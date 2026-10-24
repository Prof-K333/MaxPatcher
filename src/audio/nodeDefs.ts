import type { NodeDef, ParamSpec, ParamValues } from './types'

const audioIn = { id: 'in', label: 'in', kind: 'audio' as const }
const audioOut = { id: 'out', label: 'out', kind: 'audio' as const }

const WAVEFORMS = ['sine', 'triangle', 'sawtooth', 'square']

// Null-prototype so a lookup by untrusted name cannot reach Object.prototype.
export const NODE_DEFS: Record<string, NodeDef> = Object.assign(Object.create(null), {
  oscillator: {
    type: 'oscillator',
    icon: '〰️',
    description: 'Raw tone generator — the basic sound source.',
    label: 'Oscillator',
    category: 'source',
    accent: '#f59e0b',
    inputs: [
      { id: 'param:frequency', label: 'freq', kind: 'param' },
      { id: 'param:detune', label: 'detune', kind: 'param' },
    ],
    outputs: [audioOut],
    params: [
      { key: 'type', label: 'Wave', control: 'select', options: WAVEFORMS, default: 'sawtooth' },
      { key: 'frequency', label: 'Freq', control: 'slider', min: 20, max: 4000, step: 1, unit: 'Hz', curve: 'log', default: 220 },
      { key: 'detune', label: 'Detune', control: 'slider', min: -1200, max: 1200, step: 1, unit: 'c', default: 0 },
      { key: 'volume', label: 'Level', control: 'slider', min: -60, max: 0, step: 1, unit: 'dB', default: -12 },
    ],
  },

  noise: {
    type: 'noise',
    icon: '🌫️',
    description: 'White, pink or brown noise for percussion and texture.',
    label: 'Noise',
    category: 'source',
    accent: '#f59e0b',
    inputs: [],
    outputs: [audioOut],
    params: [
      { key: 'type', label: 'Color', control: 'select', options: ['white', 'pink', 'brown'], default: 'pink' },
      { key: 'volume', label: 'Level', control: 'slider', min: -60, max: 0, step: 1, unit: 'dB', default: -18 },
    ],
  },

  gain: {
    type: 'gain',
    icon: '🔊',
    description: 'Turns a signal up or down.',
    label: 'Gain',
    category: 'effect',
    accent: '#38bdf8',
    inputs: [audioIn, { id: 'param:gain', label: 'gain', kind: 'param' }],
    outputs: [audioOut],
    params: [{ key: 'gain', label: 'Gain', control: 'slider', min: 0, max: 2, step: 0.01, default: 0.8 }],
  },

  filter: {
    type: 'filter',
    icon: '🔻',
    description: 'Removes frequencies. Sweep the cutoff for the classic swoosh.',
    label: 'Filter',
    category: 'effect',
    accent: '#38bdf8',
    inputs: [
      audioIn,
      // Cutoff modulation lands on detune, not frequency: detune is in cents,
      // so a sweep moves in octaves and sounds even across the whole range.
      // Linear Hz modulation is lopsided — huge at the bottom, inaudible at
      // the top — and never gives you the classic swoop.
      { id: 'param:detune', label: 'cutoff', kind: 'param' },
      { id: 'param:Q', label: 'Q', kind: 'param' },
    ],
    outputs: [audioOut],
    params: [
      { key: 'type', label: 'Mode', control: 'select', options: ['lowpass', 'highpass', 'bandpass', 'notch'], default: 'lowpass' },
      { key: 'frequency', label: 'Cutoff', control: 'slider', min: 20, max: 20000, step: 1, unit: 'Hz', curve: 'log', default: 900 },
      { key: 'Q', label: 'Reso', control: 'slider', min: 0, max: 24, step: 0.1, default: 6 },
      { key: 'rolloff', label: 'Slope', control: 'select', options: ['-12', '-24', '-48'], default: '-24' },
      { key: 'detune', label: 'Fine', control: 'slider', min: -2400, max: 2400, step: 10, unit: 'c', default: 0 },
      // Explicit, so the generator leaves it alone: ±3 octaves of sweep with
      // two octaves as the default throw.
      { key: 'mod_detune', label: 'cutoff depth', control: 'slider', min: -4800, max: 4800, step: 10, unit: 'c', default: 2400, hidden: true },
    ],
  },

  delay: {
    type: 'delay',
    icon: '⏱️',
    description: 'Repeating echoes with feedback.',
    label: 'Delay',
    category: 'effect',
    accent: '#38bdf8',
    inputs: [audioIn],
    outputs: [audioOut],
    params: [
      { key: 'delayTime', label: 'Time', control: 'slider', min: 0.01, max: 1, step: 0.01, unit: 's', default: 0.25 },
      { key: 'feedback', label: 'Fdbk', control: 'slider', min: 0, max: 0.95, step: 0.01, default: 0.35 },
      { key: 'wet', label: 'Mix', control: 'slider', min: 0, max: 1, step: 0.01, default: 0.4 },
    ],
  },

  reverb: {
    type: 'reverb',
    icon: '🏛️',
    description: 'Puts the sound in a room.',
    label: 'Reverb',
    category: 'effect',
    accent: '#38bdf8',
    inputs: [audioIn],
    outputs: [audioOut],
    params: [
      { curve: 'log', key: 'decay', label: 'Decay', control: 'slider', min: 0.1, max: 10, step: 0.1, unit: 's', default: 2.5 },
      { key: 'wet', label: 'Mix', control: 'slider', min: 0, max: 1, step: 0.01, default: 0.35 },
    ],
  },

  lfo: {
    type: 'lfo',
    icon: '🔄',
    description: 'Slow wave for modulating other knobs. Patch it to a mod inlet.',
    label: 'LFO',
    category: 'modulator',
    accent: '#a78bfa',
    inputs: [],
    outputs: [{ id: 'out', label: 'mod', kind: 'audio' }],
    params: [
      { key: 'type', label: 'Wave', control: 'select', options: WAVEFORMS, default: 'sine' },
      // Exponential across the whole span: at 1000 slider positions over
      // ~20 octaves each step is about 1.3%, so slow rates are as controllable
      // as fast ones. Reaching audio rate lets the same node do FM.
      { key: 'frequency', label: 'Rate', control: 'slider', min: 0.02, max: 20000, step: 0.01, unit: 'Hz', curve: 'log', default: 2 },
      { key: 'min', label: 'Min', control: 'slider', min: -1, max: 1, step: 0.01, default: -1 },
      { key: 'max', label: 'Max', control: 'slider', min: -1, max: 1, step: 0.01, default: 1 },
    ],
  },

  fmsynth: {
    type: 'fmsynth',
    icon: '🎛️',
    description: 'Polyphonic FM voice. Feed it notes from a keyboard.',
    label: 'FM Synth',
    category: 'voice',
    accent: '#fb7185',
    width: 210,
    inputs: [
      { id: 'ev:note', label: 'note', kind: 'event' },
      { id: 'cv:fmDepth', label: 'fm depth', kind: 'cv' },
    ],
    outputs: [audioOut],
    params: [
      { key: 'harmonicity', label: 'Ratio', control: 'slider', min: 0.25, max: 12, step: 0.25, default: 2 },
      { key: 'modulationIndex', label: 'FM Index', control: 'slider', min: 0, max: 40, step: 0.5, default: 10 },
      { key: 'carrier', label: 'Carrier', control: 'select', options: WAVEFORMS, default: 'sawtooth' },
      { key: 'modulator', label: 'Mod', control: 'select', options: WAVEFORMS, default: 'sine' },
      { curve: 'log', key: 'attack', label: 'A', control: 'slider', min: 0.001, max: 2, step: 0.001, unit: 's', default: 0.01 },
      { curve: 'log', key: 'decay', label: 'D', control: 'slider', min: 0.01, max: 3, step: 0.01, unit: 's', default: 0.2 },
      { key: 'sustain', label: 'S', control: 'slider', min: 0, max: 1, step: 0.01, default: 0.6 },
      { curve: 'log', key: 'release', label: 'R', control: 'slider', min: 0.01, max: 5, step: 0.01, unit: 's', default: 0.8 },
      { curve: 'log', key: 'mAttack', label: 'FM A', control: 'slider', min: 0.001, max: 2, step: 0.001, unit: 's', default: 0.01 },
      { curve: 'log', key: 'mDecay', label: 'FM D', control: 'slider', min: 0.01, max: 3, step: 0.01, unit: 's', default: 0.3 },
      { key: 'mSustain', label: 'FM S', control: 'slider', min: 0, max: 1, step: 0.01, default: 0.3 },
      { curve: 'log', key: 'mRelease', label: 'FM R', control: 'slider', min: 0.01, max: 5, step: 0.01, unit: 's', default: 0.6 },
      { key: 'volume', label: 'Level', control: 'slider', min: -40, max: 0, step: 1, unit: 'dB', default: -10 },
    ],
  },

  keyboard: {
    type: 'keyboard',
    icon: '🎹',
    description: 'Playable keys. Sends notes, pitch, gate and velocity.',
    label: 'Keyboard',
    category: 'control',
    accent: '#facc15',
    width: 320,
    ui: 'keyboard',
    inputs: [],
    outputs: [
      { id: 'ev:note', label: 'note', kind: 'event' },
      { id: 'pitch', label: 'pitch', kind: 'cv' },
      { id: 'gate', label: 'gate', kind: 'cv' },
      { id: 'velocity', label: 'vel', kind: 'cv' },
    ],
    params: [
      { key: 'name', label: 'Name', control: 'text', placeholder: 'Name this keyboard', maxLength: 20, default: '' },
      { key: 'octave', label: 'Octave', control: 'slider', min: 1, max: 7, step: 1, default: 4 },
      { key: 'velocity', label: 'Velocity', control: 'slider', min: 0.1, max: 1, step: 0.05, default: 0.8 },
      { key: 'focus', label: 'QWERTY focus', control: 'toggle', default: 1 },
      { key: 'hold', label: 'Hold (latch)', control: 'toggle', default: 0 },
    ],
  },

  sampler: {
    type: 'sampler',
    icon: '💿',
    description: 'Drop an audio file in and trigger it.',
    label: 'Sampler',
    category: 'source',
    accent: '#2dd4bf',
    width: 240,
    ui: 'sampler',
    inputs: [
      { id: 'ev:trig', label: 'gate', kind: 'event' },
      { id: 'param:playbackRate', label: 'rate', kind: 'param' },
    ],
    outputs: [audioOut],
    params: [
      { key: 'playbackRate', label: 'Pitch', control: 'slider', min: 0.25, max: 4, step: 0.01, curve: 'log', default: 1 },
      { key: 'start', label: 'Trim In', control: 'slider', min: 0, max: 0.99, step: 0.01, default: 0 },
      { key: 'end', label: 'Trim Out', control: 'slider', min: 0.01, max: 1, step: 0.01, default: 1 },
      { key: 'loop', label: 'Loop', control: 'toggle', default: 0 },
      { key: 'reverse', label: 'Reverse', control: 'toggle', default: 0 },
      { key: 'volume', label: 'Level', control: 'slider', min: 0, max: 1.5, step: 0.01, default: 1 },
    ],
  },

  looper: {
    type: 'looper',
    icon: '🔁',
    description: 'Records note phrases and loops them in time.',
    label: 'Phrase Looper',
    category: 'control',
    accent: '#c084fc',
    width: 210,
    ui: 'looper',
    inputs: [{ id: 'ev:in', label: 'note in', kind: 'event' }],
    outputs: [{ id: 'ev:out', label: 'note out', kind: 'event' }],
    params: [
      { key: 'bars', label: 'Bars', control: 'slider', min: 1, max: 8, step: 1, default: 2 },
      { key: 'quantize', label: 'Quantize', control: 'select', options: ['off', '1/4', '1/8', '1/16'], default: '1/16' },
      { key: 'record', label: 'Record', control: 'toggle', default: 0, hidden: true },
      { key: 'overdub', label: 'Overdub', control: 'toggle', default: 0, hidden: true },
    ],
  },

  granular: {
    type: 'granular',
    icon: '✨',
    description: 'Shatters audio into grain clouds. Works on files or live input.',
    label: 'Granular Cloud',
    category: 'source',
    accent: '#22d3ee',
    width: 340,
    ui: 'granular',
    inputs: [
      { id: 'in', label: 'audio', kind: 'audio' },
      { id: 'cv:pos', label: 'pos', kind: 'cv' },
      { id: 'cv:pitch', label: 'pitch', kind: 'cv' },
      { id: 'cv:density', label: 'dens', kind: 'cv' },
      { id: 'cv:size', label: 'size', kind: 'cv' },
      { id: 'ev:freeze', label: 'freeze', kind: 'event' },
      { id: 'ev:trig', label: 'trig', kind: 'event' },
    ],
    outputs: [
      audioOut,
      { id: 'outL', label: 'L', kind: 'audio' },
      { id: 'outR', label: 'R', kind: 'audio' },
      { id: 'ev:grain', label: 'bang', kind: 'event' },
    ],
    params: [
      { key: 'source', label: 'Source', control: 'select', options: ['file', 'live'], default: 'file' },
      { key: 'mode', label: 'Mode', control: 'select', options: ['cloud', 'slice'], default: 'cloud' },
      { key: 'position', label: 'Position', control: 'slider', min: 0, max: 1, step: 0.001, default: 0.25, hidden: true },
      { key: 'spray', label: 'Spray', control: 'slider', min: 0, max: 2, step: 0.01, unit: 's', default: 0.05 },
      { key: 'size', label: 'Size', control: 'slider', min: 0.01, max: 0.5, step: 0.005, unit: 's', default: 0.12 },
      { key: 'density', label: 'Density', control: 'slider', min: 1, max: 80, step: 1, unit: '/s', default: 20 },
      { key: 'pitch', label: 'Pitch', control: 'slider', min: 0.125, max: 4, step: 0.001, curve: 'log', default: 1 },
      { key: 'pitchJitter', label: 'Detune', control: 'slider', min: 0, max: 600, step: 1, unit: 'c', default: 0 },
      { key: 'spread', label: 'Spread', control: 'slider', min: 0, max: 1, step: 0.01, default: 0.6 },
      { key: 'window', label: 'Window', control: 'select', options: ['hanning', 'triangle', 'cosine', 'rectangular'], default: 'hanning' },
      { key: 'direction', label: 'Dir', control: 'select', options: ['forward', 'reverse', 'random'], default: 'forward' },
      { key: 'crossfade', label: 'Xfade', control: 'slider', min: 1, max: 200, step: 1, unit: 'ms', default: 10 },
      { key: 'reverse', label: 'Reverse', control: 'toggle', default: 0 },
      { key: 'freeze', label: 'Freeze', control: 'toggle', default: 0, hidden: true },
      { key: 'mix', label: 'Mix', control: 'slider', min: 0, max: 1.5, step: 0.01, default: 0.8 },
    ],
  },

  drums808: {
    type: 'drums808',
    icon: '🥁',
    description: 'Six procedural 808 drum voices with individual outputs.',
    label: 'TR-808 Drums',
    category: 'voice',
    accent: '#f97316',
    width: 430,
    ui: 'drums808',
    ports: 'horizontal',
    inputs: [
      { id: 'ev:bd', label: 'BD', kind: 'event' },
      { id: 'ev:sd', label: 'SD', kind: 'event' },
      { id: 'ev:cp', label: 'CP', kind: 'event' },
      { id: 'ev:ch', label: 'CH', kind: 'event' },
      { id: 'ev:oh', label: 'OH', kind: 'event' },
      { id: 'ev:cb', label: 'CB', kind: 'event' },
      { id: 'cv:accent', label: 'accent', kind: 'cv' },
    ],
    outputs: [
      { id: 'out', label: 'mix', kind: 'audio' },
      { id: 'outL', label: 'L', kind: 'audio' },
      { id: 'outR', label: 'R', kind: 'audio' },
      { id: 'bdOut', label: 'BD', kind: 'audio' },
      { id: 'sdOut', label: 'SD', kind: 'audio' },
      { id: 'sdNoiseOut', label: 'SD nz', kind: 'audio' },
      { id: 'cpOut', label: 'CP', kind: 'audio' },
      { id: 'hhOut', label: 'HH', kind: 'audio' },
      { id: 'cbOut', label: 'CB', kind: 'audio' },
    ],
    params: [
      { key: 'bdTone', label: 'Tone', control: 'slider', min: 120, max: 220, step: 1, unit: 'Hz', default: 160, hidden: true },
      { key: 'bdSub', label: 'Sub', control: 'slider', min: 35, max: 55, step: 1, unit: 'Hz', default: 45, hidden: true },
      { key: 'bdSweep', label: 'Sweep', control: 'slider', min: 0.025, max: 0.045, step: 0.001, unit: 's', default: 0.035, hidden: true },
      { key: 'bdDecay', label: 'Decay', control: 'slider', min: 0.2, max: 3.5, step: 0.01, unit: 's', default: 0.9, hidden: true },
      { key: 'bdDrive', label: 'Drive', control: 'slider', min: 0, max: 1, step: 0.01, default: 0.3, hidden: true },
      { key: 'sdTune', label: 'Tune', control: 'slider', min: 120, max: 320, step: 1, unit: 'Hz', default: 180, hidden: true },
      { key: 'sdSnappy', label: 'Snappy', control: 'slider', min: 0, max: 1, step: 0.01, default: 0.5, hidden: true },
      { key: 'sdDecay', label: 'Decay', control: 'slider', min: 0.05, max: 1.2, step: 0.01, unit: 's', default: 0.25, hidden: true },
      { key: 'cpDecay', label: 'Decay', control: 'slider', min: 0.08, max: 1.2, step: 0.01, unit: 's', default: 0.35, hidden: true },
      { key: 'cpSpread', label: 'Spread', control: 'slider', min: 0, max: 1, step: 0.01, default: 0.4, hidden: true },
      { key: 'hhTune', label: 'Tune', control: 'slider', min: 0.5, max: 2, step: 0.01, default: 1, hidden: true },
      { key: 'chDecay', label: 'Decay', control: 'slider', min: 0.04, max: 0.12, step: 0.001, unit: 's', default: 0.07, hidden: true },
      { key: 'ohDecay', label: 'Decay', control: 'slider', min: 0.2, max: 1.2, step: 0.01, unit: 's', default: 0.55, hidden: true },
      { key: 'cbDecay', label: 'Decay', control: 'slider', min: 0.15, max: 0.6, step: 0.01, unit: 's', default: 0.35, hidden: true },
      { key: 'level_bd', label: 'BD Lvl', control: 'slider', min: 0, max: 1.5, step: 0.01, default: 0.9, hidden: true },
      { key: 'pan_bd', label: 'BD Pan', control: 'slider', min: -1, max: 1, step: 0.05, default: 0, hidden: true },
      { key: 'level_sd', label: 'SD Lvl', control: 'slider', min: 0, max: 1.5, step: 0.01, default: 0.7, hidden: true },
      { key: 'pan_sd', label: 'SD Pan', control: 'slider', min: -1, max: 1, step: 0.05, default: 0, hidden: true },
      { key: 'level_cp', label: 'CP Lvl', control: 'slider', min: 0, max: 1.5, step: 0.01, default: 0.6, hidden: true },
      { key: 'pan_cp', label: 'CP Pan', control: 'slider', min: -1, max: 1, step: 0.05, default: -0.2, hidden: true },
      { key: 'level_ch', label: 'CH Lvl', control: 'slider', min: 0, max: 1.5, step: 0.01, default: 0.45, hidden: true },
      { key: 'pan_ch', label: 'CH Pan', control: 'slider', min: -1, max: 1, step: 0.05, default: 0.25, hidden: true },
      { key: 'level_oh', label: 'OH Lvl', control: 'slider', min: 0, max: 1.5, step: 0.01, default: 0.45, hidden: true },
      { key: 'pan_oh', label: 'OH Pan', control: 'slider', min: -1, max: 1, step: 0.05, default: 0.25, hidden: true },
      { key: 'level_cb', label: 'CB Lvl', control: 'slider', min: 0, max: 1.5, step: 0.01, default: 0.5, hidden: true },
      { key: 'pan_cb', label: 'CB Pan', control: 'slider', min: -1, max: 1, step: 0.05, default: -0.35, hidden: true },
      { key: 'accent', label: 'Accent', control: 'slider', min: 0, max: 1, step: 0.01, default: 0.8, hidden: true },
      { key: 'drive', label: 'Saturation', control: 'toggle', default: 1, hidden: true },
      { key: 'masterVolume', label: 'Master', control: 'slider', min: 0, max: 1.5, step: 0.01, default: 0.9, hidden: true },
    ],
  },

  mixer: {
    type: 'mixer',
    icon: '🎚️',
    description: 'Balances four sources with level, pan and mute.',
    label: 'Mixer',
    category: 'effect',
    accent: '#60a5fa',
    width: 212,
    ui: 'mixer',
    inputs: [
      { id: 'in1', label: '1', kind: 'audio' },
      { id: 'in2', label: '2', kind: 'audio' },
      { id: 'in3', label: '3', kind: 'audio' },
      { id: 'in4', label: '4', kind: 'audio' },
    ],
    outputs: [audioOut],
    params: [
      { key: 'level1', label: 'Ch 1', control: 'slider', min: 0, max: 1.5, step: 0.01, default: 0.8, hidden: true },
      { key: 'pan1', label: 'Pan 1', control: 'slider', min: -1, max: 1, step: 0.05, default: 0, hidden: true },
      { key: 'mute1', label: 'Mute 1', control: 'toggle', default: 0, hidden: true },
      { key: 'level2', label: 'Ch 2', control: 'slider', min: 0, max: 1.5, step: 0.01, default: 0.8, hidden: true },
      { key: 'pan2', label: 'Pan 2', control: 'slider', min: -1, max: 1, step: 0.05, default: 0, hidden: true },
      { key: 'mute2', label: 'Mute 2', control: 'toggle', default: 0, hidden: true },
      { key: 'level3', label: 'Ch 3', control: 'slider', min: 0, max: 1.5, step: 0.01, default: 0.8, hidden: true },
      { key: 'pan3', label: 'Pan 3', control: 'slider', min: -1, max: 1, step: 0.05, default: 0, hidden: true },
      { key: 'mute3', label: 'Mute 3', control: 'toggle', default: 0, hidden: true },
      { key: 'level4', label: 'Ch 4', control: 'slider', min: 0, max: 1.5, step: 0.01, default: 0.8, hidden: true },
      { key: 'pan4', label: 'Pan 4', control: 'slider', min: -1, max: 1, step: 0.05, default: 0, hidden: true },
      { key: 'mute4', label: 'Mute 4', control: 'toggle', default: 0, hidden: true },
      { key: 'master', label: 'Master', control: 'slider', min: 0, max: 1.5, step: 0.01, default: 0.9, hidden: true },
    ],
  },

  liveLooper: {
    type: 'liveLooper',
    icon: '📼',
    description: 'Records live audio and layers it, tape style.',
    label: 'Tape Looper',
    category: 'effect',
    accent: '#f472b6',
    width: 250,
    ui: 'liveLooper',
    inputs: [
      { id: 'in', label: 'L', kind: 'audio' },
      { id: 'inR', label: 'R', kind: 'audio' },
      { id: 'ev:rec', label: 'rec', kind: 'event' },
      { id: 'ev:play', label: 'play', kind: 'event' },
      { id: 'ev:clear', label: 'clr', kind: 'event' },
      { id: 'cv:speed', label: 'speed', kind: 'cv' },
    ],
    outputs: [
      audioOut,
      { id: 'outL', label: 'L', kind: 'audio' },
      { id: 'outR', label: 'R', kind: 'audio' },
      { id: 'phase', label: 'phase', kind: 'cv' },
      { id: 'ev:cycle', label: 'cycle', kind: 'event' },
    ],
    params: [
      { key: 'name', label: 'Name', control: 'text', placeholder: 'Name this looper', maxLength: 20, default: '' },
      { key: 'feedback', label: 'Feedback', control: 'slider', min: 0, max: 1, step: 0.01, default: 0.95 },
      { key: 'mix', label: 'Dry/Wet', control: 'slider', min: 0, max: 1, step: 0.01, default: 1 },
      { key: 'gain', label: 'Output', control: 'slider', min: 0, max: 2, step: 0.01, default: 1 },
      { key: 'speed', label: 'Speed', control: 'slider', min: -2, max: 2, step: 0.01, default: 1 },
      { key: 'reverse', label: 'Reverse', control: 'toggle', default: 0, hidden: true },
      { key: 'halfSpeed', label: 'Half speed', control: 'toggle', default: 0, hidden: true },
    ],
  },

  drumSeq: {
    type: 'drumSeq',
    icon: '▦',
    description: 'Seven-lane 808 step sequencer with polymeter, ratchets and accents.',
    label: '808 Sequencer',
    category: 'control',
    accent: '#ef4444',
    width: 580,
    ui: 'drumSeq',
    ports: 'horizontal',
    inputs: [
      { id: 'ev:clock', label: 'clock', kind: 'event' },
      { id: 'ev:reset', label: 'reset', kind: 'event' },
      { id: 'ev:run', label: 'run', kind: 'event' },
      { id: 'cv:swing', label: 'swing', kind: 'cv' },
    ],
    outputs: [
      { id: 'ev:bd', label: 'BD', kind: 'event' },
      { id: 'ev:sd', label: 'SD', kind: 'event' },
      { id: 'ev:cp', label: 'CP', kind: 'event' },
      { id: 'ev:ch', label: 'CH', kind: 'event' },
      { id: 'ev:oh', label: 'OH', kind: 'event' },
      { id: 'ev:cb', label: 'CB', kind: 'event' },
      { id: 'accent', label: 'acc cv', kind: 'cv' },
      { id: 'sum', label: 'sum', kind: 'cv' },
      { id: 'ev:clockOut', label: 'clk', kind: 'event' },
      { id: 'ev:loop', label: 'loop', kind: 'event' },
    ],
    params: [
      { key: 'bpm', label: 'BPM', control: 'slider', min: 40, max: 260, step: 0.1, default: 120, hidden: true },
      { key: 'swing', label: 'Swing', control: 'slider', min: 0.5, max: 0.75, step: 0.005, default: 0.5, hidden: true },
      { key: 'running', label: 'Run', control: 'toggle', default: 0, hidden: true },
      // The whole pattern bank travels with the patch as compact JSON.
      { key: 'patterns', label: 'Patterns', control: 'text', maxLength: 60000, default: '', hidden: true },
      { key: 'mod_swing', label: 'swing depth', control: 'slider', min: -1, max: 1, step: 0.01, default: 1, hidden: true },
    ],
  },

  arp: {
    type: 'arp',
    icon: '🎼',
    description: 'Arpeggiates held notes or plays a step melody. Drives any synth.',
    label: 'Arp / Sequencer',
    category: 'control',
    accent: '#34d399',
    width: 470,
    ui: 'arp',
    inputs: [
      { id: 'ev:notes', label: 'notes', kind: 'event' },
      { id: 'ev:clock', label: 'clock', kind: 'event' },
      { id: 'ev:reset', label: 'reset', kind: 'event' },
      { id: 'ev:run', label: 'run', kind: 'event' },
      { id: 'cv:transpose', label: 'transp', kind: 'cv' },
    ],
    outputs: [
      { id: 'ev:note', label: 'note', kind: 'event' },
      { id: 'pitch', label: 'pitch', kind: 'cv' },
      { id: 'gate', label: 'gate', kind: 'cv' },
      { id: 'ev:step', label: 'step', kind: 'event' },
    ],
    params: [
      { key: 'mode', label: 'Mode', control: 'select', options: ['arp', 'sequence'], default: 'arp' },
      { key: 'arpMode', label: 'Direction', control: 'select', options: ['up', 'down', 'up-down', 'random', 'as played'], default: 'up' },
      { key: 'rate', label: 'Rate', control: 'select', options: ['1/4', '1/8', '1/16', '1/8T', '1/16T'], default: '1/8' },
      { key: 'octaves', label: 'Octaves', control: 'slider', min: 1, max: 4, step: 1, default: 2 },
      { key: 'gate', label: 'Gate', control: 'slider', min: 0.05, max: 1, step: 0.01, default: 0.5 },
      { key: 'transpose', label: 'Transpose', control: 'slider', min: -24, max: 24, step: 1, unit: 'st', default: 0 },
      { key: 'bpm', label: 'BPM', control: 'slider', min: 40, max: 260, step: 0.1, default: 120, hidden: true },
      { key: 'swing', label: 'Swing', control: 'slider', min: 0.5, max: 0.75, step: 0.005, default: 0.5, hidden: true },
      { key: 'length', label: 'Steps', control: 'slider', min: 1, max: 16, step: 1, default: 16, hidden: true },
      { key: 'root', label: 'Root', control: 'slider', min: 24, max: 72, step: 1, default: 48, hidden: true },
      { key: 'hold', label: 'Hold', control: 'toggle', default: 0, hidden: true },
      { key: 'running', label: 'Run', control: 'toggle', default: 0, hidden: true },
      { key: 'steps', label: 'Steps', control: 'text', maxLength: 8000, default: '', hidden: true },
      { key: 'mod_transpose', label: 'transpose depth', control: 'slider', min: -1, max: 1, step: 0.01, default: 1, hidden: true },
    ],
  },

  destination: {
    type: 'destination',
    icon: '📢',
    description: 'Where the sound leaves for your speakers.',
    label: 'Master Out',
    category: 'output',
    ui: 'master',
    width: 210,
    accent: '#34d399',
    inputs: [audioIn],
    outputs: [],
    params: [{ key: 'volume', label: 'Volume', control: 'slider', min: -60, max: 6, step: 1, unit: 'dB', default: -6 }],
  },
}) as Record<string, NodeDef>


