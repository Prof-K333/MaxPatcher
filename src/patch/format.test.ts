import { describe, expect, it } from 'vitest'
import { defaultParams } from '../audio/nodeDefs'
import { PATCH_VERSION, PatchParseError, deserialize, serialize } from './format'

const validPatch = {
  format: 'patcher',
  version: PATCH_VERSION,
  name: 'Bass Drone',
  savedAt: '2026-10-24T04:00:00.000Z',
  nodes: [
    {
      id: 'osc-1',
      type: 'oscillator',
      position: { x: 80, y: 40 },
      params: { frequency: 110 },
    },
    {
      id: 'master',
      type: 'destination',
      position: { x: 300, y: 40 },
      params: {},
    },
  ],
  edges: [
    {
      id: 'e1',
      source: 'osc-1',
      sourceHandle: 'out',
      target: 'master',
      targetHandle: 'in',
    },
  ],
}

describe('deserialize', () => {
  it('loads a valid patch, merging params onto defaults', () => {
    const result = deserialize(validPatch)
    expect(result.name).toBe('Bass Drone')
    expect(result.warnings).toEqual([])
    expect(result.nodes).toHaveLength(2)
    expect(result.nodes[0]).toMatchObject({
      id: 'osc-1',
      type: 'patch',
      position: { x: 80, y: 40 },
      data: { type: 'oscillator', params: { ...defaultParams('oscillator'), frequency: 110 } },
    })
    expect(result.edges).toEqual([
      { id: 'e1', source: 'osc-1', sourceHandle: 'out', target: 'master', targetHandle: 'in' },
    ])
  })

  it('rejects a non-object, a missing format, and a missing nodes array', () => {
    expect(() => deserialize(null)).toThrow(PatchParseError)
    expect(() => deserialize('nope')).toThrow(/not a patch object/)
    expect(() => deserialize({ version: 1, nodes: [] })).toThrow(/Not a Patcher file/)
    expect(() => deserialize({ format: 'patcher' })).toThrow(/no nodes array/)
  })

  it('rejects a future version', () => {
    expect(() => deserialize({ ...validPatch, version: PATCH_VERSION + 1 })).toThrow(
      new PatchParseError(
        `Patch version ${PATCH_VERSION + 1} is newer than this app understands (${PATCH_VERSION}).`,
      ),
    )
  })

  it('accepts an older or missing version number', () => {
    expect(deserialize({ ...validPatch, version: 0 }).nodes).toHaveLength(2)
    const { version: _version, ...rest } = validPatch
    expect(deserialize(rest).nodes).toHaveLength(2)
  })

  it('drops unknown types, duplicate ids, and nodes with no id, and throws if none remain', () => {
    const result = deserialize({
      ...validPatch,
      nodes: [
        { id: 'osc-1', type: 'oscillator', position: { x: 0, y: 0 }, params: {} },
        { id: 'osc-1', type: 'filter', position: { x: 1, y: 1 }, params: {} },
        { id: 'ghost', type: 'not-a-node', position: { x: 0, y: 0 }, params: {} },
        { type: 'oscillator', position: { x: 0, y: 0 }, params: {} },
        { id: '', type: 'oscillator', position: { x: 0, y: 0 }, params: {} },
        { id: 'master', type: 'destination', position: { x: 0, y: 0 }, params: {} },
      ],
    })
    expect(result.nodes.map((n) => n.id)).toEqual(['osc-1', 'master'])
    expect(result.warnings).toEqual([
      'Skipped a second node sharing the id "osc-1".',
      'Skipped "ghost": unknown node type "not-a-node".',
      'Skipped a node with no id.',
      'Skipped a node with no id.',
    ])

    expect(() =>
      deserialize({ format: 'patcher', version: 1, nodes: [{ id: 'x', type: 'nope' }] }),
    ).toThrow(/no usable nodes/)
  })

  it('does not treat Object.prototype names as real node types', () => {
    const result = deserialize({
      ...validPatch,
      nodes: [
        { id: 'proto', type: '__proto__', position: { x: 0, y: 0 }, params: {} },
        { id: 'ctor', type: 'constructor', position: { x: 0, y: 0 }, params: {} },
        { id: 'master', type: 'destination', position: { x: 0, y: 0 }, params: {} },
      ],
    })
    expect(result.nodes.map((n) => n.id)).toEqual(['master'])
    expect(result.warnings[0]).toMatch(/unknown node type "__proto__"/)
    expect(result.warnings[1]).toMatch(/unknown node type "constructor"/)
  })

  it('drops cables that point at missing nodes or ports, and treats a missing edges array as empty', () => {
    const result = deserialize({
      ...validPatch,
      edges: [
        { id: 'ok', source: 'osc-1', sourceHandle: 'out', target: 'master', targetHandle: 'in' },
        { id: 'missing-node', source: 'nope', sourceHandle: 'out', target: 'master', targetHandle: 'in' },
        { id: 'bad-port', source: 'osc-1', sourceHandle: 'ev:note', target: 'master', targetHandle: 'in' },
        { id: 'bad-target', source: 'osc-1', sourceHandle: 'out', target: 'master', targetHandle: 'ev:note' },
        { source: 1, target: 'master' },
      ],
    })
    expect(result.edges).toEqual([
      { id: 'ok', source: 'osc-1', sourceHandle: 'out', target: 'master', targetHandle: 'in' },
    ])
    expect(result.warnings).toEqual([
      'Dropped a cable nope → master: that connection no longer exists.',
      'Dropped a cable osc-1 → master: that connection no longer exists.',
      'Dropped a cable osc-1 → master: that connection no longer exists.',
    ])

    expect(deserialize({ ...validPatch, edges: undefined }).edges).toEqual([])
  })

  it('defaults missing handles, generates unique edge ids, and falls back for bad positions and names', () => {
    const result = deserialize({
      format: 'patcher',
      version: 1,
      nodes: [
        { id: 'osc-1', type: 'oscillator' },
        { id: 'master', type: 'destination', position: { x: 'nope', y: NaN } },
      ],
      edges: [
        { source: 'osc-1', target: 'master' },
        { id: 'e1', source: 'osc-1', sourceHandle: 'out', target: 'master', targetHandle: 'in' },
        { id: 'e1', source: 'osc-1', sourceHandle: 'out', target: 'master', targetHandle: 'in' },
      ],
    })
    expect(result.name).toBe('Untitled')
    expect(result.nodes[0].position).toEqual({ x: 0, y: 0 })
    expect(result.nodes[1].position).toEqual({ x: 0, y: 0 })
    expect(result.edges.map((e) => e.id)).toEqual(['osc-1-master-0', 'e1', 'e1-x'])
    expect(result.edges[0]).toMatchObject({ sourceHandle: 'out', targetHandle: 'in' })
  })

  it('clamps sliders, rejects unknown select options, coerces toggles, and truncates text', () => {
    const result = deserialize({
      format: 'patcher',
      version: 1,
      name: 'Params',
      nodes: [
        {
          id: 'osc-1',
          type: 'oscillator',
          params: { frequency: 1e9, type: 'triangle', extra: 1 },
        },
        {
          id: 'osc-2',
          type: 'oscillator',
          params: { frequency: 'nope', type: 'not-a-wave', volume: -120 },
        },
        {
          id: 'kbd-1',
          type: 'keyboard',
          params: { name: 'x'.repeat(40), hold: 0.7, focus: 0.2 },
        },
      ],
    })
    expect(result.nodes[0].data.params).toMatchObject({ frequency: 4000, type: 'triangle' })
    expect(result.nodes[0].data.params).not.toHaveProperty('extra')
    expect(result.nodes[1].data.params).toMatchObject({
      frequency: 220,
      type: 'sawtooth',
      volume: -60,
    })
    expect(result.nodes[2].data.params).toMatchObject({
      name: 'x'.repeat(20),
      hold: 1,
      focus: 0,
    })
  })

  it('round-trips through serialize', () => {
    const loaded = deserialize(validPatch)
    const again = deserialize(serialize(loaded.name, loaded.nodes, loaded.edges))
    expect(again.name).toBe(loaded.name)
    expect(again.nodes).toEqual(loaded.nodes)
    expect(again.edges).toEqual(loaded.edges)
    expect(again.warnings).toEqual([])
  })
})
