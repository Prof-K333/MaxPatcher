import { describe, expect, it, vi } from 'vitest'

const delay = {
  delayTime: { value: 0 },
  connect: vi.fn(),
  disconnect: vi.fn(),
}
const merger = {
  connect: vi.fn(),
  disconnect: vi.fn(),
}
const splitter = {
  connect: vi.fn(),
  disconnect: vi.fn(),
}
const createDelay = vi.fn(() => delay)
const createChannelMerger = vi.fn(() => merger)
const createChannelSplitter = vi.fn(() => splitter)

vi.mock('tone', () => {
  class Gain {
    input = {}
    connect = vi.fn()
    dispose = vi.fn()
    constructor(_value?: number) {}
  }
  return {
    Gain,
    getContext: () => ({
      rawContext: {
        createDelay,
        createChannelMerger,
        createChannelSplitter,
      },
      addAudioWorkletModule: async () => {
        throw new Error('no worklet in tests')
      },
      createAudioWorkletNode: () => {
        throw new Error('no worklet in tests')
      },
    }),
  }
})

import { LiveLooperImpl } from './LiveLooperImpl'

describe('LiveLooperImpl feedback delay', () => {
  it('puts a real DelayNode on the input path so a feedback cycle is legal', () => {
    const impl = new LiveLooperImpl()
    expect(createDelay).toHaveBeenCalledWith(0.5)
    expect(delay.delayTime.value).toBe(0.01)
    expect(merger.connect).toHaveBeenCalledWith(delay)
    impl.dispose()
    expect(delay.disconnect).toHaveBeenCalled()
  })
})
