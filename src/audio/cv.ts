import * as Tone from 'tone'

/**
 * A modulation inlet whose value JS can read.
 *
 * Patching an LFO into a Tone Param is handled by the Web Audio graph, but a
 * scheduler written in JS (the granular grain clock) has to *sample* its
 * modulation. A tiny analyser gives us the instantaneous value without
 * involving the main thread in the audio path.
 */
export class CVInlet {
  readonly input = new Tone.Gain(1)
  private analyser = new Tone.Waveform(32)
  private connected = false

  private readonly scale: number

  constructor(scale = 1) {
    this.scale = scale
    this.input.connect(this.analyser)
  }

  /** Marks whether anything is actually patched in, so we can skip reads. */
  setConnected(connected: boolean) {
    this.connected = connected
  }

  /** Attenuverter: how far the patched CV swings this destination. */
  setDepth(amount: number) {
    this.input.gain.rampTo(amount, 0.02)
  }

  /** Latest sample, scaled; 0 when nothing is patched in. */
  value(): number {
    if (!this.connected) return 0
    const buf = this.analyser.getValue()
    return (buf[buf.length - 1] ?? 0) * this.scale
  }

  dispose() {
    this.analyser.dispose()
    this.input.dispose()
  }
}
