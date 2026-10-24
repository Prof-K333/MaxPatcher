import { VoiceBus } from './voiceBus'
import { rampParam } from './rampParam'

export type VoiceId = 'bd' | 'sd' | 'cp' | 'ch' | 'oh' | 'cb'
export type OutletId = 'bd' | 'sd' | 'sdNoise' | 'hh' | 'cb' | 'cp'

export interface DrumParams {
  bdTone: number
  bdSub: number
  bdSweep: number
  bdDecay: number
  bdDrive: number
  sdTune: number
  sdSnappy: number
  sdDecay: number
  cpDecay: number
  cpSpread: number
  hhTune: number
  chDecay: number
  ohDecay: number
  cbDecay: number
  accent: number
  drive: boolean
  levels: Record<VoiceId, number>
  pans: Record<VoiceId, number>
}

export const DEFAULT_DRUM_PARAMS: DrumParams = {
  bdTone: 160,
  bdSub: 45,
  bdSweep: 0.035,
  bdDecay: 0.9,
  bdDrive: 0.3,
  sdTune: 180,
  sdSnappy: 0.5,
  sdDecay: 0.25,
  cpDecay: 0.35,
  cpSpread: 0.4,
  hhTune: 1,
  chDecay: 0.07,
  ohDecay: 0.55,
  cbDecay: 0.35,
  accent: 0.8,
  drive: true,
  levels: { bd: 0.9, sd: 0.7, cp: 0.6, ch: 0.45, oh: 0.45, cb: 0.5 },
  pans: { bd: 0, sd: 0, cp: -0.2, ch: 0.25, oh: 0.25, cb: -0.35 },
}

/** The six detuned partials that give the 808 hats their metallic clang. */
const HAT_PARTIALS = [245, 306, 384, 522, 640, 838]

/** Exponential ramps throw on zero, so every target is clamped above it. */
const EPS = 0.0001
const safe = (v: number) => Math.max(EPS, v)

/**
 * A procedural 808, built from Web Audio primitives alone — no samples.
 *
 * Oscillators and buffer sources are single-use by specification, so each hit
 * builds its own short-lived nodes and tears them down on `onended`. The
 * long-lived part (per-voice level, pan and mix routing) lives in VoiceBus and
 * is created once.
 *
 * Everything is scheduled against `currentTime` with a small lookahead, so
 * envelopes are sample-accurate rather than depending on when JS happens to run.
 */
export class DrumSynth808Engine {
  readonly master: GainNode
  readonly buses: Record<OutletId, VoiceBus>

  private ctx: BaseAudioContext
  private noiseBuffer: AudioBuffer
  private driveShaper: WaveShaperNode
  private driveWet: GainNode
  private driveDry: GainNode
  /** Live open-hat voices, so a closed hat can choke them. */
  private openHats: Array<{ gain: GainNode; stop: (t: number) => void }> = []
  private noiseToSd: GainNode

  params: DrumParams = { ...DEFAULT_DRUM_PARAMS }

  /** Fired on each hit so the UI can flash the right pad. */
  onTrigger: ((voice: VoiceId) => void) | null = null

  constructor(ctx: BaseAudioContext, destination: AudioNode) {
    this.ctx = ctx
    this.master = ctx.createGain()

    // Global saturation across the whole kit, mixed in parallel so switching
    // it off is a clean bypass rather than a level jump.
    this.driveShaper = ctx.createWaveShaper()
    this.driveShaper.curve = makeSaturationCurve(0.55)
    this.driveShaper.oversample = '4x'
    this.driveWet = ctx.createGain()
    this.driveDry = ctx.createGain()
    this.master.connect(this.driveShaper)
    this.driveShaper.connect(this.driveWet)
    this.master.connect(this.driveDry)
    this.driveWet.connect(destination)
    this.driveDry.connect(destination)
    this.setDrive(this.params.drive)

    const bus = () => new VoiceBus(ctx, this.master)
    this.buses = { bd: bus(), sd: bus(), sdNoise: bus(), cp: bus(), hh: bus(), cb: bus() }

    // The snare's noise half is tapped separately so it can have its own
    // outlet, but it still feeds the snare bus unless that tap is patched.
    this.noiseToSd = ctx.createGain()
    this.noiseToSd.connect(this.buses.sd.input)

    this.noiseBuffer = createNoiseBuffer(ctx)
    this.applyLevels()
  }

