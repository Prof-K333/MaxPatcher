import type { PatchFile } from './format'

const AUTOSAVE_KEY = 'patcher:autosave'
const SLOTS_KEY = 'patcher:patches'

/**
 * localStorage is best-effort: it throws in private windows and when the quota
 * is full, and a patcher should never lose its audio graph over a failed save.
 */
const readJSON = <T>(key: string): T | null => {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

const writeJSON = (key: string, value: unknown): boolean => {
  try {
    localStorage.setItem(key, JSON.stringify(value))
    return true
  } catch {
    return false
  }
}

export const loadAutosave = (): PatchFile | null => readJSON<PatchFile>(AUTOSAVE_KEY)
export const saveAutosave = (patch: PatchFile): boolean => writeJSON(AUTOSAVE_KEY, patch)

export type SlotMap = Record<string, PatchFile>

export const loadSlots = (): SlotMap => readJSON<SlotMap>(SLOTS_KEY) ?? {}

export interface SavedSlot {
  name: string
  savedAt: string
}

/** Named slots, most recently saved first. */
export const listSlots = (): SavedSlot[] =>
  Object.values(loadSlots())
    .map((p) => ({ name: p.name, savedAt: p.savedAt }))
    .sort((a, b) => b.savedAt.localeCompare(a.savedAt))

export const saveSlot = (patch: PatchFile): boolean => {
  const slots = loadSlots()
  slots[patch.name] = patch
  return writeJSON(SLOTS_KEY, slots)
}

export const readSlot = (name: string): PatchFile | null => loadSlots()[name] ?? null

export const deleteSlot = (name: string): boolean => {
  const slots = loadSlots()
  delete slots[name]
  return writeJSON(SLOTS_KEY, slots)
}
