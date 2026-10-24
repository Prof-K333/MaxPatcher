import { rampParam } from './rampParam'

/**
 * One instrument's output path.
 *
 * Every voice runs level → pan, then splits two ways: a send to the master
 * mix and a direct tap for its own outlet. Patching the direct outlet mutes
 * the master send, which is how a real analog mixer's normalled jacks behave —
 * plugging into an individual output removes that instrument from the mix.
 */
export class VoiceBus {
  readonly input: GainNode
  readonly level: GainNode
  readonly pan: StereoPannerNode
  readonly masterSend: GainNode
  readonly direct: GainNode

  private ctx: BaseAudioContext

  constructor(ctx: BaseAudioContext, master: AudioNode) {
    this.ctx = ctx
    this.input = ctx.createGain()
    this.level = ctx.createGain()
    this.pan = ctx.createStereoPanner()
    this.masterSend = ctx.createGain()
    this.direct = ctx.createGain()

    this.input.connect(this.level)
    this.level.connect(this.pan)
    this.pan.connect(this.masterSend)
    this.pan.connect(this.direct)
    this.masterSend.connect(master)
  }

  setLevel(value: number) {
    rampParam(this.level.gain, this.ctx, value, 0.02)
  }

  setPan(value: number) {
    rampParam(this.pan.pan, this.ctx, value, 0.02)
  }

  /** Classic normalling: a patched individual out drops out of the mix. */
  setDirectConnected(connected: boolean) {
    rampParam(this.masterSend.gain, this.ctx, connected ? 0 : 1, 0.01)
  }

  dispose() {
    this.input.disconnect()
    this.level.disconnect()
    this.pan.disconnect()
    this.masterSend.disconnect()
    this.direct.disconnect()
  }
}
