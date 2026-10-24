import type { Edge, Node } from '@xyflow/react'
import { NODE_DEFS, defaultParams } from '../audio/nodeDefs'
import type { ParamValues, PatchNodeData } from '../audio/types'

export const PATCH_VERSION = 1

export interface SerializedNode {
  id: string
  type: string
  position: { x: number; y: number }
  params: ParamValues
}

export interface SerializedEdge {
  id: string
  source: string
  sourceHandle: string
  target: string
  targetHandle: string
}

export interface PatchFile {
  format: 'patcher'
  version: number
  name: string
  savedAt: string
  nodes: SerializedNode[]
  edges: SerializedEdge[]
}

type PNode = Node<PatchNodeData>

export const serialize = (name: string, nodes: PNode[], edges: Edge[]): PatchFile => ({
  format: 'patcher',
  version: PATCH_VERSION,
  name,
  savedAt: new Date().toISOString(),
  nodes: nodes.map((n) => ({
    id: n.id,
    type: n.data.type,
    position: { x: Math.round(n.position.x), y: Math.round(n.position.y) },
    params: { ...n.data.params },
  })),
  edges: edges.map((e) => ({
    id: e.id,
    source: e.source,
    sourceHandle: e.sourceHandle ?? 'out',
    target: e.target,
    targetHandle: e.targetHandle ?? 'in',
  })),
})

/**
 * Coerces one node's params against its registry entry: unknown keys are
 * dropped, sliders are clamped to their range and selects must name a real
 * option. Anything missing or unusable falls back to the default.
 */
const sanitizeParams = (type: string, raw: unknown): ParamValues => {
  const source = (raw ?? {}) as Record<string, unknown>
  const out = defaultParams(type)

  for (const spec of NODE_DEFS[type].params) {
    const value = source[spec.key]
    if (value === undefined) continue

    if (spec.control === 'text') {
      if (typeof value === 'string') out[spec.key] = value.slice(0, spec.maxLength ?? 24)
    } else if (spec.control === 'select') {
      if (typeof value === 'string' && spec.options.includes(value)) out[spec.key] = value
    } else if (spec.control === 'toggle') {
      const n = Number(value)
      if (Number.isFinite(n)) out[spec.key] = n >= 0.5 ? 1 : 0
    } else {
      const n = Number(value)
      if (Number.isFinite(n)) out[spec.key] = Math.min(spec.max, Math.max(spec.min, n))
    }
  }
  return out
}

const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

export class PatchParseError extends Error {}

/**
 * Turns untrusted JSON into a graph that is safe to hand to the engine.
 *
 * Nodes of unknown types, edges pointing at missing nodes or non-existent
 * ports, and duplicate ids are all discarded rather than being allowed to
 * reach Tone.js, where they would throw.
 */
export function deserialize(input: unknown): { name: string; nodes: PNode[]; edges: Edge[]; warnings: string[] } {
  if (typeof input !== 'object' || input === null) throw new PatchParseError('File is not a patch object.')

  const file = input as Partial<PatchFile>
  if (file.format !== 'patcher') throw new PatchParseError('Not a Patcher file (missing "format": "patcher").')
  if (!Array.isArray(file.nodes)) throw new PatchParseError('Patch has no nodes array.')
  if (typeof file.version === 'number' && file.version > PATCH_VERSION) {
    throw new PatchParseError(`Patch version ${file.version} is newer than this app understands (${PATCH_VERSION}).`)
  }

  const warnings: string[] = []
  const nodes: PNode[] = []
  const seen = new Set<string>()

  for (const raw of file.nodes as unknown[]) {
    const n = raw as Partial<SerializedNode>
    if (typeof n.id !== 'string' || !n.id) {
      warnings.push('Skipped a node with no id.')
      continue
    }
    // Object.hasOwn, not a truthiness check: "__proto__" and "constructor"
    // would otherwise resolve against Object.prototype and look like real types.
    if (typeof n.type !== 'string' || !Object.hasOwn(NODE_DEFS, n.type)) {
      warnings.push(`Skipped "${n.id}": unknown node type "${String(n.type)}".`)
      continue
    }
    if (seen.has(n.id)) {
      warnings.push(`Skipped a second node sharing the id "${n.id}".`)
      continue
    }
    seen.add(n.id)

    const pos = n.position
    nodes.push({
      id: n.id,
      type: 'patch',
      position: {
        x: isFiniteNumber(pos?.x) ? pos.x : 0,
        y: isFiniteNumber(pos?.y) ? pos.y : 0,
      },
      data: { type: n.type, params: sanitizeParams(n.type, n.params) },
    })
  }

  if (!nodes.length) throw new PatchParseError('Patch contains no usable nodes.')

  const byId = new Map(nodes.map((n) => [n.id, n]))
  const hasPort = (id: string, handle: string, side: 'inputs' | 'outputs') => {
    const node = byId.get(id)
    return !!node && NODE_DEFS[node.data.type][side].some((p) => p.id === handle)
  }


  const edges: Edge[] = []
  const edgeIds = new Set<string>()

  for (const raw of (Array.isArray(file.edges) ? file.edges : []) as unknown[]) {
    const e = raw as Partial<SerializedEdge>
    if (typeof e.source !== 'string' || typeof e.target !== 'string') continue

    const sourceHandle = typeof e.sourceHandle === 'string' ? e.sourceHandle : 'out'
    const targetHandle = typeof e.targetHandle === 'string' ? e.targetHandle : 'in'

    if (!hasPort(e.source, sourceHandle, 'outputs') || !hasPort(e.target, targetHandle, 'inputs')) {
      warnings.push(`Dropped a cable ${e.source} → ${e.target}: that connection no longer exists.`)
      continue
    }

    let id = typeof e.id === 'string' && e.id ? e.id : `${e.source}-${e.target}-${edges.length}`
    while (edgeIds.has(id)) id = `${id}-x`
    edgeIds.add(id)

    edges.push({ id, source: e.source, sourceHandle, target: e.target, targetHandle })
  }

  return { name: typeof file.name === 'string' ? file.name : 'Untitled', nodes, edges, warnings }
}
