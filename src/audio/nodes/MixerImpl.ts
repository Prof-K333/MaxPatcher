import * as Tone from 'tone'
import { NodeImpl, type AudioTarget } from '../NodeImpl'

export const MIXER_CHANNELS = 4

interface Channel {
  input: Tone.Gain
  level: Tone.Gain
  pan: Tone.Panner
  muted: boolean
  gain: number
}

/**
 * A four-channel mixer.
 *
 * Web Audio already sums anything you patch into one input, so a mixer is not
 * needed to *combine* sources — it is needed to balance them. Each channel
 * gets its own level, pan and mute, which is the difference between a patch
 * you can mix and one where every voice fights at full volume.
 */
export class MixerImpl extends NodeImpl {
  private channels: Channel[] = []
  private bus = new Tone.Gain(1)
  private out = new Tone.Gain(0.9)

  constructor() {
    super()
    for (let i = 0; i < MIXER_CHANNELS; i++) {
      const input = new Tone.Gain(1)
      const level = new Tone.Gain(0.8)
      const pan = new Tone.Panner(0)
      input.connect(level)
      level.connect(pan)
      pan.connect(this.bus)
      this.channels.push({ input, level, pan, muted: false, gain: 0.8 })
    }
    this.bus.connect(this.out)
  }

  audioOut(): Tone.ToneAudioNode {
    return this.out
  }

  audioIn(handle: string): AudioTarget | null {
    const match = /^in(\d)$/.exec(handle)
    if (!match) return this.channels[0]?.input ?? null
    return this.channels[Number(match[1]) - 1]?.input ?? null
  }

  setParam(key: string, value: number | string) {
    const n = Number(value)

    if (key === 'master') {
      this.out.gain.rampTo(n, 0.02)
      return
    }

    const match = /^(level|pan|mute)(\d)$/.exec(key)
    if (!match) return
    const channel = this.channels[Number(match[2]) - 1]
    if (!channel) return

    switch (match[1]) {
      case 'level':
        channel.gain = n
        // Mute wins until it is lifted, so a level move cannot unmute.
        if (!channel.muted) channel.level.gain.rampTo(n, 0.02)
        break
      case 'pan':
        channel.pan.pan.rampTo(n, 0.02)
        break
      case 'mute':
        channel.muted = n >= 0.5
        channel.level.gain.rampTo(channel.muted ? 0 : channel.gain, 0.02)
        break
    }
  }

  dispose() {
    this.channels.forEach((c) => {
      c.input.dispose()
      c.level.dispose()
      c.pan.dispose()
    })
    this.bus.dispose()
    this.out.dispose()
  }
}
