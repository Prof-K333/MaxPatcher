import * as Tone from 'tone'
import { NodeImpl } from '../NodeImpl'
import { ensureWorkletModule } from '../worklet'
import { chimeraModule, chimeraReady, initChimera } from '../vocal/chimera/chimera'
import {
  BODY_MIX,
  EXHALE_LABEL,
  defaultSyllable,
  lyricsToSyllables,
  planMelisma,
  planNoteOff,
  planNoteOn,
  type BodyMix,
  type Syllable,
} from '../vocal/chimera/planner'
import type { PatchEvent } from '../types'

/** Only one heavy voice engine runs at a time. */
let occupant: VocalSynthImpl | null = null

const setOccupant = (node: VocalSynthImpl | null) => {
  occupant = node
}

const breathFor = (velocity: number, amount: number) =>
  Math.max(0, (0.55 + 0.55 * Math.min(1, Math.max(0, velocity))) * amount)

/**
 * After a long load, the queue can hold many seconds of stale noteOn/noteOff
 * events. Replaying them would dump a burst into the voice engine. Keep only
 * a note that is still held at the end of the queue, if any.
 */
export function liveNoteFromQueue(events: PatchEvent[]): Extract<PatchEvent, { type: 'noteOn' }> | null {
  const held: Array<Extract<PatchEvent, { type: 'noteOn' }>> = []
  for (const event of events) {
    if (event.type === 'noteOn') {
      const i = held.findIndex((e) => e.note === event.note)
      if (i >= 0) held.splice(i, 1)
      held.push(event)
    } else if (event.type === 'noteOff') {
      const i = held.findIndex((e) => e.note === event.note)
      if (i >= 0) held.splice(i, 1)
    }
  }
  return held.at(-1) ?? null
}

/**
 * Chimera singer: notes in, voice out, patched into the mixer like any other voice.
 *
 * The official Chimera AudioEngine is not used here. It would construct its own
 * AudioContext and connect to the speakers, skipping MaxPatcher's mixer and the
 * Start Audio button. This node loads the worklet onto Tone's context and
 * connects only to its own output.
 */
export class VocalSynthImpl extends NodeImpl {
  private output = new Tone.Gain(Tone.dbToGain(-8))
  private worklet: AudioWorkletNode | null = null
  private ready = false
  private disposed = false
  private starting = false

  /** Shown on the node when the engine cannot start, or while it loads. */
  status = ''
  blocked = false

  private body: keyof typeof BODY_MIX = 'female'
  private vowel = 'ah'
  private breath = 0.75
  private lyrics = ''
  private syllables: Syllable[] = []
  private cursor = 0
  private nextTag = 2
  private speakId = 0
  private held: number[] = []
  private sounding: { midi: number; syl: Syllable; tag: number } | null = null
  private queued: PatchEvent[] = []

  constructor() {
    super()
    if (occupant && occupant !== this) {
      this.blocked = true
      this.status = 'Only one Vocal Synth can run at a time — the voice model is heavy. Remove the other one to use this node.'
      return
    }
    setOccupant(this)
    this.status = 'Loading the singer…'
    void this.boot()
  }

  audioOut(): Tone.ToneAudioNode {
    return this.output
  }

  audioIn(): null {
    return null
  }

  private bodyMix(): BodyMix {
    return BODY_MIX[this.body]
  }

  private rebuildLyrics() {
    const text = this.lyrics.trim()
    if (!text) {
      this.syllables = []
      this.cursor = 0
      return
    }
    if (!chimeraReady()) return
    try {
      this.syllables = lyricsToSyllables(text, 'en')
    } catch {
      this.syllables = []
    }
    this.cursor = 0
  }

  private syllableFor(event: Extract<PatchEvent, { type: 'noteOn' }>): Syllable {
    const word = event.syllable?.trim()
    if (word) {
      if (chimeraReady()) {
        try {
          const parts = lyricsToSyllables(word, 'en')
          if (parts.length) return parts[0]
        } catch {
          /* fall through to a sung vowel */
        }
      }
      return { ...defaultSyllable(this.vowel), text: word }
    }
    if (this.syllables.length) {
      const syl = this.syllables[this.cursor % this.syllables.length] ?? defaultSyllable(this.vowel)
      this.cursor = (this.cursor + 1) % this.syllables.length
      return syl.melisma ? { ...syl, onset: [] } : syl
    }
    return defaultSyllable(this.vowel)
  }

  private send(msg: object) {
    this.worklet?.port.postMessage(msg)
  }

  private schedule(gestures: ReturnType<typeof planNoteOn>, lead = 0.006) {
    this.send({
      type: 'schedule',
      gestures,
      segments: [],
      end: 0,
      id: ++this.speakId,
      replace: false,
      lead,
    })
  }

  private noteOn(midi: number, velocity: number, syl: Syllable) {
    const body = this.bodyMix()
    const tag = this.nextTag
    this.nextTag += 2
    const from = this.sounding
    if (from) {
      this.send({ type: 'release', tag: from.tag })
      this.send({ type: 'release', tag: from.tag + 1 })
    }
    const gs = planNoteOn(syl, midi, {
      body,
      vibrato: 0.35,
      tag,
      legatoFrom: from ? { syl: from.syl, midi: from.midi } : undefined,
    })
    const breath = breathFor(velocity, this.breath)
    for (const g of gs) {
      if (g.targets.breath !== undefined) g.targets = { ...g.targets, breath: g.targets.breath * breath }
    }
    this.schedule(gs)
    this.sounding = { midi, syl, tag }
  }

