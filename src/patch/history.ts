import type { Edge, Node } from '@xyflow/react'
import type { ParamValues, PatchNodeData } from '../audio/types'

/** The part of a patch that undo/redo cares about. Selection and drag state are ignored. */
export interface PatchSnapshot {
  name: string
  nodes: Array<{
    id: string
    type: string
    position: { x: number; y: number }
    data: { type: string; params: ParamValues }
  }>
  edges: Array<{
    id: string
    source: string
    sourceHandle?: string | null
    target: string
    targetHandle?: string | null
  }>
}

type PNode = Node<PatchNodeData>

export function toSnapshot(name: string, nodes: PNode[], edges: Edge[]): PatchSnapshot {
  return {
    name,
    nodes: nodes.map((n) => ({
      id: n.id,
      type: n.type ?? 'patch',
      position: { x: n.position.x, y: n.position.y },
      data: { type: n.data.type, params: { ...n.data.params } },
    })),
    edges: edges.map((e) => ({
      id: e.id,
      source: e.source,
      sourceHandle: e.sourceHandle ?? 'out',
      target: e.target,
      targetHandle: e.targetHandle ?? 'in',
    })),
  }
}

export const snapshotsEqual = (a: PatchSnapshot, b: PatchSnapshot): boolean =>
  JSON.stringify(a) === JSON.stringify(b)

const LIMIT = 80

/**
 * A linear snapshot stack.
 *
 * `current` is the last *committed* state. Mid-gesture updates (a slider still
 * being dragged, a node still being moved) should not call `commit` until the
 * gesture ends, so one undo step covers the whole move.
 */
export class PatchHistory {
  private past: PatchSnapshot[] = []
  private future: PatchSnapshot[] = []
  current: PatchSnapshot

  constructor(initial: PatchSnapshot) {
    this.current = initial
  }

  get canUndo(): boolean {
    return this.past.length > 0
  }

  get canRedo(): boolean {
    return this.future.length > 0
  }

  /** Records `next` if it differs from the last committed snapshot. */
  commit(next: PatchSnapshot): boolean {
    if (snapshotsEqual(this.current, next)) return false
    this.past.push(this.current)
    if (this.past.length > LIMIT) this.past.shift()
    this.current = next
    this.future = []
    return true
  }

  /**
   * Steps back. If `present` has uncommitted changes (a gesture still open),
   * those are discarded and the last committed snapshot is returned.
   */
  undo(present: PatchSnapshot): PatchSnapshot | null {
    if (!snapshotsEqual(present, this.current)) {
      this.future = []
      return this.current
    }
    if (!this.past.length) return null
    this.future.push(this.current)
    const prev = this.past.pop()!
    this.current = prev
    return prev
  }

  redo(_present: PatchSnapshot): PatchSnapshot | null {
    if (!this.future.length) return null
    // Uncommitted work is dropped; redo starts from the last committed state.
    const next = this.future.pop()!
    this.past.push(this.current)
    this.current = next
    return next
  }
}
