import * as Tone from 'tone'
import { NodeImpl, type AudioTarget } from '../NodeImpl'
import type { PatchEvent } from '../types'

/**
 * A straightforward one-shot / loop sampler built on Tone.Player.
 *
 * Decoded buffers live only in memory: audio is far too large for the patch
 * JSON, so a saved patch remembers the file's name and asks for it again.
 */
export class SamplerImpl extends NodeImpl {
  private player = new Tone.Player()
  private out = new Tone.Gain(1)
  /** 0–1 trim positions, resolved against the buffer on each trigger. */
  private trimStart = 0
  private trimEnd = 1
  private looping = false

  fileName = ''
  onBufferChange: (() => void) | null = null

  constructor() {
    super()
    this.player.connect(this.out)
  }

  audioOut(): Tone.ToneAudioNode {
    return this.out
  }

  audioIn(handle: string): AudioTarget | null {
    return handle === 'param:playbackRate' ? (this.player.playbackRate as unknown as AudioTarget) : null
  }

  get buffer(): AudioBuffer | null {
    return this.player.loaded ? this.player.buffer.get() ?? null : null
  }

  get duration(): number {
    return this.player.loaded ? this.player.buffer.duration : 0
  }

  get playing(): boolean {
    return this.player.state === 'started'
  }

  loadBuffer(buffer: AudioBuffer, fileName: string) {
    this.player.buffer = new Tone.ToneAudioBuffer(buffer)
    this.fileName = fileName
    this.applyTrim()
    this.onBufferChange?.()
  }

  clear() {
    this.stop()
    this.player.buffer = new Tone.ToneAudioBuffer()
    this.fileName = ''
    this.onBufferChange?.()
  }

  private applyTrim() {
    if (!this.player.loaded) return
    const total = this.player.buffer.duration
    const start = this.trimStart * total
    const end = Math.max(start + 0.01, this.trimEnd * total)
    this.player.loopStart = start
    this.player.loopEnd = end
  }

  play() {
    if (!this.player.loaded) return
    const total = this.player.buffer.duration
    const start = this.trimStart * total
    const end = Math.max(start + 0.01, this.trimEnd * total)
    this.player.loop = this.looping
    this.applyTrim()
    // Restart from the trim point rather than stacking overlapping voices.
    if (this.player.state === 'started') this.player.stop()
    this.player.start(undefined, start, this.looping ? undefined : end - start)
  }

  stop() {
    if (this.player.state === 'started') this.player.stop()
  }

  setParam(key: string, value: number | string) {
    const n = Number(value)
    switch (key) {
      case 'playbackRate':
        this.player.playbackRate = n
        break
      case 'loop':
        this.looping = n >= 0.5
        this.player.loop = this.looping
        break
      case 'start':
        this.trimStart = Math.min(n, this.trimEnd - 0.01)
        this.applyTrim()
        break
      case 'end':
        this.trimEnd = Math.max(n, this.trimStart + 0.01)
        this.applyTrim()
        break
      case 'reverse':
        this.player.reverse = n >= 0.5
        break
      case 'volume':
        this.out.gain.rampTo(n, 0.02)
        break
    }
  }

  onEvent(_handle: string, event: PatchEvent) {
    if (event.type === 'noteOff') return
    this.play()
  }

  onStop() {
    this.stop()
  }

  dispose() {
    this.player.dispose()
    this.out.dispose()
  }
}