  // ------------------------------------------------------------------ wiring

  private applyLevels() {
    this.buses.bd.setLevel(this.params.levels.bd)
    this.buses.sd.setLevel(this.params.levels.sd)
    this.buses.cp.setLevel(this.params.levels.cp)
    this.buses.cb.setLevel(this.params.levels.cb)
    // Hats share one bus; the louder of the two sets its level.
    this.buses.hh.setLevel(Math.max(this.params.levels.ch, this.params.levels.oh))
    this.buses.sdNoise.setLevel(this.params.levels.sd)

    this.buses.bd.setPan(this.params.pans.bd)
    this.buses.sd.setPan(this.params.pans.sd)
    this.buses.cp.setPan(this.params.pans.cp)
    this.buses.cb.setPan(this.params.pans.cb)
    this.buses.hh.setPan(this.params.pans.ch)
    this.buses.sdNoise.setPan(this.params.pans.sd)
  }

  setParams(next: Partial<DrumParams>) {
    this.params = { ...this.params, ...next }
    this.applyLevels()
    if (next.drive !== undefined) this.setDrive(next.drive)
  }

  setDrive(on: boolean) {
    rampParam(this.driveWet.gain, this.ctx, on ? 0.85 : 0, 0.02)
    rampParam(this.driveDry.gain, this.ctx, on ? 0.25 : 1, 0.02)
  }

  /** Patching an individual outlet pulls that voice out of the master mix. */
  setOutletConnected(outlet: OutletId, connected: boolean) {
    if (outlet === 'sdNoise') {
      this.buses.sdNoise.setDirectConnected(connected)
      // The noise also stops feeding the snare bus, so it is not heard twice.
      rampParam(this.noiseToSd.gain, this.ctx, connected ? 0 : 1, 0.01)
      return
    }
    this.buses[outlet].setDirectConnected(connected)
  }

  // --------------------------------------------------------------- triggering

  trigger(voice: VoiceId, when?: number, velocity = 1) {
    // Never schedule in the past; a hair of lookahead keeps ramps exact.
    const t = Math.max(when ?? this.ctx.currentTime, this.ctx.currentTime) + 0.001
    const vel = Math.min(1.5, Math.max(0.05, velocity * this.params.accent + (1 - this.params.accent) * 0.6))

    switch (voice) {
      case 'bd':
        this.bassDrum(t, vel)
        break
      case 'sd':
        this.snare(t, vel)
        break
      case 'cp':
        this.clap(t, vel)
        break
      case 'ch':
        this.hat(t, vel, false)
        break
      case 'oh':
        this.hat(t, vel, true)
        break
      case 'cb':
        this.cowbell(t, vel)
        break
    }
    this.onTrigger?.(voice)
  }

  /** Builds a one-shot envelope that disconnects itself when it finishes. */
  private envelope(t: number, peak: number, decay: number, destination: AudioNode): GainNode {
    const g = this.ctx.createGain()
    g.gain.setValueAtTime(EPS, t)
    g.gain.exponentialRampToValueAtTime(safe(peak), t + 0.002)
    g.gain.exponentialRampToValueAtTime(EPS, t + 0.002 + decay)
    g.connect(destination)
    return g
  }

  private cleanup(node: AudioScheduledSourceNode, chain: AudioNode[], stopAt: number) {
    node.stop(stopAt)
    node.onended = () => {
      node.disconnect()
      chain.forEach((n) => n.disconnect())
    }
  }

  // -------------------------------------------------------------------- voices

