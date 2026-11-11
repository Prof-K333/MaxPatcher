import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NodeImpl, type AudioTarget } from './NodeImpl'
import type { ParamValues, PatchEvent } from './types'

const transport = {
  start: vi.fn(),
  pause: vi.fn(),
  bpm: { rampTo: vi.fn(), value: 120 },
}

vi.mock('tone', () => {
  class FakeAudio {
    volume = { rampTo: vi.fn() }
    connect() {
      return this
    }
    dispose() {}
    getValue() {
      return -Infinity
    }
  }
  return {
    Volume: class extends FakeAudio {},
    Meter: class extends FakeAudio {},
    getDestination: () => new FakeAudio(),
    getContext: () => ({
      resume: async () => {},
      rawContext: { suspend: async () => {} },
    }),
    getTransport: () => transport,
    start: async () => {},
  }
})

class FakeImpl extends NodeImpl {
  starts = 0
  stops = 0
  disposed = false
  params: ParamValues = {}
  type: string
  readonly audio = {
    connect: vi.fn(),
    disconnect: vi.fn(),
  }

  constructor(type: string) {
    super()
    this.type = type
  }

  audioOut(_handle?: string) {
    return this.audio as unknown as AudioTarget
  }

  audioIn(_handle?: string) {
    return this.audio as unknown as AudioTarget
  }

  setParam(key: string, value: number | string) {
    this.params[key] = value
  }

  onStart() {
    this.starts += 1
  }

  onStop() {
    this.stops += 1
  }

  dispose() {
    this.disposed = true
  }
}

const created: FakeImpl[] = []

vi.mock('./factory', () => ({
  createNode: (type: string) => {
    const impl = new FakeImpl(type)
    created.push(impl)
    return impl
  },
}))

import { AudioEngine } from './AudioEngine'

const node = (id: string, type: string, params: ParamValues = {}) => ({
  id,
  data: { type, params },
})

const edge = (source: string, sourceHandle: string, target: string, targetHandle: string) => ({
  source,
  sourceHandle,
  target,
  targetHandle,
})

describe('AudioEngine.sync', () => {
  let engine: AudioEngine

  beforeEach(() => {
    created.length = 0
    engine = new AudioEngine()
  })

  it('creates impls for known types and skips unknown ones', () => {
    engine.sync([node('osc-1', 'oscillator', { frequency: 110 }), node('ghost', 'not-a-node')], [])
    expect(created).toHaveLength(1)
    expect(created[0].type).toBe('oscillator')
    expect(created[0].params.frequency).toBe(110)
    expect(engine.getImpl('osc-1')).toBe(created[0])
    expect(engine.getImpl('ghost')).toBeUndefined()
  })

  it('disposes a node that disappeared, and leaves a still-present node alone', () => {
    engine.sync([node('osc-1', 'oscillator'), node('filt-1', 'filter')], [])
    const [osc, filt] = created
    engine.sync([node('filt-1', 'filter')], [])
    expect(osc.disposed).toBe(true)
    expect(filt.disposed).toBe(false)
    expect(engine.getImpl('osc-1')).toBeUndefined()
    expect(engine.getImpl('filt-1')).toBe(filt)
  })

  it('disposes and rebuilds when an id is reused for a different type', () => {
    engine.sync([node('n1', 'oscillator')], [])
    const first = created[0]
    engine.sync([node('n1', 'filter', { frequency: 800 })], [])
    expect(first.disposed).toBe(true)
    expect(created).toHaveLength(2)
    expect(created[1].type).toBe('filter')
    expect(created[1].params.frequency).toBe(800)
    expect(created[1].disposed).toBe(false)
    expect(engine.getImpl('n1')).toBe(created[1])
  })

  it('reuses the same impl when an id stays the same type (a node move / param tweak)', () => {
    engine.sync([node('loop-1', 'looper', { bars: 2 })], [])
    engine.sync([node('loop-1', 'looper', { bars: 4 })], [])
    expect(created).toHaveLength(1)
    expect(created[0].disposed).toBe(false)
    expect(created[0].params.bars).toBe(4)
  })

  it('does not call onStart while the engine is stopped, then starts everyone from start()', async () => {
    engine.sync([node('loop-1', 'looper'), node('osc-1', 'oscillator')], [])
    expect(created[0].starts).toBe(0)
    expect(created[1].starts).toBe(0)
    await engine.start()
    expect(created[0].starts).toBe(1)
    expect(created[1].starts).toBe(1)
  })

  it('calls onStart only for a newly created node while running, not for existing ones', async () => {
    engine.sync([node('loop-1', 'looper')], [])
    await engine.start()
    const looper = created[0]
    expect(looper.starts).toBe(1)

    // Same graph again — what App.tsx does when a node is dragged.
    engine.sync([node('loop-1', 'looper')], [])
    expect(looper.starts).toBe(1)
    expect(created).toHaveLength(1)

    engine.sync([node('loop-1', 'looper'), node('osc-1', 'oscillator')], [])
    expect(looper.starts).toBe(1)
    expect(created[1].starts).toBe(1)

    engine.sync([node('loop-1', 'looper'), node('osc-1', 'oscillator')], [])
    expect(looper.starts).toBe(1)
    expect(created[1].starts).toBe(1)
  })

  it('does not reschedule a live Phrase Looper when the graph is synced after a move', async () => {
    engine.sync([node('loop-1', 'looper')], [])
    const looper = created[0]
    // Mirror LooperImpl: onStart always reschedules Transport slots.
    let reschedules = 0
    const realOnStart = looper.onStart.bind(looper)
    looper.onStart = () => {
      realOnStart()
      reschedules += 1
    }

    await engine.start()
    expect(reschedules).toBe(1)
    engine.sync([node('loop-1', 'looper')], [])
    expect(reschedules).toBe(1)
    expect(looper.starts).toBe(1)
  })

  it('calls onStop from stop(), and a later start() starts existing nodes again', async () => {
    engine.sync([node('osc-1', 'oscillator')], [])
    await engine.start()
    await engine.stop()
    expect(created[0].stops).toBe(1)
    await engine.start()
    expect(created[0].starts).toBe(2)
  })

  it('patches event cables so sendEvent reaches the target', () => {
    engine.sync(
      [node('kbd-1', 'keyboard'), node('loop-1', 'looper')],
      [edge('kbd-1', 'ev:note', 'loop-1', 'ev:in')],
    )
    const received: PatchEvent[] = []
    const looper = created[1]
    looper.onEvent = (_handle, event) => {
      received.push(event)
    }
    engine.sendEvent('kbd-1', 'ev:note', { type: 'noteOn', note: 60, freq: 261.63, velocity: 0.8 })
    expect(received).toEqual([{ type: 'noteOn', note: 60, freq: 261.63, velocity: 0.8 }])
  })

  it('swallows a throwing setParam so one bad write cannot break the graph', () => {
    engine.sync([node('osc-1', 'oscillator', { frequency: 110 })], [])
    created[0].setParam = () => {
      throw new Error('cannot set value of an overridden param')
    }
    expect(() => engine.sync([node('osc-1', 'oscillator', { frequency: 880 })], [])).not.toThrow()
    expect(engine.getImpl('osc-1')).toBe(created[0])
    expect(created).toHaveLength(1)
  })
})
