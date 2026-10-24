import * as Tone from 'tone'
import { NodeImpl, type AudioTarget } from '../NodeImpl'
import { CVInlet } from '../cv'
import { LookaheadClock } from '../sequencer/LookaheadClock'
import { parseBank, serializeBank, TRACKS, type Bank, type TrackId } from '../sequencer/pattern'
import type { PatchEvent } from '../types'

const DRUM_TRACKS: TrackId[] = ['bd', 'sd', 'cp', 'ch', 'oh', 'cb']
/** Trigger pulse length on the CV outlets. */
const PULSE = 0.01

/**
 * Multi-track step sequencer built to drive the 808.
 *
 * Each track keeps its own position and wraps at its own length, so lanes of
 * different lengths drift against each other — that is where polymeter comes
 * from, and it is why there is no single shared step counter.
 *
 * Triggers leave as events carrying both a velocity and the exact time they
 * are due. The 808 honours that time, so a step booked 100ms early still
 * strikes on the sample it was scheduled for.
 */
export class DrumSequencerImpl extends NodeImpl {
  private ctx: AudioContext
  private clock: LookaheadClock
  private bank: Bank = parseBank(null)

  private accentOut = new Tone.Signal(0)
  private summedOut = new Tone.Signal(0)
  private swingCV = new CVInlet(1)
  private swingCVConnected = false

  /** Per-track playhead, advanced independently for polymeter. */
  private positions: Record<string, number> = {}
  private externalClock = false
  private running = false
  private baseSwing = 0.5
  /** Held Fill button: every step becomes a 16th-note roll. */
  fill = false

  /** Latest played step per track, for the UI playhead. */
  readonly display: Record<string, number> = {}
  onPatternChange: (() => void) | null = null

  constructor() {
    super()
    this.ctx = (Tone.getContext().rawContext as unknown as AudioContext)
    this.clock = new LookaheadClock(this.ctx)
    this.clock.onStep = (step, time) => this.playStep(step, time)
    TRACKS.forEach((t) => {
      this.positions[t] = 0
      this.display[t] = 0
    })
  }

  // ------------------------------------------------------------------- ports

  audioOut(handle: string): Tone.ToneAudioNode | null {
    if (handle === 'accent') return this.accentOut
    if (handle === 'sum') return this.summedOut
    return null
  }

  audioIn(handle: string): AudioTarget | null {
    return handle === 'cv:swing' ? this.swingCV.input : null
  }

  onConnectionChange(handle: string, connected: boolean) {
    if (handle === 'cv:swing') {
      this.swingCV.setConnected(connected)
      this.swingCVConnected = connected
    } else if (handle === 'ev:clock') {
      // An external clock takes over from the internal one entirely.
      this.externalClock = connected
      if (connected) this.clock.stop()
      else if (this.running) this.clock.start()
    }
  }

  // -------------------------------------------------------------- transport

  get isRunning() {
    return this.running
  }

  get pattern() {
    return this.bank.patterns[this.bank.current]
  }

  getBank(): Bank {
    return this.bank
  }

  setBank(bank: Bank) {
    this.bank = bank
    this.onPatternChange?.()
  }

  play() {
    this.running = true
    if (!this.externalClock) this.clock.start()
  }

  pause() {
    this.running = false
    this.clock.stop()
  }

  toggle() {
    if (this.running) this.pause()
    else this.play()
  }

  reset() {
    this.clock.reset()
    TRACKS.forEach((t) => {
      this.positions[t] = 0
      this.display[t] = 0
    })
  }

  // -------------------------------------------------------------- sequencing

  private anySolo(): boolean {
    return TRACKS.some((t) => this.pattern[t].solo)
  }

  private playStep(_step: number, time: number) {
    const pattern = this.pattern
    const solo = this.anySolo()
    const stepDur = this.clock.stepDuration

    // The accent lane is read first: it lifts every drum struck on this step.
    const accTrack = pattern.acc
    const accIndex = this.indexFor('acc')
    const accLevel = accTrack.level[accIndex]
    const accent = accLevel === 2 ? 1 : accLevel === 1 ? 0.6 : 0
    if (accLevel > 0) {
      this.accentOut.setValueAtTime(accent, time)
      this.accentOut.setValueAtTime(0, time + stepDur * 0.9)
    }

    let struck = 0
    for (const id of DRUM_TRACKS) {
      const track = pattern[id]
      const index = this.indexFor(id)
      const level = track.level[index]

      if (level > 0 && !track.mute && (!solo || track.solo)) {
        const chance = track.prob[index]
        if (chance >= 1 || Math.random() < chance) {
          const velocity = (level === 2 ? 1 : 0.7) * (1 + accent * 0.35)
          const ratchet = this.fill ? 4 : Math.max(1, track.ratchet[index])
          for (let r = 0; r < ratchet; r++) {
            const at = time + (r * stepDur) / ratchet
            this.emit(`ev:${id}`, { type: 'bang', velocity: Math.min(1.5, velocity), time: at })
          }
          struck++
        }
      }

      this.display[id] = index
      this.positions[id] = (this.positions[id] + 1) % Math.max(1, track.length)
    }

    this.display.acc = accIndex
    this.positions.acc = (this.positions.acc + 1) % Math.max(1, accTrack.length)

    // A single pulse standing in for the whole kit, for sidechain ducking.
    if (struck > 0) {
      this.summedOut.setValueAtTime(1, time)
      this.summedOut.setValueAtTime(0, time + PULSE)
    }

    this.emit('ev:clockOut', { type: 'bang', time })
    // The bass drum lane defines the bar as far as downstream modules care.
    if (this.positions.bd === 0) this.emit('ev:loop', { type: 'bang', time })
  }

  /** Where a track currently sits, including its own rotation. */
  private indexFor(id: TrackId): number {
    const track = this.pattern[id]
    const len = Math.max(1, track.length)
    return (((this.positions[id] + track.shift) % len) + len) % len
  }

  // ----------------------------------------------------------------- params

  setParam(key: string, value: number | string) {
    const n = Number(value)
    switch (key) {
      case 'bpm':
        this.clock.bpm = n
        break
      case 'swing':
        this.baseSwing = n
        this.applySwing()
        break
      case 'mod_swing':
        this.swingCV.setDepth(n)
        break
      case 'running':
        if (n >= 0.5) this.play()
        else this.pause()
        break
      case 'patterns':
        this.bank = parseBank(value)
        break
    }
  }

  private applySwing() {
    const cv = this.swingCVConnected ? this.swingCV.value() * 0.25 : 0
    this.clock.swing = Math.min(0.75, Math.max(0.5, this.baseSwing + cv))
  }

  onEvent(handle: string, event: PatchEvent) {
    switch (handle) {
      case 'ev:clock':
        if (event.type !== 'noteOff' && this.running) {
          this.applySwing()
          this.clock.external(event.time)
        }
        break
      case 'ev:reset':
        if (event.type !== 'noteOff') this.reset()
        break
      case 'ev:run':
        if (event.type === 'noteOn') this.play()
        else if (event.type === 'noteOff') this.pause()
        else this.toggle()
        break
    }
  }

  onStart() {
    this.applySwing()
    if (this.running && !this.externalClock) this.clock.start()
  }

  onStop() {
    this.clock.stop()
  }

  dispose() {
    this.clock.dispose()
    this.accentOut.dispose()
    this.summedOut.dispose()
    this.swingCV.dispose()
  }
}

export { serializeBank }
