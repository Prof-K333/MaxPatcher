import * as Tone from 'tone'
import { NODE_DEFS } from './nodeDefs'
import { createNode } from './factory'
import type { NodeImpl } from './NodeImpl'
import type { ParamValues, PatchEvent } from './types'

/**
 * Owns the real audio graph and keeps it in step with the visual graph.
 *
 * The React side never touches Tone directly: it calls `sync()` with the
 * current nodes and edges, and the engine diffs that against what it already
 * built — creating, disposing, re-patching and re-tuning only what changed.
 *
 * Cables come in two kinds. Audio/param cables are wired through Web Audio.
 * Event cables ("ev:" handles) carry discrete note and bang messages as plain
 * JS calls, which is what lets one keyboard drive a polyphonic synth.
 */

interface EngineNode {
  id: string
  type: string
  impl: NodeImpl
  params: ParamValues
}

interface Patch {
  source: string
  sourceHandle: string
  target: string
  targetHandle: string
}

const edgeKey = (p: Patch) => `${p.source}:${p.sourceHandle}->${p.target}:${p.targetHandle}`
const isEventHandle = (handle: string) => handle.startsWith('ev:')

export class AudioEngine {
  private nodes = new Map<string, EngineNode>()
  private patches = new Map<string, Patch>()
  /** `${sourceId}:${handle}` → the inlets it feeds. */
  private eventRoutes = new Map<string, Array<{ target: string; handle: string }>>()
  private listeners = new Set<() => void>()

  /** Every node's output lands here before the hardware destination. */
  private master = new Tone.Volume(-6)
  private meter = new Tone.Meter({ normalRange: false, smoothing: 0.2 })

  running = false

  constructor() {
    this.master.connect(Tone.getDestination())
    this.master.connect(this.meter)
  }

  // ---------------------------------------------------------------- lifecycle

