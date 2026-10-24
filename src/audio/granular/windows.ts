/**
 * Grain envelopes, precomputed once as gain curves.
 *
 * Every grain is a short slice cut out of a buffer, and cutting audio at a
 * non-zero sample is exactly how you get a click. Multiplying each grain by a
 * window that starts and ends at zero is what makes a grain cloud smooth, so
 * the window is not decoration — it is the whole trick.
 *
 * These are applied with `setValueCurveAtTime`, so the shaping happens on the
 * audio thread rather than in JS.
 */
export type WindowShape = 'hanning' | 'triangle' | 'cosine' | 'rectangular'

const POINTS = 256

const build = (shape: WindowShape): Float32Array => {
  const curve = new Float32Array(POINTS)
  for (let i = 0; i < POINTS; i++) {
    const t = i / (POINTS - 1)
    switch (shape) {
      case 'hanning':
        curve[i] = 0.5 * (1 - Math.cos(2 * Math.PI * t))
        break
      case 'triangle':
        curve[i] = 1 - Math.abs(2 * t - 1)
        break
      case 'cosine':
        curve[i] = Math.sin(Math.PI * t)
        break
      case 'rectangular':
        // Not truly rectangular: a 3% ramp at each end keeps the attack sharp
        // while still starting and ending at zero, which is what avoids clicks.
        curve[i] = t < 0.03 ? t / 0.03 : t > 0.97 ? (1 - t) / 0.03 : 1
        break
    }
  }
  return curve
}

const CACHE: Record<WindowShape, Float32Array> = {
  hanning: build('hanning'),
  triangle: build('triangle'),
  cosine: build('cosine'),
  rectangular: build('rectangular'),
}

export const windowCurve = (shape: WindowShape): Float32Array => CACHE[shape] ?? CACHE.hanning

export const WINDOW_SHAPES: WindowShape[] = ['hanning', 'triangle', 'cosine', 'rectangular']
