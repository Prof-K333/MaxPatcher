import { windowCurve, type WindowShape } from './windows'

export type Direction = 'forward' | 'reverse' | 'random'

export interface GrainParams {
  position: number // 0–1 into the buffer
  spray: number // seconds of random offset
  size: number // grain duration, seconds
  density: number // grains per second
  pitch: number // playback rate multiplier
  pitchJitter: number // cents of random detune per grain
  spread: number // 0–1 stereo randomisation
  window: WindowShape
  direction: Direction
  freeze: boolean
  gain: number
}

/** Reusable per-grain output chain. Only the buffer source is disposable. */
interface GrainSlot {
  gain: GainNode
  panner: StereoPannerNode
  busyUntil: number
}

const LOOKAHEAD_MS = 25
const SCHEDULE_AHEAD = 0.12

/**
 * A sample-accurate grain scheduler.
 *
 * Grains are emitted far too often to drive from `setTimeout` directly — the
 * main thread would jitter audibly. Instead a slow timer wakes up every 25ms
 * and schedules every grain due in the next 120ms at exact AudioContext times,
 * so the audio thread does the timing and main-thread hiccups never reach the
 * output.
 *
 * `AudioBufferSourceNode`s are single-use by specification, so they cannot be
 * pooled; the gain and panner nodes behind each grain are, which is what keeps
 * the allocation rate (and therefore GC pauses) low at high densities.
 */
export class GranularAudioEngine {
  private buffer: AudioBuffer | null = null
  /** Pre-reversed copy, since negative playbackRate is not supported. */
  private reversed: AudioBuffer | null = null

  /**
   * Live re-sampling: the buffer is a ring being written continuously while
   * grains read from it. Grains are kept to a window *behind* the write head,
   * so they never read the sample currently being overwritten — that trailing
   * window is what keeps live granular from tearing.
   */
  live = false
  liveWriteIndex = 0
  /** Samples of the ring the grains are allowed to roam, behind the head. */
  liveWindow = 0
  private slots: GrainSlot[] = []
  private timer: number | null = null
  private nextGrainTime = 0
  private running = false
  private frozenPosition: number | null = null

  params: GrainParams = {
    position: 0.25,
    spray: 0.05,
    size: 0.12,
    density: 20,
    pitch: 1,
    pitchJitter: 0,
    spread: 0.6,
    window: 'hanning',
    direction: 'forward',
    freeze: false,
    gain: 0.8,
  }

  /** Fired when a grain is scheduled, for the visualiser and the bang outlet. */
  onGrain: ((position: number, pan: number) => void) | null = null

  private readonly ctx: BaseAudioContext
  private readonly destination: AudioNode

  constructor(ctx: BaseAudioContext, destination: AudioNode) {
    this.ctx = ctx
    this.destination = destination
  }

  setBuffer(buffer: AudioBuffer | null) {
    this.buffer = buffer
    // A live ring is rewritten constantly, so a reversed copy would be stale
    // the moment it was made; reverse is a loaded-file feature only.
    this.reversed = buffer && !this.live ? reverseBuffer(this.ctx, buffer) : null
  }

  setLive(live: boolean, buffer: AudioBuffer | null, windowSamples = 0) {
    this.live = live
    this.liveWindow = windowSamples
    this.setBuffer(buffer)
  }

  getBuffer(): AudioBuffer | null {
    return this.buffer
  }

  get isRunning(): boolean {
    return this.running
  }

  start() {
    if (this.running) return
    this.running = true
    this.nextGrainTime = this.ctx.currentTime
    this.timer = window.setInterval(() => this.tick(), LOOKAHEAD_MS)
  }

  /** Stops the clock and releases voices — nothing should run while silent. */
  stop() {
    this.running = false
    if (this.timer !== null) {
      clearInterval(this.timer)
      this.timer = null
    }
    for (const slot of this.slots) {
      slot.gain.gain.cancelScheduledValues(this.ctx.currentTime)
      slot.gain.gain.setValueAtTime(0, this.ctx.currentTime)
      slot.busyUntil = 0
    }
  }

  setFreeze(on: boolean) {
    this.params.freeze = on
    // Latch the position at the instant of freezing so the cloud holds exactly
    // where it was rather than jumping to wherever the slider sits.
    this.frozenPosition = on ? this.params.position : null
  }

  /** Fires one grain immediately, for Trigger/Gate inlets. */
  bang() {
    if (this.buffer) this.scheduleGrain(this.ctx.currentTime)
  }

