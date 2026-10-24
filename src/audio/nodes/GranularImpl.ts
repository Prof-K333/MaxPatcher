import * as Tone from 'tone'
import { NodeImpl, type AudioTarget } from '../NodeImpl'
import { CVInlet } from '../cv'
import { GranularAudioEngine, type Direction } from '../granular/GranularAudioEngine'
import { createDefaultBuffer } from '../granular/defaultBuffer'
import { detectTransients } from '../granular/slicing'
import type { WindowShape } from '../granular/windows'
import type { PatchEvent } from '../types'
import { ensureWorkletModule } from '../worklet'

/** Seconds of rolling audio kept for live re-sampling. */
const LIVE_SECONDS = 8

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

/**
 * Granular cloud and slicing sampler.
 *
 * Two modes share one buffer: "cloud" runs the grain scheduler continuously,
 * while "slice" turns incoming notes into one-shot playback of detected
 * transients. The grain engine itself is deliberately plain Web Audio — Tone
 * wraps the node's input and output so it patches like anything else.
 */
export class GranularImpl extends NodeImpl {
  private out = new Tone.Gain(1)
  private splitter: ChannelSplitterNode
  private left = new Tone.Gain(1)
  private right = new Tone.Gain(1)
  private granular: GranularAudioEngine

  // CV inlets are sampled by the scheduler rather than patched into Params,
  // because grain parameters are decided in JS once per grain.
  private posCV = new CVInlet(1)
  private pitchCV = new CVInlet(1)
  private densityCV = new CVInlet(1)
  private sizeCV = new CVInlet(1)

  private base = { position: 0.25, pitch: 1, density: 20, size: 0.12 }
  private mode: 'cloud' | 'slice' = 'cloud'
  private slices: number[] = []
  private slicePlayer = new Tone.Player()
  private cvTimer: number | null = null
  private grainPulse = 0

  // Live re-sampling.
  private liveIn = new Tone.Gain(1)
  private capture: AudioWorkletNode | null = null
  private liveBuffer: AudioBuffer | null = null
  private writeIndex = 0
  private source: 'file' | 'live' = 'file'
  private captureLoading = false
  private captureSink = new Tone.Gain(0)
  liveSeconds = LIVE_SECONDS

  fileName = 'Default Bell'
  /** Kept so switching back from live restores the loaded sample. */
  private fileBuffer: AudioBuffer | null = null
  onBufferChange: (() => void) | null = null
  /** Latest grain positions, drained by the canvas for its particles. */
  grainTrail: Array<{ pos: number; pan: number; born: number }> = []

  constructor(master: Tone.ToneAudioNode) {
    super()
    const ctx = Tone.getContext().rawContext as unknown as AudioContext

    this.granular = new GranularAudioEngine(ctx, this.out.input as unknown as AudioNode)

    // Split the stereo cloud so Audio Out L / R can be patched separately.
    this.splitter = ctx.createChannelSplitter(2)
    this.out.connect(this.splitter as unknown as Tone.ToneAudioNode)
    this.splitter.connect(this.left.input as unknown as AudioNode, 0)
    this.splitter.connect(this.right.input as unknown as AudioNode, 1)

    this.slicePlayer.connect(this.out)
    this.captureSink.connect(Tone.getDestination())

    const buffer = createDefaultBuffer(ctx)
    this.fileBuffer = buffer
    this.granular.setBuffer(buffer)
    this.slicePlayer.buffer = new Tone.ToneAudioBuffer(buffer)
    this.slices = detectTransients(buffer)

    this.granular.onGrain = (pos, pan) => {
      this.grainTrail.push({ pos, pan, born: performance.now() })
      if (this.grainTrail.length > 120) this.grainTrail.shift()
      // Bangs are throttled: at 80 grains/sec an unthrottled event outlet
      // would flood the main thread and the rest of the patch.
      if (++this.grainPulse % 4 === 0) this.emit('ev:grain', { type: 'bang' })
    }

    void master // master bus is reached through the normal cable graph
  }

  // ------------------------------------------------------------------ ports

  audioOut(handle: string): Tone.ToneAudioNode | null {
    if (handle === 'outL') return this.left
    if (handle === 'outR') return this.right
    return this.out
  }

  audioIn(handle: string): AudioTarget | null {
    switch (handle) {
      case 'in':
        return this.liveIn
      case 'cv:pos':
        return this.posCV.input
      case 'cv:pitch':
        return this.pitchCV.input
      case 'cv:density':
        return this.densityCV.input
      case 'cv:size':
        return this.sizeCV.input
      default:
        return null
    }
  }

