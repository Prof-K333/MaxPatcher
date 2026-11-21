import { describe, expect, it } from 'vitest'
import { liveNoteFromQueue } from './VocalSynthImpl'
import type { PatchEvent } from '../types'

const on = (note: number, syllable?: string): PatchEvent => ({
  type: 'noteOn',
  note,
  freq: 440,
  velocity: 0.8,
  ...(syllable ? { syllable } : {}),
})

const off = (note: number): PatchEvent => ({ type: 'noteOff', note })

describe('liveNoteFromQueue', () => {
  it('returns null when the queue is empty or every note has already been released', () => {
    expect(liveNoteFromQueue([])).toBeNull()
    expect(liveNoteFromQueue([on(67), off(67), on(69), off(69)])).toBeNull()
  })

  it('drops stale history and keeps only a note that is still held', () => {
    const events = [on(67, 'Yan'), off(67), on(67, 'kee'), off(67), on(69, 'Doo')]
    expect(liveNoteFromQueue(events)).toMatchObject({ type: 'noteOn', note: 69, syllable: 'Doo' })
  })
})
