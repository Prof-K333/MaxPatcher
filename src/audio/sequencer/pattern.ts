export const TRACKS = ['bd', 'sd', 'cp', 'ch', 'oh', 'cb', 'acc'] as const
export type TrackId = (typeof TRACKS)[number]

export const TRACK_LABELS: Record<TrackId, string> = {
  bd: 'BD', sd: 'SD', cp: 'CP', ch: 'CH', oh: 'OH', cb: 'CB', acc: 'ACC',
}

export const MAX_STEPS = 16
/** Slots 0–7 ship with beats; 8–15 start empty and are yours to fill. */
export const FACTORY_COUNT = 8
export const CUSTOM_COUNT = 8
export const PATTERN_COUNT = FACTORY_COUNT + CUSTOM_COUNT

/** 0 off · 1 normal · 2 accented — the tri-state a step click cycles through. */
export type StepLevel = 0 | 1 | 2

export interface Track {
  /** One entry per step. */
  level: StepLevel[]
  /** Sub-triggers packed into the step: 1 is a single hit, 4 a roll. */
  ratchet: number[]
  /** Chance the step fires at all, 0–1. */
  prob: number[]
  /** Steps before this track wraps — shorter than others gives polymeter. */
  length: number
  mute: boolean
  solo: boolean
  /** Rotates the whole lane against the others. */
  shift: number
}

export type Pattern = Record<TrackId, Track>

export interface Bank {
  patterns: Pattern[]
  current: number
}

const emptyTrack = (): Track => ({
  level: Array(MAX_STEPS).fill(0),
  ratchet: Array(MAX_STEPS).fill(1),
  prob: Array(MAX_STEPS).fill(1),
  length: MAX_STEPS,
  mute: false,
  solo: false,
  shift: 0,
})

export const emptyPattern = (): Pattern =>
  Object.fromEntries(TRACKS.map((t) => [t, emptyTrack()])) as Pattern

interface LaneSpec {
  on?: number[]
  accent?: number[]
  ratchet?: Record<number, number>
}

/**
 * Eight beats in the bank from the start.
 *
 * An empty sequencer is a blank page, and a blank page is the slowest way to
 * find out what a drum machine does. These are the common grooves, so you can
 * switch between them and hear the difference before programming anything.
 */
export const FACTORY_BEATS: Array<{ name: string; short: string; lanes: Partial<Record<TrackId, LaneSpec>> }> = [
  {
    name: 'Four on the floor',
    short: '4×4',
    lanes: {
      bd: { accent: [0, 4, 8, 12] },
      oh: { on: [2, 6, 10, 14] },
      ch: { on: [0, 1, 3, 5, 7, 9, 11, 13, 15] },
      cp: { accent: [4, 12] },
      acc: { accent: [0, 8] },
    },
  },
  {
    name: 'Boom bap',
    short: 'Boom',
    lanes: {
      bd: { accent: [0], on: [10] },
      sd: { accent: [4, 12] },
      ch: { on: [0, 2, 4, 6, 8, 10, 12, 14] },
      acc: { accent: [0, 4, 8, 12] },
    },
  },
  {
    name: 'Trap',
    short: 'Trap',
    lanes: {
      bd: { accent: [0], on: [6, 11] },
      sd: { accent: [8] },
      ch: { on: [0, 2, 4, 6, 8, 10, 12, 14], ratchet: { 6: 3, 14: 4 } },
      acc: { accent: [0, 8] },
    },
  },
  {
    name: 'House',
    short: 'Hous',
    lanes: {
      bd: { accent: [0, 4, 8, 12] },
      oh: { on: [2, 6, 10, 14] },
      cp: { accent: [4, 12] },
      ch: { on: [1, 3, 5, 7, 9, 11, 13, 15] },
      acc: { accent: [0, 8] },
    },
  },
  {
    name: 'Breakbeat',
    short: 'Brk',
    lanes: {
      bd: { accent: [0], on: [3, 10] },
      sd: { accent: [4, 12], on: [14] },
      ch: { on: [0, 2, 4, 6, 8, 10, 12, 14] },
      acc: { accent: [0, 4] },
    },
  },
  {
    name: 'Electro',
    short: 'Elec',
    lanes: {
      bd: { accent: [0, 8], on: [3, 11] },
      sd: { accent: [4, 12] },
      ch: { on: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] },
      cb: { on: [6, 14] },
      acc: { accent: [0, 8] },
    },
  },
  {
    name: 'Half time',
    short: 'Half',
    lanes: {
      bd: { accent: [0], on: [7] },
      sd: { accent: [8] },
      ch: { on: [0, 4, 8, 12] },
      oh: { on: [14] },
      acc: { accent: [0] },
    },
  },
  {
    name: 'Clave',
    short: 'Clav',
    lanes: {
      bd: { accent: [0], on: [6] },
      cb: { accent: [0, 3, 6, 10, 12] },
      cp: { on: [10] },
      ch: { on: [2, 6, 10, 14] },
      acc: { accent: [0, 6] },
    },
  },
]

