import * as Tone from 'tone'
import { NodeImpl, type AudioTarget } from '../NodeImpl'
import { CVInlet } from '../cv'
import { rampParam } from '../drums/rampParam'
import type { PatchEvent } from '../types'

/** Sixteenths per note value; an incoming clock tick is taken to be one sixteenth. */
export const SYNC_DIVISIONS: Record<string, number> = { '1/16': 1, '1/8': 2, '1/8.': 3, '1/4': 4, '1/2': 8 }

const MAX_DELAY = 2.5
const MAX_TIME = 2
/** Seconds of delay-time swing for a full-scale (±1) CV at depth 1. */
const CV_SECONDS = 0.25
/** Freeverb's tuning, in seconds at 44.1 kHz; the right bank is offset for stereo width. */
const COMB_TIMES = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617].map((n) => n / 44100)
const ALLPASS_TIMES = [556, 441, 341, 225].map((n) => n / 44100)
const STEREO_SPREAD = 23 / 44100
const FROZEN_FEEDBACK = 0.9995
/**
 * Lowpass/highpass Q is in dB in Web Audio and defaults to +1 dB — a resonance
 * peak that, inside a feedback loop, pushes loop gain past unity. -3.01 dB is
 * the flat (Butterworth) response.
 */
const FLAT_Q = -3.0103

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

interface Comb {
  inGain: GainNode
  fb: GainNode
  lp: BiquadFilterNode
  time: number
}

interface Allpass {
  fb: GainNode
  ff: GainNode
}

/**
 * Stereo ping-pong / tape delay plus a Freeverb-style plate (Schroeder combs
 * and allpasses), switchable between parallel and series.
 *
 * Series feeds the echoes into the reverb as well as the dry signal; parallel
 * feeds the reverb the dry signal only. Everything inside is raw-context nodes
 * driven through the anchored ramp helper; only the boundary is Tone.
 */
export class SpatialFXProImpl extends NodeImpl {
  private ctx: AudioContext
  private all: AudioNode[] = []
  private disposed = false

  private inL = new Tone.Gain(1)
  private inR = new Tone.Gain(1)
  private outL = new Tone.Gain(1)
  private outR = new Tone.Gain(1)
  private delayCV = new Tone.Gain(1)
  private sizeCV = new CVInlet(1)

  // delay
  private normal: GainNode
  private rSrc: GainNode
  private feedLtoL: GainNode
  private feedRtoR: GainNode
  private feedRtoL: GainNode
  private lines: DelayNode[] = []
  private loops: Array<{
    hp: BiquadFilterNode
    lp: BiquadFilterNode
    clean: GainNode
    sat: GainNode
    self: GainNode
    cross: GainNode
  }> = []
  private echoGains: GainNode[] = []
  private cvDelayScale: GainNode
  private wowDepth: GainNode
  private flutterDepth: GainNode

  // reverb
  private revSum: GainNode
  private echoToRev: GainNode[] = []
  private revGate: GainNode
  private preDelay: DelayNode
  private banks: Comb[][] = [[], []]
  private allpass: Allpass[][] = [[], []]
  private revLevel: GainNode[] = []

  // output
  private dryGains: GainNode[] = []
  private wetGains: GainNode[] = []
  private analysers: AnalyserNode[] = []
  private bufs: Float32Array<ArrayBuffer>[] = []

  private cfg = {
    mode: 'parallel',
    time: 375,
    sync: false,
    division: '1/8',
    bpm: 120,
    feedback: 40,
    dDamp: 0.4,
    wow: 0.15,
    pingpong: true,
    delayLevel: 0.6,
    predelay: 20,
    decay: 2.5,
    rDamp: 0.5,
    diffusion: 0.7,
    freeze: false,
    reverbLevel: 0.5,
    mix: 0.35,
    modDelay: 1,
    modSize: 1,
  }
  /** Seconds per sixteenth measured from an incoming clock, or 0 when none. */
  private clockSixteenth = 0
  private lastTick = 0
  private lastDelayTarget = -1
  private lastDecay = -1
  private sizeTimer: ReturnType<typeof setInterval> | null = null
  private lfos: OscillatorNode[] = []

