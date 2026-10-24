import * as Tone from 'tone'
import { NodeImpl, type AudioTarget } from '../NodeImpl'
import { CVInlet } from '../cv'
import { LookaheadClock } from '../sequencer/LookaheadClock'
import {
  NOTE_STEPS,
  RATE_BEATS,
  arpOrder,
  parseSeqBank,
  type ArpMode,
  type NoteSequence,
  type Rate,
  type SeqBank,
} from '../sequencer/noteSeq'
import type { PatchEvent } from '../types'

const midiToFreq = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12)

/**
 * Melodic step sequencer and arpeggiator.
 *
 * Two ways to decide the next pitch, one clock and one output. In *sequence*
 * mode the pitch comes from the grid; in *arp* mode it comes from whatever
 * notes are being held at the inlet, walked in the chosen direction. Both
 * emit ordinary note events, so anything that accepts a keyboard accepts this.
 *
 * Notes are emitted as a pair — an attack at the step's exact time and a
 * release a gate-length later — rather than held until the next step. That is
 * what lets gate length actually shorten a note instead of merely delaying
 * the one after it.
 */
export class ArpImpl extends NodeImpl {
  private clock: LookaheadClock
  private pitchOut = new Tone.Signal(440, 'frequency')
  private gateOut = new Tone.Signal(0)
  private transposeCV = new CVInlet(1)
  private transposeConnected = false

  private bank: SeqBank = parseSeqBank(null)
  private held: number[] = []
  private latched: number[] = []
  private step = 0
  private arpIndex = 0
  private running = false
  private externalClock = false
  /** Fractional clock accumulator, so triplet rates survive an external clock. */
  private pulseAccum = 0

  private mode: 'arp' | 'sequence' = 'arp'
  private arpMode: ArpMode = 'up'
  private rate: Rate = '1/8'
  private octaves = 2
  private gate = 0.5
  private length = NOTE_STEPS
  private root = 48
  private transpose = 0
  private hold = false

  /** Latest step index, for the UI playhead. */
  displayStep = 0

  constructor() {
    super()
    const ctx = Tone.getContext().rawContext as unknown as AudioContext
    this.clock = new LookaheadClock(ctx)
    this.clock.division = RATE_BEATS[this.rate]
    this.clock.onStep = (_s, time) => this.fire(time)
  }

  // ------------------------------------------------------------------- ports

  audioOut(handle: string): Tone.ToneAudioNode | null {
    if (handle === 'pitch') return this.pitchOut
    if (handle === 'gate') return this.gateOut
    return null
  }

  audioIn(handle: string): AudioTarget | null {
    return handle === 'cv:transpose' ? this.transposeCV.input : null
  }

  onConnectionChange(handle: string, connected: boolean) {
    if (handle === 'cv:transpose') {
      this.transposeCV.setConnected(connected)
      this.transposeConnected = connected
    } else if (handle === 'ev:clock') {
      this.externalClock = connected
      if (connected) this.clock.stop()
      else if (this.running) this.clock.start()
    }
  }

  // -------------------------------------------------------------- transport

  get isRunning() {
    return this.running
  }

  get heldNotes() {
    return this.hold ? this.latched : this.held
  }

  play() {
    this.running = true
    if (!this.externalClock) this.clock.start()
  }

  pause() {
    this.running = false
    this.clock.stop()
    this.gateOut.rampTo(0, 0.005)
  }

  reset() {
    this.step = 0
    this.arpIndex = 0
    this.pulseAccum = 0
    this.clock.reset()
  }

  /** The slot currently selected; `sequence` mode plays this one. */
  private get sequence(): NoteSequence {
    return this.bank.sequences[this.bank.current]
  }

  getBank(): SeqBank {
    return this.bank
  }

  setBank(bank: SeqBank) {
    this.bank = bank
  }

  // --------------------------------------------------------------- stepping