  private bassDrum(t: number, vel: number) {
    const p = this.params
    const osc = this.ctx.createOscillator()
    osc.type = 'sine'

    // The pitch drop from click to body is the whole character of an 808 kick.
    osc.frequency.setValueAtTime(safe(p.bdTone), t)
    osc.frequency.exponentialRampToValueAtTime(safe(p.bdSub), t + p.bdSweep)

    const shaper = this.ctx.createWaveShaper()
    shaper.curve = makeSaturationCurve(0.2 + p.bdDrive * 0.75)
    shaper.oversample = '2x'

    const env = this.envelope(t, vel, p.bdDecay, shaper)
    shaper.connect(this.buses.bd.input)
    osc.connect(env)

    osc.start(t)
    this.cleanup(osc, [env, shaper], t + p.bdDecay + 0.1)
  }

  private snare(t: number, vel: number) {
    const p = this.params
    const bodyDecay = p.sdDecay
    const noiseDecay = p.sdDecay * 1.4

    // Snappy balances the drum head against the snare wires.
    const bodyLevel = (1 - p.sdSnappy) * vel
    const noiseLevel = p.sdSnappy * vel

    for (const ratio of [1, 1.83]) {
      const osc = this.ctx.createOscillator()
      osc.type = 'sine'
      osc.frequency.setValueAtTime(safe(p.sdTune * ratio), t)
      const env = this.envelope(t, bodyLevel * 0.7, bodyDecay, this.buses.sd.input)
      osc.connect(env)
      osc.start(t)
      this.cleanup(osc, [env], t + bodyDecay + 0.1)
    }

    const noise = this.ctx.createBufferSource()
    noise.buffer = this.noiseBuffer
    noise.loop = true
    const hp = this.ctx.createBiquadFilter()
    hp.type = 'highpass'
    hp.frequency.setValueAtTime(1000, t)

    // The noise half feeds its own bus, which in turn feeds the snare bus
    // unless the SD Noise outlet has been patched.
    const env = this.envelope(t, noiseLevel, noiseDecay, hp)
    hp.connect(this.noiseToSd)
    hp.connect(this.buses.sdNoise.input)
    noise.connect(env)
    noise.start(t)
    this.cleanup(noise, [env, hp], t + noiseDecay + 0.1)
  }

  private clap(t: number, vel: number) {
    const p = this.params
    const bp = this.ctx.createBiquadFilter()
    bp.type = 'bandpass'
    bp.frequency.setValueAtTime(1200, t)
    bp.Q.setValueAtTime(1.5, t)
    bp.connect(this.buses.cp.input)

    const noise = this.ctx.createBufferSource()
    noise.buffer = this.noiseBuffer
    noise.loop = true

    const g = this.ctx.createGain()
    g.gain.setValueAtTime(EPS, t)

    // Three short slaps 15ms apart read as several hands, then a diffuse tail.
    const spacing = 0.015 + p.cpSpread * 0.012
    for (let i = 0; i < 3; i++) {
      const at = t + i * spacing
      g.gain.setValueAtTime(safe(vel * 0.85), at)
      g.gain.exponentialRampToValueAtTime(EPS, at + 0.01)
    }
    const tailAt = t + 3 * spacing
    g.gain.setValueAtTime(safe(vel), tailAt)
    g.gain.exponentialRampToValueAtTime(EPS, tailAt + p.cpDecay)

    noise.connect(g)
    g.connect(bp)
    noise.start(t)
    this.cleanup(noise, [g, bp], tailAt + p.cpDecay + 0.1)
  }