/**
 * Every modulation inlet gets a depth control, generated rather than written
 * out by hand so a new inlet can never ship without one.
 *
 * For a `param:` inlet the depth is in that param's own units — patch an LFO
 * into cutoff and a depth of 2000 means "swing 2000 Hz either side of the
 * knob". Bipolar, so a negative depth inverts the modulation. `cv:` inlets are
 * normalised to ±1, because the node reading them does its own scaling.
 */
const withModDepths = (def: NodeDef): NodeDef => {
  const extra: ParamSpec[] = []

  for (const inlet of def.inputs) {
    if (inlet.kind !== 'param' && inlet.kind !== 'cv') continue
    const key = inlet.id.replace(/^(param|cv):/, '')
    // A hand-written depth spec wins — some inlets need units the generator
    // cannot infer, like cutoff modulation measured in cents.
    if (def.params.some((p) => p.key === `mod_${key}`)) continue
    const owner = def.params.find((p) => p.key === key)

    if (inlet.kind === 'param' && owner && owner.control === 'slider') {
      const span = owner.max - owner.min
      // Default to a swing the size of the knob's own resting value, which
      // lands musically whatever the units. A fraction of the full span does
      // not: a quarter of 20Hz–18kHz would hurl the cutoff off the scale.
      const natural = Math.abs(Number(owner.default) || span * 0.1)
      const depth = Math.min(natural, span)
      // Four times the default throw is plenty of reach while keeping the
      // slider aimable.
      const reach = Math.min(span, Math.max(depth * 4, span * 0.05))
      extra.push({
        key: `mod_${key}`,
        label: `${inlet.label} depth`,
        control: 'slider',
        min: -Math.round(reach * 100) / 100,
        max: Math.round(reach * 100) / 100,
        step: owner.step,
        unit: owner.unit,
        default: Math.round(depth * 100) / 100,
        hidden: true,
      })
    } else {
      extra.push({
        key: `mod_${key}`,
        label: `${inlet.label} depth`,
        control: 'slider',
        min: -1,
        max: 1,
        step: 0.01,
        default: 1,
        hidden: true,
      })
    }
  }

  return extra.length ? { ...def, params: [...def.params, ...extra] } : def
}

for (const key of Object.keys(NODE_DEFS)) {
  NODE_DEFS[key] = withModDepths(NODE_DEFS[key])
}

/** The depth param belonging to a modulation inlet, if it has one. */
export const modDepthKey = (inletId: string): string | null =>
  /^(param|cv):/.test(inletId) ? `mod_${inletId.replace(/^(param|cv):/, '')}` : null

export const defaultParams = (type: string): ParamValues =>
  Object.fromEntries(NODE_DEFS[type].params.map((p) => [p.key, p.default]))