  /** Picks the note this step should play, or null for a rest. */
  private nextNote(): { note: number; accent: boolean } | null {
    const shift = this.transpose + (this.transposeConnected ? Math.round(this.transposeCV.value() * 12) : 0)

    if (this.mode === 'sequence') {
      const cell = this.sequence[this.step % Math.max(1, this.length)]
      if (!cell || cell.pitch === null) return null
      return { note: this.root + cell.pitch + shift, accent: cell.accent }
    }

    const order = arpOrder(this.heldNotes, this.arpMode, this.octaves)
    if (!order.length) return null
    const index = this.arpMode === 'random' ? Math.floor(Math.random() * order.length) : this.arpIndex % order.length
    this.arpIndex = (this.arpIndex + 1) % Math.max(1, order.length)
    return { note: order[index] + shift, accent: false }
  }

  private fire(time: number) {
    const picked = this.nextNote()
    this.displayStep = this.step % Math.max(1, this.length)
    this.step = (this.step + 1) % Math.max(1, this.length)
    this.emit('ev:step', { type: 'bang', time })

    if (!picked) return
    const note = Math.min(120, Math.max(0, picked.note))
    const freq = midiToFreq(note)
    const velocity = picked.accent ? 1 : 0.75
    const hold = Math.max(0.01, this.clock.stepDuration * this.gate)

    this.emit('ev:note', { type: 'noteOn', note, freq, velocity, time })
    this.emit('ev:note', { type: 'noteOff', note, time: time + hold })

    this.pitchOut.setValueAtTime(freq, time)
    this.gateOut.setValueAtTime(velocity, time)
    this.gateOut.setValueAtTime(0, time + hold)
  }

  // ----------------------------------------------------------------- params

  setParam(key: string, value: number | string) {
    const n = Number(value)
    switch (key) {
      case 'mode':
        this.mode = value === 'sequence' ? 'sequence' : 'arp'
        break
      case 'arpMode':
        this.arpMode = value as ArpMode
        this.arpIndex = 0
        break
      case 'rate':
        this.rate = value as Rate
        this.clock.division = RATE_BEATS[this.rate] ?? 0.5
        break
      case 'octaves':
        this.octaves = n
        break
      case 'gate':
        this.gate = n
        break
      case 'bpm':
        this.clock.bpm = n
        break
      case 'swing':
        this.clock.swing = n
        break
      case 'length':
        this.length = Math.max(1, Math.min(NOTE_STEPS, n))
        break
      case 'root':
        this.root = n
        break
      case 'transpose':
        this.transpose = n
        break
      case 'mod_transpose':
        this.transposeCV.setDepth(n)
        break
      case 'hold':
        this.hold = n >= 0.5
        // Dropping hold clears the latch, otherwise it would play on forever.
        if (!this.hold) this.latched = [...this.held]
        break
      case 'running':
        if (n >= 0.5) this.play()
        else this.pause()
        break
      case 'steps':
        this.bank = parseSeqBank(value)
        break
    }
  }

  onEvent(handle: string, event: PatchEvent) {
    switch (handle) {
      case 'ev:notes':
        // Held notes feed the arpeggiator; the grid ignores them.
        if (event.type === 'noteOn') {
          if (this.hold && !this.held.length) this.latched = []
          this.held = this.held.filter((n) => n !== event.note).concat(event.note)
          if (this.hold && !this.latched.includes(event.note)) this.latched.push(event.note)
        } else if (event.type === 'noteOff') {
          this.held = this.held.filter((n) => n !== event.note)
          if (!this.hold) this.latched = [...this.held]
        }
        break
      case 'ev:clock':
        if (event.type !== 'noteOff' && this.running) {
          // Fractional accumulation keeps triplets usable off a 16th clock.
          this.pulseAccum += 0.25
          const division = this.clock.division > 0 ? this.clock.division : 0.25
          let guard = 16
          while (this.pulseAccum >= division - 1e-9 && guard-- > 0) {
            this.pulseAccum -= division
            this.fire(event.time ?? Tone.now())
          }
        }
        break
      case 'ev:reset':
        if (event.type !== 'noteOff') this.reset()
        break
      case 'ev:run':
        if (event.type === 'noteOn') this.play()
        else if (event.type === 'noteOff') this.pause()
        else if (this.running) this.pause()
        else this.play()
        break
    }
  }

  onStart() {
    if (this.running && !this.externalClock) this.clock.start()
  }

  onStop() {
    this.clock.stop()
  }

  dispose() {
    this.clock.dispose()
    this.pitchOut.dispose()
    this.gateOut.dispose()
    this.transposeCV.dispose()
  }
}