  private hat(t: number, vel: number, open: boolean) {
    const p = this.params
    const decay = open ? p.ohDecay : p.chDecay

    // A closed hat chokes any ringing open hat, exactly like the real machine
    // where both share one output circuit.
    if (!open) this.chokeOpenHats(t)

    const bp = this.ctx.createBiquadFilter()
    bp.type = 'bandpass'
    bp.frequency.setValueAtTime(7000, t)
    bp.Q.setValueAtTime(1.2, t)

    const hp = this.ctx.createBiquadFilter()
    hp.type = 'highpass'
    hp.frequency.setValueAtTime(10000, t)

    const env = this.envelope(t, vel * 0.6, decay, bp)
    bp.connect(hp)
    hp.connect(this.buses.hh.input)

    const oscs = HAT_PARTIALS.map((freq) => {
      const osc = this.ctx.createOscillator()
      osc.type = 'square'
      osc.frequency.setValueAtTime(safe(freq * p.hhTune), t)
      osc.connect(env)
      osc.start(t)
      return osc
    })

    const stopAt = t + decay + 0.1
    oscs.forEach((osc, i) => {
      osc.stop(stopAt)
      // Only the last one tears down the shared chain.
      osc.onended = i === oscs.length - 1
        ? () => {
            oscs.forEach((o) => o.disconnect())
            env.disconnect()
            bp.disconnect()
            hp.disconnect()
          }
        : null
    })

    if (open) {
      const voice = {
        gain: env,
        stop: (at: number) => oscs.forEach((o) => {
          try {
            o.stop(at)
          } catch {
            /* already stopped */
          }
        }),
      }
      this.openHats.push(voice)
      setTimeout(() => {
        this.openHats = this.openHats.filter((v) => v !== voice)
      }, (decay + 0.2) * 1000)
    }
  }

  private chokeOpenHats(t: number) {
    for (const voice of this.openHats) {
      voice.gain.gain.cancelScheduledValues(t)
      voice.gain.gain.setValueAtTime(Math.max(EPS, voice.gain.gain.value), t)
      voice.gain.gain.exponentialRampToValueAtTime(EPS, t + 0.008)
      voice.stop(t + 0.02)
    }
    this.openHats = []
  }

  private cowbell(t: number, vel: number) {
    const p = this.params
    const bp = this.ctx.createBiquadFilter()
    bp.type = 'bandpass'
    bp.frequency.setValueAtTime(800, t)
    bp.Q.setValueAtTime(3, t)
    bp.connect(this.buses.cb.input)

    const env = this.ctx.createGain()
    env.gain.setValueAtTime(EPS, t)
    env.gain.exponentialRampToValueAtTime(safe(vel * 0.8), t + 0.001)
    env.gain.exponentialRampToValueAtTime(EPS, t + p.cbDecay)
    env.connect(bp)

    const oscs = [540, 800].map((freq) => {
      const osc = this.ctx.createOscillator()
      osc.type = 'square'
      osc.frequency.setValueAtTime(safe(freq * p.hhTune), t)
      osc.connect(env)
      osc.start(t)
      return osc
    })

    const stopAt = t + p.cbDecay + 0.1
    oscs.forEach((osc, i) => {
      osc.stop(stopAt)
      osc.onended = i === oscs.length - 1
        ? () => {
            oscs.forEach((o) => o.disconnect())
            env.disconnect()
            bp.disconnect()
          }
        : null
    })
  }

  dispose() {
    this.chokeOpenHats(this.ctx.currentTime)
    Object.values(this.buses).forEach((b) => b.dispose())
    this.noiseToSd.disconnect()
    this.master.disconnect()
    this.driveShaper.disconnect()
    this.driveWet.disconnect()
    this.driveDry.disconnect()
  }
}

/** Two seconds of white noise, shared by every noise-based voice. */
function createNoiseBuffer(ctx: BaseAudioContext): AudioBuffer {
  const length = Math.floor(ctx.sampleRate * 2)
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1
  return buffer
}

/** Soft clipping: gentle odd-harmonic warmth rather than hard digital edges. */
function makeSaturationCurve(amount: number): Float32Array<ArrayBuffer> {
  const n = 1024
  const curve = new Float32Array(new ArrayBuffer(n * 4))
  const k = 1 + amount * 60
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1
    curve[i] = ((1 + k) * x) / (1 + k * Math.abs(x))
  }
  return curve
}
