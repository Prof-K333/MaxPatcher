/**
 * Onset detection for slice mode.
 *
 * Walks a short-term energy envelope and marks points where energy rises
 * sharply against its own recent average — the standard cheap onset detector.
 * Comparing against a local average rather than a fixed threshold is what lets
 * it find hits in both quiet and loud passages of the same file.
 */
export function detectTransients(buffer: AudioBuffer, maxSlices = 16): number[] {
  const data = buffer.getChannelData(0)
  const rate = buffer.sampleRate
  const hop = Math.floor(rate * 0.01) // 10ms frames
  const frames = Math.floor(data.length / hop)
  if (frames < 4) return [0]

  const energy = new Float32Array(frames)
  for (let f = 0; f < frames; f++) {
    let sum = 0
    for (let i = f * hop, end = Math.min(i + hop, data.length); i < end; i++) sum += data[i] * data[i]
    energy[f] = Math.sqrt(sum / hop)
  }

  // Rising edges only: the positive part of the frame-to-frame difference.
  const flux = new Float32Array(frames)
  for (let f = 1; f < frames; f++) flux[f] = Math.max(0, energy[f] - energy[f - 1])

  const window = 20
  const candidates: Array<{ frame: number; strength: number }> = []
  for (let f = 1; f < frames; f++) {
    let sum = 0
    let count = 0
    for (let k = Math.max(0, f - window); k < Math.min(frames, f + window); k++) {
      sum += flux[k]
      count++
    }
    const local = sum / Math.max(1, count)
    if (flux[f] > local * 1.8 && flux[f] > 0.004) candidates.push({ frame: f, strength: flux[f] })
  }

  // Keep the strongest, then enforce a minimum spacing so one hit does not
  // produce a burst of near-identical slice points.
  const minGap = Math.max(2, Math.floor(frames / (maxSlices * 3)))
  const chosen: number[] = []
  for (const c of candidates.sort((a, b) => b.strength - a.strength)) {
    if (chosen.length >= maxSlices) break
    if (chosen.every((f) => Math.abs(f - c.frame) >= minGap)) chosen.push(c.frame)
  }

  const positions = chosen.map((f) => (f * hop) / data.length).sort((a, b) => a - b)

  // Always start at zero, and fall back to an even split for material with no
  // clear transients at all (pads, drones) so slice mode is never empty.
  if (!positions.length || positions[0] > 0.01) positions.unshift(0)
  if (positions.length < 4) {
    const n = 8
    return Array.from({ length: n }, (_, i) => i / n)
  }
  return positions.slice(0, maxSlices)
}