export const PATTERN_NAMES = [
  ...FACTORY_BEATS.map((b) => b.name),
  ...Array.from({ length: 8 }, (_, i) => `Custom ${i + 1}`),
]
export const PATTERN_SHORT = [
  ...FACTORY_BEATS.map((b) => b.short),
  ...Array.from({ length: 8 }, (_, i) => String(i + 1)),
]

/** Turns a readable lane description into a pattern. */
export function patternFrom(lanes: Partial<Record<TrackId, LaneSpec>>): Pattern {
  const pattern = emptyPattern()
  for (const [id, spec] of Object.entries(lanes) as Array<[TrackId, LaneSpec]>) {
    const track = pattern[id]
    spec.on?.forEach((step) => (track.level[step] = 1))
    spec.accent?.forEach((step) => (track.level[step] = 2))
    if (spec.ratchet) for (const [step, r] of Object.entries(spec.ratchet)) track.ratchet[Number(step)] = r
  }
  return pattern
}

/** The shipped beat for a slot, or an empty grid for the custom half. */
export const factoryPattern = (index: number): Pattern =>
  FACTORY_BEATS[index] ? patternFrom(FACTORY_BEATS[index].lanes) : emptyPattern()

export const isFactorySlot = (index: number) => index < FACTORY_COUNT

export const defaultBank = (): Bank => ({
  patterns: Array.from({ length: PATTERN_COUNT }, (_, i) => factoryPattern(i)),
  current: 0,
})

/**
 * Patterns ride along in the patch file, so they are packed as digit strings
 * rather than arrays of objects — a bank stays a couple of kilobytes instead
 * of tens, and stays readable if anyone opens the JSON.
 */
export function serializeBank(bank: Bank): string {
  return JSON.stringify({
    c: bank.current,
    p: bank.patterns.map((pattern) =>
      Object.fromEntries(
        TRACKS.map((id) => {
          const t = pattern[id]
          return [
            id,
            {
              v: t.level.join(''),
              r: t.ratchet.join(''),
              // Probability as a single digit: 9 means 90%, and 1.0 maps to 'a'.
              p: t.prob.map((x) => (x >= 1 ? 'a' : String(Math.round(x * 10)))).join(''),
              l: t.length,
              m: t.mute ? 1 : 0,
              s: t.solo ? 1 : 0,
              h: t.shift,
            },
          ]
        }),
      ),
    ),
  })
}

const digits = (text: unknown, fallback: number, map: (c: string) => number): number[] =>
  Array.from({ length: MAX_STEPS }, (_, i) => {
    const c = typeof text === 'string' ? text[i] : undefined
    if (c === undefined) return fallback
    const v = map(c)
    return Number.isFinite(v) ? v : fallback
  })

/** Rebuilds a bank from stored JSON, falling back rather than throwing. */
export function parseBank(raw: unknown): Bank {
  if (typeof raw !== 'string' || !raw.trim()) return defaultBank()
  try {
    const data = JSON.parse(raw) as { c?: number; p?: unknown[] }
    if (!Array.isArray(data.p) || !data.p.length) return defaultBank()

    const patterns = data.p.slice(0, PATTERN_COUNT).map((rawPattern) => {
      const pattern = emptyPattern()
      const src = (rawPattern ?? {}) as Record<string, Record<string, unknown>>
      for (const id of TRACKS) {
        const t = src[id]
        if (!t) continue
        const track = pattern[id]
        track.level = digits(t.v, 0, (c) => Math.min(2, Math.max(0, Number(c)))) as StepLevel[]
        track.ratchet = digits(t.r, 1, (c) => Math.min(4, Math.max(1, Number(c))))
        track.prob = digits(t.p, 1, (c) => (c === 'a' ? 1 : Math.min(1, Math.max(0, Number(c) / 10))))
        track.length = Math.min(MAX_STEPS, Math.max(1, Number(t.l) || MAX_STEPS))
        track.mute = !!t.m
        track.solo = !!t.s
        track.shift = Number(t.h) || 0
      }
      return pattern
    })

    while (patterns.length < PATTERN_COUNT) patterns.push(factoryPattern(patterns.length))
    return { patterns, current: Math.min(PATTERN_COUNT - 1, Math.max(0, Number(data.c) || 0)) }
  } catch {
    return defaultBank()
  }
}
