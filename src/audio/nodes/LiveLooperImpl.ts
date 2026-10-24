import * as Tone from 'tone'
import { NodeImpl, type AudioTarget } from '../NodeImpl'
import type { PatchEvent } from '../types'

export type LooperState = 'EMPTY' | 'RECORDING' | 'PLAYING' | 'OVERDUBBING' | 'STOPPED' | 'LOADING'

export interface LooperStatus {
  state: LooperState
  loopSeconds: number
  phase: number
  recordedSeconds: number
}

const WORKLET_URL = `${import.meta.env.BASE_URL ?? '/'}looper-processor.js`.replace('//', '/')

/**
 * Registered once per AudioContext. Calling addModule twice is harmless but
 * the promise is shared so a canvas full of loopers does not refetch it.
 */
const registry = new WeakMap<BaseAudioContext, Promise<void>>()

function ensureWorklet(context: Tone.Context): Promise<void> {
  const raw = context.rawContext as unknown as BaseAudioContext
  let pending = registry.get(raw)
  if (!pending) {
    pending = context.addAudioWorkletModule(WORKLET_URL)
    registry.set(raw, pending)
  }
  return pending
}

/**
 * Live sound-on-sound looper.
 *
 * The DSP lives in an AudioWorklet (`public/looper-processor.js`); this class
 * only owns the plumbing — getting the module registered, wiring the worklet
 * between the node's inlets and outlets once it exists, and relaying commands
 * and status. Loading is asynchronous, so audio passes through dry until the
 * worklet is live rather than dropping out.
 */
export class LiveLooperImpl extends NodeImpl {
  private inL = new Tone.Gain(1)
  private inR = new Tone.Gain(1)
  private speedCV = new Tone.Gain(1)
  private outL = new Tone.Gain(1)
  private outR = new Tone.Gain(1)
  private out = new Tone.Gain(1)
  private phaseOut = new Tone.Gain(1)

  private merger: ChannelMergerNode
  /**
   * A real DelayNode sitting in front of the worklet.
   *
   * Web Audio mutes any feedback cycle that is not broken by a DelayNode, and
   * an AudioWorklet does not count — nor does Tone's delay, whose dry path
   * bypasses its own delay line and leaves a delay-free loop. Putting 10ms of
   * genuine delay on the looper's input means every cycle through it is legal,
   * which is what makes tape-style feedback patches work at all. It is also
   * honest: real tape has a gap between the record and play heads.
   */
  private inDelay: DelayNode
  private splitter: ChannelSplitterNode
  private worklet: AudioWorkletNode | null = null
  private ctx: AudioContext
  private disposed = false
  /** Params set before the worklet existed, replayed once it does. */
  private pending: Record<string, number> = {}
  private config = { reverse: false, halfSpeed: false }
  /** Non-null when the worklet could not be built, so the UI can say so. */
  loadError: string | null = null

  status: LooperStatus = { state: 'LOADING', loopSeconds: 0, phase: 0, recordedSeconds: 0 }
  onStatus: ((status: LooperStatus) => void) | null = null
  onPeaks: ((peaks: Float32Array) => void) | null = null

  constructor() {
    super()
    const context = Tone.getContext() as Tone.Context
    this.ctx = context.rawContext as unknown as AudioContext

    // Two mono inlets are merged into the stereo pair the worklet expects.
    // Each has to land on its own merger input, which means addressing the
    // channels explicitly rather than using Tone's connect.
    this.merger = this.ctx.createChannelMerger(2)
    this.inL.connect(this.merger as unknown as Tone.ToneAudioNode, 0, 0)
    this.inR.connect(this.merger as unknown as Tone.ToneAudioNode, 0, 1)

    this.inDelay = this.ctx.createDelay(0.5)
    this.inDelay.delayTime.value = 0.01
    this.merger.connect(this.inDelay)

    this.splitter = this.ctx.createChannelSplitter(2)
    this.splitter.connect(this.outL.input as unknown as AudioNode, 0)
    this.splitter.connect(this.outR.input as unknown as AudioNode, 1)

    void this.load(context)
  }

