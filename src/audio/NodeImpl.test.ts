import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('tone', () => {
  class Signal {
    value: number
    overridden = false
    connectedTo: unknown[] = []
    constructor(value = 0) {
      this.value = value
    }
    connect(target: unknown) {
      this.connectedTo.push(target)
      return this
    }
    dispose() {}
    rampTo(value: number) {
      if (this.overridden) throw new Error('cannot set value of an overridden param')
      this.value = value
    }
  }

  class Param extends Signal {}

  class Gain {
    gain: Signal
    connectedTo: unknown[] = []
    constructor(value = 1) {
      this.gain = new Signal(value)
    }
    connect(target: unknown) {
      this.connectedTo.push(target)
      return this
    }
    dispose() {}
  }

  return { Signal, Param, Gain }
})

import { ToneNodeImpl } from './NodeImpl'
import * as Tone from 'tone'

type FakeSignal = InstanceType<typeof Tone.Signal> & { overridden: boolean; value: number }

describe('ToneNodeImpl param-cable guard', () => {
  let frequency: FakeSignal
  let impl: ToneNodeImpl

  beforeEach(() => {
    frequency = new Tone.Signal(220) as FakeSignal
    const tone = { frequency, dispose() {} }
    impl = new ToneNodeImpl(tone as never)
    impl.setParam('frequency', 220)
  })

  it('writes the knob directly when the param is not cabled', () => {
    impl.setParam('frequency', 440)
    expect(frequency.value).toBe(440)
  })

  it('does not throw when the knob moves on a cabled param, and leaves the cable in charge', () => {
    frequency.overridden = true
    frequency.rampTo = () => {
      throw new Error('cannot set value of an overridden param')
    }
    impl.onConnectionChange('param:frequency', true)
    expect(() => impl.setParam('frequency', 880)).not.toThrow()
    expect(frequency.value).toBe(220)
  })

  it('still does not throw if a write slips through to an overridden param', () => {
    frequency.overridden = true
    frequency.rampTo = () => {
      throw new Error('cannot set value of an overridden param')
    }
    expect(() => impl.setParam('frequency', 660)).not.toThrow()
  })
})
