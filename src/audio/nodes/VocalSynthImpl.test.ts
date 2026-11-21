import { afterEach, describe, expect, it, vi } from 'vitest'

const harness = vi.hoisted(() => {
  let now = 1
  const timers = new Map<number, { fireAt: number; cb: () => void }>()
  let nextId = 0
  const messages: object[] = []
  const planned: Array<{ text: string; midi: number }> = []
  const port: {
    onmessage: ((e: { data: { type?: string; message?: string } }) => void) | null
    postMessage: (msg: object) => void
  } = {
    onmessage: null,
    postMessage(msg) {
      messages.push(msg)
    },
  }
  const worklet = {
    port,
    connect() {},
    disconnect() {},
  }
  return {
    get now() {
      return now
    },
    messages,
    planned,
    port,
    worklet,
    reset() {
      now = 1
      timers.clear()
      nextId = 0
      messages.length = 0
      planned.length = 0
      port.onmessage = null
    },
    setTimeout(cb: () => void, delay: number) {
      const id = ++nextId
      timers.set(id, { fireAt: now + delay, cb })
      return id
    },
    clearTimeout(id: number) {
      timers.delete(id)
    },
    advanceTo(t: number) {
      now = t
      const due = [...timers.entries()].filter(([, v]) => v.fireAt <= t + 1e-12)
      due.sort((a, b) => a[1].fireAt - b[1].fireAt)
      for (const [id, v] of due) {
        timers.delete(id)
        v.cb()
      }
    },
  }
})

vi.mock('tone', () => {
  class Gain {
    input = {}
    gain = { rampTo: vi.fn() }
    connect() {
      return this
    }
    dispose() {}
  }
  return {
    Gain,
    dbToGain: (n: number) => 10 ** (n / 20),
    // Includes Tone's 100ms lookAhead. Using this as "audio now" would make
    // booked notes look late and fire immediately — the tests guard against that.
    now: () => harness.now + 0.1,
    getContext: () => ({
      immediate: () => harness.now,
      rawContext: {
        get currentTime() {
          return harness.now
        },
      },
      setTimeout: (fn: () => void, delay: number) => harness.setTimeout(fn, delay),
      clearTimeout: (id: number) => harness.clearTimeout(id),
      createAudioWorkletNode: () => harness.worklet,
    }),
  }
})

vi.mock('../vocal/chimera/chimera', () => ({
  initChimera: async () => {},
  chimeraReady: () => true,
  chimeraModule: () => ({}),
}))

vi.mock('../worklet', () => ({
  ensureWorkletModule: async () => {},
}))

vi.mock('../vocal/chimera/planner', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../vocal/chimera/planner')>()
  return {
    ...actual,
    lyricsToSyllables: (text: string) =>
      text
        .trim()
        .split(/[\s-]+/)
        .filter(Boolean)
        .map((word) => ({ ...actual.defaultSyllable('ah'), text: word })),
    planNoteOn: (syl: { text: string }, midi: number) => {
      harness.planned.push({ text: syl.text, midi })
      return [{ label: 'on', targets: {}, tag: 0 }]
    },
    planNoteOff: () => [{ label: 'off', targets: {}, tag: 0 }],
    planMelisma: () => [],
  }
})

import { liveNoteFromQueue, VocalSynthImpl } from './VocalSynthImpl'
import type { PatchEvent } from '../types'

const on = (note: number, syllable?: string, time?: number): PatchEvent => ({
  type: 'noteOn',
  note,
  freq: 440,
  velocity: 0.8,
  ...(syllable ? { syllable } : {}),
  ...(time !== undefined ? { time } : {}),
})

const off = (note: number, time?: number): PatchEvent => ({
  type: 'noteOff',
  note,
  ...(time !== undefined ? { time } : {}),
})

const ofType = (type: string) =>
  harness.messages.filter((m) => (m as { type?: string }).type === type)

async function readySynth() {
  const impl = new VocalSynthImpl()
  await vi.waitFor(() => {
    if (!harness.port.onmessage) throw new Error('boot did not finish')
  })
  harness.port.onmessage!({ data: { type: 'ready' } })
  return impl
}

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

describe('VocalSynthImpl scheduled time', () => {
  let impl: VocalSynthImpl

  afterEach(() => {
    impl?.dispose()
    harness.reset()
  })

  it('does not start and release a future noteOn+noteOff booked in the same turn', async () => {
    impl = await readySynth()
    const before = ofType('schedule').length + ofType('release').length

    impl.onEvent('ev:note', on(67, 'Yan', 1.05))
    impl.onEvent('ev:note', off(67, 1.12))

    expect(ofType('schedule').length + ofType('release').length).toBe(before)
    expect(harness.planned).toEqual([])

    harness.advanceTo(1.05)
    expect(ofType('schedule').length).toBeGreaterThan(0)
    expect(ofType('release')).toHaveLength(0)
    expect(harness.planned).toEqual([{ text: 'Yan', midi: 67 }])

    const scheduled = ofType('schedule').at(-1) as { lead?: number }
    expect(scheduled.lead).toBeGreaterThanOrEqual(0.006)

    harness.advanceTo(1.12)
    expect(ofType('release').length).toBeGreaterThan(0)
  })

  it('fires a note with no time immediately', async () => {
    impl = await readySynth()
    const before = ofType('schedule').length
    impl.onEvent('ev:note', on(60, 'ah'))
    expect(ofType('schedule').length).toBe(before + 1)
    expect(harness.planned).toEqual([{ text: 'ah', midi: 60 }])
  })

  it('cancels pending notes on stop so a booked note never sounds', async () => {
    impl = await readySynth()
    const before = ofType('schedule').length
    impl.onEvent('ev:note', on(64, 'kee', 1.2))
    impl.onStop()
    harness.advanceTo(1.3)
    expect(ofType('schedule').length).toBe(before)
    expect(harness.planned).toEqual([])
    expect(ofType('stopSpeech').length).toBeGreaterThan(0)
  })

  it('does not advance the lyric cursor when a lookahead burst is booked', async () => {
    impl = await readySynth()
    impl.setParam('lyrics', 'Yan kee Doo dle')

    impl.onEvent('ev:note', on(67, undefined, 1.05))
    impl.onEvent('ev:note', on(69, undefined, 1.15))
    impl.onEvent('ev:note', off(67, 1.12))
    impl.onEvent('ev:note', off(69, 1.22))

    expect(harness.planned).toEqual([])

    harness.advanceTo(1.05)
    expect(harness.planned).toEqual([{ text: 'Yan', midi: 67 }])

    harness.advanceTo(1.15)
    expect(harness.planned).toEqual([
      { text: 'Yan', midi: 67 },
      { text: 'kee', midi: 69 },
    ])
  })
})
