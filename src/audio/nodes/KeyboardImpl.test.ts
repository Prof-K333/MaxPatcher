import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PatchEvent } from '../types'

vi.mock('tone', () => {
  class Signal {
    value: number
    constructor(value = 0) {
      this.value = value
    }
    rampTo(value: number) {
      this.value = value
    }
    dispose() {}
  }
  return {
    Signal,
    Frequency: (note: number) => ({ toFrequency: () => 440 * 2 ** ((note - 69) / 12) }),
  }
})

import { KeyboardImpl } from './KeyboardImpl'

describe('KeyboardImpl hanging notes', () => {
  let impl: KeyboardImpl
  let emitted: Array<{ handle: string; event: PatchEvent }>

  beforeEach(() => {
    impl = new KeyboardImpl()
    emitted = []
    impl.emit = (handle, event) => {
      emitted.push({ handle, event })
    }
  })

  it('releases sounding notes with note-off events on onStop, and closes the gate', () => {
    impl.onEvent('ui', { type: 'noteOn', note: 60, freq: 261.63, velocity: 0.8 })
    impl.onEvent('ui', { type: 'noteOn', note: 64, freq: 329.63, velocity: 0.7 })
    expect(impl.audioOut('gate')).toMatchObject({ value: 1 })
    emitted.length = 0
    impl.onStop()
    expect(emitted).toEqual([
      { handle: 'ev:note', event: { type: 'noteOff', note: 60 } },
      { handle: 'ev:note', event: { type: 'noteOff', note: 64 } },
    ])
    expect(impl.audioOut('gate')).toMatchObject({ value: 0 })
  })

  it('releases sounding notes on dispose so a removed keyboard cannot hang a voice', () => {
    impl.onEvent('ui', { type: 'noteOn', note: 62, freq: 293.66, velocity: 0.9 })
    emitted.length = 0
    impl.dispose()
    expect(emitted).toEqual([{ handle: 'ev:note', event: { type: 'noteOff', note: 62 } }])
  })

  it('a noteOff on the last held key closes the gate', () => {
    impl.onEvent('ui', { type: 'noteOn', note: 60, freq: 261.63, velocity: 0.8 })
    impl.onEvent('ui', { type: 'noteOff', note: 60 })
    expect(impl.audioOut('gate')).toMatchObject({ value: 0 })
    expect(emitted.at(-1)).toEqual({ handle: 'ev:note', event: { type: 'noteOff', note: 60 } })
  })
})
