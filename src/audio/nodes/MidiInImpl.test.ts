import { describe, expect, it, vi } from 'vitest'
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

import { MidiInImpl } from './MidiInImpl'

describe('MidiInImpl without a device', () => {
  it('can be constructed and enabled when requestMIDIAccess is missing, without throwing', async () => {
    const impl = new MidiInImpl()
    await expect(impl.enable()).resolves.toBeUndefined()
    expect(impl.status.supported).toBe(false)
    impl.dispose()
  })

  it('emits the same note events as a keyboard when driven directly', () => {
    const impl = new MidiInImpl()
    const emitted: Array<{ handle: string; event: PatchEvent }> = []
    impl.emit = (handle, event) => {
      emitted.push({ handle, event })
    }
    impl.onEvent('ui', { type: 'noteOn', note: 60, freq: 261.63, velocity: 0.8 })
    impl.onEvent('ui', { type: 'noteOff', note: 60 })
    expect(emitted[0]).toEqual({ handle: 'ev:note', event: { type: 'noteOn', note: 60, freq: 261.63, velocity: 0.8 } })
    expect(emitted[1]).toEqual({ handle: 'ev:note', event: { type: 'noteOff', note: 60 } })
    expect(impl.audioOut('gate')).toMatchObject({ value: 0 })
    impl.dispose()
  })
})
