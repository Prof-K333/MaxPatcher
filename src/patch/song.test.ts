import { describe, expect, it } from 'vitest'
import { deserialize } from './format'
import { expandSong, noteNameToMidi, parseNoteList, type SongFile } from './song'
import { parseSeqBank } from '../audio/sequencer/noteSeq'
import { parseBank } from '../audio/sequencer/pattern'
import { chainRepeats, loopLength } from '../audio/sequencer/arrangement'

const twinkle: SongFile = {
  format: 'patcher-song',
  version: 1,
  name: 'Twinkle vocal demo',
  bpm: 100,
  key: 'C',
  root: 'C4',
  rate: '1/8',
  lyrics: 'Twinkle twinkle little star how I wonder what you are',
  voice: { body: 'female', vowel: 'ah', breath: 0.7 },
  bars: [
    { notes: 'C4 C4 G4 G4 A4 A4 G4 .', lyrics: 'Twin-kle twin-kle lit-tle star' },
    { notes: 'F4 F4 E4 E4 D4 D4 C4 .', lyrics: 'how I won-der what you are' },
  ],
  arrangement: [0, 1],
  loopBars: 64,
  drums: {
    presets: ['Four on the floor', 'House'],
    order: [0, 1],
    bars: 64,
  },
  instruments: {
    lead: { type: 'fmsynth', wave: 'triangle' },
    fx: ['reverb'],
  },
}

