import * as Tone from 'tone'
import { NodeImpl, type AudioTarget } from '../NodeImpl'
import { rampParam } from '../drums/rampParam'
import { ensureWorkletModule } from '../worklet'
import { dbToGain } from '../mixMath'

const GATE_RAMP = 0.005
/** dB of threshold swing for a full-scale (±1) threshold CV at depth 1. */
const CV_DB = 30

/**
 * Bus compressor / sidechain ducker.
 *
 * Bus mode runs the native DynamicsCompressorNode. DynamicsCompressorNode has
 * no external key input, so ducking mode builds its own: the sidechain goes
 * through a switchable high-pass into `duck-processor` (public/looper-processor.js),
 * which rectifies, smooths and runs a gain computer, then emits the gain
 * reduction as a signal. That signal is inverted and summed onto the gain
 * param of a plain GainNode sitting in the main path, so the ducking itself is
 * applied by Web Audio, sample-accurately, with no main-thread involvement.
 *
 * Until the worklet has loaded the duck gain stays at its base value of 1, so
 * audio passes rather than going silent.
 *
 * In bus mode the same detector watches the main mix (emulating the native
 * compressor's settings) purely to drive the Gain Reduction CV outlet; the
 * meter reads the native compressor's true `reduction` instead.
 */
export class BusCompressorImpl extends NodeImpl {
  private ctx: AudioContext
  private disposed = false

  private inL = new Tone.Gain(1)
  private inR = new Tone.Gain(1)
  private scIn = new Tone.Gain(1)
  private cvIn = new Tone.Gain(1)
  private outL = new Tone.Gain(1)
  private outR = new Tone.Gain(1)
  private grOut = new Tone.Gain(1)
  private sink = new Tone.Gain(0)

  private normal: GainNode
  private merger: ChannelMergerNode
  private comp: DynamicsCompressorNode
  private busGate: GainNode
  private duckGain: GainNode
  private duckGate: GainNode
  private makeup: GainNode
  private outStage: GainNode
  private final: GainNode
  private splitter: ChannelSplitterNode

  private scDirect: GainNode
  private scHpf: BiquadFilterNode
  private scHpfGain: GainNode
  private scMix: GainNode
  private listen: GainNode
  private scDet: GainNode
  private busDet: GainNode
  private cvScale: GainNode
  private compCv: GainNode
  private negate: GainNode

  private worklet: AudioWorkletNode | null = null
  private grDb = 0
  private cfg = {
    mode: 'bus',
    threshold: -18,
    ratio: 4,
    inf: false,
    attack: 10,
    release: 150,
    auto: false,
    depth: 100,
    hpf: 'off',
    makeup: 0,
    listen: false,
    modDepth: 1,
  }
  loadError: string | null = null