  private async load(context: Tone.Context) {
    try {
      await ensureWorklet(context)
      if (this.disposed) return

      // Tone wraps the AudioContext (standardized-audio-context), and the
      // global AudioWorkletNode constructor rejects that wrapper outright.
      // Tone's own factory builds a node the wrapped graph will accept.
      const node = context.createAudioWorkletNode('looper-processor', {
        numberOfInputs: 2,
        numberOfOutputs: 2,
        outputChannelCount: [2, 1],
        channelCount: 2,
        channelCountMode: 'explicit',
      })

      this.inDelay.connect(node, 0, 0)
      this.speedCV.connect(node as unknown as Tone.ToneAudioNode, 0, 1)
      node.connect(this.out.input as unknown as AudioNode, 0)
      node.connect(this.splitter, 0)
      node.connect(this.phaseOut.input as unknown as AudioNode, 1)

      node.port.onmessage = (e) => this.onWorkletMessage(e.data)
      this.worklet = node

      for (const [key, value] of Object.entries(this.pending)) this.setParam(key, value)
      node.port.postMessage({ type: 'config', ...this.config })
      this.update({ state: 'EMPTY' })
    } catch (err) {
      console.error('[looper] worklet failed to load', err)
      this.loadError = err instanceof Error ? err.message : String(err)
      this.update({ state: 'EMPTY' })
    }
  }

  private onWorkletMessage(msg: { type: string } & Record<string, unknown>) {
    if (msg.type === 'state') {
      this.update({
        state: msg.state as LooperState,
        loopSeconds: msg.loopSeconds as number,
        phase: msg.phase as number,
        recordedSeconds: msg.recordedSeconds as number,
      })
    } else if (msg.type === 'cycle') {
      this.emit('ev:cycle', { type: 'bang' })
    } else if (msg.type === 'peaks') {
      this.onPeaks?.(msg.peaks as Float32Array)
    }
  }

  private update(next: Partial<LooperStatus>) {
    this.status = { ...this.status, ...next }
    this.onStatus?.(this.status)
  }

  // ------------------------------------------------------------------- ports

  audioOut(handle: string): Tone.ToneAudioNode | null {
    switch (handle) {
      case 'outL':
        return this.outL
      case 'outR':
        return this.outR
      case 'phase':
        return this.phaseOut
      default:
        return this.out
    }
  }

  audioIn(handle: string): AudioTarget | null {
    switch (handle) {
      case 'inR':
        return this.inR
      case 'cv:speed':
        return this.speedCV
      default:
        return this.inL
    }
  }

  // ---------------------------------------------------------------- controls

  command(type: 'recordOrDub' | 'playStop' | 'stop' | 'clear') {
    this.worklet?.port.postMessage({ type })
  }

  requestPeaks(columns = 160) {
    this.worklet?.port.postMessage({ type: 'requestPeaks', columns })
  }

  setParam(key: string, value: number | string) {
    const n = Number(value)

    if (key === 'reverse' || key === 'halfSpeed') {
      this.config[key] = n >= 0.5
      this.worklet?.port.postMessage({ type: 'config', ...this.config })
      return
    }

    const name = { speed: 'speed', feedback: 'feedback', mix: 'mix', gain: 'gain', mod_speed: 'cvAmount' }[key]
    if (!name) return

    if (!this.worklet) {
      this.pending[key] = n
      return
    }
    const param = this.worklet.parameters.get(name)
    param?.setTargetAtTime(n, this.ctx.currentTime, 0.01)
  }

  onEvent(handle: string, event: PatchEvent) {
    if (event.type === 'noteOff') return
    if (handle === 'ev:rec') this.command('recordOrDub')
    else if (handle === 'ev:play') this.command('playStop')
    else if (handle === 'ev:clear') this.command('clear')
  }

  onStop() {
    this.command('stop')
  }

  dispose() {
    this.disposed = true
    if (this.worklet) {
      // Without this the processor keeps running and holding its 60s buffers.
      this.worklet.port.onmessage = null
      this.worklet.port.postMessage({ type: 'clear' })
      this.worklet.disconnect()
      this.worklet = null
    }
    this.onStatus = null
    this.onPeaks = null
    this.merger.disconnect()
    this.inDelay.disconnect()
    this.splitter.disconnect()
    this.inL.dispose()
    this.inR.dispose()
    this.speedCV.dispose()
    this.outL.dispose()
    this.outR.dispose()
    this.phaseOut.dispose()
    this.out.dispose()
  }
}