  constructor() {
    super()
    const ctx = Tone.getContext().rawContext as unknown as AudioContext
    this.ctx = ctx
    const nat = (n: Tone.ToneAudioNode) => (n as unknown as { input: AudioNode }).input
    const g = (value = 1) => {
      const node = this.n(ctx.createGain())
      node.gain.value = value
      return node
    }
    const into = (a: AudioNode, b: AudioNode) => a.connect(b)

    // Right inlet follows left when unpatched.
    this.normal = g(1)
    this.rSrc = g(1)
    this.inL.connect(this.normal as unknown as Tone.ToneAudioNode)
    this.normal.connect(this.rSrc)
    this.inR.connect(this.rSrc as unknown as Tone.ToneAudioNode)
    const lSrc = g(1)
    this.inL.connect(lSrc as unknown as Tone.ToneAudioNode)

    // ---------------------------------------------------------------- delay
    this.feedLtoL = g(1)
    this.feedRtoR = g(0)
    this.feedRtoL = g(1)
    const lineL = this.n(ctx.createDelay(MAX_DELAY))
    const lineR = this.n(ctx.createDelay(MAX_DELAY))
    this.lines = [lineL, lineR]
    into(lSrc, this.feedLtoL)
    into(this.feedLtoL, lineL)
    into(this.rSrc, this.feedRtoR)
    into(this.feedRtoR, lineR)
    into(this.rSrc, this.feedRtoL)
    into(this.feedRtoL, lineL)

    const saturator = () => {
      const pre = g(0.5)
      const shaper = this.n(ctx.createWaveShaper())
      // f(x) = tanh(x) on x in [-2, 2], reached via the 0.5 pre-gain.
      const curve = new Float32Array(2049)
      for (let i = 0; i < curve.length; i++) curve[i] = Math.tanh(2 * ((i / 2048) * 2 - 1))
      shaper.curve = curve
      shaper.oversample = '2x'
      pre.connect(shaper)
      return { pre, shaper }
    }

    for (let side = 0; side < 2; side++) {
      const line = this.lines[side]
      const other = this.lines[1 - side]
      const hp = this.n(ctx.createBiquadFilter())
      hp.type = 'highpass'
      hp.frequency.value = 100
      hp.Q.value = FLAT_Q
      const lp = this.n(ctx.createBiquadFilter())
      lp.type = 'lowpass'
      lp.frequency.value = 6000
      lp.Q.value = FLAT_Q
      const clean = g(0.4)
      const sat = g(0)
      const { pre, shaper } = saturator()
      const self = g(1)
      const cross = g(0)

      into(line, hp)
      into(hp, lp)
      // Clean path below 100 %; tanh soft-clip path above it.
      into(lp, clean)
      into(lp, sat)
      into(sat, pre)
      const merge = g(1)
      into(clean, merge)
      into(shaper, merge)
      into(merge, self)
      into(merge, cross)
      into(self, line)
      into(cross, other)
      this.loops.push({ hp, lp, clean, sat, self, cross })

      const echo = g(0.6)
      into(line, echo)
      this.echoGains.push(echo)
    }

    // Wow and flutter: two slow oscillators summed onto both delay times.
    this.wowDepth = g(0)
    this.flutterDepth = g(0)
    const wow = this.n(ctx.createOscillator())
    wow.frequency.value = 0.6
    const flutter = this.n(ctx.createOscillator())
    flutter.frequency.value = 6.5
    wow.connect(this.wowDepth)
    flutter.connect(this.flutterDepth)
    this.lfos = [wow, flutter]
    for (const line of this.lines) {
      this.wowDepth.connect(line.delayTime)
      this.flutterDepth.connect(line.delayTime)
    }
    this.cvDelayScale = g(CV_SECONDS)
    this.delayCV.connect(this.cvDelayScale as unknown as Tone.ToneAudioNode)
    for (const line of this.lines) this.cvDelayScale.connect(line.delayTime)

    // --------------------------------------------------------------- reverb
    this.revSum = g(0.5)
    into(lSrc, this.revSum)
    into(this.rSrc, this.revSum)
    for (const echo of this.echoGains) {
      const toRev = g(0)
      into(echo, toRev)
      into(toRev, this.revSum)
      this.echoToRev.push(toRev)
    }
    this.revGate = g(1)
    this.preDelay = this.n(ctx.createDelay(0.2))
    into(this.revSum, this.preDelay)
    into(this.preDelay, this.revGate)

    for (let side = 0; side < 2; side++) {
      const bankSum = g(0.25)
      for (const base of COMB_TIMES) {
        const time = base + (side ? STEREO_SPREAD : 0)
        const inGain = g(0.25)
        const sum = g(1)
        const delay = this.n(ctx.createDelay(0.1))
        delay.delayTime.value = time
        const lp = this.n(ctx.createBiquadFilter())
        lp.type = 'lowpass'
        lp.frequency.value = 6000
        lp.Q.value = FLAT_Q
        const fb = g(0.8)
        into(this.revGate, inGain)
        into(inGain, sum)
        into(sum, delay)
        into(delay, lp)
        into(lp, fb)
        into(fb, sum)
        into(delay, bankSum)
        this.banks[side].push({ inGain, fb, lp, time })
      }
      let tail: AudioNode = bankSum
      for (const base of ALLPASS_TIMES) {
        const time = base + (side ? STEREO_SPREAD : 0)
        const sum = g(1)
        const delay = this.n(ctx.createDelay(0.05))
        delay.delayTime.value = time
        const fb = g(0.5)
        const ff = g(-0.5)
        const out = g(1)
        into(tail, sum)
        into(sum, delay)
        into(delay, fb)
        into(fb, sum)
        into(sum, ff)
        into(ff, out)
        into(delay, out)
        this.allpass[side].push({ fb, ff })
        tail = out
      }
      // Keep any DC the frozen tail accumulates out of the output.
      const dc = this.n(ctx.createBiquadFilter())
      dc.type = 'highpass'
      dc.frequency.value = 20
      dc.Q.value = FLAT_Q
      into(tail, dc)
      const level = g(0.5)
      into(dc, level)
      this.revLevel.push(level)
    }

    // --------------------------------------------------------------- output
    const sumL = g(1)
    const sumR = g(1)
    const sums = [sumL, sumR]
    const srcs = [lSrc, this.rSrc]
    for (let side = 0; side < 2; side++) {
      const dry = g(1)
      const wet = g(0)
      into(srcs[side], dry)
      into(this.echoGains[side], wet)
      into(this.revLevel[side], wet)
      into(dry, sums[side])
      into(wet, sums[side])
      this.dryGains.push(dry)
      this.wetGains.push(wet)

      const an = this.n(ctx.createAnalyser())
      an.fftSize = 256
      sums[side].connect(an)
      this.analysers.push(an)
      this.bufs.push(new Float32Array(256))
    }
    sumL.connect(nat(this.outL))
    sumR.connect(nat(this.outR))

    this.lfos.forEach((o) => o.start())
  }