  constructor() {
    super()
    const context = Tone.getContext() as Tone.Context
    const ctx = context.rawContext as unknown as AudioContext
    this.ctx = ctx
    const nat = (n: Tone.ToneAudioNode) => (n as unknown as { input: AudioNode }).input

    this.merger = ctx.createChannelMerger(2)
    this.normal = ctx.createGain()
    this.inL.connect(this.merger as unknown as Tone.ToneAudioNode, 0, 0)
    this.inL.connect(this.normal as unknown as Tone.ToneAudioNode)
    this.normal.connect(this.merger, 0, 1)
    this.inR.connect(this.merger as unknown as Tone.ToneAudioNode, 0, 1)

    this.comp = ctx.createDynamicsCompressor()
    this.comp.knee.value = 6
    this.busGate = ctx.createGain()
    this.duckGain = ctx.createGain()
    this.duckGain.gain.value = 1
    this.duckGate = ctx.createGain()
    this.duckGate.gain.value = 0
    this.makeup = ctx.createGain()
    this.outStage = ctx.createGain()
    this.final = ctx.createGain()
    this.splitter = ctx.createChannelSplitter(2)

    this.merger.connect(this.comp)
    this.comp.connect(this.busGate)
    this.merger.connect(this.duckGain)
    this.duckGain.connect(this.duckGate)
    this.busGate.connect(this.makeup)
    this.duckGate.connect(this.makeup)
    this.makeup.connect(this.outStage)
    this.outStage.connect(this.final)
    this.final.connect(this.splitter)
    this.splitter.connect(nat(this.outL), 0)
    this.splitter.connect(nat(this.outR), 1)

    // Sidechain: optional high-pass, then the detector input (and Listen).
    this.scDirect = ctx.createGain()
    this.scHpf = ctx.createBiquadFilter()
    this.scHpf.type = 'highpass'
    this.scHpf.Q.value = 0.707
    this.scHpf.frequency.value = 120
    this.scHpfGain = ctx.createGain()
    this.scHpfGain.gain.value = 0
    this.scMix = ctx.createGain()
    this.scIn.connect(this.scDirect as unknown as Tone.ToneAudioNode)
    this.scIn.connect(this.scHpf as unknown as Tone.ToneAudioNode)
    this.scDirect.connect(this.scMix)
    this.scHpf.connect(this.scHpfGain)
    this.scHpfGain.connect(this.scMix)

    this.listen = ctx.createGain()
    this.listen.gain.value = 0
    this.scMix.connect(this.listen)
    this.listen.connect(this.final)

    this.scDet = ctx.createGain()
    this.busDet = ctx.createGain()
    this.busDet.gain.value = 0
    this.scMix.connect(this.scDet)
    this.merger.connect(this.busDet)

    // Threshold CV: scaled to dB, then to the detector and the native threshold.
    this.cvScale = ctx.createGain()
    this.cvScale.gain.value = CV_DB
    this.compCv = ctx.createGain()
    this.cvIn.connect(this.cvScale as unknown as Tone.ToneAudioNode)
    this.cvScale.connect(this.comp.threshold)

    this.negate = ctx.createGain()
    this.negate.gain.value = -1
    this.compCv.gain.value = 1 / CV_DB
    this.cvScale.connect(this.compCv)

    // A worklet nobody pulls never runs: its second output goes to a muted
    // path to the destination so the detector is live even with no cables out.
    this.sink.connect(Tone.getDestination())

    void this.load(context)
  }

  private async load(context: Tone.Context) {
    try {
      await ensureWorkletModule(context, 'looper-processor.js')
      if (this.disposed) return
      const node = context.createAudioWorkletNode('duck-processor', {
        numberOfInputs: 2,
        numberOfOutputs: 2,
        outputChannelCount: [1, 1],
        channelCount: 1,
        channelCountMode: 'explicit',
      })
      const nat = (n: Tone.ToneAudioNode) => (n as unknown as { input: AudioNode }).input
      this.scDet.connect(node, 0, 0)
      this.busDet.connect(node, 0, 0)
      this.compCv.connect(node, 0, 1)
      node.connect(this.negate, 0)
      this.negate.connect(this.duckGain.gain)
      node.connect(nat(this.grOut), 1)
      node.connect(nat(this.sink), 1)
      node.port.onmessage = (e) => {
        if (e.data?.type === 'gr') this.grDb = e.data.db
      }
      this.worklet = node
      this.pushConfig()
    } catch (err) {
      console.error('[busCompressor] worklet failed to load', err)
      this.loadError = err instanceof Error ? err.message : String(err)
    }
  }

  audioOut(handle: string): Tone.ToneAudioNode | null {
    if (handle === 'outR') return this.outR
    if (handle === 'gr') return this.grOut
    return this.outL
  }

  audioIn(handle: string): AudioTarget | null {
    if (handle === 'inR') return this.inR
    if (handle === 'sc') return this.scIn
    if (handle === 'cv:threshold') return this.cvIn
    return this.inL
  }

  onConnectionChange(handle: string, connected: boolean) {
    // Mono-normalling: an unpatched R inlet follows L.
    if (handle === 'inR') this.ramp(this.normal.gain, connected ? 0 : 1)
  }

