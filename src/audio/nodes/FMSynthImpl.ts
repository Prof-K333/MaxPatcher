import * as Tone from 'tone'
import { NodeImpl, type AudioTarget } from '../NodeImpl'
import { CVInlet } from '../cv'
import type { PatchEvent } from '../types'

/**
 * Classic Chowning FM: a modulator oscillator deviating a carrier's frequency,
 * where the modulator runs at a fixed ratio of the carrier (harmonicity) and
 * the depth of the deviation is the modulation index.
 *
 * Both the amplitude and the modulation index get their own ADSR, which is the
 * part that actually makes FM expressive — a decaying modulation envelope is
 * what gives you a struck-bell or plucked-bass timbre rather than a static buzz.
 *
 * Voices are allocated by Tone.PolySynth, so held chords work without the
 * patch author wiring anything extra.
 */
export class FMSynthImpl extends NodeImpl {
  private synth = new Tone.PolySynth(Tone.FMSynth, {
    harmonicity: 2,
    modulationIndex: 10,
    oscillator: { type: 'sine' },
    modulation: { type: 'sine' },
    envelope: { attack: 0.01, decay: 0.2, sustain: 0.6, release: 0.8 },
    modulationEnvelope: { attack: 0.01, decay: 0.3, sustain: 0.3, release: 0.6 },
  })

  private fmDepth = new CVInlet(1)
  private baseIndex = 10
  private cvTimer: number | null = null
  /** Notes currently held, so a CV sweep can be re-applied to live voices. */
  private held = new Set<number>()

  constructor() {
    super()
    this.synth.maxPolyphony = 16
    this.synth.volume.value = -10
  }

  audioOut(): Tone.ToneAudioNode {
    return this.synth
  }

  audioIn(handle: string): AudioTarget | null {
    if (handle === 'cv:fmDepth') return this.fmDepth.input
    return null
  }

  onConnectionChange(handle: string, connected: boolean) {
    if (handle !== 'cv:fmDepth') return
    this.fmDepth.setConnected(connected)
    if (connected) this.startCVPolling()
    else this.stopCVPolling()
  }

  /**
   * PolySynth has no modulationIndex Signal to patch into, so the FM depth
   * inlet is sampled at control rate and pushed onto the voices. 60 Hz is
   * plenty for timbral movement and costs nothing next to the audio thread.
   */
  private startCVPolling() {
    if (this.cvTimer !== null) return
    this.cvTimer = window.setInterval(() => {
      const index = Math.max(0, this.baseIndex + this.fmDepth.value() * 30)
      this.synth.set({ modulationIndex: index })
    }, 16)
  }

  private stopCVPolling() {
    if (this.cvTimer === null) return
    clearInterval(this.cvTimer)
    this.cvTimer = null
  }

  setParam(key: string, value: number | string) {
    const n = Number(value)
    if (key === 'mod_fmDepth') return this.fmDepth.setDepth(n)
    switch (key) {
      case 'harmonicity':
        return void this.synth.set({ harmonicity: n })
      case 'modulationIndex':
        this.baseIndex = n
        return void this.synth.set({ modulationIndex: n })
      case 'carrier':
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return void this.synth.set({ oscillator: { type: value as any } })
      case 'modulator':
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return void this.synth.set({ modulation: { type: value as any } })
      case 'attack':
      case 'decay':
      case 'sustain':
      case 'release':
        return void this.synth.set({ envelope: { [key]: n } })
      case 'mAttack':
        return void this.synth.set({ modulationEnvelope: { attack: n } })
      case 'mDecay':
        return void this.synth.set({ modulationEnvelope: { decay: n } })
      case 'mSustain':
        return void this.synth.set({ modulationEnvelope: { sustain: n } })
      case 'mRelease':
        return void this.synth.set({ modulationEnvelope: { release: n } })
      case 'volume':
        return void this.synth.volume.rampTo(n, 0.02)
    }
  }

  onEvent(_handle: string, event: PatchEvent) {
    // Looped events carry the exact time they were scheduled for; live ones
    // play now.
    const at = event.time ?? Tone.now()
    switch (event.type) {
      case 'noteOn':
        this.held.add(event.note)
        this.synth.triggerAttack(event.freq, at, event.velocity)
        break
      case 'noteOff':
        this.held.delete(event.note)
        this.synth.triggerRelease(Tone.Frequency(event.note, 'midi').toFrequency(), at)
        break
      case 'bang':
        this.synth.triggerAttackRelease('C4', 0.25, at, event.velocity ?? 0.8)
        break
    }
  }

  onStop() {
    this.synth.releaseAll()
    this.held.clear()
    this.stopCVPolling()
  }

  onStart() {
    if (this.fmDepth.value() !== 0) this.startCVPolling()
  }

  dispose() {
    this.stopCVPolling()
    this.synth.dispose()
    this.fmDepth.dispose()
  }
}
