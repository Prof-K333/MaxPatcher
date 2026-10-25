import * as Tone from 'tone'
import { NodeImpl, type AudioTarget } from '../NodeImpl'
import type { PatchEvent } from '../types'

/**
 * How far before the loop boundary a held note is released. Long enough that
 * the voice's own release is audible, short enough not to clip the phrase.
 */
const TAIL_GUARD = 0.01

interface RecordedEvent {
  /** Position within the loop, in seconds. */
  at: number
  event: PatchEvent
}

/**
 * Records incoming note events, snaps them to the clock, and replays them on
 * a seamless loop.
 *
 * Playback is scheduled against Tone's Transport rather than a JS timer, so
 * the loop stays locked to the clock and to anything else synced to it.
 * Recording and overdub both capture into the same list; overdub simply keeps
 * what is already there instead of replacing it.
 */
export class LooperImpl extends NodeImpl {
  private events: RecordedEvent[] = []
  private scheduleIds: number[] = []
  private bars = 2
  private quantizeDivision = 4 // sixteenths per beat → set from the param
  private recording = false
  private overdub = false
  /** Pending take, kept apart until the pass completes. */
  private incoming: RecordedEvent[] = []

  onChange: (() => void) | null = null

  audioOut(): Tone.ToneAudioNode | null {
    return null
  }

  audioIn(): AudioTarget | null {
    return null
  }

  get loopSeconds(): number {
    const secondsPerBeat = 60 / Tone.getTransport().bpm.value
    return secondsPerBeat * 4 * this.bars
  }

  get eventCount(): number {
    return this.events.length + this.incoming.length
  }

  get isRecording(): boolean {
    return this.recording
  }

  /** Where we are within the current loop pass, in seconds. */
  private loopPosition(): number {
    const seconds = Tone.getTransport().seconds
    const len = this.loopSeconds
    return ((seconds % len) + len) % len
  }

  /** Snaps a time to the nearest grid line, wrapping at the loop boundary. */
  private quantize(time: number): number {
    if (this.quantizeDivision <= 0) return time
    const secondsPerBeat = 60 / Tone.getTransport().bpm.value
    const grid = secondsPerBeat / this.quantizeDivision
    const snapped = Math.round(time / grid) * grid
    // Clamped, never wrapped: a note-off snapped up to the loop boundary used
    // to come back round as 0, landing ahead of its own note-on. The voice
    // then never got released, and every pass stacked another one.
    return Math.min(snapped, Math.max(0, this.loopSeconds - TAIL_GUARD))
  }

  setRecording(on: boolean) {
    this.recording = on
    if (on) {
      this.incoming = []
      if (!this.overdub) this.events = []
    } else {
      this.commit()
    }
    this.onChange?.()
  }

  setOverdub(on: boolean) {
    this.overdub = on
    this.onChange?.()
  }

  private commit() {
    if (!this.incoming.length) return
    const merged = this.closeHeldNotes(this.events.concat(this.incoming))
    this.events = merged.sort((a, b) => a.at - b.at)
    this.incoming = []
    this.reschedule()
  }

  /**
   * Gives every note-on in the take a note-off.
   *
   * A pass can easily capture one without the other — you stop recording
   * while still holding a key, or the key goes down near the end of the loop
   * and comes up after the wrap. The loop then replays a note that is never
   * released, and since it repeats, each pass leaves another voice sounding
   * until the patch is a wall of drone. Releasing them at the boundary keeps
   * a loop self-contained.
   */
  private closeHeldNotes(list: RecordedEvent[]): RecordedEvent[] {
    const held = new Set<number>()
    for (const rec of list) {
      if (rec.event.type === 'noteOn') held.add(rec.event.note)
      else if (rec.event.type === 'noteOff') held.delete(rec.event.note)
    }
    if (!held.size) return list
    const at = Math.max(0, this.loopSeconds - TAIL_GUARD)
    return list.concat([...held].map((note) => ({ at, event: { type: 'noteOff' as const, note } })))
  }

  clear() {
    this.events = []
    this.incoming = []
    this.reschedule()
    this.onChange?.()
  }

  setParam(key: string, value: number | string) {
    const n = Number(value)
    if (key === 'bars') {
      this.bars = Math.max(1, n)
      this.reschedule()
    } else if (key === 'quantize') {
      // "off" | "1/4" | "1/8" | "1/16" → grid subdivisions of a beat.
      this.quantizeDivision = { off: 0, '1/4': 1, '1/8': 2, '1/16': 4 }[String(value)] ?? 4
    } else if (key === 'record') {
      const on = n >= 0.5
      if (on !== this.recording) this.setRecording(on)
    } else if (key === 'overdub') {
      this.setOverdub(n >= 0.5)
    }
  }

  onEvent(_handle: string, event: PatchEvent) {
    // Pass live input straight through, so playing while recording is audible.
    this.emit('ev:out', event)
    if (!this.recording) return
    this.incoming.push({ at: this.quantize(this.loopPosition()), event })
    this.onChange?.()
  }

  /**
   * Each recorded event gets its own repeating Transport slot at its offset
   * within the loop. The callback's `time` is the exact audio-clock moment the
   * event is due, and it travels with the event so voices start sample-accurately
   * rather than whenever the main thread happens to run.
   */
  private reschedule() {
    this.unschedule()
    if (!this.events.length) return

    const len = this.loopSeconds
    const transport = Tone.getTransport()
    for (const rec of this.events) {
      const id = transport.scheduleRepeat((time) => this.emit('ev:out', { ...rec.event, time }), len, rec.at)
      this.scheduleIds.push(id)
    }
  }

  private unschedule() {
    const transport = Tone.getTransport()
    this.scheduleIds.forEach((id) => transport.clear(id))
    this.scheduleIds = []
  }

  onStart() {
    if (this.events.length) this.reschedule()
  }

  onStop() {
    this.unschedule()
  }

  dispose() {
    this.unschedule()
  }
}
