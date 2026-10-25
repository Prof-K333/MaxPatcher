/** Fader position (0..1) → dB breakpoints. Linear in dB between stops, so the throw is logarithmic in gain. */
const STOPS: Array<[pos: number, db: number]> = [
  [0, -90],
  [0.12, -50],
  [0.3, -25],
  [0.5, -10],
  [0.75, 0],
  [1, 6],
]

export const FADER_UNITY = 0.75

/** Fader position to dB; position 0 is -Infinity (true off). */
export function faderToDb(pos: number): number {
  const p = Math.min(1, Math.max(0, pos))
  if (p <= 0) return -Infinity
  for (let i = 1; i < STOPS.length; i++) {
    const [p1, d1] = STOPS[i]
    if (p <= p1) {
      const [p0, d0] = STOPS[i - 1]
      return d0 + ((p - p0) / (p1 - p0)) * (d1 - d0)
    }
  }
  return 6
}

export const dbToGain = (db: number) => (Number.isFinite(db) ? Math.pow(10, db / 20) : 0)

export const faderToGain = (pos: number) => dbToGain(faderToDb(pos))

/** Inverse of faderToDb, used to place tick marks. */
export function dbToFader(db: number): number {
  if (db <= STOPS[0][1]) return 0
  for (let i = 1; i < STOPS.length; i++) {
    const [p1, d1] = STOPS[i]
    if (db <= d1) {
      const [p0, d0] = STOPS[i - 1]
      return p0 + ((db - d0) / (d1 - d0)) * (p1 - p0)
    }
  }
  return 1
}

/** Linear amplitude to dBFS, floored so silence stays finite. */
export const ampToDb = (amp: number) => (amp > 1e-5 ? 20 * Math.log10(amp) : -100)