  /** Registers a raw node for disposal and hands it back. */
  private n<T extends AudioNode>(node: T): T {
    this.all.push(node)
    return node
  }

  audioOut(handle: string): Tone.ToneAudioNode | null {
    return handle === 'outR' ? this.outR : this.outL
  }

  audioIn(handle: string): AudioTarget | null {
    if (handle === 'inR') return this.inR
    if (handle === 'cv:delayTime') return this.delayCV
    if (handle === 'cv:size') return this.sizeCV.input
    return this.inL
  }

  onConnectionChange(handle: string, connected: boolean) {
    if (handle === 'ev:clock' && !connected) {
      this.clockSixteenth = 0
      this.lastTick = 0
      this.applyDelayTime()
    }
    if (handle === 'inR') this.ramp(this.normal.gain, connected ? 0 : 1)
    if (handle === 'cv:size') {
      this.sizeCV.setConnected(connected)
      if (connected && !this.sizeTimer) this.sizeTimer = setInterval(() => this.applyDecay(), 40)
      else if (!connected && this.sizeTimer) {
        clearInterval(this.sizeTimer)
        this.sizeTimer = null
        this.applyDecay()
      }
    }
  }

  private ramp(param: AudioParam, value: number, seconds = 0.015) {
    rampParam(param, this.ctx, value, seconds)
  }

