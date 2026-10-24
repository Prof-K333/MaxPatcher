/**
 * Sample-accurate step clock.
 *
 * The timer never decides when a note sounds — it only decides when to *book*
 * notes. Every tick looks 100ms into the future and schedules each step that
 * falls inside that window at an exact `AudioContext` time, so a stalled main
 * thread delays the booking, not the music. Steps already booked still play on
 * time because the audio clock owns them.
 *
 * The tick itself comes from a Worker, because browsers clamp timers in
 * background tabs to about once a second — which would starve the scheduler
 * and drop steps the moment the tab loses focus.
 */

const TICK_MS = 25
const LOOKAHEAD = 0.1
/** Past this far behind, catching up step by step would machine-gun. */
const RESYNC_AFTER = 0.25

const WORKER_SRC = `
let id = null
self.onmessage = (e) => {
  if (e.data.type === 'start') {
    clearInterval(id)
    id = setInterval(() => self.postMessage('tick'), e.data.interval)
  } else if (e.data.type === 'stop') {
    clearInterval(id)
    id = null
  }
}
`

export class LookaheadClock {
  bpm = 120
  /** 0.5 straight, 0.75 heavy triplet shuffle, applied to every other step. */
  swing = 0.5
  /** Step length in beats: 0.25 is a 16th, 1/3 a triplet eighth. */
  division = 0.25

  /** Called once per 16th with the exact time that step should sound. */
  onStep: ((step: number, time: number) => void) | null = null

  private ctx: BaseAudioContext
  private worker: Worker | null = null
  private fallback: number | null = null
  private nextStepTime = 0
  private step = 0
  private running = false

  constructor(ctx: BaseAudioContext) {
    this.ctx = ctx
    try {
      const url = URL.createObjectURL(new Blob([WORKER_SRC], { type: 'application/javascript' }))
      this.worker = new Worker(url)
      this.worker.onmessage = () => this.tick()
      URL.revokeObjectURL(url)
    } catch {
      // Workers can be blocked outright; a plain timer still works in the
      // foreground, which is where someone is almost certainly sequencing.
      this.worker = null
    }
  }

  get isRunning() {
    return this.running
  }

  get currentStep() {
    return this.step
  }

  get stepDuration() {
    const dur = (60 / this.bpm) * this.division
    // A zero or broken step length would make the scheduling loop below spin
    // forever and take the whole tab with it.
    return Number.isFinite(dur) && dur > 0.001 ? dur : 0.001
  }

  start() {
    if (this.running) return
    this.running = true
    this.nextStepTime = this.ctx.currentTime + 0.05
    if (this.worker) this.worker.postMessage({ type: 'start', interval: TICK_MS })
    else this.fallback = window.setInterval(() => this.tick(), TICK_MS)
  }

  stop() {
    this.running = false
    if (this.worker) this.worker.postMessage({ type: 'stop' })
    if (this.fallback !== null) {
      clearInterval(this.fallback)
      this.fallback = null
    }
  }

  reset() {
    this.step = 0
    this.nextStepTime = this.ctx.currentTime + 0.01
  }

  /** Advances one step immediately — used when an external clock drives us. */
  external(time?: number) {
    const at = Math.max(time ?? this.ctx.currentTime, this.ctx.currentTime)
    this.onStep?.(this.step, at)
    this.step++
  }

  private tick() {
    if (!this.running) return
    const now = this.ctx.currentTime

    // A long stall would otherwise leave a backlog that fires as one burst.
    if (this.nextStepTime < now - RESYNC_AFTER) this.nextStepTime = now

    // Bounded so a pathological tempo cannot lock the thread; at the fastest
    // sane rate a 100ms window holds far fewer steps than this.
    let guard = 256
    while (this.nextStepTime < now + LOOKAHEAD && guard-- > 0) {
      const dur = this.stepDuration
      // Swing delays every second 16th without moving the beats around it.
      const offset = this.step % 2 === 1 ? (this.swing - 0.5) * 2 * dur : 0
      this.onStep?.(this.step, this.nextStepTime + offset)
      this.step++
      this.nextStepTime += dur
    }
  }

  dispose() {
    this.stop()
    this.worker?.terminate()
    this.worker = null
  }
}
