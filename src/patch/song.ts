/**
 * LLM-friendly song JSON (`format: "patcher-song"`).
 *
 * A full `format: "patcher"` file is a node graph: positions, cable handles, and
 * packed sequencer strings. Language models get that wrong. This companion
 * format uses readable fields — lyrics, note names, drum preset names, a memory
 * chain, a 64- or 128-bar loop — and `deserialize()` expands it into a wired
 * patch that can play out of the box.
 *
 * Export of a hand-patched graph stays as `patcher`. This module is for
 * authoring and import, not a perfect round-trip back to song JSON.
 */
import { NODE_DEFS, defaultParams } from '../audio/nodeDefs'
import {
  BAR_STEPS,
  MAX_SEQ_STEPS,
  RATES,
  RATE_BEATS,
  ROLL_ROWS,
  SEQ_SLOT_COUNT,
  defaultSeqBank,
  emptySequence,
  serializeSeqBank,
  type NoteSequence,
  type Rate,
  type SeqBank,
} from '../audio/sequencer/noteSeq'
import { normalizeBars, normalizeOrder } from '../audio/sequencer/arrangement'
import {
  PATTERN_COUNT,
  defaultBank,
  factoryPattern,
  patternIndexFromName,
  serializeBank,
  type Bank,
} from '../audio/sequencer/pattern'
import type { ParamValues } from '../audio/types'
import type { PatchFile, SerializedEdge, SerializedNode } from './format'

export const SONG_FORMAT = 'patcher-song'
export const SONG_VERSION = 1

export interface SongBar {
  /** Note names such as "C4", "E4", "G#3". ".", "rest", or "-" is a rest. "C4!" is accented. */
  notes?: string[] | string
  /** Syllables for this bar, walked onto sounded notes. */
  lyrics?: string
  /** How many 16th-note steps this slot uses (default 16). */
  length?: number
}

export interface SongChain {
  /** Memory slots to walk, in order (indices, or drum preset names for drums). */
  order?: Array<number | string>
  /** Bars in one full loop of the chain. 64 and 128 are the usual lengths. */
  bars?: number
  /** Alias for `bars`. */
  loopBars?: number
}

export interface SongMelody extends Omit<SongChain, 'bars'> {
  slots?: SongBar[]
  /** Loop length in bars, or (if an array) the same list of slots. */
  bars?: number | SongBar[]
  /** Sequencer rate, e.g. "1/8" or "1/16". Defaults to the song-level rate, then 1/16. */
  rate?: Rate
}

export interface SongDrums extends SongChain {
  /** Factory beat names or slot indices loaded into memory, in order. */
  presets?: Array<number | string>
  /** A single pattern, if you only need one beat. */
  pattern?: number | string
  swing?: number
  volume?: number
}

export interface SongVoice {
  body?: 'male' | 'female' | 'child'
  vowel?: string
  breath?: number
  volume?: number
}

export interface SongExtra {
  type: string
  id?: string
  params?: Record<string, unknown>
  /** Patch this node's default audio (or note) outlet into that node id. */
  to?: string
}

export interface SongInstruments {
  drums?: boolean | SongDrums
  bass?: boolean | { type?: string; notes?: string[] | string; wave?: string; volume?: number }
  pad?: boolean | { wave?: string; volume?: number; cutoff?: number }
  lead?: boolean | { type?: string; volume?: number; wave?: string }
  keys?: boolean | { octave?: number; name?: string }
  fx?: string[] | { reverb?: boolean | number; delay?: boolean | number; filter?: boolean | number; spatial?: boolean }
  mixer?: 'mixer' | 'performanceMixer' | false
  extras?: SongExtra[]
}

export interface SongFile {
  format: typeof SONG_FORMAT
  version?: number
  name?: string
  bpm?: number
  /** Concert key, like "C" or "A minor". */
  key?: string
  /** Sequence root, like "C3". Defaults from the key, then C3. */
  root?: string
  lyrics?: string
  voice?: SongVoice
  /** Shorthand for melody slots: an array of bars. */
  bars?: SongBar[] | string[]
  melody?: SongMelody | SongBar[] | string[]
  /** Shorthand for the melody memory chain. */
  arrangement?: Array<number | string>
  /** Shorthand for the melody loop length, in bars. */
  loopBars?: number
  /** Melody sequencer rate, e.g. "1/8" or "1/16". Default "1/16". */
  rate?: Rate
  drums?: boolean | SongDrums
  instruments?: SongInstruments
}

