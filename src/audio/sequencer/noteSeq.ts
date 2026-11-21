import { BAR_STEPS, normalizeBars, normalizeOrder } from './arrangement'

export { BAR_STEPS }
export const ROLL_ROWS = 13
/** One bar of 16ths — the familiar piano-roll width. */
export const NOTE_STEPS = BAR_STEPS
/** Longest single slot, if you stretch one memory slot past a bar. */
export const MAX_SEQ_STEPS = 128

export interface NoteStep {
  /** Semitones above the sequence root, or null when the step is silent. */
  pitch: number | null
  accent: boolean
  /** Optional syllable sung on this step when a Vocal Synth is patched in. */
  syllable?: string
}

export type NoteSequence = NoteStep[]

export const emptySequence = (length = NOTE_STEPS): NoteSequence =>
  Array.from({ length: Math.min(MAX_SEQ_STEPS, Math.max(1, length)) }, () => ({ pitch: null, accent: false }))

/**
 * Packed as two short strings so a sequence costs a few dozen bytes in the
 * patch file rather than a few hundred.
 */
export function serializeSequence(seq: NoteSequence): string {
  const pitches = seq.map((s) => (s.pitch === null ? '.' : s.pitch.toString(36))).join('')
  const accents = seq.map((s) => (s.accent ? '1' : '0')).join('')
  const packed = `${pitches}|${accents}`
  if (!seq.some((s) => s.syllable)) return packed
  // A third field, slash-separated, so old two-field strings still load.
  return `${packed}|${seq.map((s) => encodeSyllable(s.syllable)).join('/')}`
}

const encodeSyllable = (s?: string) => (s ?? '').replace(/[/|]/g, ' ').trim()

export function parseSequence(raw: unknown): NoteSequence {
  if (typeof raw !== 'string' || !raw.includes('|')) return emptySequence()
  const [pitches, accents, syllables] = raw.split('|')
  // Honour the packed length so a 1/8-rate bar of 8 steps does not get padded
  // back to a 16-step slot (which would double the bar at playback).
  const count = Math.min(MAX_SEQ_STEPS, Math.max(1, pitches.length))
  const seq = emptySequence(count)
  const syls = syllables !== undefined ? syllables.split('/') : []
  for (let i = 0; i < count; i++) {
    const c = pitches[i]
    const syllable = syls[i]?.trim() || undefined
    if (c && c !== '.') {
      const v = parseInt(c, 36)
      if (Number.isFinite(v) && v >= 0 && v < ROLL_ROWS) {
        seq[i] = { pitch: v, accent: accents?.[i] === '1', ...(syllable ? { syllable } : {}) }
        continue
      }
    }
    if (syllable) seq[i] = { pitch: null, accent: false, syllable }
  }
  return seq
}

/** Words and hyphenated bits, in order — enough to walk a lyric against notes. */
export function tokenizeLyrics(text: string): string[] {
  return text
    .split(/[\s-]+/)
    .map((s) => s.trim())
    .filter(Boolean)
}

/** Shipped lines, as [step, semitone, accent] triples above the root. */
type LineSpec = Array<[number, number, boolean?]>

export const FACTORY_LINES: Array<{ name: string; short: string; notes: LineSpec }> = [
  {
    name: 'Minor arp',
    short: 'Min',
    notes: [[0, 0, true], [2, 3], [4, 7], [6, 12], [8, 7], [10, 3], [12, 0, true], [14, 7]],
  },
  {
    name: 'Acid line',
    short: 'Acid',
    notes: [[0, 0, true], [1, 0], [3, 12], [4, 0], [6, 3], [7, 0], [8, 10, true], [10, 0], [11, 7], [13, 12], [15, 10]],
  },
  {
    name: 'Octave bass',
    short: 'Oct',
    notes: [[0, 0, true], [2, 12], [4, 0], [6, 12], [8, 0, true], [10, 12], [12, 0], [14, 12]],
  },
  {
    name: 'Pentatonic run',
    short: 'Pent',
    notes: [[0, 0, true], [1, 3], [2, 5], [3, 7], [4, 10], [5, 12], [7, 10], [8, 7, true], [9, 5], [10, 3], [12, 0], [14, 7]],
  },
  {
    name: 'Major arp',
    short: 'Maj',
    notes: [[0, 0, true], [2, 4], [4, 7], [6, 12], [8, 7], [10, 4], [12, 0, true], [14, 4]],
  },
  {
    name: 'Walking bass',
    short: 'Walk',
    notes: [[0, 0, true], [2, 2], [4, 3], [6, 5], [8, 7, true], [10, 5], [12, 3], [14, 2]],
  },
  {
    name: 'Syncopated stab',
    short: 'Stab',
    notes: [[0, 0, true], [3, 7], [6, 10], [7, 12], [11, 7], [14, 3, true]],
  },
  {
    name: 'Drone fifths',
    short: 'Drne',
    notes: [[0, 0, true], [4, 7], [8, 0], [12, 7]],
  },
]

export const SEQ_FACTORY_COUNT = 8
export const SEQ_CUSTOM_COUNT = 8
export const SEQ_SLOT_COUNT = SEQ_FACTORY_COUNT + SEQ_CUSTOM_COUNT

