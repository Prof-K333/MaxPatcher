import * as Tone from 'tone'
import type { PatchEvent } from './types'

export type AudioTarget = Tone.ToneAudioNode | Tone.Param | Tone.Signal

/** How a node sends events back out of its own outlets. */
export type Emit = (handle: string, event: PatchEvent) => void

/**
 * One node in the audio graph.
 *
 * Simple Tone wrappers and elaborate custom nodes (the granular cloud, the
 * sampler, the looper) all present this same face to the engine, so the
 * engine's reconciler never needs to know which it is dealing with.
 */
export abstract class NodeImpl {
  /** Set by the engine before any event is delivered. */
  emit: Emit = () => {}

  /** The Tone object an outgoing cable should leave from. */
  abstract audioOut(handle: string): Tone.ToneAudioNode | null

  /** The Tone object or Param an incoming cable should arrive at. */
  abstract audioIn(handle: string): AudioTarget | null

  /** Applies one changed param from the node's UI. */
  setParam(_key: string, _value: number | string): void {}

  /** Receives a message on an event inlet. */
  onEvent(_handle: string, _event: PatchEvent): void {}

  /** Called when an event/CV inlet gains or loses a connection. */
  onConnectionChange(_handle: string, _connected: boolean): void {}

  /**
   * Called when one of this node's *outlets* gains or loses a cable.
   * Needed for normalling, where patching an individual output has to change
   * what the node sends to its own mix.
   */
  onOutletChange(_handle: string, _connected: boolean): void {}

  /** AudioContext resumed — start any free-running sources or schedulers. */
  onStart(): void {}

  /** AudioContext suspended — stop schedulers so nothing runs in the dark. */
  onStop(): void {}

  dispose(): void {}
}

/**
 * The generic wrapper for plain Tone nodes: oscillators, filters, delays and
 * friends, whose params and ports map straight onto Tone properties.
 */
export class ToneNodeImpl extends NodeImpl {
  private started = false
  /**
   * While a cable drives a param, Tone marks it `overridden` and zeroes its
   * intrinsic value — writing to it then throws. So the knob's value re-enters
   * as its own signal summed into the same param, which also gives the real
   * modular behaviour: the knob offsets the incoming CV instead of going dead.
   */
  private baseSignals = new Map<string, Tone.Signal>()
  /** Attenuverter per cabled param: incoming CV passes through this. */
  private depthGains = new Map<string, Tone.Gain>()
  private depths = new Map<string, number>()
  private cableCounts = new Map<string, number>()
  private lastValues = new Map<string, number>()

  readonly tone: Tone.ToneAudioNode
  private readonly source?: { start: (t?: number) => unknown; stop: (t?: number) => unknown }
  private readonly onSetParam?: (key: string, value: number | string) => boolean

  constructor(
    tone: Tone.ToneAudioNode,
    source?: { start: (t?: number) => unknown; stop: (t?: number) => unknown },
    onSetParam?: (key: string, value: number | string) => boolean,
  ) {
    super()
    this.tone = tone
    this.source = source
    this.onSetParam = onSetParam
  }

  audioOut(): Tone.ToneAudioNode {
    return this.tone
  }

  /**
   * A cable into a param lands on that param's depth gain, never on the param
   * itself. The param then sums two things: the knob's base signal, and the
   * incoming CV scaled by depth — so the knob sets where the modulation sits
   * and depth sets how far it swings, the way an attenuverter works.
   */
  audioIn(handle: string): AudioTarget | null {
    if (!handle.startsWith('param:')) return this.tone
    const key = handle.slice('param:'.length)
    const field = this.field(key)
    if (!field) return null

    let depth = this.depthGains.get(key)
    if (!depth) {
      depth = new Tone.Gain(this.depths.get(key) ?? 1)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      depth.connect(field as any)
      this.depthGains.set(key, depth)
    }
    return depth
  }

  private field(key: string): Tone.Param | Tone.Signal | null {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const f = (this.tone as any)[key]
    return f instanceof Tone.Param || f instanceof Tone.Signal ? f : null
  }

  onConnectionChange(handle: string, connected: boolean) {
    if (!handle.startsWith('param:')) return
    const key = handle.slice('param:'.length)
    const field = this.field(key)
    if (!field) return

    const count = Math.max(0, (this.cableCounts.get(key) ?? 0) + (connected ? 1 : -1))
    this.cableCounts.set(key, count)

    if (count > 0 && !this.baseSignals.has(key)) {
      const base = new Tone.Signal(this.lastValues.get(key) ?? 0)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      base.connect(field as any)
      this.baseSignals.set(key, base)
      return
    }

    if (count === 0) {
      const base = this.baseSignals.get(key)
      if (base) {
        base.dispose()
        this.baseSignals.delete(key)
      }
      const depth = this.depthGains.get(key)
      if (depth) {
        depth.dispose()
        this.depthGains.delete(key)
      }
      // Hand the param back to its knob.
      field.overridden = false
      const last = this.lastValues.get(key)
      if (last !== undefined) {
        try {
          field.value = last
        } catch {
          /* param rejected the value; the knob will set it again */
        }
      }
    }
  }

  setParam(key: string, value: number | string) {
    if (this.onSetParam?.(key, value)) return

    // Modulation depth for a cabled inlet, not a property of the Tone node.
    if (key.startsWith('mod_')) {
      const target = key.slice('mod_'.length)
      const amount = Number(value)
      this.depths.set(target, amount)
      this.depthGains.get(target)?.gain.rampTo(amount, 0.02)
      return
    }

    if (typeof value !== 'string') this.lastValues.set(key, Number(value))

    // A cabled param is driven by its base signal, not written directly.
    const base = this.baseSignals.get(key)
    if (base) {
      base.rampTo(Number(value), 0.02)
      return
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const target = this.tone as any
    const field = target[key]

    if (field instanceof Tone.Param || field instanceof Tone.Signal) {
      try {
        field.rampTo(Number(value), 0.02)
      } catch {
        // An overridden param (one a cable took over) rejects writes. Leave
        // the cable in charge rather than letting the exception escape.
      }
    } else if (typeof value === 'string') {
      target[key] = value
    } else {
      target[key] = Number(value)
    }
  }

  onStart() {
    if (this.source && !this.started) {
      this.source.start()
      this.started = true
    }
  }

  onStop() {
    if (this.source && this.started) {
      this.source.stop()
      this.started = false
    }
  }

  dispose() {
    this.baseSignals.forEach((s) => s.dispose())
    this.baseSignals.clear()
    this.depthGains.forEach((g) => g.dispose())
    this.depthGains.clear()
    this.tone.dispose()
  }
}
