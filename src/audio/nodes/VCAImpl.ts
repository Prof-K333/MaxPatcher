import * as Tone from 'tone'
import { NodeImpl, type AudioTarget } from '../NodeImpl'

/**
 * Voltage-controlled amplifier: audio in, CV in, audio out.
 *
 * Bias is a resting gain (default 0, so the VCA is closed until an envelope
 * or other CV opens it). Incoming CV is scaled by its mod depth and, when
 * expo is on, shaped before it is summed with the bias.
 */
export class VCAImpl extends NodeImpl {
  private amp = new Tone.Gain(0)
  private bias = new Tone.Signal(0)
  private cvIn = new Tone.Gain(1)
  private shaper = new Tone.WaveShaper(linearCurve, 1024)

  constructor() {
    super()
    this.bias.connect(this.amp.gain)
    this.cvIn.connect(this.shaper)
    this.shaper.connect(this.amp.gain)
  }

  audioOut(): Tone.ToneAudioNode {
    return this.amp
  }

  audioIn(handle: string): AudioTarget | null {
    if (handle === 'cv:gain') return this.cvIn
    if (handle === 'in') return this.amp
    return null
  }

  setParam(key: string, value: number | string) {
    if (key === 'mod_gain') {
      this.cvIn.gain.rampTo(Number(value), 0.02)
      return
    }
    if (key === 'bias') {
      this.bias.rampTo(Number(value), 0.02)
      return
    }
    if (key === 'curve') {
      this.shaper.setMap(value === 'expo' ? expoCurve : linearCurve)
    }
  }

  dispose() {
    this.shaper.dispose()
    this.cvIn.dispose()
    this.bias.dispose()
    this.amp.dispose()
  }
}

function linearCurve(x: number) {
  return x
}

/** Unipolar expo: 0 stays 0, 1 stays 1, values in between sit lower than linear. */
function expoCurve(x: number) {
  if (x <= 0) return 0
  return (Math.pow(2, x * 6) - 1) / (Math.pow(2, 6) - 1)
}
