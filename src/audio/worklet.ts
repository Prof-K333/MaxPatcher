import * as Tone from 'tone'

/** Per-context, per-module promises: adding a module twice is wasteful. */
const registry = new WeakMap<BaseAudioContext, Map<string, Promise<void>>>()

export const workletUrl = (file: string) => `${import.meta.env.BASE_URL ?? '/'}${file}`.replace('//', '/')

/**
 * Registers an AudioWorklet module once per context.
 *
 * Note for callers: the matching node must be built with Tone's
 * `context.createAudioWorkletNode(...)`. Tone wraps the AudioContext in
 * standardized-audio-context and the global `AudioWorkletNode` constructor
 * rejects that wrapper outright.
 */
export function ensureWorkletModule(context: Tone.Context, file: string): Promise<void> {
  const raw = context.rawContext as unknown as BaseAudioContext
  let byFile = registry.get(raw)
  if (!byFile) {
    byFile = new Map()
    registry.set(raw, byFile)
  }
  let pending = byFile.get(file)
  if (!pending) {
    pending = context.addAudioWorkletModule(workletUrl(file))
    byFile.set(file, pending)
  }
  return pending
}
