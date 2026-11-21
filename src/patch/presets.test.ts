import { describe, expect, it } from 'vitest'
import { deserialize } from './format'
import { PRESETS } from './presets'
import { parseSeqBank } from '../audio/sequencer/noteSeq'
import { parseBank } from '../audio/sequencer/pattern'
import { chainRepeats, loopLength } from '../audio/sequencer/arrangement'

const SONG_PRESETS = [
  'Ode to Joy',
  'Für Elise',
  'Twinkle Twinkle Little Star',
  'The Entertainer',
  'In the Hall of the Mountain King',
  'When the Saints Go Marching In',
  'Eine kleine Nachtmusik',
  'Jingle Bells',
  'Row, Row, Row Your Boat',
  'Yankee Doodle',
] as const

const DEMO_PRESETS = [
  'Tape Loop Drone',
  'Granular Shimmer',
  '808 Jam',
  'Polymeter Clockwork',
  'Modulation Lab',
  'Arp Engine',
  'Envelope VCA',
] as const

describe('PRESETS', () => {
  it('deserializes every preset without error or warning', () => {
    expect(PRESETS).toHaveLength(DEMO_PRESETS.length + SONG_PRESETS.length)
    for (const preset of PRESETS) {
      const result = deserialize(preset.build())
      expect(result.name, preset.name).toBe(preset.name)
      expect(result.warnings, preset.name).toEqual([])
      expect(result.nodes.length, preset.name).toBeGreaterThan(0)
    }
  })

  it('keeps the original demos and lists the ten public-domain songs', () => {
    const names = PRESETS.map((p) => p.name)
    expect(names.slice(0, DEMO_PRESETS.length)).toEqual([...DEMO_PRESETS])
    expect(names).toEqual(expect.arrayContaining([...SONG_PRESETS]))
  })

  it('gives Yankee Doodle a 64-bar memory chain on melody and drums, with lyrics', () => {
    const preset = PRESETS.find((p) => p.name === 'Yankee Doodle')
    expect(preset).toBeDefined()
    const result = deserialize(preset!.build())
    expect(result.warnings).toEqual([])
    const vocal = result.nodes.find((n) => n.data.type === 'vocalSynth')
    const seq = result.nodes.find((n) => n.data.type === 'arp')
    const drums = result.nodes.find((n) => n.data.type === 'drumSeq')
    expect(String(vocal?.data.params.lyrics)).toMatch(/dandy/i)
    const melody = parseSeqBank(String(seq?.data.params.steps))
    const bank = parseBank(String(drums?.data.params.patterns))
    expect(melody.order).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
    expect(melody.bars).toBe(64)
    expect(loopLength(melody.order.length, melody.bars)).toBe(64)
    expect(chainRepeats(melody.order.length, melody.bars)).toBe(8)
    expect(bank.order).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
    expect(bank.bars).toBe(64)
    expect(chainRepeats(bank.order.length, bank.bars)).toBe(8)
    expect(result.edges.some((e) => e.sourceHandle === 'ev:note' && e.targetHandle === 'ev:note')).toBe(true)
  })
})
