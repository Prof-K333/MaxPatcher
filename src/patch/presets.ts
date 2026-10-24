import { MAX_STEPS, TRACKS, defaultBank, serializeBank, type StepLevel, type TrackId } from '../audio/sequencer/pattern'
import type { PatchFile, SerializedEdge, SerializedNode } from './format'
import type { ParamValues } from '../audio/types'

/**
 * Demo patches.
 *
 * Each one exists to show a different part of the app working, and each is
 * built to make sound as soon as it loads — a preset you have to repair
 * teaches nothing.
 */

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

/** Every drum trigger plus the accent lane, in one go. */
const drumCables = (seq: string, drums: string): SerializedEdge[] => [
  ...['bd', 'sd', 'cp', 'ch', 'oh', 'cb'].map((v) => wire(seq, `ev:${v}`, drums, `ev:${v}`)),
  wire(seq, 'accent', drums, 'cv:accent'),
]

interface LaneSpec {
  on: number[]
  accent?: number[]
  length?: number
  ratchet?: Record<number, number>
}

/** Builds a sequencer bank from a readable lane description. */
function bankFrom(lanes: Partial<Record<TrackId, LaneSpec>>): string {
  const bank = defaultBank()
  const pattern = bank.patterns[0]
  for (const id of TRACKS) {
    const track = pattern[id]
    track.level = Array(MAX_STEPS).fill(0) as StepLevel[]
    track.ratchet = Array(MAX_STEPS).fill(1)
    track.prob = Array(MAX_STEPS).fill(1)
    track.length = MAX_STEPS

    const spec = lanes[id]
    if (!spec) continue
    spec.on.forEach((s) => (track.level[s] = 1))
    spec.accent?.forEach((s) => (track.level[s] = 2))
    if (spec.length) track.length = spec.length
    if (spec.ratchet) for (const [step, r] of Object.entries(spec.ratchet)) track.ratchet[Number(step)] = r
  }
  return serializeBank(bank)
}

const patch = (name: string, nodes: SerializedNode[], edges: SerializedEdge[]): PatchFile => ({
  format: 'patcher',
  version: 1,
  name,
  savedAt: new Date().toISOString(),
  nodes,
  edges,
})

// ---------------------------------------------------------------- 1. Tape loop

const tapeLoop = () =>
  patch(
    'Tape Loop Drone',
    [
      node('kbd', 'keyboard', 40, 20, { name: 'Play me', octave: 3 }),
      node('fm', 'fmsynth', 60, 300, { carrier: 'sawtooth', harmonicity: 1.5, modulationIndex: 6, attack: 0.02, release: 1.6, volume: -4 }),
      // Not fully wet: with an empty loop a wet-only looper is silent, and a
      // preset you cannot hear until you operate it teaches nothing.
      node('loop', 'liveLooper', 420, 300, { name: 'Tape', feedback: 0.85, mix: 0.65, gain: 1 }),
      node('delay', 'delay', 760, 300, { delayTime: 0.37, feedback: 0.45, wet: 1 }),
      node('verb', 'reverb', 420, 640, { decay: 6, wet: 0.35 }),
      node('master', 'destination', 440, 900, { volume: -4 }),
    ],
    [
      wire('kbd', 'ev:note', 'fm', 'ev:note'),
      wire('fm', 'out', 'loop', 'in'),
      // The cycle that makes it evolve: looper out, through the delay, back in.
      wire('loop', 'out', 'delay', 'in'),
      wire('delay', 'out', 'loop', 'in'),
      wire('loop', 'out', 'verb', 'in'),
      wire('verb', 'out', 'master', 'in'),
    ],
  )

// ------------------------------------------------------------ 2. Granular live

const shimmer = () =>
  patch(
    'Granular Shimmer',
    [
      node('kbd', 'keyboard', 40, 20, { name: 'Lead', octave: 4 }),
      node('fm', 'fmsynth', 60, 300, { carrier: 'sine', harmonicity: 2, modulationIndex: 8, attack: 0.01, decay: 0.4, sustain: 0.4, release: 1.2, volume: -4 }),
      node('filt', 'filter', 60, 660, { frequency: 2400, Q: 3 }),
      // Granulating the live synth an octave up is where the shimmer comes from.
      node('gran', 'granular', 420, 300, { source: 'live', density: 40, size: 0.14, pitch: 2, pitchJitter: 25, spread: 0.9, spray: 0.25, mix: 0.7 }),
      node('verb', 'reverb', 420, 700, { decay: 8, wet: 0.7 }),
      node('mix', 'mixer', 800, 560, { level1: 1.1, level2: 1, pan2: 0.2 }),
      node('master', 'destination', 820, 860, { volume: -4 }),
    ],
    [
      wire('kbd', 'ev:note', 'fm', 'ev:note'),
      wire('fm', 'out', 'filt', 'in'),
      wire('fm', 'out', 'gran', 'in'),
      wire('gran', 'out', 'verb', 'in'),
      wire('filt', 'out', 'mix', 'in1'),
      wire('verb', 'out', 'mix', 'in2'),
      wire('mix', 'out', 'master', 'in'),
    ],
  )

