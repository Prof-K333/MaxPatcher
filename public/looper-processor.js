/**
 * Sound-on-sound tape looper, running on the audio thread.
 *
 * Everything that decides a sample lives here: the main thread only sends
 * commands and receives status. That is the point of the worklet — a looper
 * punched in from a UI thread would smear its loop points by however long the
 * browser was busy, and the loop length would be wrong forever after.
 */

const MAX_SECONDS = 60
const FADE_SECONDS = 0.005

const EMPTY = 'EMPTY'
const RECORDING = 'RECORDING'
const PLAYING = 'PLAYING'
const OVERDUBBING = 'OVERDUBBING'
const STOPPED = 'STOPPED'

class LooperProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'speed', defaultValue: 1, minValue: -4, maxValue: 4, automationRate: 'k-rate' },
      { name: 'cvAmount', defaultValue: 1, minValue: -2, maxValue: 2, automationRate: 'k-rate' },
      { name: 'feedback', defaultValue: 1, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'mix', defaultValue: 1, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'gain', defaultValue: 1, minValue: 0, maxValue: 2, automationRate: 'k-rate' },
    ]
  }

  constructor() {
    super()
    this.max = Math.floor(MAX_SECONDS * sampleRate)
    this.fade = Math.max(1, Math.floor(FADE_SECONDS * sampleRate))

    this.bufL = new Float32Array(this.max)
    this.bufR = new Float32Array(this.max)
    // Audio captured just past the punch-out, which is what makes a genuine
    // crossfade possible: without it the loop end and start are unrelated
    // samples and the seam can only be hidden by ducking the volume.
    this.tailL = new Float32Array(this.fade)
    this.tailR = new Float32Array(this.fade)
    this.hasTail = false

    this.state = EMPTY
    this.loopLength = 0
    this.writePos = 0
    this.readPos = 0
    /** Counts down while the extra crossfade tail is being captured. */
    this.tailRemaining = 0
    /** Ramps the record input so punch-in and punch-out do not click. */
    this.recGain = 0
    this.recTarget = 0
    this.reverse = false
    this.halfSpeed = false
    this.frame = 0

    this.port.onmessage = (e) => this.onMessage(e.data)
  }

  onMessage(msg) {
    switch (msg.type) {
      case 'recordOrDub':
        this.recordOrDub()
        break
      case 'playStop':
        this.playStop()
        break
      case 'stop':
        this.stop()
        break
      case 'clear':
        this.clear()
        break
      case 'config':
        if (msg.reverse !== undefined) this.reverse = !!msg.reverse
        if (msg.halfSpeed !== undefined) this.halfSpeed = !!msg.halfSpeed
        break
      case 'requestPeaks':
        this.sendPeaks(msg.columns || 128)
        break
    }
    this.sendState()
  }

  // ------------------------------------------------------------- transitions

  recordOrDub() {
    if (this.state === EMPTY || this.state === STOPPED && this.loopLength === 0) {
      this.state = RECORDING
      this.writePos = 0
      this.loopLength = 0
      this.recTarget = 1
      return
    }
    if (this.state === RECORDING) {
      // Punching out of the first take is what defines the loop.
      this.loopLength = Math.max(this.fade * 2, this.writePos)
      this.readPos = 0
      this.tailRemaining = this.fade
      this.state = PLAYING
      this.recTarget = 0
      return
    }
    if (this.state === OVERDUBBING) {
      this.state = PLAYING
      this.recTarget = 0
      return
    }
    // PLAYING or STOPPED with a loop → start layering onto it.
    this.state = OVERDUBBING
    this.recTarget = 1
  }

  playStop() {
    if (this.loopLength === 0) return
    if (this.state === PLAYING || this.state === OVERDUBBING) {
      this.state = STOPPED
      this.recTarget = 0
    } else {
      this.state = PLAYING
      this.readPos = 0
    }
  }

  stop() {
    if (this.state === RECORDING) this.recordOrDub()
    this.state = this.loopLength ? STOPPED : EMPTY
    this.recTarget = 0
  }

  clear() {
    this.state = EMPTY
    this.loopLength = 0
    this.writePos = 0
    this.readPos = 0
    this.recGain = 0
    this.recTarget = 0
    this.hasTail = false
    this.bufL.fill(0)
    this.bufR.fill(0)
  }

  // ------------------------------------------------------------------ status

  sendState() {
    this.port.postMessage({
      type: 'state',
      state: this.state,
      loopSeconds: this.loopLength / sampleRate,
      phase: this.loopLength ? this.readPos / this.loopLength : 0,
      recordedSeconds: this.state === RECORDING ? this.writePos / sampleRate : this.loopLength / sampleRate,
    })
  }

  /** Min/max pairs for the waveform display, computed off the audio thread's
   *  hot path only when the UI asks. */
  sendPeaks(columns) {
    const len = this.loopLength || this.writePos
    if (!len) {
      this.port.postMessage({ type: 'peaks', peaks: [] })
      return
    }
    const block = Math.max(1, Math.floor(len / columns))
    const peaks = new Float32Array(columns * 2)
    for (let c = 0; c < columns; c++) {
      let lo = 0
      let hi = 0
      const start = c * block
      for (let i = start, end = Math.min(start + block, len); i < end; i++) {
        const v = (this.bufL[i] + this.bufR[i]) * 0.5
        if (v < lo) lo = v
        if (v > hi) hi = v
      }
      peaks[c * 2] = lo
      peaks[c * 2 + 1] = hi
    }
    this.port.postMessage({ type: 'peaks', peaks }, [peaks.buffer])
  }

  // ------------------------------------------------------------------- audio

  /** Linear interpolation, so varispeed and reverse stay smooth. */
  read(buf, pos, len) {
    const i0 = Math.floor(pos)
    const frac = pos - i0
    const a = buf[((i0 % len) + len) % len]
    const b = buf[((((i0 + 1) % len) + len) % len)]
    return a + (b - a) * frac
  }

  process(inputs, outputs, parameters) {
    const inL = inputs[0]?.[0]
    const inR = inputs[0]?.[1] ?? inL
    const cv = inputs[1]?.[0]

    const outL = outputs[0][0]
    const outR = outputs[0][1]
    const phaseOut = outputs[1]?.[0]

    const speedParam = parameters.speed[0]
    const cvAmount = parameters.cvAmount[0]
    const feedback = parameters.feedback[0]
    const mix = parameters.mix[0]
    const gain = parameters.gain[0]

    const blocks = outL.length
    const fadeStep = 1 / this.fade

    for (let i = 0; i < blocks; i++) {
      const dryL = inL ? inL[i] : 0
      const dryR = inR ? inR[i] : 0

      // Record gain glides, so punching in or out never steps the signal.
      if (this.recGain < this.recTarget) this.recGain = Math.min(this.recTarget, this.recGain + fadeStep)
      else if (this.recGain > this.recTarget) this.recGain = Math.max(this.recTarget, this.recGain - fadeStep)

      let wetL = 0
      let wetR = 0

      if (this.state === RECORDING) {
        if (this.writePos < this.max) {
          this.bufL[this.writePos] = dryL * this.recGain
          this.bufR[this.writePos] = dryR * this.recGain
          this.writePos++
        } else {
          // Out of tape: close the loop rather than silently dropping audio.
          this.recordOrDub()
          this.sendState()
        }
      } else if (this.loopLength > 0 && (this.state === PLAYING || this.state === OVERDUBBING)) {
        const len = this.loopLength

        // Keep capturing just past the punch-out to use as crossfade material.
        if (this.tailRemaining > 0) {
          const idx = this.fade - this.tailRemaining
          this.tailL[idx] = dryL
          this.tailR[idx] = dryR
          this.tailRemaining--
          if (this.tailRemaining === 0) this.hasTail = true
        }

        wetL = this.read(this.bufL, this.readPos, len)
        wetR = this.read(this.bufR, this.readPos, len)

        // Crossfade the seam. With a recorded tail this is a true blend of
        // what followed the loop end against the loop start; without one it
        // degrades to a short fade, which still removes the click.
        const toEnd = len - this.readPos
        if (toEnd < this.fade) {
          const t = 1 - toEnd / this.fade
          const idx = this.fade - Math.ceil(toEnd)
          if (this.hasTail && idx >= 0 && idx < this.fade) {
            wetL = this.tailL[idx] * (1 - t) + wetL * t
            wetR = this.tailR[idx] * (1 - t) + wetR * t
          } else {
            wetL *= toEnd / this.fade
            wetR *= toEnd / this.fade
          }
        } else if (this.readPos < this.fade) {
          const t = this.readPos / this.fade
          if (!this.hasTail) {
            wetL *= t
            wetR *= t
          }
        }

        if (this.state === OVERDUBBING) {
          // Sound on sound: existing material is scaled by feedback as the
          // new layer lands on it, so old passes decay like analog tape.
          //
          // The sum is soft-clipped because a feedback patch — looper into a
          // delay and back again — has a loop gain above one and will climb
          // until it clips. Tape does not do that: it saturates, the buildup
          // plateaus, and that self-limiting is the Frippertronics sound.
          const w = ((Math.round(this.readPos) % len) + len) % len
          this.bufL[w] = Math.tanh(this.bufL[w] * feedback + dryL * this.recGain)
          this.bufR[w] = Math.tanh(this.bufR[w] * feedback + dryR * this.recGain)
        }

        let speed = speedParam
        if (cv) speed += cv[i] * cvAmount * 2
        if (this.halfSpeed) speed *= 0.5
        if (this.reverse) speed = -speed

        this.readPos += speed
        if (this.readPos >= len) {
          this.readPos -= len
          this.port.postMessage({ type: 'cycle' })
        } else if (this.readPos < 0) {
          this.readPos += len
          this.port.postMessage({ type: 'cycle' })
        }
      }

      outL[i] = (dryL * (1 - mix) + wetL * mix) * gain
      outR[i] = (dryR * (1 - mix) + wetR * mix) * gain
      if (phaseOut) phaseOut[i] = this.loopLength ? this.readPos / this.loopLength : 0
    }

    // ~30 status updates a second is plenty for a progress ring.
    if ((this.frame = (this.frame + 1) % 4) === 0) this.sendState()
    return true
  }
}

