import type { PatchFile } from './format'

const slug = (name: string) =>
  name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'patch'

/** Offers the patch to the user as a .json download. */
export function downloadPatch(patch: PatchFile) {
  const blob = new Blob([JSON.stringify(patch, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${slug(patch.name)}.patcher.json`
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Revoked on the next tick so the click has definitely been handled.
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

export const readFileAsJSON = (file: File): Promise<unknown> =>
  file.text().then((text) => {
    try {
      return JSON.parse(text)
    } catch {
      throw new Error('That file is not valid JSON.')
    }
  })
