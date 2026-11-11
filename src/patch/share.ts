import { strFromU8, strToU8, unzlibSync, zlibSync } from 'fflate'
import type { PatchFile } from './format'

/** Hash prefix for a compressed patch. Everything after `#p=` is the payload. */
export const SHARE_PREFIX = 'p='

/** Refuse to decode a hash longer than this, so a huge URL cannot lock the tab. */
export const MAX_SHARE_CHARS = 800_000

export class ShareError extends Error {}

const toBase64Url = (data: Uint8Array): string => {
  let bin = ''
  const chunk = 0x8000
  for (let i = 0; i < data.length; i += chunk) {
    bin += String.fromCharCode(...data.subarray(i, i + chunk))
  }
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

const fromBase64Url = (text: string): Uint8Array => {
  const padded = text + '='.repeat((4 - (text.length % 4)) % 4)
  const bin = atob(padded.replace(/-/g, '+').replace(/_/g, '/'))
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/** Compresses a patch file into a URL-safe string. */
export function encodeShare(patch: PatchFile): string {
  const compressed = zlibSync(strToU8(JSON.stringify(patch)), { level: 9 })
  return toBase64Url(compressed)
}

/** Inflates a share payload into raw JSON, which still has to go through deserialize(). */
export function decodeShare(payload: string): unknown {
  if (!payload) throw new ShareError('Shared patch is empty.')
  if (payload.length > MAX_SHARE_CHARS) throw new ShareError('Shared patch is too large to load.')
  try {
    const json = strFromU8(unzlibSync(fromBase64Url(payload)))
    return JSON.parse(json)
  } catch (err) {
    if (err instanceof ShareError) throw err
    throw new ShareError('Shared patch could not be read.')
  }
}

/** Builds a same-origin link whose hash carries the compressed patch. */
export function shareUrl(patch: PatchFile, loc: Pick<Location, 'origin' | 'pathname' | 'search'>): string {
  return `${loc.origin}${loc.pathname}${loc.search}#${SHARE_PREFIX}${encodeShare(patch)}`
}

/**
 * Pulls a share payload out of `window.location.hash`.
 * Returns null when the URL is not a share link.
 */
export function readShareHash(hash: string): string | null {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash
  if (!raw.startsWith(SHARE_PREFIX)) return null
  const payload = raw.slice(SHARE_PREFIX.length)
  return payload || null
}