  private tick() {
    if (!this.buffer || !this.running) return
    const horizon = this.ctx.currentTime + SCHEDULE_AHEAD

    // Bounded for the same reason the step clock is: a broken density must
    // not be able to spin here.
    let guard = 512
    while (this.nextGrainTime < horizon && guard-- > 0) {
      // Never schedule into the past: after a tab stall, catch up to now.
      const when = Math.max(this.nextGrainTime, this.ctx.currentTime)
      this.scheduleGrain(when)
      const density = Number.isFinite(this.params.density) ? Math.max(1, this.params.density) : 20
      this.nextGrainTime = when + 1 / density
    }
  }

  /** Finds a free output chain, or grows the pool if every slot is in use. */
  private acquireSlot(now: number): GrainSlot {
    for (const slot of this.slots) {
      if (slot.busyUntil <= now) return slot
    }
    const gain = this.ctx.createGain()
    const panner = this.ctx.createStereoPanner()
    gain.gain.value = 0
    gain.connect(panner)
    panner.connect(this.destination)
    const slot: GrainSlot = { gain, panner, busyUntil: 0 }
    this.slots.push(slot)
    return slot
  }

  private scheduleGrain(when: number) {
    const buffer = this.buffer
    if (!buffer) return

    const p = this.params
    const basePosition = this.frozenPosition ?? p.position

    // Spray scatters grain start points around the playhead; without it a
    // cloud degenerates into a periodic buzz at the grain rate.
    const sprayOffset = p.spray > 0 ? (Math.random() * 2 - 1) * p.spray : 0
    const duration = Math.max(0.005, p.size)

    const reverse = !this.live && (p.direction === 'reverse' || (p.direction === 'random' && Math.random() < 0.5))
    const source = this.ctx.createBufferSource()
    source.buffer = reverse && this.reversed ? this.reversed : buffer

    const cents = p.pitchJitter > 0 ? (Math.random() * 2 - 1) * p.pitchJitter : 0
    source.playbackRate.value = Math.max(0.01, p.pitch * Math.pow(2, cents / 1200))

    const span = duration * source.playbackRate.value

    let offset
    if (this.live) {
      // Map position across the trailing window: 0 is the oldest audio still
      // held, 1 is the most recent that is safely behind the write head.
      const rate = buffer.sampleRate
      const guard = span * rate + rate * 0.05
      const windowSamples = Math.max(rate * 0.1, this.liveWindow - guard)
      const start = this.liveWriteIndex - guard - (1 - basePosition) * windowSamples
      offset = (((start / rate) % buffer.duration) + buffer.duration) % buffer.duration
      offset = (offset + sprayOffset + buffer.duration) % buffer.duration
      // A grain that would wrap past the end is pulled back inside it.
      if (offset + span > buffer.duration) offset = Math.max(0, buffer.duration - span)
    } else {
      offset = basePosition * buffer.duration + sprayOffset
      // Keep the whole grain inside the buffer so it never runs off the end.
      offset = Math.min(Math.max(offset, 0), Math.max(0, buffer.duration - span))
      if (reverse) offset = Math.max(0, buffer.duration - offset - span)
    }

    const slot = this.acquireSlot(when)
    const pan = p.spread > 0 ? (Math.random() * 2 - 1) * p.spread : 0
    slot.panner.pan.setValueAtTime(pan, when)

    // The window is applied as a gain curve on the audio thread; this is what
    // keeps grains click-free even at 80 grains a second.
    const curve = windowCurve(p.window)
    const g = slot.gain.gain
    g.cancelScheduledValues(when)
    g.setValueAtTime(0, when)
    g.setValueCurveAtTime(scaleCurve(curve, p.gain), when, duration)

    source.connect(slot.gain)
    source.start(when, offset, span + 0.01)
    source.stop(when + duration + 0.01)
    source.onended = () => source.disconnect()

    slot.busyUntil = when + duration
    this.onGrain?.(offset / buffer.duration, pan)
  }

  dispose() {
    this.stop()
    for (const slot of this.slots) {
      slot.gain.disconnect()
      slot.panner.disconnect()
    }
    this.slots = []
  }
}

/** Curves are cached unscaled, so apply the output gain to a copy. */
const scaleCurve = (curve: Float32Array, gain: number): Float32Array => {
  const out = new Float32Array(curve.length)
  for (let i = 0; i < curve.length; i++) out[i] = curve[i] * gain
  return out
}

const reverseBuffer = (ctx: BaseAudioContext, buffer: AudioBuffer): AudioBuffer => {
  const copy = ctx.createBuffer(buffer.numberOfChannels, buffer.length, buffer.sampleRate)
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const src = buffer.getChannelData(ch)
    const dst = copy.getChannelData(ch)
    for (let i = 0, n = src.length; i < n; i++) dst[i] = src[n - 1 - i]
  }
  return copy
}