  onConnectionChange(handle: string, connected: boolean) {
    const inlet = {
      'cv:pos': this.posCV,
      'cv:pitch': this.pitchCV,
      'cv:density': this.densityCV,
      'cv:size': this.sizeCV,
    }[handle]
    if (!inlet) return
    inlet.setConnected(connected)
    this.refreshCVPolling()
  }

  private get anyCVConnected() {
    return [this.posCV, this.pitchCV, this.densityCV, this.sizeCV].some((i) => i.value() !== 0)
  }

  /** CV is folded into the grain params at control rate. */
  private refreshCVPolling() {
    if (this.cvTimer !== null) return
    this.cvTimer = window.setInterval(() => {
      const p = this.granular.params
      p.position = clamp01(this.base.position + this.posCV.value())
      p.pitch = Math.max(0.01, this.base.pitch * Math.pow(2, this.pitchCV.value() * 2))
      p.density = Math.min(80, Math.max(1, this.base.density + this.densityCV.value() * 40))
      p.size = Math.min(0.5, Math.max(0.01, this.base.size + this.sizeCV.value() * 0.25))
    }, 16)
  }

  // ------------------------------------------------------------------- live

  /**
   * Starts capturing whatever is patched into the audio inlet.
   *
   * The ring is an AudioBuffer written in place while grains read from it.
   * That is only safe because the scheduler confines grains to a window
   * trailing the write head — see `GranularAudioEngine.live`.
   */
  private async startCapture() {
    if (this.capture || this.captureLoading) return
    this.captureLoading = true
    try {
      const context = Tone.getContext() as Tone.Context
      await ensureWorkletModule(context, 'looper-processor.js')
      if (this.disposed) return

      const ctx = context.rawContext as unknown as AudioContext
      this.liveBuffer = ctx.createBuffer(2, Math.floor(LIVE_SECONDS * ctx.sampleRate), ctx.sampleRate)
      this.writeIndex = 0

      const node = context.createAudioWorkletNode('capture-processor', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
        channelCount: 2,
        channelCountMode: 'explicit',
      })
      this.liveIn.connect(node as unknown as Tone.ToneAudioNode)
      // Its output is silence, but it has to reach the destination or the
      // graph has no reason to pull the node and process() never runs.
      node.connect(this.captureSink.input as unknown as AudioNode)
      node.port.onmessage = (e) => this.onCaptured(e.data)
      this.capture = node

      this.granular.setLive(true, this.liveBuffer, this.liveBuffer.length)
      this.onBufferChange?.()
    } catch (err) {
      console.error('[granular] live capture failed to start', err)
    } finally {
      this.captureLoading = false
    }
  }

  private onCaptured(msg: { type: string; left?: Float32Array; right?: Float32Array }) {
    const buf = this.liveBuffer
    if (msg.type !== 'audio' || !buf || !msg.left || !msg.right) return

    const L = buf.getChannelData(0)
    const R = buf.getChannelData(1)
    const len = L.length
    let w = this.writeIndex
    for (let i = 0; i < msg.left.length; i++) {
      L[w] = msg.left[i]
      R[w] = msg.right[i]
      if (++w === len) w = 0
    }
    this.writeIndex = w
    this.granular.liveWriteIndex = w
  }

  private stopCapture() {
    if (this.capture) {
      this.capture.port.onmessage = null
      this.capture.disconnect()
      this.capture = null
    }
    this.liveBuffer = null
  }

  // ----------------------------------------------------------------- buffer

  get buffer(): AudioBuffer | null {
    return this.granular.getBuffer()
  }

  get sliceCount(): number {
    return this.slices.length
  }

  getSlices(): number[] {
    return this.slices
  }

  setSlices(slices: number[]) {
    this.slices = [...slices].sort((a, b) => a - b)
    this.onBufferChange?.()
  }

  loadBuffer(buffer: AudioBuffer, fileName: string) {
    this.fileBuffer = buffer
    if (this.source === 'live') {
      this.source = 'file'
      this.stopCapture()
      this.granular.setLive(false, buffer)
    }
    this.granular.setBuffer(buffer)
    this.slicePlayer.buffer = new Tone.ToneAudioBuffer(buffer)
    this.slices = detectTransients(buffer)
    this.fileName = fileName
    this.onBufferChange?.()
  }

  resliceFromTransients() {
    const buffer = this.buffer
    if (buffer) this.setSlices(detectTransients(buffer))
  }

  // ----------------------------------------------------------------- params

  setParam(key: string, value: number | string) {
    const n = Number(value)
    const p = this.granular.params

    if (key.startsWith('mod_')) {
      const inlet = { mod_pos: this.posCV, mod_pitch: this.pitchCV, mod_density: this.densityCV, mod_size: this.sizeCV }[key]
      inlet?.setDepth(n)
      return
    }

    switch (key) {
      case 'source': {
        const next = value === 'live' ? 'live' : 'file'
        if (next === this.source) break
        this.source = next
        if (next === 'live') {
          void this.startCapture()
        } else {
          this.stopCapture()
          this.granular.setLive(false, this.fileBuffer)
          this.onBufferChange?.()
        }
        break
      }
      case 'mode':
        this.mode = value === 'slice' ? 'slice' : 'cloud'
        if (this.mode === 'slice') this.granular.stop()
        else if (this.isLive) this.granular.start()
        break
      case 'position':
        this.base.position = n
        p.position = n
        break
      case 'spray':
        p.spray = n
        break
      case 'size':
        this.base.size = n
        p.size = n
        break
      case 'density':
        this.base.density = n
        p.density = n
        break
      case 'pitch':
        this.base.pitch = n
        p.pitch = n
        this.slicePlayer.playbackRate = Math.max(0.01, n)
        break
      case 'pitchJitter':
        p.pitchJitter = n
        break
      case 'spread':
        p.spread = n
        break
      case 'window':
        p.window = value as WindowShape
        break
      case 'direction':
        p.direction = value as Direction
        break
      case 'freeze':
        this.granular.setFreeze(n >= 0.5)
        break
      case 'reverse':
        this.slicePlayer.reverse = n >= 0.5
        break
      case 'crossfade':
        this.slicePlayer.fadeIn = n / 1000
        this.slicePlayer.fadeOut = n / 1000
        break
      case 'mix':
        p.gain = n
        this.out.gain.rampTo(n, 0.02)
        break
    }
  }

  // ----------------------------------------------------------------- events

  onEvent(handle: string, event: PatchEvent) {
    if (handle === 'ev:freeze') {
      if (event.type !== 'noteOff') {
        const next = !this.granular.params.freeze
        this.granular.setFreeze(next)
      }
      return
    }

    if (event.type === 'noteOff') return

    if (this.mode === 'slice') {
      this.playSlice(event)
    } else {
      // A trigger in cloud mode fires a short burst rather than one grain,
      // which is what actually reads as a gesture.
      for (let i = 0; i < 6; i++) this.granular.bang()
    }
  }

  private playSlice(event: PatchEvent) {
    const buffer = this.buffer
    if (!buffer || !this.slices.length) return

    // Notes select slices by index from the bottom of the keyboard, so a
    // chromatic run walks through the sliced material in order.
    const index = event.type === 'noteOn' ? (event.note - 48 + this.slices.length * 4) % this.slices.length : 0
    const start = this.slices[index] * buffer.duration
    const end = index + 1 < this.slices.length ? this.slices[index + 1] * buffer.duration : buffer.duration

    try {
      this.slicePlayer.start(event.time ?? Tone.now(), start, Math.max(0.02, end - start))
    } catch {
      /* overlapping retriggers are harmless */
    }
  }

  // -------------------------------------------------------------- lifecycle

  private isLive = false
  private disposed = false

  /** True while the node is capturing from its audio inlet. */
  get isCapturing(): boolean {
    return !!this.capture
  }

  onStart() {
    this.isLive = true
    if (this.mode === 'cloud') this.granular.start()
    if (this.anyCVConnected) this.refreshCVPolling()
  }

  onStop() {
    this.isLive = false
    this.granular.stop()
    if (this.cvTimer !== null) {
      clearInterval(this.cvTimer)
      this.cvTimer = null
    }
  }

  dispose() {
    this.disposed = true
    this.stopCapture()
    this.captureSink.dispose()
    this.liveIn.dispose()
    this.onStop()
    this.granular.dispose()
    this.slicePlayer.dispose()
    this.posCV.dispose()
    this.pitchCV.dispose()
    this.densityCV.dispose()
    this.sizeCV.dispose()
    this.left.dispose()
    this.right.dispose()
    this.out.dispose()
  }
}
