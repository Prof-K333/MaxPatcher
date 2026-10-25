import * as Tone from 'tone'
import { NodeImpl, type AudioTarget } from '../NodeImpl'
import { rampParam } from '../drums/rampParam'
import { dbToGain, faderToGain } from '../mixMath'

export const PERF_CHANNELS = 6
const MUTE_RAMP = 0.005

export interface Level {
  peak: number
  rms: number
}

interface Strip {
  input: Tone.Gain
  trim: GainNode
  /** After mute/solo, before the fader: the pre-fader tap. */
  gate: GainNode
  fader: GainNode
  pan: StereoPannerNode
  analyser: AnalyserNode
  buf: Float32Array<ArrayBuffer>
  preA: GainNode
  postA: GainNode
  preB: GainNode
  postB: GainNode
  direct: Tone.Gain
  muted: boolean
  solo: boolean
  sendA: number
  sendB: number
  isPreA: boolean
  isPreB: boolean
}

const readLevel = (an: AnalyserNode, buf: Float32Array<ArrayBuffer>): Level => {
  an.getFloatTimeDomainData(buf)
  let peak = 0
  let sum = 0
  for (let i = 0; i < buf.length; i++) {
    const v = buf[i]
    const a = Math.abs(v)
    if (a > peak) peak = a
    sum += v * v
  }
  return { peak, rms: Math.sqrt(sum / buf.length) }
}

/**
 * Six-channel performance console.
 *
 * Each strip: trim → mute/solo gate → fader → pan, with Aux A/B sends that can
 * tap either side of the fader. Strips sum into one stereo bus together with
 * the two aux returns, then the master fader. Raw (rawContext) nodes are used
 * inside so every param change goes through the anchored ramp helper; only the
 * node boundary is wrapped in Tone gains so the engine can cable to it.
 */
export class PerformanceMixerImpl extends NodeImpl {
  private ctx: AudioContext
  private strips: Strip[] = []

  private auxABus: GainNode
  private auxBBus: GainNode
  private sendAOut = new Tone.Gain(1)
  private sendBOut = new Tone.Gain(1)
  private retA = new Tone.Gain(1)
  private retB = new Tone.Gain(1)
  private retAGain: GainNode
  private retBGain: GainNode

  private sum: GainNode
  private master: GainNode
  private masterAnalyserL: AnalyserNode
  private masterAnalyserR: AnalyserNode
  private masterBufL: Float32Array<ArrayBuffer>
  private masterBufR: Float32Array<ArrayBuffer>
  private splitter: ChannelSplitterNode
  private outL = new Tone.Gain(1)
  private outR = new Tone.Gain(1)
  private disposed = false

  constructor() {
    super()
    const ctx = Tone.getContext().rawContext as unknown as AudioContext
    this.ctx = ctx
    const toNative = (n: Tone.ToneAudioNode) => (n as unknown as { input: AudioNode }).input

    this.sum = ctx.createGain()
    this.master = ctx.createGain()
    this.master.gain.value = faderToGain(0.75)
    this.sum.connect(this.master)

    this.splitter = ctx.createChannelSplitter(2)
    this.master.connect(this.splitter)
    this.splitter.connect(toNative(this.outL), 0)
    this.splitter.connect(toNative(this.outR), 1)

    this.masterAnalyserL = ctx.createAnalyser()
    this.masterAnalyserR = ctx.createAnalyser()
    this.masterAnalyserL.fftSize = 256
    this.masterAnalyserR.fftSize = 256
    this.masterBufL = new Float32Array(256)
    this.masterBufR = new Float32Array(256)
    this.splitter.connect(this.masterAnalyserL, 0)
    this.splitter.connect(this.masterAnalyserR, 1)

    this.auxABus = ctx.createGain()
    this.auxBBus = ctx.createGain()
    this.auxABus.connect(toNative(this.sendAOut))
    this.auxBBus.connect(toNative(this.sendBOut))

    // Returns are stereo and enter the master sum ahead of the master fader.
    this.retAGain = ctx.createGain()
    this.retBGain = ctx.createGain()
    this.retA.connect(this.retAGain as unknown as Tone.ToneAudioNode)
    this.retB.connect(this.retBGain as unknown as Tone.ToneAudioNode)
    this.retAGain.connect(this.sum)
    this.retBGain.connect(this.sum)

    for (let i = 0; i < PERF_CHANNELS; i++) this.strips.push(this.buildStrip())
  }