// ------------------------------------------------------------------ 3. 808 jam

const jam = () =>
  patch(
    '808 Jam',
    [
      node('seq', 'drumSeq', 40, 20, {
        bpm: 104,
        swing: 0.56,
        running: 1,
        patterns: bankFrom({
          bd: { on: [3, 11], accent: [0, 8] },
          sd: { on: [], accent: [4, 12] },
          ch: { on: [0, 2, 4, 6, 8, 10, 12, 14], ratchet: { 14: 2 } },
          oh: { on: [7] },
          cp: { on: [12] },
          acc: { on: [], accent: [0, 4, 8, 12] },
        }),
      }),
      node('drums', 'drums808', 100, 380, { masterVolume: 0.95, level_ch: 0.35, drive: 1 }),
      node('kbd', 'keyboard', 640, 380, { name: 'Bass', octave: 2 }),
      node('bass', 'fmsynth', 700, 700, { carrier: 'square', harmonicity: 1, modulationIndex: 4, attack: 0.005, decay: 0.18, sustain: 0.2, release: 0.2, volume: -8 }),
      node('filt', 'filter', 700, 1020, { frequency: 600, Q: 8 }),
      node('mix', 'mixer', 300, 820, { level1: 0.9, level2: 0.8 }),
      node('master', 'destination', 320, 1120, { volume: -9 }),
    ],
    [
      ...drumCables('seq', 'drums'),
      wire('drums', 'out', 'mix', 'in1'),
      wire('kbd', 'ev:note', 'bass', 'ev:note'),
      wire('bass', 'out', 'filt', 'in'),
      wire('filt', 'out', 'mix', 'in2'),
      wire('mix', 'out', 'master', 'in'),
    ],
  )

// ----------------------------------------------------------- 4. Polymeter

const clockwork = () =>
  patch(
    'Polymeter Clockwork',
    [
      // Lanes of 16, 7, 5 and 11 steps drift against each other for bars on end.
      node('seq', 'drumSeq', 40, 20, {
        bpm: 128,
        running: 1,
        patterns: bankFrom({
          bd: { on: [], accent: [0, 6], length: 16 },
          ch: { on: [0, 2, 4], length: 7 },
          cb: { on: [0, 3], length: 5 },
          oh: { on: [5], length: 11 },
          sd: { on: [], accent: [4, 12], length: 16 },
          acc: { on: [], accent: [0, 8], length: 16 },
        }),
      }),
      node('drums', 'drums808', 100, 380, { masterVolume: 0.9, level_cb: 0.4 }),
      // Each time the kick lane wraps, the grain cloud freezes or thaws.
      node('gran', 'granular', 640, 380, { density: 25, size: 0.2, pitch: 0.5, spread: 0.8, spray: 0.4, mix: 0.55 }),
      node('verb', 'reverb', 660, 760, { decay: 7, wet: 0.5 }),
      node('mix', 'mixer', 300, 820, { level1: 0.85, level2: 0.6 }),
      node('master', 'destination', 320, 1120, { volume: -9 }),
    ],
    [
      ...drumCables('seq', 'drums'),
      wire('seq', 'ev:loop', 'gran', 'ev:freeze'),
      wire('drums', 'out', 'mix', 'in1'),
      wire('gran', 'out', 'verb', 'in'),
      wire('verb', 'out', 'mix', 'in2'),
      wire('mix', 'out', 'master', 'in'),
    ],
  )

// ------------------------------------------------------------- 5. Modulation