describe('patcher-song JSON', () => {
  it('parses readable note names', () => {
    expect(noteNameToMidi('C4')).toBe(60)
    expect(noteNameToMidi('C3')).toBe(48)
    expect(noteNameToMidi('G#3')).toBe(56)
    expect(noteNameToMidi('Db4')).toBe(61)
    expect(noteNameToMidi('.')).toBeNull()
    expect(parseNoteList('C4 E4! rest G4')[1]).toEqual({ midi: 64, accent: true })
  })

  it('expands a song with lyrics, chained melody bars, and a 64-bar drum loop', () => {
    const { patch, warnings } = expandSong(twinkle)
    expect(warnings).toEqual([])
    expect(patch.format).toBe('patcher')
    expect(patch.name).toBe('Twinkle vocal demo')

    const types = Object.fromEntries(patch.nodes.map((n) => [n.id, n]))
    expect(types.vocal.type).toBe('vocalSynth')
    expect(types.vocal.params.lyrics).toBe(twinkle.lyrics)
    expect(types.vocal.params.body).toBe('female')
    expect(types.seq.type).toBe('arp')
    expect(types.drumSeq.type).toBe('drumSeq')
    expect(types.drums.type).toBe('drums808')
    expect(types.lead.type).toBe('fmsynth')
    expect(types.seq.params.rate).toBe('1/8')
    expect(types.seq.params.gate).toBe(0.9)
    expect(types.verb.type).toBe('reverb')
    expect(types.mix.type).toBe('mixer')
    expect(types.master.type).toBe('destination')

    const melody = parseSeqBank(String(types.seq.params.steps))
    expect(melody.order).toEqual([0, 1])
    expect(melody.bars).toBe(64)
    expect(loopLength(melody.order.length, melody.bars)).toBe(64)
    expect(chainRepeats(melody.order.length, melody.bars)).toBe(32)
    expect(melody.sequences[0][0]).toMatchObject({ pitch: 0 })
    expect(melody.lyrics[0]).toMatch(/Twin/i)

    const drums = parseBank(String(types.drumSeq.params.patterns))
    expect(drums.order).toEqual([0, 1])
    expect(drums.bars).toBe(64)

    const cables = patch.edges.map((e) => `${e.source}:${e.sourceHandle}->${e.target}:${e.targetHandle}`)
    expect(cables).toContain('seq:ev:note->vocal:ev:note')
    expect(cables).toContain('vocal:out->mix:in1')
    expect(cables).toContain('drums:out->mix:in2')
    expect(cables).toContain('mix:out->verb:in')
    expect(cables).toContain('verb:out->master:in')
  })

  it('imports that song through deserialize into a usable graph', () => {
    const result = deserialize(twinkle)
    expect(result.name).toBe('Twinkle vocal demo')
    expect(result.warnings).toEqual([])
    const vocal = result.nodes.find((n) => n.data.type === 'vocalSynth')
    const seq = result.nodes.find((n) => n.data.type === 'arp')
    expect(vocal?.data.params.lyrics).toBe(twinkle.lyrics)
    expect(String(seq?.data.params.steps)).toContain('Twin')
    expect(result.edges.some((e) => e.sourceHandle === 'ev:note' && e.targetHandle === 'ev:note')).toBe(true)
    expect(result.nodes.some((n) => n.data.type === 'destination')).toBe(true)
  })

  it('honours an 8-slot 128-bar chain on both melody and drums', () => {
    const song: SongFile = {
      format: 'patcher-song',
      name: 'Long form',
      root: 'C4',
      bars: Array.from({ length: 8 }, (_, i) => ({ notes: `${['C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4', 'C5'][i]} . . .` })),
      arrangement: [0, 1, 2, 3, 4, 5, 6, 7],
      loopBars: 128,
      drums: {
        presets: [
          'Four on the floor',
          'Boom bap',
          'Trap',
          'House',
          'Breakbeat',
          'Electro',
          'Half time',
          'Clave',
        ],
        order: [0, 1, 2, 3, 4, 5, 6, 7],
        bars: 128,
      },
    }
    const { patch, warnings } = expandSong(song)
    expect(warnings).toEqual([])
    const seq = patch.nodes.find((n) => n.type === 'arp')!
    const drums = patch.nodes.find((n) => n.type === 'drumSeq')!
    const melody = parseSeqBank(String(seq.params.steps))
    const bank = parseBank(String(drums.params.patterns))
    expect(melody.order).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
    expect(bank.order).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
    expect(loopLength(8, melody.bars)).toBe(128)
    expect(chainRepeats(8, melody.bars)).toBe(16)
    expect(loopLength(8, bank.bars)).toBe(128)
    expect(chainRepeats(8, bank.bars)).toBe(16)
  })

  it('fails softly on a partial song: unknown extras warn, the rest still loads', () => {
    const result = deserialize({
      format: 'patcher-song',
      name: 'Partial',
      lyrics: 'ah',
      instruments: {
        extras: [{ type: 'not-a-node' }],
        fx: ['reverb', 'space-laser'],
      },
    })
    expect(result.name).toBe('Partial')
    expect(result.nodes.some((n) => n.data.type === 'vocalSynth')).toBe(true)
    expect(result.nodes.some((n) => n.data.type === 'destination')).toBe(true)
    expect(result.warnings.join('\n')).toMatch(/not-a-node/i)
    expect(result.warnings.join('\n')).toMatch(/space-laser/i)
    expect(result.warnings.filter((w) => /reverb/i.test(w) && !/space-laser/i.test(w))).toEqual([])
  })

  it('rejects a future song version, and a missing format is still a parse error', () => {
    expect(() => deserialize({ format: 'patcher-song', version: 99, bars: [] })).toThrow(/newer/)
  })

  it('does not auto-insert a free-running oscillator for instruments.pad', () => {
    const { patch, warnings } = expandSong({
      format: 'patcher-song',
      name: 'Pad warning',
      lyrics: 'ah',
      instruments: { pad: { wave: 'triangle', cutoff: 800 } },
    })
    expect(patch.nodes.some((n) => n.type === 'oscillator')).toBe(false)
    expect(warnings.join('\n')).toMatch(/drone/i)
  })

  it('uses 8-step bars when the melody rate is 1/8', () => {
    const { patch, warnings } = expandSong({
      format: 'patcher-song',
      name: 'Eighths',
      root: 'C4',
      rate: '1/8',
      bars: [{ notes: 'C4 E4 G4 C5' }],
    })
    expect(warnings).toEqual([])
    const seq = patch.nodes.find((n) => n.type === 'arp')!
    expect(seq.params.rate).toBe('1/8')
    const melody = parseSeqBank(String(seq.params.steps))
    expect(melody.sequences[0]).toHaveLength(8)
    expect(melody.sequences[0][0]).toMatchObject({ pitch: 0 })
    expect(melody.sequences[0][1]).toMatchObject({ pitch: 4 })
  })
})
