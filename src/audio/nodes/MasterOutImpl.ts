import * as Tone from 'tone'
import { NodeImpl, type AudioTarget } from '../NodeImpl'
import { ensureWorkletModule } from '../worklet'
import { encodeWav, type RecordedAudio } from '../recorder'

/** Stop runaway takes before they eat the tab's memory. */
const MAX_MINUTES = 10

/**
 * The master output, with a recorder built in.
 *
 * It taps the engine's master bus rather than its own inlet, so what lands in
 * the file is exactly what you hear — master volume and all — without having
 * to patch anything. Samples come up from the capture worklet and are kept as
 * raw chunks until you stop, then written out as a wav.
 */
export class MasterOutImpl extends NodeImpl {
  private gain = new Tone.Gain(1)
  private tap = new Tone.Gain(1)
  private sink = new Tone.Gain(0)
  private capture: AudioWorkletNode | null = null
  private ctx: AudioContext
  private masterBus: Tone.ToneAudioNode
  private disposed = false
  private starting = false

  private left: Float32Array[] = []
  private right: Float32Array[] = []
  private frames = 0

  recording = false
  /** Seconds captured so far, for the UI readout. */
  elapsed = 0
  lastTake: RecordedAudio | null = null
  onChange: (() => void) | null = null
  onError: ((message: string) => void) | null = null

  constructor(master: Tone.ToneAudioNode) {
    super()
    this.ctx = Tone.getContext().rawContext as unknown as AudioContext
    this.masterBus = master
    this.gain.connect(master)
    // The capture node needs a path to the destination or the graph never
    // pulls it; its own output is silence.
    this.sink.connect(Tone.getDestination())
  }

  audioOut(): Tone.ToneAudioNode | null {
    return null
  }

  audioIn(): AudioTarget {
    return this.gain
  }

  setParam() {
    // Volume is handled by the engine's master bus, not here.
  }

  // -------------------------------------------------------------- recording

  private async ensureCapture(): Promise<boolean> {
    if (this.capture) return true
    if (this.starting) return false
    this.starting = true
    try {
      const context = Tone.getContext() as Tone.Context
      await ensureWorkletModule(context, 'looper-processor.js')
      if (this.disposed) return false

      const node = context.createAudioWorkletNode('capture-processor', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
        channelCount: 2,
        channelCountMode: 'explicit',
      })
      // Tap the master bus: the file then matches what the speakers get.
      this.masterBus.connect(this.tap)
      this.tap.connect(node as unknown as Tone.ToneAudioNode)
      node.connect(this.sink.input as unknown as AudioNode)
      node.port.onmessage = (e) => this.onCaptured(e.data)
      this.capture = node
      return true
    } catch (err) {
      console.error('[master] recorder failed to start', err)
      this.onError?.('Could not start the recorder.')
      return false
    } finally {
      this.starting = false
    }
  }

  private onCaptured(msg: { type: string; left?: Float32Array; right?: Float32Array }) {
    if (!this.recording || msg.type !== 'audio' || !msg.left || !msg.right) return
    this.left.push(msg.left)
    this.right.push(msg.right)
    this.frames += msg.left.length
    this.elapsed = this.frames / this.ctx.sampleRate
    if (this.elapsed >= MAX_MINUTES * 60) {
      this.stop()
      this.onError?.(`Stopped at the ${MAX_MINUTES} minute limit.`)
    }
    this.onChange?.()
  }

  async start() {
    if (this.recording) return
    if (!(await this.ensureCapture())) return
    this.left = []
    this.right = []
    this.frames = 0
    this.elapsed = 0
    this.lastTake = null
    this.recording = true
    this.onChange?.()
  }

  /** Ends the take and returns the encoded file. */
  stop(): RecordedAudio | null {
    if (!this.recording) return this.lastTake
    this.recording = false
    if (!this.frames) {
      this.onChange?.()
      return null
    }
    this.lastTake = encodeWav(this.left, this.right, this.ctx.sampleRate)
    this.left = []
    this.right = []
    this.onChange?.()
    return this.lastTake
  }

  discard() {
    this.recording = false
    this.left = []
    this.right = []
    this.frames = 0
    this.elapsed = 0
    this.lastTake = null
    this.onChange?.()
  }

  onStop() {
    // Suspending the context stops samples arriving, so close the take
    // rather than leaving it half-recorded and apparently still running.
    if (this.recording) this.stop()
  }

  dispose() {
    this.disposed = true
    if (this.capture) {
      this.capture.port.onmessage = null
      this.capture.disconnect()
      this.capture = null
    }
    this.onChange = null
    this.onError = null
    this.left = []
    this.right = []
    this.tap.dispose()
    this.sink.dispose()
    this.gain.dispose()
  }
}
