import { describe, expect, it } from 'vitest'
import {
  MAX_SEQ_STEPS,
  NOTE_STEPS,
  defaultSeqBank,
  emptySequence,
  parseSeqBank,
  parseSequence,
  serializeSeqBank,
  serializeSequence,
  tokenizeLyrics,
} from './noteSeq'

describe('sequence parse/serialize', () => {
  it('still loads a packed 16-step string from older patches', () => {
    const packed = '0.3.7...........|1.0.1...........'
    const seq = parseSequence(packed)
    expect(seq).toHaveLength(NOTE_STEPS)
    expect(seq[0]).toMatchObject({ pitch: 0, accent: true })
    expect(seq[2]).toMatchObject({ pitch: 3, accent: false })
    expect(seq[4]).toMatchObject({ pitch: 7, accent: true })
    expect(seq[1].pitch).toBeNull()
  })

  it('round-trips a multi-bar sequence, arrangement order, and lyrics', () => {
    const long = Array.from({ length: 64 }, (_, i) => ({
      pitch: i % 4 === 0 ? i % 12 : null,
      accent: i === 0,
      syllable: i % 4 === 0 ? 'la' : undefined,
    }))
    const bank = defaultSeqBank()
    bank.sequences[0] = long
    bank.current = 0
    bank.order = [0, 0, 1, 2]
    bank.bars = 128
    bank.lyrics[0] = 'row row row your boat'
    bank.lyrics[1] = 'gently down the stream'
    const packed = serializeSeqBank(bank)
    const again = parseSeqBank(packed)
    expect(again.sequences[0]).toHaveLength(64)
    expect(again.sequences[0][0]).toMatchObject({ pitch: 0, accent: true, syllable: 'la' })
    expect(again.order).toEqual([0, 0, 1, 2])
    expect(again.bars).toBe(128)
    expect(again.lyrics[0]).toBe('row row row your boat')
    expect(again.lyrics[1]).toBe('gently down the stream')
    expect(again.current).toBe(0)
  })

  it('keeps an old {c,s} bank without order or lyrics', () => {
    const raw = JSON.stringify({ c: 3, s: [serializeSequence(defaultSeqBank().sequences[0])] })
    const bank = parseSeqBank(raw)
    expect(bank.current).toBe(3)
    expect(bank.order).toEqual([])
    expect(bank.bars).toBe(0)
    expect(bank.lyrics.every((l) => l === '')).toBe(true)
    expect(bank.sequences).toHaveLength(16)
  })

  it('loads a bare sequence string into slot 1, as older patches did', () => {
    const bank = parseSeqBank('0.3.|1.0.')
    expect(bank.sequences[0][0].pitch).toBe(0)
    expect(bank.order).toEqual([])
  })

  it('keeps an 8-step packed bar at 8 steps, rather than padding to 16', () => {
    const seq = emptySequence(8)
    seq[0] = { pitch: 0, accent: true }
    seq[1] = { pitch: 4, accent: false }
    const again = parseSequence(serializeSequence(seq))
    expect(again).toHaveLength(8)
    expect(again[0]).toMatchObject({ pitch: 0, accent: true })
    expect(again[1]).toMatchObject({ pitch: 4, accent: false })
  })

  it('caps a slot at MAX_SEQ_STEPS and tokenizes lyrics into syllables', () => {
    const huge = `${'0'.repeat(200)}|${'1'.repeat(200)}`
    expect(parseSequence(huge).length).toBe(MAX_SEQ_STEPS)
    expect(tokenizeLyrics('row, row — your-boat')).toEqual(['row,', 'row', '—', 'your', 'boat'])
  })
})
