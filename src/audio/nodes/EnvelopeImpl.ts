import * as Tone from 'tone'
import { NodeImpl, type AudioTarget } from '../NodeImpl'
import type { PatchEvent } from '../types'

/**
 * Standalone ADSR. Triggered by note/gate/trig events — the same messages a
 * keyboard already sends — and outputs an audio-rate CV envelope.
 *
 * This is the modular envelope; the FM synth keeps its own built-in ADSR.
 */
export class EnvelopeImpl extends NodeImpl {
  private env = new Tone.Envelope({
    attack: 0.01,
    decay: 0.2,
    sustain: 0.7,
    release: 0.5,
  })

  audioOut(): Tone.ToneAudioNode {
    return this.env
  }

  audioIn(): AudioTarget | null {
    return null
  }

  setParam(key: string, value: number | string) {
    const n = Number(value)
    if (!Number.isFinite(n)) return
    if (key === 'attack' || key === 'decay' || key === 'sustain' || key === 'release') {
      this.env[key] = n
    }
  }

  onEvent(_handle: string, event: PatchEvent) {
    const at = event.time ?? Tone.now()
    if (event.type === 'noteOn') {
      this.env.triggerAttack(at)
      return
    }
    if (event.type === 'noteOff') {
      this.env.triggerRelease(at)
      return
    }
    if (event.type === 'bang') {
      // A trigger is a short gate: run the attack and decay, then release.
      const duration = Math.max(0.001, Number(this.env.attack) + Number(this.env.decay))
      this.env.triggerAttackRelease(duration, at)
    }
  }

  onStop() {
    this.env.cancel()
  }

  dispose() {
    this.env.dispose()
  }
}