  private noteOff(midi: number) {
    const s = this.sounding
    if (!s || s.midi !== midi) return
    if (this.held.length) {
      const next = this.held[this.held.length - 1]
      this.send({ type: 'release', tag: s.tag + 1 })
      this.schedule(planMelisma(next, { vibrato: 0.35, tag: s.tag }))
      s.midi = next
      return
    }
    this.send({ type: 'release', tag: s.tag })
    this.send({ type: 'release', tag: s.tag + 1 })
    this.sounding = null
    const gs = planNoteOff(s.syl, midi, this.bodyMix())
    if (!gs.length) return
    const tag = this.nextTag
    this.nextTag += 2
    this.schedule(gs.map((g) => ({ ...g, tag: g.label === EXHALE_LABEL ? tag + 1 : tag })))
  }

  setParam(key: string, value: number | string) {
    const n = Number(value)
    switch (key) {
      case 'body':
        if (value === 'male' || value === 'female' || value === 'child') {
          this.body = value
          if (this.ready) this.send({ type: 'body', body: this.bodyMix() })
        }
        break
      case 'vowel':
        if (typeof value === 'string' && value) this.vowel = value
        break
      case 'breath':
        if (Number.isFinite(n)) this.breath = Math.min(1, Math.max(0, n))
        break
      case 'volume':
        if (Number.isFinite(n)) this.output.gain.rampTo(Tone.dbToGain(n), 0.02)
        break
      case 'lyrics':
        this.lyrics = typeof value === 'string' ? value : ''
        this.rebuildLyrics()
        break
    }
  }

  onEvent(_handle: string, event: PatchEvent) {
    if (this.blocked) return
    if (!this.ready) {
      if (event.type === 'noteOn' || event.type === 'noteOff') this.queued.push(event)
      return
    }
    this.handle(event)
  }

  private handle(event: PatchEvent) {
    if (event.type === 'noteOn') {
      this.held = this.held.filter((n) => n !== event.note).concat(event.note)
      this.noteOn(event.note, event.velocity, this.syllableFor(event))
    } else if (event.type === 'noteOff') {
      this.held = this.held.filter((n) => n !== event.note)
      this.noteOff(event.note)
    } else if (event.type === 'bang') {
      this.held = this.held.filter((n) => n !== 60).concat(60)
      this.noteOn(60, event.velocity ?? 0.8, this.syllables[this.cursor] ?? defaultSyllable(this.vowel))
      if (this.syllables.length) this.cursor = (this.cursor + 1) % this.syllables.length
    }
  }

  private flushQueue() {
    const pending = this.queued
    this.queued = []
    const live = liveNoteFromQueue(pending)
    if (live) this.handle(live)
  }

  private markReady() {
    if (this.ready || this.disposed || this.blocked) return
    this.ready = true
    this.status = ''
    this.flushQueue()
  }

  private async boot() {
    if (this.blocked || this.disposed || this.starting) return
    this.starting = true
    try {
      await initChimera()
      if (this.disposed) return
      const context = Tone.getContext() as Tone.Context
      await ensureWorkletModule(context, 'chimera-processor.js')
      if (this.disposed) return
      const node = context.createAudioWorkletNode('chimera', {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [2],
        processorOptions: { module: chimeraModule() },
      })
      // postReady() may fire during construction, before this handler exists.
      // Sending `body` immediately makes the worklet post ready again, which
      // we cannot miss. Do not mark ready or flush until that message arrives.
      node.port.onmessage = (e: MessageEvent<{ type?: string; message?: string }>) => {
        if (this.disposed) return
        if (e.data?.type === 'ready') {
          this.markReady()
        } else if (e.data?.type === 'error') {
          this.status = e.data.message || 'The singer stopped unexpectedly.'
          this.ready = false
        }
      }
      node.connect(this.output.input as unknown as AudioNode)
      this.worklet = node
      this.send({ type: 'telemetry', enabled: false })
      this.send({ type: 'body', body: this.bodyMix() })
      this.rebuildLyrics()
    } catch (err) {
      this.ready = false
      this.status = err instanceof Error ? err.message : 'The singer could not start.'
      console.error('[vocalSynth]', err)
    } finally {
      this.starting = false
    }
  }

  onStart() {
    if (!this.blocked && !this.ready && !this.starting) void this.boot()
  }

  onStop() {
    this.held = []
    if (this.sounding) {
      this.send({ type: 'release', tag: this.sounding.tag })
      this.send({ type: 'release', tag: this.sounding.tag + 1 })
      this.sounding = null
    }
    this.send({ type: 'stopSpeech' })
    this.queued = []
  }

  dispose() {
    this.disposed = true
    this.onStop()
    this.worklet?.disconnect()
    this.worklet = null
    this.output.dispose()
    if (occupant === this) setOccupant(null)
  }
}
