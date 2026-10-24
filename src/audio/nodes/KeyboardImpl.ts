import * as Tone from 'tone'
import { NodeImpl, type AudioTarget } from '../NodeImpl'
import type { PatchEvent } from '../types'

const GLIDE = 0.01

/**
 * A keyboard's three control outlets, plus an event outlet.
 *
 * Pitch/gate/velocity are signals, for patching into oscillators and params
 * the old modular way. The `note` event outlet is what a polyphonic synth
 * wants, since signals can only ever express one note at a time.
 *
 * The signal outlets use last-note priority: holding a new key retunes the
 * pitch, and releasing it falls back to whatever is still held.
 */
export class KeyboardImpl extends NodeImpl {
  private pitch = new Tone.Signal(440, 'frequency')
  private gate = new Tone.Signal(0)
  private velocity = new Tone.Signal(0)
  /** Held notes in press order, so release can fall back correctly. */
  private held: number[] = []

  audioOut(handle: string): Tone.ToneAudioNode | null {
    switch (handle) {
      case 'pitch':
        return this.pitch
      case 'gate':
        return this.gate
      case 'velocity':
        return this.velocity
      default:
        return null
    }
  }

  audioIn(): AudioTarget | null {
    return null
  }

  /**
   * The UI injects key presses here; the engine then fans the same event out
   * to anything patched into the `note` outlet.
   */
  onEvent(_handle: string, event: PatchEvent) {
    if (event.type === 'noteOn') {
      this.held = this.held.filter((n) => n !== event.note).concat(event.note)
      this.pitch.rampTo(event.freq, GLIDE)
      this.velocity.rampTo(event.velocity, GLIDE)
      this.gate.rampTo(1, 0.002)
      this.emit('ev:note', event)
      return
    }

    if (event.type === 'noteOff') {
      this.held = this.held.filter((n) => n !== event.note)
      const last = this.held[this.held.length - 1]
      if (last === undefined) {
        this.gate.rampTo(0, 0.002)
      } else {
        this.pitch.rampTo(Tone.Frequency(last, 'midi').toFrequency(), GLIDE)
      }
      this.emit('ev:note', event)
    }
  }

  onStop() {
    this.held = []
    this.gate.value = 0
  }

  dispose() {
    this.pitch.dispose()
    this.gate.dispose()
    this.velocity.dispose()
  }
}
