import * as Tone from 'tone'
import { NodeImpl, type AudioTarget } from '../NodeImpl'
import type { PatchEvent } from '../types'

const GLIDE = 0.01

export interface MidiDevice {
  id: string
  name: string
}

export interface MidiStatus {
  supported: boolean
  permission: 'unknown' | 'ok' | 'denied'
  devices: MidiDevice[]
}

/**
 * Web MIDI input that speaks the same language as the Keyboard module:
 * `ev:note` plus pitch/gate/velocity signals.
 *
 * Access is requested explicitly (from the node UI), never in the
 * constructor, so tests and browsers without MIDI never throw.
 */
export class MidiInImpl extends NodeImpl {
  private pitch = new Tone.Signal(440, 'frequency')
  private gate = new Tone.Signal(0)
  private velocity = new Tone.Signal(0)
  private held: number[] = []

  private access: MIDIAccess | null = null
  private selectedId = ''
  private channel = 0
  private bound = new Map<string, (ev: Event) => void>()

  status: MidiStatus = { supported: midiSupported(), permission: 'unknown', devices: [] }
  onStatus: ((status: MidiStatus) => void) | null = null

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

  setParam(key: string, value: number | string) {
    if (key === 'device') {
      this.selectedId = String(value)
      this.bindInputs()
      return
    }
    if (key === 'channel') {
      const n = value === 'all' ? 0 : Number(value)
      this.channel = Number.isFinite(n) ? Math.max(0, Math.min(16, Math.round(n))) : 0
    }
  }

  /** Prompts the browser for MIDI access. Safe to call when the API is missing. */
  async enable() {
    if (!midiSupported()) {
      this.status = { supported: false, permission: 'unknown', devices: [] }
      this.notify()
      return
    }
    try {
      this.access = await navigator.requestMIDIAccess()
      this.access.onstatechange = () => this.refreshDevices()
      this.status = { supported: true, permission: 'ok', devices: [] }
      this.refreshDevices()
      this.bindInputs()
    } catch {
      this.access = null
      this.status = { supported: true, permission: 'denied', devices: [] }
      this.notify()
    }
  }

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
      if (last === undefined) this.gate.rampTo(0, 0.002)
      else this.pitch.rampTo(Tone.Frequency(last, 'midi').toFrequency(), GLIDE)
      this.emit('ev:note', event)
    }
  }

  onStop() {
    this.releaseHeld()
  }

  dispose() {
    this.releaseHeld()
    this.unbindInputs()
    if (this.access) this.access.onstatechange = null
    this.access = null
    this.onStatus = null
    this.pitch.dispose()
    this.gate.dispose()
    this.velocity.dispose()
  }

  private releaseHeld() {
    const sounding = [...this.held]
    this.held = []
    this.gate.value = 0
    for (const note of sounding) this.emit('ev:note', { type: 'noteOff', note })
  }

  private refreshDevices() {
    if (!this.access) return
    const devices: MidiDevice[] = []
    this.access.inputs.forEach((input) => {
      devices.push({ id: input.id, name: input.name || input.id })
    })
    this.status = { ...this.status, devices }
    this.notify()
  }

  private bindInputs() {
    if (!this.access) return
    this.unbindInputs()
    this.access.inputs.forEach((input) => {
      if (this.selectedId && input.id !== this.selectedId) return
      const listener = (ev: Event) => this.onMidi(ev as MIDIMessageEvent)
      input.addEventListener('midimessage', listener)
      this.bound.set(input.id, listener)
    })
  }

  private unbindInputs() {
    if (!this.access) {
      this.bound.clear()
      return
    }
    this.access.inputs.forEach((input) => {
      const listener = this.bound.get(input.id)
      if (listener) input.removeEventListener('midimessage', listener)
    })
    this.bound.clear()
  }

  private onMidi(ev: MIDIMessageEvent) {
    const data = ev.data
    if (!data || data.length < 2) return
    const status = data[0]
    const data1 = data[1]
    const data2 = data[2] ?? 0
    const cmd = status & 0xf0
    const channel = (status & 0x0f) + 1
    if (this.channel !== 0 && channel !== this.channel) return

    if (cmd === 0x90 && data2 > 0) {
      const velocity = data2 / 127
      const freq = Tone.Frequency(data1, 'midi').toFrequency()
      this.onEvent('ui', { type: 'noteOn', note: data1, freq, velocity })
      return
    }
    if (cmd === 0x80 || (cmd === 0x90 && data2 === 0)) {
      this.onEvent('ui', { type: 'noteOff', note: data1 })
      return
    }
    // CC 123: all notes off.
    if (cmd === 0xb0 && data1 === 123) this.releaseHeld()
  }

  private notify() {
    this.onStatus?.(this.status)
  }
}

function midiSupported(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.requestMIDIAccess === 'function'
}