  // ----------------------------------------------------------------- clock

  onEvent(handle: string, event: PatchEvent) {
    if (handle !== 'ev:clock' || event.type !== 'bang') return
    const t = event.time ?? this.ctx.currentTime
    if (this.lastTick > 0) {
      const dt = t - this.lastTick
      if (dt > 0.02 && dt < 2) {
        this.clockSixteenth = this.clockSixteenth > 0 ? this.clockSixteenth * 0.7 + dt * 0.3 : dt
        if (this.cfg.sync) this.applyDelayTime()
      }
    }
    this.lastTick = t
  }

  /** Seconds per sixteenth from the clock if one is ticking, else from the tempo param. */
  get sixteenth(): number {
    return this.clockSixteenth > 0 ? this.clockSixteenth : 15 / this.cfg.bpm
  }

  // ------------------------------------------------------------ parameters

  private applyDelayTime() {
    const c = this.cfg
    const seconds = c.sync ? this.sixteenth * (SYNC_DIVISIONS[c.division] ?? 2) : c.time / 1000
    const target = clamp(seconds, 0.001, MAX_TIME)
    if (this.lastDelayTarget > 0 && Math.abs(target - this.lastDelayTarget) / this.lastDelayTarget < 0.003) return
    this.lastDelayTarget = target
    // A slowish ramp is deliberate: moving the heads gives the tape pitch-bend.
    for (const line of this.lines) this.ramp(line.delayTime, target, 0.12)
  }

  private applyDelayMix() {
    const c = this.cfg
    const pp = c.pingpong
    this.ramp(this.feedRtoR.gain, pp ? 0 : 1)
    this.ramp(this.feedRtoL.gain, pp ? 1 : 0)
    for (const l of this.loops) {
      this.ramp(l.self.gain, pp ? 0 : 1)
      this.ramp(l.cross.gain, pp ? 1 : 0)
      const fb = clamp(c.feedback / 100, 0, 1.1)
      // Past 100 % the tanh path takes over, so a >1 loop gain stays bounded.
      this.ramp(l.clean.gain, fb <= 1 ? fb : 0)
      this.ramp(l.sat.gain, fb > 1 ? fb : 0)
      // Bandpass damping: a fixed low cut with a high cut that closes with Damp.
      this.ramp(l.lp.frequency, 12000 * Math.pow(1000 / 12000, c.dDamp))
    }
    for (const echo of this.echoGains) this.ramp(echo.gain, c.delayLevel)
    this.ramp(this.wowDepth.gain, c.wow * 0.004)
    this.ramp(this.flutterDepth.gain, c.wow * 0.0006)
    this.ramp(this.cvDelayScale.gain, CV_SECONDS * c.modDelay)
  }

