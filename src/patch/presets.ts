import { MAX_STEPS, TRACKS, defaultBank, serializeBank, type StepLevel, type TrackId } from '../audio/sequencer/pattern'
import { NOTE_STEPS, ROLL_ROWS, defaultSeqBank, emptySequence, serializeSeqBank } from '../audio/sequencer/noteSeq'
import type { PatchFile, SerializedEdge, SerializedNode } from './format'
import type { ParamValues } from '../audio/types'
import { expandSong, type SongFile } from './song'

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


/** Builds an arp sequence bank from readable [step, semitone, accent?] triples. */
function seqFrom(notes: Array<[number, number, boolean?]>, slot = 8): string {
  const bank = defaultSeqBank()
  const seq = emptySequence()
  for (const [step, pitch, accent] of notes) {
    if (step < NOTE_STEPS && pitch >= 0 && pitch < ROLL_ROWS) seq[step] = { pitch, accent: !!accent }
  }
  bank.sequences[slot] = seq
  bank.current = slot
  return serializeSeqBank(bank)
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


// ---------------------------------------------------------------- 7. Envelope + VCA

const envelopeVca = () =>
  patch(
    'Envelope VCA',
    [
      node('kbd', 'keyboard', 40, 40, { name: 'Play me', octave: 3 }),
      node('osc', 'oscillator', 40, 360, { type: 'sawtooth', frequency: 110, volume: -8 }),
      node('env', 'envelope', 380, 40, { attack: 0.01, decay: 0.25, sustain: 0.6, release: 0.8 }),
      node('vca', 'vca', 380, 360, { bias: 0, curve: 'linear' }),
      node('filt', 'filter', 380, 620, { frequency: 1800, Q: 4 }),
      node('master', 'destination', 380, 920, { volume: -8 }),
    ],
    [
      wire('kbd', 'ev:note', 'env', 'ev:trig'),
      wire('kbd', 'pitch', 'osc', 'param:frequency'),
      wire('osc', 'out', 'vca', 'in'),
      wire('env', 'out', 'vca', 'cv:gain'),
      wire('vca', 'out', 'filt', 'in'),
      wire('filt', 'out', 'master', 'in'),
    ],
  )

// ---------------------------------------------- 8–15. Public-domain song hooks
// Sixteen steps, pitches 0–12 above root. Traditional / public-domain works
// only — not sound-alikes of copyrighted popular songs.

const odeToJoy = () =>
  patch(
    'Ode to Joy',
    [
      node('arp', 'arp', 40, 40, {
        mode: 'sequence',
        rate: '1/4',
        gate: 0.9,
        bpm: 80,
        root: 60,
        running: 1,
        steps: seqFrom([
          [0, 4, true], [1, 4], [2, 5], [3, 7, true], [4, 7], [5, 5], [6, 4], [7, 2],
          [8, 0, true], [9, 0], [10, 2], [11, 4], [12, 4], [13, 2], [14, 2],
        ]),
      }),
      node('osc', 'oscillator', 40, 400, { type: 'triangle', frequency: 262, volume: -8 }),
      node('env', 'envelope', 420, 40, { attack: 0.02, decay: 0.15, sustain: 0.85, release: 0.35 }),
      node('vca', 'vca', 420, 400, { bias: 0, curve: 'linear' }),
      node('verb', 'reverb', 420, 680, { decay: 4.5, wet: 0.4 }),
      node('master', 'destination', 440, 980, { volume: -7 }),
    ],
    [
      wire('arp', 'ev:note', 'env', 'ev:trig'),
      wire('arp', 'pitch', 'osc', 'param:frequency'),
      wire('osc', 'out', 'vca', 'in'),
      wire('env', 'out', 'vca', 'cv:gain'),
      wire('vca', 'out', 'verb', 'in'),
      wire('verb', 'out', 'master', 'in'),
    ],
  )

const fuerElise = () =>
  patch(
    'Für Elise',
    [
      node('arp', 'arp', 40, 40, {
        mode: 'sequence',
        rate: '1/16',
        gate: 0.7,
        bpm: 72,
        root: 57,
        running: 1,
        steps: seqFrom([
          [0, 7, true], [1, 6], [2, 7], [3, 6], [4, 7], [5, 2], [6, 5], [7, 3], [8, 0, true],
          [11, 3], [12, 7], [13, 0], [14, 2],
        ]),
      }),
      node('lead', 'fmsynth', 560, 40, { carrier: 'sine', harmonicity: 1, modulationIndex: 1.5, attack: 0.005, decay: 0.45, sustain: 0.15, release: 0.5, volume: -6 }),
      node('delay', 'delay', 560, 420, { delayTime: 0.28, feedback: 0.25, wet: 0.22 }),
      node('verb', 'reverb', 560, 700, { decay: 3.2, wet: 0.35 }),
      node('master', 'destination', 580, 980, { volume: -8 }),
    ],
    [
      wire('arp', 'ev:note', 'lead', 'ev:note'),
      wire('lead', 'out', 'delay', 'in'),
      wire('delay', 'out', 'verb', 'in'),
      wire('verb', 'out', 'master', 'in'),
    ],
  )

const twinkle = () =>
  patch(
    'Twinkle Twinkle Little Star',
    [
      node('arp', 'arp', 40, 40, {
        mode: 'sequence',
        rate: '1/4',
        gate: 0.8,
        bpm: 100,
        root: 60,
        running: 1,
        steps: seqFrom([
          [0, 0, true], [1, 0], [2, 7], [3, 7], [4, 9], [5, 9], [6, 7, true],
          [8, 5], [9, 5], [10, 4], [11, 4], [12, 2], [13, 2], [14, 0, true],
        ]),
      }),
      node('lead', 'fmsynth', 560, 40, { carrier: 'triangle', harmonicity: 2, modulationIndex: 0.8, attack: 0.01, decay: 0.2, sustain: 0.35, release: 0.25, volume: -7 }),
      node('filt', 'filter', 560, 420, { frequency: 3200, Q: 2, type: 'lowpass' }),
      node('verb', 'reverb', 560, 720, { decay: 2.2, wet: 0.25 }),
      node('master', 'destination', 580, 1000, { volume: -8 }),
    ],
    [
      wire('arp', 'ev:note', 'lead', 'ev:note'),
      wire('lead', 'out', 'filt', 'in'),
      wire('filt', 'out', 'verb', 'in'),
      wire('verb', 'out', 'master', 'in'),
    ],
  )

const entertainer = () =>
  patch(
    'The Entertainer',
    [
      node('arp', 'arp', 40, 40, {
        mode: 'sequence',
        rate: '1/16',
        gate: 0.55,
        bpm: 92,
        swing: 0.54,
        root: 62,
        running: 1,
        steps: seqFrom([
          [0, 0], [1, 1], [2, 2, true], [3, 10], [5, 2], [6, 10], [8, 2], [9, 10],
          [11, 0], [12, 1], [13, 2, true], [14, 10],
        ]),
      }),
      node('lead', 'fmsynth', 560, 40, { carrier: 'sine', harmonicity: 2, modulationIndex: 3.5, attack: 0.002, decay: 0.28, sustain: 0.2, release: 0.18, volume: -6 }),
      node('filt', 'filter', 560, 420, { frequency: 2600, Q: 3 }),
      node('seq', 'drumSeq', 40, 400, {
        bpm: 92,
        swing: 0.54,
        running: 1,
        patterns: bankFrom({
          bd: { on: [], accent: [0, 8] },
          sd: { on: [], accent: [4, 12] },
          ch: { on: [2, 6, 10, 14] },
          acc: { on: [], accent: [0, 4, 8, 12] },
        }),
      }),
      node('drums', 'drums808', 100, 760, { masterVolume: 0.7, level_ch: 0.25, level_sd: 0.7 }),
      node('mix', 'mixer', 560, 760, { level1: 1, level2: 0.7 }),
      node('master', 'destination', 580, 1060, { volume: -8 }),
    ],
    [
      wire('seq', 'ev:clockOut', 'arp', 'ev:clock'),
      wire('arp', 'ev:note', 'lead', 'ev:note'),
      wire('lead', 'out', 'filt', 'in'),
      wire('filt', 'out', 'mix', 'in1'),
      ...drumCables('seq', 'drums'),
      wire('drums', 'out', 'mix', 'in2'),
      wire('mix', 'out', 'master', 'in'),
    ],
  )

const mountainKing = () =>
  patch(
    'In the Hall of the Mountain King',
    [
      node('arp', 'arp', 40, 40, {
        mode: 'sequence',
        rate: '1/8',
        gate: 0.35,
        bpm: 108,
        root: 47,
        running: 1,
        steps: seqFrom([
          [0, 0, true], [1, 2], [2, 3], [3, 5], [4, 7, true], [5, 3], [6, 7],
          [8, 6], [9, 2], [10, 6], [11, 5], [12, 1], [13, 5],
        ]),
      }),
      node('lead', 'fmsynth', 560, 40, { carrier: 'square', harmonicity: 1, modulationIndex: 2.5, attack: 0.005, decay: 0.12, sustain: 0.15, release: 0.12, volume: -5 }),
      node('filt', 'filter', 560, 420, { frequency: 700, Q: 7, type: 'lowpass', rolloff: '-24' }),
      node('seq', 'drumSeq', 40, 400, {
        bpm: 108,
        running: 1,
        patterns: bankFrom({
          bd: { on: [], accent: [0, 8] },
          cb: { on: [4, 12] },
          acc: { on: [], accent: [0, 8] },
        }),
      }),
      node('drums', 'drums808', 100, 760, { masterVolume: 0.65, level_cb: 0.35, level_bd: 0.85 }),
      node('mix', 'mixer', 560, 760, { level1: 1, level2: 0.55 }),
      node('master', 'destination', 580, 1060, { volume: -8 }),
    ],
    [
      wire('seq', 'ev:clockOut', 'arp', 'ev:clock'),
      wire('arp', 'ev:note', 'lead', 'ev:note'),
      wire('lead', 'out', 'filt', 'in'),
      wire('filt', 'out', 'mix', 'in1'),
      ...drumCables('seq', 'drums'),
      wire('drums', 'out', 'mix', 'in2'),
      wire('mix', 'out', 'master', 'in'),
    ],
  )

const saints = () =>
  patch(
    'When the Saints Go Marching In',
    [
      node('arp', 'arp', 40, 40, {
        mode: 'sequence',
        rate: '1/8',
        gate: 0.65,
        bpm: 116,
        swing: 0.56,
        root: 55,
        running: 1,
        steps: seqFrom([
          [0, 0, true], [1, 4], [2, 5], [3, 7, true], [5, 0], [6, 4], [7, 5], [8, 7, true],
          [10, 0], [11, 4], [12, 5], [13, 7], [14, 4], [15, 0],
        ]),
      }),
      node('lead', 'fmsynth', 560, 40, { carrier: 'sawtooth', harmonicity: 2, modulationIndex: 6, attack: 0.01, decay: 0.22, sustain: 0.4, release: 0.28, volume: -6 }),
      node('filt', 'filter', 560, 420, { frequency: 1800, Q: 4 }),
      node('seq', 'drumSeq', 40, 400, {
        bpm: 116,
        swing: 0.56,
        running: 1,
        patterns: bankFrom({
          bd: { on: [3, 10], accent: [0, 8] },
          sd: { on: [], accent: [4, 12] },
          ch: { on: [0, 2, 4, 6, 8, 10, 12, 14] },
          oh: { on: [6, 14] },
          cp: { on: [12] },
          acc: { on: [], accent: [0, 4, 8, 12] },
        }),
      }),
      node('drums', 'drums808', 100, 760, { masterVolume: 0.75, level_ch: 0.28, level_oh: 0.4, level_cp: 0.55 }),
      node('mix', 'mixer', 560, 760, { level1: 0.95, level2: 0.8 }),
      node('master', 'destination', 580, 1060, { volume: -8 }),
    ],
    [
      wire('seq', 'ev:clockOut', 'arp', 'ev:clock'),
      wire('arp', 'ev:note', 'lead', 'ev:note'),
      wire('lead', 'out', 'filt', 'in'),
      wire('filt', 'out', 'mix', 'in1'),
      ...drumCables('seq', 'drums'),
      wire('drums', 'out', 'mix', 'in2'),
      wire('mix', 'out', 'master', 'in'),
    ],
  )

const nachtmusik = () =>
  patch(
    'Eine kleine Nachtmusik',
    [
      node('arp', 'arp', 40, 40, {
        mode: 'sequence',
        rate: '1/16',
        gate: 0.85,
        bpm: 126,
        root: 50,
        running: 1,
        steps: seqFrom([
          [0, 5, true], [4, 0, true], [8, 5], [9, 0], [10, 5], [11, 9], [12, 12, true],
        ]),
      }),
      node('lead', 'fmsynth', 560, 40, { carrier: 'sawtooth', harmonicity: 1, modulationIndex: 1.2, attack: 0.008, decay: 0.18, sustain: 0.55, release: 0.2, volume: -7 }),
      node('filt', 'filter', 560, 420, { frequency: 2200, Q: 2.5 }),
      node('verb', 'reverb', 560, 720, { decay: 2.8, wet: 0.32 }),
      node('master', 'destination', 580, 1000, { volume: -8 }),
    ],
    [
      wire('arp', 'ev:note', 'lead', 'ev:note'),
      wire('lead', 'out', 'filt', 'in'),
      wire('filt', 'out', 'verb', 'in'),
      wire('verb', 'out', 'master', 'in'),
    ],
  )

const jingleBells = () =>
  patch(
    'Jingle Bells',
    [
      node('arp', 'arp', 40, 40, {
        mode: 'sequence',
        rate: '1/8',
        gate: 0.55,
        bpm: 120,
        root: 60,
        running: 1,
        steps: seqFrom([
          [0, 4, true], [1, 4], [2, 4], [4, 4, true], [5, 4], [6, 4],
          [8, 4], [9, 7], [10, 0, true], [11, 2], [12, 4, true],
        ]),
      }),
      node('lead', 'fmsynth', 560, 40, { carrier: 'sine', harmonicity: 3, modulationIndex: 8, attack: 0.001, decay: 0.35, sustain: 0.1, release: 0.4, volume: -7 }),
      node('delay', 'delay', 560, 420, { delayTime: 0.25, feedback: 0.2, wet: 0.18 }),
      node('seq', 'drumSeq', 40, 400, {
        bpm: 120,
        running: 1,
        patterns: bankFrom({
          bd: { on: [], accent: [0, 8] },
          cb: { on: [0, 2, 4, 6, 8, 10, 12, 14] },
          ch: { on: [4, 12] },
          acc: { on: [], accent: [0, 8] },
        }),
      }),
      node('drums', 'drums808', 100, 760, { masterVolume: 0.6, level_cb: 0.45, level_ch: 0.2, level_bd: 0.55 }),
      node('mix', 'mixer', 560, 760, { level1: 1, level2: 0.55 }),
      node('verb', 'reverb', 860, 760, { decay: 2.5, wet: 0.3 }),
      node('master', 'destination', 880, 1060, { volume: -8 }),
    ],
    [
      wire('seq', 'ev:clockOut', 'arp', 'ev:clock'),
      wire('arp', 'ev:note', 'lead', 'ev:note'),
      wire('lead', 'out', 'delay', 'in'),
      wire('delay', 'out', 'mix', 'in1'),
      ...drumCables('seq', 'drums'),
      wire('drums', 'out', 'mix', 'in2'),
      wire('mix', 'out', 'verb', 'in'),
      wire('verb', 'out', 'master', 'in'),
    ],
  )

export interface Preset {
  name: string
  blurb: string
  build: () => PatchFile
}


const rowYourBoatSong: SongFile = {
  format: 'patcher-song',
  version: 1,
  name: 'Row, Row, Row Your Boat',
  bpm: 108,
  key: 'C',
  root: 'C4',
  lyrics:
    'Row, row, row your boat gently down the stream. Merrily, merrily, merrily, merrily, life is but a dream.',
  voice: { body: 'female', vowel: 'ah', breath: 0.72 },
  bars: [
    { notes: 'C4 . C4 . C4 . D4 . E4 . . . E4 . D4 . E4 .', lyrics: 'Row row row your boat gent-ly down the' },
    { notes: 'F4 . . . G4 . . . . . . . . . . .', lyrics: 'stream' },
    { notes: 'C5 C5 C5 G4 G4 G4 E4 E4 E4 C4 C4 C4 . . . .', lyrics: 'Mer-ri-ly mer-ri-ly mer-ri-ly mer-ri-ly' },
    { notes: 'G4 . F4 . E4 . D4 . C4 . . . . . . .', lyrics: 'life is but a dream' },
  ],
  arrangement: [0, 1, 2, 3],
  loopBars: 64,
  drums: {
    presets: ['Four on the floor', 'House', 'Clave', 'Half time'],
    order: [0, 1, 2, 3],
    bars: 64,
  },
  instruments: {
    keys: { name: 'Sing along', octave: 4 },
    pad: { wave: 'triangle', cutoff: 700 },
    fx: ['reverb'],
  },
}

const rowYourBoat = () => expandSong(rowYourBoatSong).patch

const yankeeDoodleSong: SongFile = {
  format: 'patcher-song',
  version: 1,
  name: 'Yankee Doodle',
  bpm: 116,
  key: 'G',
  root: 'D4',
  lyrics:
    'Yankee Doodle went to town a-riding on a pony, stuck a feather in his cap and called it macaroni. Yankee Doodle keep it up, Yankee Doodle dandy, mind the music and the step and with the girls be handy.',
  voice: { body: 'male', vowel: 'ah', breath: 0.7 },
  bars: [
    { notes: 'G4 . G4 . A4 . B4 . G4 . B4 . A4 . D5 .', lyrics: 'Yan-kee Doo-dle went to town' },
    { notes: 'G4 . G4 . A4 . B4 . G4 . F#4 . E4 . D4 .', lyrics: 'A-rid-ing on a po-ny' },
    { notes: 'G4 . G4 . A4 . B4 . C5 . B4 . A4 . G4 .', lyrics: 'Stuck a feath-er in his cap' },
    { notes: 'F#4 . D4 . E4 . F#4 . G4 . G4 . G4 . . .', lyrics: 'And called it mac-a-ro-ni' },
    { notes: 'E4 . F#4 . E4 . D4 . E4 . F#4 . G4 . . .', lyrics: 'Yan-kee Doo-dle keep it up' },
    { notes: 'D4 . E4 . D4 . C5 . B4 . D5 . . . . .', lyrics: 'Yan-kee Doo-dle dan-dy' },
    { notes: 'E4 . F#4 . E4 . D4 . E4 . F#4 . G4 . E4 .', lyrics: 'Mind the mu-sic and the step' },
    { notes: 'D4 . G4 . F#4 . A4 . G4 . G4 . . . . .', lyrics: 'And with the girls be han-dy' },
  ],
  arrangement: [0, 1, 2, 3, 4, 5, 6, 7],
  loopBars: 64,
  drums: {
    presets: [
      'Four on the floor',
      'House',
      'Four on the floor',
      'Clave',
      'Electro',
      'Boom bap',
      'Electro',
      'Breakbeat',
    ],
    order: [0, 1, 2, 3, 4, 5, 6, 7],
    bars: 64,
  },
  instruments: {
    keys: { name: 'Sing along', octave: 4 },
    pad: { wave: 'triangle', cutoff: 800 },
    fx: ['reverb'],
  },
}

const yankeeDoodle = () => expandSong(yankeeDoodleSong).patch


export const PRESETS: Preset[] = [
  { name: 'Tape Loop Drone', blurb: 'Play into a tape loop that feeds a delay and itself.', build: tapeLoop },
  { name: 'Granular Shimmer', blurb: 'A lead synth granulated an octave up into reverb.', build: shimmer },
  { name: '808 Jam', blurb: 'Sequenced 808 beat with a playable bass line.', build: jam },
  { name: 'Polymeter Clockwork', blurb: 'Drum lanes of 16, 11, 7 and 5 drifting apart.', build: clockwork },
  { name: 'Modulation Lab', blurb: 'Two LFOs: one sweeps a filter, one scrubs a grain cloud.', build: modLab },
  { name: 'Arp Engine', blurb: 'Hold a chord and the arp plays it, locked to the drum clock.', build: arpEngine },
  { name: 'Envelope VCA', blurb: 'A classic modular voice: keyboard, oscillator, envelope and VCA.', build: envelopeVca },
  { name: 'Ode to Joy', blurb: "Beethoven's hymn theme from the Ninth Symphony.", build: odeToJoy },
  { name: 'Für Elise', blurb: "Beethoven's famous E–D♯–E opening.", build: fuerElise },
  { name: 'Twinkle Twinkle Little Star', blurb: 'The traditional English nursery song.', build: twinkle },
  { name: 'The Entertainer', blurb: "Scott Joplin's 1902 ragtime hook (public domain).", build: entertainer },
  { name: 'In the Hall of the Mountain King', blurb: "Grieg's creeping theme from Peer Gynt.", build: mountainKing },
  { name: 'When the Saints Go Marching In', blurb: 'The traditional New Orleans spiritual.', build: saints },
  { name: 'Eine kleine Nachtmusik', blurb: "Mozart's opening fanfare from the 1787 serenade.", build: nachtmusik },
  { name: 'Jingle Bells', blurb: "James Pierpont's 1857 holiday song (public domain).", build: jingleBells },
  { name: 'Row, Row, Row Your Boat', blurb: 'A sung public-domain hook, built from song JSON.', build: rowYourBoat },
  {
    name: 'Yankee Doodle',
    blurb: 'The traditional public-domain march, including the “Yankee Doodle dandy” chorus, as a 64-bar sung loop.',
    build: yankeeDoodle,
  },
]
