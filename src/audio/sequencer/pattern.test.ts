import { describe, expect, it } from 'vitest'
import { defaultBank, parseBank, patternIndexFromName, serializeBank } from './pattern'

describe('drum bank arrangement', () => {
  it('round-trips a memory chain and a 128-bar loop', () => {
    const bank = defaultBank()
    bank.order = [0, 1, 2, 3, 4, 5, 6, 7]
    bank.bars = 128
    bank.current = 2
    const again = parseBank(serializeBank(bank))
    expect(again.order).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
    expect(again.bars).toBe(128)
    expect(again.current).toBe(2)
    expect(again.patterns).toHaveLength(16)
  })

  it('loads an older bank with no order as a single looping pattern', () => {
    const raw = serializeBank(defaultBank())
    expect(raw).not.toContain('"o"')
    const again = parseBank(raw)
    expect(again.order).toEqual([])
    expect(again.bars).toBe(0)
  })

  it('resolves shipped beats by name', () => {
    expect(patternIndexFromName('Four on the floor')).toBe(0)
    expect(patternIndexFromName('boom-bap')).toBe(1)
    expect(patternIndexFromName(3)).toBe(3)
    expect(patternIndexFromName('not-a-beat')).toBeNull()
  })
})
