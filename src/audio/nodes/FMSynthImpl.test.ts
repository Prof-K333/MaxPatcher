import { beforeEach, describe, expect, it, vi } from 'vitest'

const triggerAttack = vi.fn()
const triggerRelease = vi.fn()
const releaseAll = vi.fn()
const dispose = vi.fn()
const set = vi.fn()

vi.mock('tone', () => {
  class Gain {
    gain = { rampTo: vi.fn(), value: 1 }
    connect() {
      return this
    }
    dispose() {}
  }
  class Waveform {
    getValue() {
      return [0]
    }
    dispose() {}
  }
  class PolySynth {
    maxPolyphony = 0
    volume = { value: 0, rampTo: vi.fn() }
    triggerAttack = triggerAttack
    triggerRelease = triggerRelease
    releaseAll = releaseAll
    set = set
    dispose = dispose
    constructor() {
      return this
    }
  }
  return {
    PolySynth,
    FMSynth: class {},
    Gain,
    Waveform,
    now: () => 1.25,
    Frequency: (note: number) => ({ toFrequency: () => 440 * 2 ** ((note - 69) / 12) }),
  }
})

import { FMSynthImpl } from './FMSynthImpl'

describe('FMSynthImpl voice release', () => {
  let impl: FMSynthImpl

  beforeEach(() => {
    triggerAttack.mockClear()
    triggerRelease.mockClear()
    releaseAll.mockClear()
    dispose.mockClear()
    set.mockClear()
    impl = new FMSynthImpl()
  })

  it('releases a voice at the exact frequency it was attacked at, not a recomputed one', () => {
    impl.onEvent('ev:note', { type: 'noteOn', note: 60, freq: 261.1, velocity: 0.8, time: 2 })
    expect(triggerAttack).toHaveBeenCalledWith(261.1, 2, 0.8)
    impl.onEvent('ev:note', { type: 'noteOff', note: 60, time: 3 })
    expect(triggerRelease).toHaveBeenCalledWith(261.1, 3)
    expect(triggerRelease).not.toHaveBeenCalledWith(440 * 2 ** ((60 - 69) / 12), 3)
  })

  it('retriggers a held note by releasing the stored frequency first', () => {
    impl.onEvent('ev:note', { type: 'noteOn', note: 60, freq: 261.1, velocity: 0.8, time: 1 })
    impl.onEvent('ev:note', { type: 'noteOn', note: 60, freq: 270, velocity: 0.9, time: 1.5 })
    expect(triggerRelease).toHaveBeenCalledWith(261.1, 1.5)
    expect(triggerAttack).toHaveBeenLastCalledWith(270, 1.5, 0.9)
    impl.onEvent('ev:note', { type: 'noteOff', note: 60, time: 2 })
    expect(triggerRelease).toHaveBeenLastCalledWith(270, 2)
  })

  it('calls releaseAll on stop and on dispose', () => {
    impl.onEvent('ev:note', { type: 'noteOn', note: 64, freq: 329.6, velocity: 0.7 })
    impl.onStop()
    expect(releaseAll).toHaveBeenCalledTimes(1)
    impl.onEvent('ev:note', { type: 'noteOn', note: 67, freq: 392, velocity: 0.6 })
    impl.dispose()
    expect(releaseAll).toHaveBeenCalledTimes(2)
  })
})
