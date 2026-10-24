/**
 * A three-second bell-like drone, synthesised on the spot.
 *
 * The node needs to make sound the moment it is dropped on the canvas, and
 * generating a buffer avoids shipping or fetching an audio asset. Inharmonic
 * partials plus slow detuning give granular synthesis something with evolving
 * spectral content to chew on, which a plain sine would not.
 */
export function createDefaultBuffer(ctx: BaseAudioContext): AudioBuffer {
  const duration = 3
  const rate = ctx.sampleRate
  const length = Math.floor(duration * rate)
  const buffer = ctx.createBuffer(2, length, rate)

  // Inharmonic ratios, the kind that make a struck bell rather than an organ.
  const partials = [1, 2.01, 2.76, 3.49, 4.21, 5.63, 7.12]
  const root = 138.6 // C#3

  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch)
    const detune = ch === 0 ? 1 : 1.004 // slight spread between channels

    for (let p = 0; p < partials.length; p++) {
      const freq = root * partials[p] * detune
      const amp = 0.5 / (p + 1.4)
      const decay = 2.4 / (1 + p * 0.45)
      // A slow wobble per partial keeps the tone from sitting perfectly still.
      const wobbleRate = 0.15 + p * 0.07
      const wobbleDepth = 0.4 + p * 0.25

      for (let i = 0; i < length; i++) {
        const t = i / rate
        const env = Math.exp(-t / decay)
        const phase = 2 * Math.PI * (freq * t + (wobbleDepth / wobbleRate) * Math.sin(2 * Math.PI * wobbleRate * t))
        data[i] += Math.sin(phase) * amp * env
      }
    }

    // Gentle fades so grabbing grains at the very edges is clean.
    const fade = Math.floor(rate * 0.02)
    for (let i = 0; i < fade; i++) {
      data[i] *= i / fade
      data[length - 1 - i] *= i / fade
    }
  }

  return buffer
}