export const SEQ_NAMES = [
  ...FACTORY_LINES.map((l) => l.name),
  ...Array.from({ length: SEQ_CUSTOM_COUNT }, (_, i) => `Custom ${i + 1}`),
]
export const SEQ_SHORT = [
  ...FACTORY_LINES.map((l) => l.short),
  ...Array.from({ length: SEQ_CUSTOM_COUNT }, (_, i) => String(i + 1)),
]

const lineToSequence = (notes: LineSpec): NoteSequence => {
  const seq = emptySequence()
  for (const [step, pitch, accent] of notes) {
    if (step < NOTE_STEPS && pitch >= 0 && pitch < ROLL_ROWS) seq[step] = { pitch, accent: !!accent }
  }
  return seq
}

/** The shipped line for a slot, or an empty grid for the custom half. */
export const factorySequence = (index: number): NoteSequence =>
  FACTORY_LINES[index] ? lineToSequence(FACTORY_LINES[index].notes) : emptySequence()

export const isFactorySeqSlot = (index: number) => index < SEQ_FACTORY_COUNT

export const startingSequence = (): NoteSequence => factorySequence(0)

export interface SeqBank {
  sequences: NoteSequence[]
  current: number
  /** Memory slots to walk, in order. Empty: loop `current`. */
  order: number[]
  /**
   * Bars in one full loop of the chain (64 and 128 are the usual lengths).
   * 0 means "keep looping the order".
   */
  bars: number
  /** Plain lyrics for each slot, walked one syllable per sounded note. */
  lyrics: string[]
}

export const defaultSeqBank = (): SeqBank => ({
  sequences: Array.from({ length: SEQ_SLOT_COUNT }, (_, i) => factorySequence(i)),
  current: 0,
  order: [],
  bars: 0,
  lyrics: Array.from({ length: SEQ_SLOT_COUNT }, () => ''),
})

export function serializeSeqBank(bank: SeqBank): string {
  const payload: Record<string, unknown> = {
    c: bank.current,
    s: bank.sequences.map(serializeSequence),
  }
  const order = normalizeOrder(bank.order, SEQ_SLOT_COUNT)
  if (order.length) payload.o = order
  const bars = normalizeBars(bank.bars)
  if (bars) payload.b = bars
  const lyrics = Array.from({ length: SEQ_SLOT_COUNT }, (_, i) => bank.lyrics?.[i] ?? '')
  if (lyrics.some(Boolean)) payload.l = lyrics
  return JSON.stringify(payload)
}

/**
 * Reads a bank, and still understands the single-sequence string older
 * patches stored — that line becomes slot 1 rather than being thrown away.
 */
export function parseSeqBank(raw: unknown): SeqBank {
  if (typeof raw !== 'string' || !raw.trim()) return defaultSeqBank()

  if (!raw.startsWith('{')) {
    const bank = defaultSeqBank()
    bank.sequences[0] = parseSequence(raw)
    return bank
  }

  try {
    const data = JSON.parse(raw) as { c?: number; s?: unknown[]; o?: unknown; b?: unknown; l?: unknown }
    if (!Array.isArray(data.s) || !data.s.length) return defaultSeqBank()
    const sequences = data.s.slice(0, SEQ_SLOT_COUNT).map((entry) => parseSequence(entry))
    while (sequences.length < SEQ_SLOT_COUNT) sequences.push(factorySequence(sequences.length))
    const lyrics = Array.from({ length: SEQ_SLOT_COUNT }, () => '')
    if (Array.isArray(data.l)) {
      for (let i = 0; i < Math.min(SEQ_SLOT_COUNT, data.l.length); i++) {
        if (typeof data.l[i] === 'string') lyrics[i] = data.l[i]
      }
    }
    return {
      sequences,
      current: Math.min(SEQ_SLOT_COUNT - 1, Math.max(0, Number(data.c) || 0)),
      order: normalizeOrder(data.o, SEQ_SLOT_COUNT),
      bars: normalizeBars(data.b),
      lyrics,
    }
  } catch {
    return defaultSeqBank()
  }
}

/** Resize a slot, keeping existing notes and padding with rests. */
export function resizeSequence(seq: NoteSequence, length: number): NoteSequence {
  const next = emptySequence(length)
  for (let i = 0; i < Math.min(seq.length, next.length); i++) next[i] = { ...seq[i] }
  return next
}

export const ARP_MODES = ['up', 'down', 'up-down', 'random', 'as played'] as const
export type ArpMode = (typeof ARP_MODES)[number]

export const RATES = ['1/4', '1/8', '1/16', '1/8T', '1/16T'] as const
export type Rate = (typeof RATES)[number]

/** Step length in beats for each rate. */
export const RATE_BEATS: Record<Rate, number> = {
  '1/4': 1,
  '1/8': 0.5,
  '1/16': 0.25,
  '1/8T': 1 / 3,
  '1/16T': 1 / 6,
}

/**
 * Expands the held notes into the order the arpeggiator walks.
 * `up-down` drops the repeated end notes so the turnaround does not stutter.
 */
export function arpOrder(held: number[], mode: ArpMode, octaves: number): number[] {
  if (!held.length) return []
  const base = mode === 'as played' ? [...held] : [...held].sort((a, b) => a - b)

  const spread: number[] = []
  for (let o = 0; o < Math.max(1, octaves); o++) spread.push(...base.map((n) => n + o * 12))

  switch (mode) {
    case 'down':
      return spread.slice().reverse()
    case 'up-down':
      return spread.length > 1 ? [...spread, ...spread.slice(1, -1).reverse()] : spread
    default:
      return spread
  }
}