  subscribe(fn: () => void) {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private notify() {
    this.listeners.forEach((fn) => fn())
  }

  /** Resumes the AudioContext (requires a user gesture) and starts all sources. */
  async start() {
    await Tone.start()
    await Tone.getContext().resume()
    this.running = true
    Tone.getTransport().start()
    this.nodes.forEach((n) => n.impl.onStart())
    this.notify()
  }

  /** Suspends the context so the patch holds its state but makes no sound. */
  async stop() {
    this.running = false
    this.nodes.forEach((n) => n.impl.onStop())
    Tone.getTransport().pause()
    await (Tone.getContext().rawContext as unknown as AudioContext).suspend()
    this.notify()
  }

  async toggle() {
    return this.running ? this.stop() : this.start()
  }

  setMasterVolume(db: number) {
    this.master.volume.rampTo(db, 0.03)
  }

  /**
   * Post-master peak level in dB.
   *
   * Clamped to a sane floor: a silent meter drifts towards -Infinity, which is
   * useless to read and serialises as null.
   */
  getMasterLevel(): number {
    // A suspended context freezes the analyser, so the meter would otherwise
    // keep reporting the last level it saw and look like sound that will not
    // stop.
    if (!this.running) return -100
    const raw = this.meter.getValue()
    const db = Array.isArray(raw) ? raw[0] : raw
    return Number.isFinite(db) ? Math.max(-100, Math.min(10, db)) : -100
  }

  setTempo(bpm: number) {
    Tone.getTransport().bpm.rampTo(bpm, 0.1)
  }

  // -------------------------------------------------------------- event routing

  /** Outlets currently mid-dispatch, used to break event cycles. */
  private dispatching = new Set<string>()
  private cycleWarned = new Set<string>()

  /**
   * Delivers a message from an outlet to everything patched into it.
   *
   * Event cables are plain function calls, so a patch that loops back on
   * itself — a clock out feeding something that clocks the clock — would
   * recurse until the tab froze, with already-scheduled audio still playing
   * and no way to reach the stop button. An outlet already on the stack
   * therefore refuses to fire again for this pass: the cycle is broken at the
   * point it closes, and the rest of the patch carries on.
   */
  private dispatch(sourceId: string, handle: string, event: PatchEvent) {
    const key = `${sourceId}:${handle}`
    const routes = this.eventRoutes.get(key)
    if (!routes) return

    if (this.dispatching.has(key)) {
      if (!this.cycleWarned.has(key)) {
        this.cycleWarned.add(key)
        console.warn(`[audio] event feedback loop through ${key} — the repeat was dropped`)
      }
      return
    }

    this.dispatching.add(key)
    try {
      for (const route of routes) {
        try {
          this.nodes.get(route.target)?.impl.onEvent(route.handle, event)
        } catch (err) {
          // One misbehaving node must not stop the others receiving the event.
          console.error(`[audio] ${route.target} failed handling ${route.handle}`, err)
        }
      }
    } finally {
      this.dispatching.delete(key)
    }
  }

  /** Reports outlets where a feedback loop has been broken. */
  get loopingOutlets(): string[] {
    return [...this.cycleWarned]
  }

  /** Lets UI components (the docked keyboard, node widgets) inject events. */
  sendEvent(nodeId: string, handle: string, event: PatchEvent) {
    this.dispatch(nodeId, handle, event)
  }

  /** Delivers an event straight into one node, as its own UI would. */
  sendToNode(nodeId: string, handle: string, event: PatchEvent) {
    this.nodes.get(nodeId)?.impl.onEvent(handle, event)
  }

  getImpl(nodeId: string): NodeImpl | undefined {
    return this.nodes.get(nodeId)?.impl
  }

  // ------------------------------------------------------------ reconciliation

  private create(id: string, type: string): EngineNode {
    const impl = createNode(type, this.master)
    impl.emit = (handle, event) => this.dispatch(id, handle, event)
    return { id, type, impl, params: {} }
  }

  private applyParams(n: EngineNode, next: ParamValues) {
    for (const [key, value] of Object.entries(next)) {
      if (n.params[key] === value) continue
      if (n.type === 'destination' && key === 'volume') {
        this.setMasterVolume(Number(value))
        continue
      }
      // One bad param must never take the graph — or the React tree calling
      // us from an effect — down with it. An uncaught throw here unmounted
      // the whole app, which looked like "turning a knob stops the sound".
      try {
        n.impl.setParam(key, value)
      } catch (err) {
        console.error(`[audio] ${n.type}.${key} = ${String(value)} failed`, err)
      }
    }
    n.params = { ...next }
  }

  /**
   * Diffs the visual graph against the audio graph. Safe to call on every
   * render — unchanged nodes, params and cables are left completely untouched.
   */
  sync(
    flowNodes: Array<{ id: string; data: { type: string; params: ParamValues } }>,
    flowEdges: Array<{ source: string; sourceHandle?: string | null; target: string; targetHandle?: string | null }>,
  ) {
    const wanted = new Map(flowNodes.map((n) => [n.id, n.data.type]))

    // Drop nodes that disappeared, and nodes whose id was reused for a
    // different type — loading a patch can do that, and reusing the old
    // implementation would write params onto entirely the wrong kind of node.
    for (const [id, node] of this.nodes) {
      if (wanted.get(id) === node.type) continue
      for (const [key, patch] of this.patches) {
        if (patch.source === id || patch.target === id) {
          this.unpatch(patch)
          this.patches.delete(key)
        }
      }
      node.impl.dispose()
      this.nodes.delete(id)
    }

    for (const flowNode of flowNodes) {
      let node = this.nodes.get(flowNode.id)
      if (!node) {
        if (!Object.hasOwn(NODE_DEFS, flowNode.data.type)) continue
        try {
          node = this.create(flowNode.id, flowNode.data.type)
        } catch (err) {
          console.error(`[audio] could not build ${flowNode.data.type}`, err)
          continue
        }
        this.nodes.set(flowNode.id, node)
      }
      this.applyParams(node, flowNode.data.params)
      if (this.running) {
        try {
          node.impl.onStart()
        } catch (err) {
          console.error(`[audio] ${node.type} failed to start`, err)
        }
      }
    }

    const nextPatches = new Map<string, Patch>()
    for (const e of flowEdges) {
      const patch: Patch = {
        source: e.source,
        sourceHandle: e.sourceHandle ?? 'out',
        target: e.target,
        targetHandle: e.targetHandle ?? 'in',
      }
      nextPatches.set(edgeKey(patch), patch)
    }

    for (const [key, patch] of this.patches) {
      if (!nextPatches.has(key)) {
        this.unpatch(patch)
        this.patches.delete(key)
      }
    }
    for (const [key, patch] of nextPatches) {
      if (this.patches.has(key)) continue
      if (this.doPatch(patch)) this.patches.set(key, patch)
    }

    this.rebuildEventRoutes()
  }

  /** Event cables are an index, rebuilt whenever the cable set changes. */
  private rebuildEventRoutes() {
    this.eventRoutes.clear()
    this.cycleWarned.clear()
    for (const patch of this.patches.values()) {
      if (!isEventHandle(patch.sourceHandle)) continue
      const key = `${patch.source}:${patch.sourceHandle}`
      const list = this.eventRoutes.get(key) ?? []
      list.push({ target: patch.target, handle: patch.targetHandle })
      this.eventRoutes.set(key, list)
    }
  }

  private endpoints(patch: Patch) {
    const from = this.nodes.get(patch.source)
    const to = this.nodes.get(patch.target)
    if (!from || !to) return null
    const out = from.impl.audioOut(patch.sourceHandle)
    const dest = to.impl.audioIn(patch.targetHandle)
    return out && dest ? { out, dest } : null
  }

  /**
   * Outlets can carry several cables, so connection state is reference
   * counted — removing one of two cables must not report the outlet as free.
   */
  private outletRefs = new Map<string, number>()

  private noteOutlet(patch: Patch, delta: number) {
    const key = `${patch.source}:${patch.sourceHandle}`
    const before = this.outletRefs.get(key) ?? 0
    const after = Math.max(0, before + delta)
    if (after === 0) this.outletRefs.delete(key)
    else this.outletRefs.set(key, after)
    if ((before > 0) !== (after > 0)) {
      this.nodes.get(patch.source)?.impl.onOutletChange(patch.sourceHandle, after > 0)
    }
  }

  private doPatch(patch: Patch): boolean {
    // Event cables are pure bookkeeping; nothing is wired in Web Audio.
    if (isEventHandle(patch.sourceHandle) || isEventHandle(patch.targetHandle)) {
      this.nodes.get(patch.target)?.impl.onConnectionChange(patch.targetHandle, true)
      this.noteOutlet(patch, 1)
      return true
    }
    const ends = this.endpoints(patch)
    if (!ends) return false
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ends.out.connect(ends.dest as any)
      this.nodes.get(patch.target)?.impl.onConnectionChange(patch.targetHandle, true)
      this.noteOutlet(patch, 1)
      return true
    } catch {
      return false
    }
  }

  private unpatch(patch: Patch) {
    this.nodes.get(patch.target)?.impl.onConnectionChange(patch.targetHandle, false)
    this.noteOutlet(patch, -1)
    if (isEventHandle(patch.sourceHandle) || isEventHandle(patch.targetHandle)) return
    const ends = this.endpoints(patch)
    if (!ends) return
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ends.out.disconnect(ends.dest as any)
    } catch {
      /* already torn down */
    }
  }
}

export const engine = new AudioEngine()

if (import.meta.env.DEV) {
  // Handy for poking at the live graph from the console.
  ;(globalThis as unknown as { engine: AudioEngine }).engine = engine
}