const modLab = () =>
  patch(
    'Modulation Lab',
    [
      node('osc', 'oscillator', 40, 20, { type: 'sawtooth', frequency: 110, volume: -14 }),
      node('noise', 'noise', 40, 300, { type: 'pink', volume: -30 }),
      // Slow LFO on the cutoff: the classic sweep, depth set on the filter.
      node('lfo1', 'lfo', 420, 20, { frequency: 0.25, type: 'sine', min: -1, max: 1 }),
      node('filt', 'filter', 60, 600, { frequency: 500, Q: 9, rolloff: '-24', mod_detune: 3600 }),
      // A second LFO scrubs the grain cloud through its buffer.
      node('lfo2', 'lfo', 760, 20, { frequency: 0.08, type: 'triangle', min: -1, max: 1 }),
      node('gran', 'granular', 760, 300, { density: 18, size: 0.25, pitch: 1, spread: 0.7, spray: 0.1, mix: 0.5, mod_pos: 0.5 }),
      node('mix', 'mixer', 420, 900, { level1: 0.9, level2: 0.55 }),
      node('master', 'destination', 440, 1180, { volume: -10 }),
    ],
    [
      wire('osc', 'out', 'filt', 'in'),
      wire('noise', 'out', 'filt', 'in'),
      wire('lfo1', 'out', 'filt', 'param:detune'),
      wire('lfo2', 'out', 'gran', 'cv:pos'),
      wire('filt', 'out', 'mix', 'in1'),
      wire('gran', 'out', 'mix', 'in2'),
      wire('mix', 'out', 'master', 'in'),
    ],
  )

// ------------------------------------------------------------- 6. Arpeggiator

const arpEngine = () =>
  patch(
    'Arp Engine',
    [
      node('kbd', 'keyboard', 40, 20, { name: 'Hold a chord', octave: 3, hold: 1 }),
      // Clocked by the drum sequencer, so the arp locks to the beat.
      node('arp', 'arp', 40, 300, { mode: 'arp', arpMode: 'up-down', octaves: 2, rate: '1/16', gate: 0.45, running: 1 }),
      node('lead', 'fmsynth', 560, 300, { carrier: 'sawtooth', harmonicity: 2, modulationIndex: 7, attack: 0.005, decay: 0.25, sustain: 0.25, release: 0.3, volume: -6 }),
      node('filt', 'filter', 560, 660, { frequency: 1400, Q: 7, mod_detune: 2400 }),
      node('lfo', 'lfo', 860, 660, { frequency: 0.3, min: -1, max: 1 }),
      node('seq', 'drumSeq', 40, 980, {
        bpm: 124,
        running: 1,
        patterns: bankFrom({
          bd: { on: [], accent: [0, 8] },
          sd: { on: [], accent: [4, 12] },
          ch: { on: [2, 6, 10, 14] },
          acc: { on: [], accent: [0, 8] },
        }),
      }),
      node('drums', 'drums808', 100, 1340, { masterVolume: 0.85, level_ch: 0.3 }),
      node('mix', 'mixer', 640, 1060, { level1: 0.9, level2: 0.85 }),
      node('master', 'destination', 660, 1360, { volume: -7 }),
    ],
    [
      wire('kbd', 'ev:note', 'arp', 'ev:notes'),
      wire('seq', 'ev:clockOut', 'arp', 'ev:clock'),
      wire('arp', 'ev:note', 'lead', 'ev:note'),
      wire('lead', 'out', 'filt', 'in'),
      wire('lfo', 'out', 'filt', 'param:detune'),
      wire('filt', 'out', 'mix', 'in1'),
      ...drumCables('seq', 'drums'),
      wire('drums', 'out', 'mix', 'in2'),
      wire('mix', 'out', 'master', 'in'),
    ],
  )

export interface Preset {
  name: string
  blurb: string
  build: () => PatchFile
}

export const PRESETS: Preset[] = [
  { name: 'Tape Loop Drone', blurb: 'Play into a tape loop that feeds a delay and itself.', build: tapeLoop },
  { name: 'Granular Shimmer', blurb: 'A lead synth granulated an octave up into reverb.', build: shimmer },
  { name: '808 Jam', blurb: 'Sequenced 808 beat with a playable bass line.', build: jam },
  { name: 'Polymeter Clockwork', blurb: 'Drum lanes of 16, 11, 7 and 5 drifting apart.', build: clockwork },
  { name: 'Modulation Lab', blurb: 'Two LFOs: one sweeps a filter, one scrubs a grain cloud.', build: modLab },
  { name: 'Arp Engine', blurb: 'Hold a chord and the arp plays it, locked to the drum clock.', build: arpEngine },
]
