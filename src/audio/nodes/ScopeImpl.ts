import * as Tone from 'tone'
import { NodeImpl, type AudioTarget } from '../NodeImpl'

const WAVE_SIZE = 512
const FFT_SIZE = 256

const silentWave = new Float32Array(WAVE_SIZE)
const silentFft = new Float32Array(FFT_SIZE)

/**
 * Visual analyser. Audio passes through so the scope can sit in a chain,
 * and a quiet trace is returned if the engine is stopped or the analyser
 * throws — a dead canvas is better than an unmounted tree.
 */
export class ScopeImpl extends NodeImpl {
  private input = new Tone.Gain(1)
  private wave = new Tone.Analyser('waveform', WAVE_SIZE)
  private fft = new Tone.Analyser('fft', FFT_SIZE)

  constructor() {
    super()
    this.input.connect(this.wave)
    this.input.connect(this.fft)
  }

  audioOut(): Tone.ToneAudioNode {
    return this.input
  }

  audioIn(): AudioTarget | null {
    return this.input
  }

  getWaveform(): Float32Array {
    try {
      const value = this.wave.getValue()
      return (Array.isArray(value) ? value[0] : value) as Float32Array
    } catch {
      return silentWave
    }
  }

  getSpectrum(): Float32Array {
    try {
      const value = this.fft.getValue()
      return (Array.isArray(value) ? value[0] : value) as Float32Array
    } catch {
      return silentFft
    }
  }

  dispose() {
    this.wave.dispose()
    this.fft.dispose()
    this.input.dispose()
  }
}
