/**
 * Smoothly moves an AudioParam to a value.
 *
 * Deliberately not `setTargetAtTime`: on the nodes Tone hands us through
 * `rawContext`, that call silently does nothing — the param keeps its old
 * value and the change is simply never heard. An explicit ramp, anchored with
 * `setValueAtTime` so it starts from where the param actually is, does apply.
 */
export function rampParam(param: AudioParam, ctx: BaseAudioContext, value: number, seconds = 0.015) {
  const now = ctx.currentTime
  param.cancelScheduledValues(now)
  param.setValueAtTime(param.value, now)
  param.linearRampToValueAtTime(value, now + Math.max(0.001, seconds))
}