  /** Effective decay: the knob, scaled by the size CV (±1 → ×4 / ÷4 at depth 1). */
  private applyDecay() {
    const c = this.cfg
    const effective = clamp(c.decay * Math.pow(2, this.sizeCV.value() * c.modSize * 2), 0.2, 15)
    const key = c.freeze ? -2 : effective
    if (Math.abs(key - this.lastDecay) < this.lastDecay * 0.01) return
    this.lastDecay = key
    const damp = 14000 * Math.pow(1500 / 14000, c.rDamp)
    for (const bank of this.banks) {
      for (const comb of bank) {
        const g = c.freeze ? FROZEN_FEEDBACK : Math.min(0.985, Math.pow(10, (-3 * comb.time) / effective))
        this.ramp(comb.fb.gain, g)
        this.ramp(comb.inGain.gain, Math.sqrt(1 - g * g))
        this.ramp(comb.lp.frequency, c.freeze ? 20000 : damp)
      }
    }
  }

  private applyReverb() {
    const c = this.cfg
    this.lastDecay = -1
    this.applyDecay()
    this.ramp(this.preDelay.delayTime, c.predelay / 1000)
    // Frozen: nothing new enters the tank, so the tail is not coloured further.
    this.ramp(this.revGate.gain, c.freeze ? 0 : 1, 0.02)
    const gap = 0.2 + 0.5 * c.diffusion
    for (const bank of this.allpass) {
      for (const ap of bank) {
        this.ramp(ap.fb.gain, gap)
        this.ramp(ap.ff.gain, -gap)
      }
    }
    for (const level of this.revLevel) this.ramp(level.gain, c.reverbLevel)
    const series = c.mode === 'series'
    for (const g of this.echoToRev) this.ramp(g.gain, series ? 1 : 0)
  }

  private applyMix() {
    const m = clamp(this.cfg.mix, 0, 1)
    for (const d of this.dryGains) this.ramp(d.gain, Math.cos((m * Math.PI) / 2))
    for (const w of this.wetGains) this.ramp(w.gain, Math.sin((m * Math.PI) / 2))
  }

  setParam(key: string, value: number | string) {
    const c = this.cfg as Record<string, number | string | boolean>
    switch (key) {
      case 'mode':
      case 'division':
        c[key] = String(value)
        break
      case 'sync':
      case 'pingpong':
      case 'freeze':
        c[key] = Number(value) >= 0.5
        break
      case 'mod_delayTime':
        c.modDelay = Number(value)
        break
      case 'mod_size':
        c.modSize = Number(value)
        break
      default:
        if (!(key in c) || !Number.isFinite(Number(value))) return
        c[key] = Number(value)
    }
    this.lastDelayTarget = -1
    this.applyDelayTime()
    this.applyDelayMix()
    this.applyReverb()
    this.applyMix()
  }

  /** Post-mix output level in linear amplitude, for L (0) or R (1). */
  getLevel(side: 0 | 1): { peak: number; rms: number } {
    const an = this.analysers[side]
    const buf = this.bufs[side]
    an.getFloatTimeDomainData(buf)
    let peak = 0
    let sum = 0
    for (let i = 0; i < buf.length; i++) {
      peak = Math.max(peak, Math.abs(buf[i]))
      sum += buf[i] * buf[i]
    }
    return { peak, rms: Math.sqrt(sum / buf.length) }
  }

  /** Tempo the sync divisions currently follow, and whether it comes from a clock. */
  getTempo(): { bpm: number; external: boolean } {
    return { bpm: 15 / this.sixteenth, external: this.clockSixteenth > 0 }
  }

  dispose() {
    this.disposed = true
    if (this.sizeTimer) clearInterval(this.sizeTimer)
    this.sizeTimer = null
    for (const o of this.lfos) {
      try {
        o.stop()
      } catch {
        /* never started */
      }
    }
    for (const node of this.all) {
      try {
        node.disconnect()
      } catch {
        /* already gone */
      }
    }
    this.all = []
    this.sizeCV.dispose()
    ;[this.inL, this.inR, this.outL, this.outR, this.delayCV].forEach((n) => n.dispose())
  }

  get isDisposed() {
    return this.disposed
  }
}
