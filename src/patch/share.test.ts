import { describe, expect, it } from 'vitest'
import { PATCH_VERSION, deserialize, serialize } from './format'
import {
  MAX_SHARE_CHARS,
  SHARE_PREFIX,
  ShareError,
  decodeShare,
  encodeShare,
  readShareHash,
  shareUrl,
} from './share'

const patch = {
  format: 'patcher' as const,
  version: PATCH_VERSION,
  name: 'Bass Drone',
  savedAt: '2026-10-24T04:00:00.000Z',
  nodes: [
    { id: 'osc-1', type: 'oscillator', position: { x: 80, y: 40 }, params: { frequency: 110 } },
    { id: 'master', type: 'destination', position: { x: 300, y: 40 }, params: {} },
  ],
  edges: [
    { id: 'e1', source: 'osc-1', sourceHandle: 'out', target: 'master', targetHandle: 'in' },
  ],
}

describe('share URLs', () => {
  it('round-trips a patch through encode, decode, and deserialize', () => {
    const payload = encodeShare(patch)
    expect(payload).toMatch(/^[A-Za-z0-9_-]+$/)
    const loaded = deserialize(decodeShare(payload))
    const original = deserialize(patch)
    expect(loaded.name).toBe(original.name)
    expect(loaded.nodes).toEqual(original.nodes)
    expect(loaded.edges).toEqual(original.edges)
    expect(loaded.warnings).toEqual([])
  })

  it('builds a hash URL and readShareHash pulls the payload back out', () => {
    const url = shareUrl(patch, { origin: 'https://example.com', pathname: '/MaxPatcher/', search: '' })
    expect(url.startsWith('https://example.com/MaxPatcher/#p=')).toBe(true)
    const payload = readShareHash(new URL(url).hash)
    expect(payload).toBe(encodeShare(patch))
    expect(deserialize(decodeShare(payload!)).name).toBe('Bass Drone')
  })

  it('ignores a URL with no share hash', () => {
    expect(readShareHash('')).toBeNull()
    expect(readShareHash('#')).toBeNull()
    expect(readShareHash('#something-else')).toBeNull()
    expect(readShareHash(SHARE_PREFIX)).toBeNull()
  })

  it('rejects an invalid or oversized payload without throwing an unexpected type', () => {
    expect(() => decodeShare('not-valid-base64***')).toThrow(ShareError)
    expect(() => decodeShare('aaaa')).toThrow(/could not be read/)
    expect(() => decodeShare('x'.repeat(MAX_SHARE_CHARS + 1))).toThrow(/too large/)
  })

  it('serialize output is also a valid share payload', () => {
    const loaded = deserialize(patch)
    const file = serialize(loaded.name, loaded.nodes, loaded.edges)
    const again = deserialize(decodeShare(encodeShare(file)))
    expect(again.nodes).toEqual(loaded.nodes)
    expect(again.edges).toEqual(loaded.edges)
  })
})