registerProcessor('looper-processor', LooperProcessor)

/* ------------------------------------------------------------------------ *
 * Live capture, registered from this same module.
 *
 * It lives here rather than in its own file because Tone's context wrapper
 * only exposes processors from modules it has successfully parsed, and a
 * second module was rejected with NotSupportedError even though Chrome
 * accepted it natively. Registering both processors from one module sidesteps
 * that entirely.
 * ------------------------------------------------------------------------ */

const CHUNK = 2048

class CaptureProcessor extends AudioWorkletProcessor {
  // Required even when empty: the context wrapper Tone uses validates that
  // this is an array and rejects the processor with NotSupportedError when it
  // is missing, which looks exactly like an unregistered processor name.
  static get parameterDescriptors() {
    return [{ name: 'capture', defaultValue: 1, minValue: 0, maxValue: 1, automationRate: 'k-rate' }]
  }

  constructor() {
    super()
    this.left = new Float32Array(CHUNK)
    this.right = new Float32Array(CHUNK)
    this.fill = 0
    this.active = true
    this.port.onmessage = (e) => {
      if (e.data?.type === 'active') this.active = !!e.data.value
    }
  }

  // Declares one (silent) output: a zero-output worklet is rejected outright
  // by some implementations, and a node with nothing downstream is not
  // guaranteed to be pulled by the graph at all.
  process(inputs, outputs) {
    const out = outputs[0]?.[0]
    if (out) out.fill(0)

    const inL = inputs[0]?.[0]
    if (!inL || !this.active) return true
    const inR = inputs[0][1] ?? inL

    for (let i = 0; i < inL.length; i++) {
      this.left[this.fill] = inL[i]
      this.right[this.fill] = inR[i]
      if (++this.fill === CHUNK) {
        const l = this.left
        const r = this.right
        this.port.postMessage({ type: 'audio', left: l, right: r }, [l.buffer, r.buffer])
        // Transferred buffers are detached, so start fresh ones.
        this.left = new Float32Array(CHUNK)
        this.right = new Float32Array(CHUNK)
        this.fill = 0
      }
    }
    return true
  }
}

registerProcessor('capture-processor', CaptureProcessor)
