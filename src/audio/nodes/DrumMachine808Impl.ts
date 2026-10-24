import * as Tone from 'tone'
import { NodeImpl, type AudioTarget } from '../NodeImpl'
import { CVInlet } from '../cv'
import { DrumSynth808Engine, type OutletId, type VoiceId } from '../drums/DrumSynth808Engine'
import type { PatchEvent } from '../types'

const VOICES: VoiceId[] = ['bd', 'sd', 'cp', 'ch', 'oh', 'cb']

/** Outlet handle → the bus it taps. */
const OUTLETS: Record<string, OutletId> = {
  bdOut: 'bd',
  sdOut: 'sd',
  sdNoiseOut: 'sdNoise',
  cpOut: 'cp',
  hhOut: 'hh',
  cbOut: 'cb',
}

/**
 * Patch-graph wrapper around the 808 engine.
 *
 * Trigger inlets are event cables, so a looper, keyboard or sequencer can all
 * fire the same voice. Accent arrives as CV and is sampled at trigger time
 * rather than polled — a drum only cares about the velocity at the instant
 * it is struck.
 */
export class DrumMachine808Impl extends NodeImpl {
  private out = new Tone.Gain(1)
  private left = new Tone.Gain(1)
  private right = new Tone.Gain(1)
  private drums: DrumSynth808Engine
  private accentCV = new CVInlet(1)
  private accentConnected = false
  private directOuts: Record<string, Tone.Gain> = {}

  /** Set by the UI so pads can flash on every hit, wherever it came from. */
  onVoiceTrigger: ((voice: VoiceId) => void) | null = null

  constructor() {
    super()
    const ctx = Tone.getContext().rawContext as unknown as AudioContext
    this.drums = new DrumSynth808Engine(ctx, this.out.input as unknown as AudioNode)

    const splitter = ctx.createChannelSplitter(2)
    this.out.connect(splitter as unknown as Tone.ToneAudioNode)
    splitter.connect(this.left.input as unknown as AudioNode, 0)
    splitter.connect(this.right.input as unknown as AudioNode, 1)

    // Each individual outlet is a Tone wrapper around that bus's direct tap.
    for (const [handle, outlet] of Object.entries(OUTLETS)) {
      const gain = new Tone.Gain(1)
      this.drums.buses[outlet].direct.connect(gain.input as unknown as AudioNode)
      this.directOuts[handle] = gain
    }

    this.drums.onTrigger = (voice) => this.onVoiceTrigger?.(voice)
  }

  audioOut(handle: string): Tone.ToneAudioNode | null {
    if (handle === 'outL') return this.left
    if (handle === 'outR') return this.right
    if (this.directOuts[handle]) return this.directOuts[handle]
    return this.out
  }

  audioIn(handle: string): AudioTarget | null {
    return handle === 'cv:accent' ? this.accentCV.input : null
  }

  onConnectionChange(handle: string, connected: boolean) {
    if (handle === 'cv:accent') {
      this.accentCV.setConnected(connected)
      this.accentConnected = connected
    }
  }

  /** Normalling: a patched individual out leaves the master mix. */
  onOutletChange(handle: string, connected: boolean) {
    const outlet = OUTLETS[handle]
    if (outlet) this.drums.setOutletConnected(outlet, connected)
  }

  setParam(key: string, value: number | string) {
    const n = Number(value)

    if (key === 'mod_accent') return void this.accentCV.setDepth(n)
    if (key === 'drive') return void this.drums.setParams({ drive: n >= 0.5 })
    if (key === 'masterVolume') return void this.out.gain.rampTo(n, 0.02)

    // level_<voice> / pan_<voice> address one strip's mixer controls.
    const mixer = /^(level|pan)_(bd|sd|cp|ch|oh|cb)$/.exec(key)
    if (mixer) {
      const [, which, voice] = mixer
      const field = which === 'level' ? 'levels' : 'pans'
      this.drums.setParams({ [field]: { ...this.drums.params[field], [voice as VoiceId]: n } })
      return
    }

    this.drums.setParams({ [key]: n })
  }

  /** `ev:<voice>` inlets, plus a bare trigger that fires the bass drum. */
  onEvent(handle: string, event: PatchEvent) {
    if (event.type === 'noteOff') return
    const voice = handle.startsWith('ev:') ? (handle.slice(3) as VoiceId) : 'bd'
    if (!VOICES.includes(voice)) return

    const velocity = event.type === 'noteOn' ? event.velocity : (event.velocity ?? 0.9)
    // Accent CV is read at the moment of the hit, not polled.
    const accent = this.accentConnected ? 1 + this.accentCV.value() : 1
    this.drums.trigger(voice, event.time, Math.max(0.05, velocity * accent))
  }

  /** Lets the UI's pad buttons fire the same path as a cable would. */
  triggerVoice(voice: VoiceId, velocity = 0.9) {
    this.drums.trigger(voice, undefined, velocity)
  }

  onStop() {
    // Nothing free-running to stop: every voice is a one-shot that has
    // already scheduled its own teardown.
  }

  dispose() {
    this.drums.dispose()
    this.accentCV.dispose()
    Object.values(this.directOuts).forEach((g) => g.dispose())
    this.left.dispose()
    this.right.dispose()
    this.out.dispose()
  }
}