  private buildStrip(): Strip {
    const ctx = this.ctx
    const toNative = (n: Tone.ToneAudioNode) => (n as unknown as { input: AudioNode }).input

    const input = new Tone.Gain(1)
    // A console channel is mono until the pan pot; fold stereo sources down.
    const trim = ctx.createGain()
    trim.channelCount = 1
    trim.channelCountMode = 'explicit'
    input.connect(trim as unknown as Tone.ToneAudioNode)

    const gate = ctx.createGain()
    const fader = ctx.createGain()
    const pan = ctx.createStereoPanner()
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 256
    trim.connect(gate)
    gate.connect(fader)
    fader.connect(pan)
    fader.connect(analyser)
    pan.connect(this.sum)

    const mk = (from: AudioNode, bus: GainNode, level: number) => {
      const g = ctx.createGain()
      g.gain.value = level
      from.connect(g)
      g.connect(bus)
      return g
    }
    const preA = mk(gate, this.auxABus, 0)
    const postA = mk(fader, this.auxABus, 0)
    const preB = mk(gate, this.auxBBus, 0)
    const postB = mk(fader, this.auxBBus, 0)

    const direct = new Tone.Gain(1)
    fader.connect(toNative(direct))

    fader.gain.value = faderToGain(0.75)

    return {
      input,
      trim,
      gate,
      fader,
      pan,
      analyser,
      buf: new Float32Array(256),
      preA,
      postA,
      preB,
      postB,
      direct,
      muted: false,
      solo: false,
      sendA: 0,
      sendB: 0,
      isPreA: false,
      isPreB: false,
    }
  }

  audioOut(handle: string): Tone.ToneAudioNode | null {
    if (handle === 'outL') return this.outL
    if (handle === 'outR') return this.outR
    if (handle === 'sendA') return this.sendAOut
    if (handle === 'sendB') return this.sendBOut
    const m = /^d(\d)$/.exec(handle)
    if (m) return this.strips[Number(m[1]) - 1]?.direct ?? null
    return null
  }

  audioIn(handle: string): AudioTarget | null {
    if (handle === 'retA') return this.retA
    if (handle === 'retB') return this.retB
    const m = /^in(\d)$/.exec(handle)
    return m ? (this.strips[Number(m[1]) - 1]?.input ?? null) : null
  }

  private ramp(param: AudioParam, value: number, seconds = 0.015) {
    rampParam(param, this.ctx, value, seconds)
  }

  /** Mute wins over solo; soloing silences everything not soloed without touching its own mute. */
  private applyGates() {
    const anySolo = this.strips.some((s) => s.solo)
    for (const s of this.strips) {
      const audible = !s.muted && (!anySolo || s.solo)
      this.ramp(s.gate.gain, audible ? 1 : 0, MUTE_RAMP)
    }
  }

  private applySends(s: Strip) {
    this.ramp(s.preA.gain, s.isPreA ? s.sendA : 0)
    this.ramp(s.postA.gain, s.isPreA ? 0 : s.sendA)
    this.ramp(s.preB.gain, s.isPreB ? s.sendB : 0)
    this.ramp(s.postB.gain, s.isPreB ? 0 : s.sendB)
  }

  setParam(key: string, value: number | string) {
    if (typeof value === 'string' && !Number.isFinite(Number(value))) return
    const n = Number(value)

    if (key === 'master') return this.ramp(this.master.gain, faderToGain(n))
    if (key === 'retA') return this.ramp(this.retAGain.gain, n)
    if (key === 'retB') return this.ramp(this.retBGain.gain, n)

    const match = /^(trim|auxA|auxB|preA|preB|pan|mute|solo|fader)(\d)$/.exec(key)
    if (!match) return
    const s = this.strips[Number(match[2]) - 1]
    if (!s) return

    switch (match[1]) {
      case 'trim':
        this.ramp(s.trim.gain, dbToGain(n))
        break
      case 'fader':
        this.ramp(s.fader.gain, faderToGain(n))
        break
      case 'pan':
        this.ramp(s.pan.pan, Math.max(-1, Math.min(1, n)))
        break
      case 'mute':
        s.muted = n >= 0.5
        this.applyGates()
        break
      case 'solo':
        s.solo = n >= 0.5
        this.applyGates()
        break
      case 'auxA':
        s.sendA = n
        this.applySends(s)
        break
      case 'auxB':
        s.sendB = n
        this.applySends(s)
        break
      case 'preA':
        s.isPreA = n >= 0.5
        this.applySends(s)
        break
      case 'preB':
        s.isPreB = n >= 0.5
        this.applySends(s)
        break
    }
  }

  /** Post-fader peak/RMS (linear) for one channel, 1-based. */
  getChannelLevel(channel: number): Level {
    const s = this.strips[channel - 1]
    return s ? readLevel(s.analyser, s.buf) : { peak: 0, rms: 0 }
  }

  getMasterLevel(): { l: Level; r: Level } {
    return {
      l: readLevel(this.masterAnalyserL, this.masterBufL),
      r: readLevel(this.masterAnalyserR, this.masterBufR),
    }
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
    for (const s of this.strips) {
      s.input.dispose()
      ;[s.trim, s.gate, s.fader, s.pan, s.analyser, s.preA, s.postA, s.preB, s.postB].forEach(off)
      s.direct.dispose()
    }
    this.strips = []
    ;[
      this.auxABus,
      this.auxBBus,
      this.retAGain,
      this.retBGain,
      this.sum,
      this.master,
      this.splitter,
      this.masterAnalyserL,
      this.masterAnalyserR,
    ].forEach(off)
    ;[this.sendAOut, this.sendBOut, this.retA, this.retB, this.outL, this.outR].forEach((n) => n.dispose())
  }

  get isDisposed() {
    return this.disposed
  }
}