  private ramp(param: AudioParam, value: number, seconds = 0.015) {
    rampParam(param, this.ctx, value, seconds)
  }

  /** Pushes the whole configuration to the audio graph and the detector. */
  private pushConfig() {
    const c = this.cfg
    const duck = c.mode === 'duck'
    const ratio = c.inf ? 1000 : c.ratio

    this.ramp(this.busGate.gain, duck ? 0 : 1, GATE_RAMP)
    this.ramp(this.duckGate.gain, duck ? 1 : 0, GATE_RAMP)
    this.ramp(this.scDet.gain, duck ? 1 : 0, GATE_RAMP)
    this.ramp(this.busDet.gain, duck ? 0 : 1, GATE_RAMP)

    // The native compressor tops out at ratio 20 and release 1 s.
    this.ramp(this.comp.threshold, c.threshold)
    this.ramp(this.comp.ratio, Math.min(20, ratio))
    this.ramp(this.comp.attack, Math.max(0, c.attack / 1000))
    this.ramp(this.comp.release, c.auto ? 0.25 : Math.min(1, c.release / 1000))
    this.comp.knee.value = c.inf ? 0 : 6

    this.ramp(this.makeup.gain, dbToGain(c.makeup))
    this.ramp(this.cvScale.gain, CV_DB * c.modDepth)

    const hpf = c.hpf === 'off' ? 0 : Number(c.hpf)
    if (hpf > 0) this.ramp(this.scHpf.frequency, hpf)
    this.ramp(this.scDirect.gain, hpf > 0 ? 0 : 1, GATE_RAMP)
    this.ramp(this.scHpfGain.gain, hpf > 0 ? 1 : 0, GATE_RAMP)

    // Listen SC swaps the output for the filtered trigger signal.
    this.ramp(this.outStage.gain, c.listen ? 0 : 1, GATE_RAMP)
    this.ramp(this.listen.gain, c.listen ? 1 : 0, GATE_RAMP)

    this.worklet?.port.postMessage({
      type: 'config',
      threshold: c.threshold,
      ratio,
      attack: c.attack,
      release: c.release,
      auto: c.auto,
      depth: c.depth / 100,
      knee: c.inf ? 0 : 6,
      cvDb: CV_DB,
    })
  }

  setParam(key: string, value: number | string) {
    const c = this.cfg as Record<string, number | string | boolean>
    switch (key) {
      case 'mode':
      case 'hpf':
        c[key] = String(value)
        break
      case 'inf':
      case 'auto':
      case 'listen':
        c[key] = Number(value) >= 0.5
        break
      case 'mod_threshold':
        c.modDepth = Number(value)
        break
      case 'threshold':
      case 'ratio':
      case 'attack':
      case 'release':
      case 'makeup':
      case 'depth':
        if (!Number.isFinite(Number(value))) return
        c[key] = Number(value)
        break
      default:
        return
    }
    this.pushConfig()
  }

  /** Current gain reduction in positive dB (0 = none), for the meter. */
  getGainReductionDb(): number {
    if (this.cfg.mode === 'bus') return Math.max(0, -this.comp.reduction)
    return this.grDb
  }

  dispose() {
    this.disposed = true
    const off = (n: AudioNode) => {
      try {
        n.disconnect()
      } catch {
        /* already gone */
      }
    }
    if (this.worklet) {
      this.worklet.port.onmessage = null
      off(this.worklet)
      this.worklet = null
    }
    ;[
      this.normal,
      this.merger,
      this.comp,
      this.busGate,
      this.duckGain,
      this.duckGate,
      this.makeup,
      this.outStage,
      this.final,
      this.splitter,
      this.scDirect,
      this.scHpf,
      this.scHpfGain,
      this.scMix,
      this.listen,
      this.scDet,
      this.busDet,
      this.cvScale,
      this.compCv,
      this.negate,
    ].forEach(off)
    ;[this.inL, this.inR, this.scIn, this.cvIn, this.outL, this.outR, this.grOut, this.sink].forEach((n) => n.dispose())
  }
}
