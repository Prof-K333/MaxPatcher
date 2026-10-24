export const ROLL_ROWS = 13
export const NOTE_STEPS = 16

export interface NoteStep {
  /** Semitones above the sequence root, or null when the step is silent. */
  pitch: number | null
  accent: boolean
}

export type NoteSequence = NoteStep[]

export const emptySequence = (): NoteSequence =>
  Array.from({ length: NOTE_STEPS }, () => ({ pitch: null, accent: false }))

/**
 * Packed as two short strings so a sequence costs a few dozen bytes in the
 * patch file rather than a few hundred.
 */
export function serializeSequence(seq: NoteSequence): string {
  const pitches = seq.map((s) => (s.pitch === null ? '.' : s.pitch.toString(36))).join('')
  const accents = seq.map((s) => (s.accent ? '1' : '0')).join('')
  return `${pitches}|${accents}`
}

export function parseSequence(raw: unknown): NoteSequence {
  if (typeof raw !== 'string' || !raw.includes('|')) return emptySequence()
  const [pitches, accents] = raw.split('|')
  const seq = emptySequence()
  for (let i = 0; i < NOTE_STEPS; i++) {
    const c = pitches[i]
    if (c && c !== '.') {
      const v = parseInt(c, 36)
      if (Number.isFinite(v) && v >= 0 && v < ROLL_ROWS) seq[i] = { pitch: v, accent: accents?.[i] === '1' }
    }
  }
  return seq
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
}

export const defaultSeqBank = (): SeqBank => ({
  sequences: Array.from({ length: SEQ_SLOT_COUNT }, (_, i) => factorySequence(i)),
  current: 0,
})

export function serializeSeqBank(bank: SeqBank): string {
  return JSON.stringify({ c: bank.current, s: bank.sequences.map(serializeSequence) })
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
    const data = JSON.parse(raw) as { c?: number; s?: unknown[] }
    if (!Array.isArray(data.s) || !data.s.length) return defaultSeqBank()
    const sequences = data.s.slice(0, SEQ_SLOT_COUNT).map((entry) => parseSequence(entry))
    while (sequences.length < SEQ_SLOT_COUNT) sequences.push(factorySequence(sequences.length))
    return { sequences, current: Math.min(SEQ_SLOT_COUNT - 1, Math.max(0, Number(data.c) || 0)) }
  } catch {
    return defaultSeqBank()
  }
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
