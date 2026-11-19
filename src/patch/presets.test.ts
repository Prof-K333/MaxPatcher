import { describe, expect, it } from 'vitest'
import { deserialize } from './format'
import { PRESETS } from './presets'

const SONG_PRESETS = [
  'Ode to Joy',
  'Für Elise',
  'Twinkle Twinkle Little Star',
  'The Entertainer',
  'In the Hall of the Mountain King',
  'When the Saints Go Marching In',
  'Eine kleine Nachtmusik',
  'Jingle Bells',
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

  it('keeps the original demos and lists the eight public-domain songs', () => {
    const names = PRESETS.map((p) => p.name)
    expect(names.slice(0, DEMO_PRESETS.length)).toEqual([...DEMO_PRESETS])
    expect(names).toEqual(expect.arrayContaining([...SONG_PRESETS]))
  })
})