export class SongParseError extends Error {}

const node = (id: string, type: string, x: number, y: number, params: ParamValues = {}): SerializedNode => ({
  id,
  type,
  position: { x, y },
  params,
})

const wire = (source: string, sourceHandle: string, target: string, targetHandle: string): SerializedEdge => ({
  id: `${source}.${sourceHandle}->${target}.${targetHandle}`,
  source,
  sourceHandle,
  target,
  targetHandle,
})

export const isSongFile = (input: unknown): input is SongFile =>
  typeof input === 'object' && input !== null && (input as { format?: unknown }).format === SONG_FORMAT

const NOTE_RE = /^([A-Ga-g])([#b]?)(-?\d+)?(!)?$/
const REST = new Set(['', '.', '-', 'rest', 'x', 'r'])

const NOTE_INDEX: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }

export function noteNameToMidi(name: string): number | null {
  const raw = name.trim()
  if (REST.has(raw.toLowerCase())) return null
  const match = NOTE_RE.exec(raw.replace(/!+$/, ''))
  if (!match) return null
  const letter = match[1].toUpperCase()
  const acc = match[2] === '#' ? 1 : match[2] === 'b' ? -1 : 0
  const octave = match[3] !== undefined ? Number(match[3]) : 4
  if (!Number.isInteger(octave)) return null
  return (octave + 1) * 12 + NOTE_INDEX[letter] + acc
}

export function parseNoteToken(token: string): { midi: number | null; accent: boolean } {
  const raw = token.trim()
  const accent = raw.endsWith('!')
  const midi = noteNameToMidi(accent ? raw.slice(0, -1) : raw)
  return { midi, accent }
}

export function parseNoteList(notes: string[] | string | undefined): Array<{ midi: number | null; accent: boolean }> {
  if (notes === undefined) return []
  const tokens = Array.isArray(notes)
    ? notes.flatMap((n) => String(n).trim().split(/\s+/))
    : notes.trim().split(/\s+/)
  return tokens.filter(Boolean).map(parseNoteToken)
}

const KEY_NOTE: Record<string, string> = {
  c: 'C',
  'c major': 'C',
  'c minor': 'C',
  'a minor': 'A',
  'g major': 'G',
  g: 'G',
  d: 'D',
  a: 'A',
  e: 'E',
  f: 'F',
  bb: 'Bb',
  eb: 'Eb',
}

export function parseRootMidi(root: unknown, key: unknown, fallback = 48): number {
  if (typeof root === 'string' && root.trim()) {
    const midi = noteNameToMidi(root.trim())
    if (midi !== null) return midi
  }
  if (typeof key === 'string' && key.trim()) {
    const mapped = KEY_NOTE[key.trim().toLowerCase()] ?? key.trim()
    const midi = noteNameToMidi(/-?\d$/.test(mapped) ? mapped : `${mapped}3`)
    if (midi !== null) return midi
  }
  return fallback
}

function asBars(raw: unknown): SongBar[] {
  if (!Array.isArray(raw)) return []
  return raw.map((item) => {
    if (typeof item === 'string') return { notes: item }
    if (item && typeof item === 'object') return item as SongBar
    return { notes: [] }
  })
}

function parseMelodyRate(raw: unknown, warnings: string[]): Rate {
  if (raw === undefined || raw === null || raw === '') return '1/16'
  if (typeof raw === 'string' && (RATES as readonly string[]).includes(raw)) return raw as Rate
  warnings.push(`Unknown melody rate “${String(raw)}” — using 1/16.`)
  return '1/16'
}

/** How many sequencer steps fill one 4/4 bar at this rate. */
export function stepsPerBar(rate: Rate): number {
  return Math.round(4 / RATE_BEATS[rate])
}

function melodyParts(song: SongFile, warnings: string[]): { slots: SongBar[]; orderRaw: unknown; bars: number; rate: Rate } {
  const fromMelody =
    song.melody && typeof song.melody === 'object' && !Array.isArray(song.melody)
      ? (song.melody as SongMelody)
      : null
  const melodyBarList = fromMelody && Array.isArray(fromMelody.bars) ? fromMelody.bars : null
  const slots = asBars(
    fromMelody?.slots ?? melodyBarList ?? (Array.isArray(song.melody) ? song.melody : null) ?? song.bars,
  )
  const loopRaw =
    fromMelody?.loopBars ?? (typeof fromMelody?.bars === 'number' ? fromMelody.bars : undefined) ?? song.loopBars
  return {
    slots,
    orderRaw: fromMelody?.order ?? song.arrangement,
    bars: normalizeBars(loopRaw),
    rate: parseMelodyRate(fromMelody?.rate ?? song.rate, warnings),
  }
}

function sequenceFromBar(bar: SongBar, root: number, warnings: string[], label: string, barSteps: number): NoteSequence {
  const tokens = parseNoteList(bar.notes)
  const length = Math.min(MAX_SEQ_STEPS, Math.max(1, bar.length ?? Math.max(barSteps, tokens.length)))
  const seq = emptySequence(length)
  const words = (bar.lyrics ?? '').split(/[\s-]+/).map((s) => s.trim()).filter(Boolean)
  let word = 0
  for (let i = 0; i < Math.min(tokens.length, length); i++) {
    const { midi, accent } = tokens[i]
    if (midi === null) continue
    const pitch = midi - root
    if (pitch < 0 || pitch >= ROLL_ROWS) {
      warnings.push(`${label} step ${i + 1}: ${midi} is outside the one-octave roll (root MIDI ${root}); skipped.`)
      continue
    }
    const syllable = words[word++]
    seq[i] = { pitch, accent, ...(syllable ? { syllable } : {}) }
  }
  return seq
}

function buildMelodyBank(
  slots: SongBar[],
  orderRaw: unknown,
  bars: number,
  root: number,
  globalLyrics: string,
  warnings: string[],
  barSteps = BAR_STEPS,
): SeqBank {
  const bank = defaultSeqBank()
  if (!slots.length) {
    if (globalLyrics) bank.lyrics[0] = globalLyrics
    return bank
  }
  const count = Math.min(SEQ_SLOT_COUNT, slots.length)
  for (let i = 0; i < count; i++) {
    bank.sequences[i] = sequenceFromBar(slots[i], root, warnings, `Melody slot ${i}`, barSteps)
    bank.lyrics[i] = slots[i].lyrics ?? (i === 0 ? globalLyrics : '')
  }
  if (slots.length > SEQ_SLOT_COUNT) {
    warnings.push(`Only the first ${SEQ_SLOT_COUNT} melody slots are kept (the rest were ignored).`)
  }
  let order = [] as number[]
  if (Array.isArray(orderRaw)) {
    for (const item of orderRaw) {
      const n = typeof item === 'number' ? item : Number(item)
      if (Number.isInteger(n) && n >= 0 && n < SEQ_SLOT_COUNT) order.push(n)
      else warnings.push(`Melody order skipped an unknown slot: ${String(item)}.`)
    }
  } else if (bars > 0 || count > 1) {
    order = Array.from({ length: count }, (_, i) => i)
  }
  bank.order = normalizeOrder(order, SEQ_SLOT_COUNT)
  bank.bars = bars
  bank.current = bank.order[0] ?? 0
  return bank
}

function buildDrumBank(spec: SongDrums, warnings: string[]): Bank {
  const bank = defaultBank()
  const names = spec.presets ?? (spec.pattern !== undefined ? [spec.pattern] : [])
  const resolved: number[] = []
  for (const name of names) {
    const index = patternIndexFromName(name)
    if (index === null) {
      warnings.push(`Unknown drum preset “${String(name)}” — skipped.`)
      continue
    }
    resolved.push(index)
  }
  // Load named presets into consecutive memory slots starting at 0 when the
  // author listed them, so order [0,1,2] matches the list they wrote.
  if (resolved.length) {
    for (let i = 0; i < Math.min(PATTERN_COUNT, resolved.length); i++) {
      bank.patterns[i] = factoryPattern(resolved[i])
    }
  }
  let order: number[] = []
  if (Array.isArray(spec.order)) {
    for (const item of spec.order) {
      const asIndex = typeof item === 'number' ? item : patternIndexFromName(item)
      if (asIndex === null) {
        warnings.push(`Drum order skipped an unknown slot: ${String(item)}.`)
        continue
      }
      order.push(asIndex)
    }
  } else if (resolved.length) {
    order = resolved.map((_, i) => i)
  }
  const bars = normalizeBars(spec.loopBars ?? spec.bars)
  if (!order.length && bars > 0 && resolved.length) order = resolved.map((_, i) => i)
  if (!order.length && bars > 0) order = [bank.current]
  bank.order = normalizeOrder(order, PATTERN_COUNT)
  bank.bars = bars
  bank.current = bank.order[0] ?? (resolved[0] ?? 0)
  return bank
}

function fxList(fx: SongInstruments['fx']): string[] {
  if (!fx) return []
  if (Array.isArray(fx)) return fx.map((s) => String(s).toLowerCase())
  const out: string[] = []
  for (const key of ['reverb', 'delay', 'filter', 'spatial'] as const) {
    if (fx[key]) out.push(key)
  }
  return out
}


/** Pick a root that keeps as many melody notes as possible on the one-octave roll. */
function inferRoot(root: unknown, key: unknown, slots: SongBar[], warnings: string[]): number {
  const explicit = typeof root === 'string' && root.trim() ? noteNameToMidi(root.trim()) : null
  if (explicit !== null) return explicit

  const midis = slots.flatMap((s) => parseNoteList(s.notes).map((n) => n.midi).filter((m): m is number => m !== null))
  const keyMidi = typeof key === 'string' && key.trim() ? parseRootMidi(undefined, key) : null

  if (midis.length) {
    const low = Math.min(...midis)
    const high = Math.max(...midis)
    // Prefer the named key, shifted into the octave of the lowest note.
    if (keyMidi !== null) {
      const letter = keyMidi % 12
      let candidate = low - ((low - letter) % 12 + 12) % 12
      if (high - candidate >= ROLL_ROWS) candidate -= 12
      if (high - candidate < ROLL_ROWS && midis.every((m) => m >= candidate && m < candidate + ROLL_ROWS)) {
        return candidate
      }
    }
    if (high - low >= ROLL_ROWS) {
      warnings.push(`Melody spans more than an octave; the roll starts at MIDI ${low} and notes above ${low + ROLL_ROWS - 1} are skipped.`)
    }
    return low
  }

  return keyMidi ?? 48
}

/**
 * Expands a song file into a regular patch graph, collecting warnings rather
 * than throwing on bad optional fields.
 */
export function expandSong(input: unknown): { patch: PatchFile; warnings: string[] } {
  if (!isSongFile(input)) throw new SongParseError('Not a song file (missing "format": "patcher-song").')
  const song = input
  if (typeof song.version === 'number' && song.version > SONG_VERSION) {
    throw new SongParseError(`Song version ${song.version} is newer than this app understands (${SONG_VERSION}).`)
  }

  const warnings: string[] = []
  const bpm = Number.isFinite(Number(song.bpm)) ? Math.min(260, Math.max(40, Number(song.bpm))) : 120
  const inst = song.instruments ?? {}
  const drumSpec: false | SongDrums | true =
    song.drums ?? inst.drums ?? false
  const voice = song.voice ?? {}

  const melodyMeta = melodyParts(song, warnings)
  const root = inferRoot(song.root, song.key, melodyMeta.slots, warnings)
  const barSteps = stepsPerBar(melodyMeta.rate)
  const melodyBank = buildMelodyBank(
    melodyMeta.slots,
    melodyMeta.orderRaw,
    melodyMeta.bars,
    root,
    typeof song.lyrics === 'string' ? song.lyrics : '',
    warnings,
    barSteps,
  )
  const hasMelody = melodyMeta.slots.some((s) => parseNoteList(s.notes).some((n) => n.midi !== null))

  const nodes: SerializedNode[] = []
  const edges: SerializedEdge[] = []
  let x = 40
  const row1 = 40
  const row2 = 360
  const row3 = 680

  const wantKeys = inst.keys !== false
  if (wantKeys) {
    const keys = typeof inst.keys === 'object' ? inst.keys : {}
    nodes.push(
      node('kbd', 'keyboard', x, row1, {
        name: keys.name ?? 'Play me',
        octave: keys.octave ?? 4,
      }),
    )
  }

  nodes.push(
    node('vocal', 'vocalSynth', x + 280, row1, {
      body: voice.body === 'male' || voice.body === 'child' ? voice.body : 'female',
      vowel: typeof voice.vowel === 'string' && voice.vowel ? voice.vowel : 'ah',
      breath: Number.isFinite(Number(voice.breath)) ? Number(voice.breath) : 0.75,
      volume: Number.isFinite(Number(voice.volume)) ? Number(voice.volume) : -8,
      lyrics: typeof song.lyrics === 'string' ? song.lyrics : '',
    }),
  )

  if (hasMelody || melodyBank.order.length || melodyMeta.slots.length) {
    nodes.push(
      node('seq', 'arp', x, row2, {
        mode: 'sequence',
        rate: melodyMeta.rate,
        bpm,
        length: Math.min(MAX_SEQ_STEPS, Math.max(1, melodyBank.sequences[melodyBank.current]?.length ?? barSteps)),
        root,
        running: 1,
        gate: 0.9,
        octaves: 1,
        steps: serializeSeqBank(melodyBank),
      }),
    )
    edges.push(wire('seq', 'ev:note', 'vocal', 'ev:note'))
  } else if (wantKeys) {
    edges.push(wire('kbd', 'ev:note', 'vocal', 'ev:note'))
  } else {
    warnings.push('No melody bars and no keyboard — the singer is in the patch, but nothing is driving it yet.')
  }

  const audioSources: Array<{ id: string; mix: string }> = [{ id: 'vocal', mix: 'in1' }]

  const drumsOn = drumSpec !== false
  if (drumsOn) {
    const spec: SongDrums = drumSpec === true ? {} : drumSpec
    const drumBank = buildDrumBank(spec, warnings)
    nodes.push(
      node('drumSeq', 'drumSeq', x + 520, row1, {
        bpm,
        running: 1,
        swing: Number.isFinite(Number(spec.swing)) ? Number(spec.swing) : 0.5,
        patterns: serializeBank(drumBank),
      }),
    )
    nodes.push(
      node('drums', 'drums808', x + 520, row2, {
        volume: Number.isFinite(Number(spec.volume)) ? Number(spec.volume) : -6,
      }),
    )
    for (const lane of ['bd', 'sd', 'cp', 'ch', 'oh', 'cb']) {
      edges.push(wire('drumSeq', `ev:${lane}`, 'drums', `ev:${lane}`))
    }
    edges.push(wire('drumSeq', 'accent', 'drums', 'cv:accent'))
    audioSources.push({ id: 'drums', mix: 'in2' })
  }

  if (inst.bass) {
    const bass = inst.bass === true ? {} : inst.bass
    const type = bass.type === 'oscillator' ? 'oscillator' : 'fmsynth'
    const bassNode = node(
      'bass',
      type,
      x + 40,
      row3,
      type === 'fmsynth'
        ? { carrier: bass.wave ?? 'sine', harmonicity: 1, modulationIndex: 2, attack: 0.02, release: 0.3, volume: bass.volume ?? -8 }
        : { type: bass.wave ?? 'sine', frequency: 55, volume: bass.volume ?? -10 },
    )
    nodes.push(bassNode)
    if (bass.notes && type === 'fmsynth') {
      const bassBank = buildMelodyBank([{ notes: bass.notes }], undefined, 0, root - 12, '', warnings)
      nodes.push(
        node('bassSeq', 'arp', x - 20, row3 + 200, {
          mode: 'sequence',
          rate: '1/8',
          bpm,
          length: BAR_STEPS,
          root: root - 12,
          running: 1,
          gate: 0.9,
          steps: serializeSeqBank(bassBank),
        }),
      )
      edges.push(wire('bassSeq', 'ev:note', 'bass', 'ev:note'))
    }
    audioSources.push({ id: 'bass', mix: 'in3' })
  }

  if (inst.pad) {
    // A bare oscillator starts on Start Audio and holds a tone with no envelope,
    // which is a drone — not a usable song pad. Do not auto-insert one.
    warnings.push(
      'instruments.pad is not added automatically — a free-running oscillator would drone for the whole song. Patch an oscillator through an envelope and VCA in extras if you want a pad, or omit pad.',
    )
  }

  if (inst.lead) {
    const lead = inst.lead === true ? {} : inst.lead
    const type = lead.type === 'oscillator' ? 'oscillator' : 'fmsynth'
    nodes.push(
      node(
        'lead',
        type,
        x + 760,
        row3,
        type === 'fmsynth'
          ? { volume: lead.volume ?? -10, carrier: lead.wave ?? 'sawtooth' }
          : { volume: lead.volume ?? -10, type: lead.wave ?? 'sawtooth' },
      ),
    )
    if (wantKeys && !hasMelody) edges.push(wire('kbd', 'ev:note', 'lead', 'ev:note'))
    else if (hasMelody) edges.push(wire('seq', 'ev:note', 'lead', 'ev:note'))
    audioSources.push({ id: 'lead', mix: audioSources.length < 4 ? `in${audioSources.length + 1}` : 'in4' })
  }

  // Mixer + FX + master
  const useMixer = inst.mixer !== false && (audioSources.length > 1 || inst.mixer)
  const mixerType = inst.mixer === 'performanceMixer' ? 'performanceMixer' : 'mixer'
  const mixId = 'mix'
  const fx = fxList(inst.fx)
  let chainIn = useMixer ? mixId : audioSources[0]?.id
  const fxStartX = 900

  if (useMixer) {
    const mixerParams: ParamValues = mixerType === 'mixer' ? { fader: 0.8 } : {}
    nodes.push(node(mixId, mixerType, fxStartX, row2, mixerParams))
    audioSources.forEach((src, i) => {
      const handle =
        mixerType === 'performanceMixer'
          ? `in${Math.min(6, i + 1)}`
          : (`in${Math.min(4, i + 1)}` as string)
      // 4-channel mixer only has in1–in4; extras sum into in4.
      edges.push(wire(src.id, 'out', mixId, handle))
    })
  } else if (audioSources.length) {
    // No mixer: we will chain / sum into master below.
  }

  let last = chainIn
  let fxX = fxStartX + 260
  for (const kind of fx) {
    if (kind === 'reverb' || kind === 'verb') {
      nodes.push(node('verb', 'reverb', fxX, row2, { decay: 2.5, wet: 0.3 }))
      if (last) edges.push(wire(last, last === mixId && mixerType === 'performanceMixer' ? 'outL' : 'out', 'verb', 'in'))
      last = 'verb'
      fxX += 200
    } else if (kind === 'delay') {
      nodes.push(node('delay', 'delay', fxX, row2, { delayTime: 0.28, feedback: 0.35, wet: 0.25 }))
      if (last) edges.push(wire(last, last === mixId && mixerType === 'performanceMixer' ? 'outL' : 'out', 'delay', 'in'))
      last = 'delay'
      fxX += 200
    } else if (kind === 'filter') {
      nodes.push(node('fxFilter', 'filter', fxX, row2, { frequency: 1800, type: 'lowpass' }))
      if (last) edges.push(wire(last, last === mixId && mixerType === 'performanceMixer' ? 'outL' : 'out', 'fxFilter', 'in'))
      last = 'fxFilter'
      fxX += 200
    } else if (kind === 'spatial' || kind === 'spatialfx' || kind === 'spatialfxpro') {
      nodes.push(node('spatial', 'spatialFXPro', fxX, row2, {}))
      if (last) edges.push(wire(last, last === mixId && mixerType === 'performanceMixer' ? 'outL' : 'out', 'spatial', 'in'))
      last = 'spatial'
      fxX += 220
    } else {
      warnings.push(`Unknown effect “${kind}” — skipped.`)
    }
  }

  if (inst.extras) {
    inst.extras.forEach((extra, i) => {
      if (!extra || typeof extra.type !== 'string' || !Object.hasOwn(NODE_DEFS, extra.type)) {
        warnings.push(`Extra instrument skipped: unknown node type “${String(extra?.type)}”.`)
        return
      }
      const id = typeof extra.id === 'string' && extra.id ? extra.id : `extra${i + 1}`
      const params = { ...defaultParams(extra.type) }
      if (extra.params && typeof extra.params === 'object') {
        for (const [k, v] of Object.entries(extra.params)) {
          if (typeof v === 'number' || typeof v === 'string') params[k] = v
        }
      }
      nodes.push(node(id, extra.type, fxX, row3 + (i % 3) * 40, params))
      const def = NODE_DEFS[extra.type]
      const out = def.outputs.find((o) => o.kind === 'audio')
      const dest = extra.to ?? last ?? 'master'
      if (out && dest) edges.push(wire(id, out.id, dest, dest === 'master' || dest === last ? 'in' : 'in'))
    })
  }

  nodes.push(node('master', 'destination', fxX + 200, row2, { volume: -6 }))
  if (last) {
    const from = last === mixId && mixerType === 'performanceMixer' ? 'outL' : 'out'
    edges.push(wire(last, from, 'master', 'in'))
  } else if (!useMixer) {
    for (const src of audioSources) edges.push(wire(src.id, 'out', 'master', 'in'))
  }

  const patch: PatchFile = {
    format: 'patcher',
    version: 1,
    name: typeof song.name === 'string' && song.name.trim() ? song.name.trim() : 'Untitled song',
    savedAt: new Date().toISOString(),
    nodes,
    edges,
  }
  return { patch, warnings }
}
