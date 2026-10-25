import { useCallback, useRef, useState } from 'react'
import { engine } from '../../audio/AudioEngine'
import { SYNC_DIVISIONS, type SpatialFXProImpl } from '../../audio/nodes/SpatialFXProImpl'
import { ampToDb } from '../../audio/mixMath'
import { Knob } from './Knob'
import { LedMeter } from './LedMeter'
import { useFrame } from './useFrame'
import type { NodeUIProps } from './types'

const CYAN = '#22d3ee'
const VIOLET = '#a78bfa'

function Toggle({
  on,
  label,
  title,
  color,
  onClick,
}: {
  on: boolean
  label: string
  title: string
  color: string
  onClick: () => void
}) {
  return (
    <button
      title={title}
      aria-pressed={on}
      onClick={onClick}
      className="nodrag nopan flex flex-1 items-center justify-center gap-1 rounded px-1.5 py-1 text-[9px] font-bold tracking-wide text-slate-200 ring-1 ring-white/10 hover:bg-slate-700"
      style={{ background: on ? `${color}33` : '#0f172a', color: on ? color : undefined }}
    >
      <span
        className="h-1.5 w-1.5 rounded-full"
        style={{ background: on ? color : '#334155', boxShadow: on ? `0 0 5px ${color}` : 'none' }}
      />
      {label}
    </button>
  )
}

/** Delay on the left in cyan, reverb on the right in violet. */
export function SpatialFXProUI({ nodeId, params, setParam }: NodeUIProps) {
  const impl = useCallback(() => engine.getImpl(nodeId) as SpatialFXProImpl | undefined, [nodeId])
  const num = (key: string, fallback: number) => Number(params[key] ?? fallback)
  const sync = num('sync', 0) >= 0.5
  const pingpong = num('pingpong', 1) >= 0.5
  const freeze = num('freeze', 0) >= 0.5
  const series = String(params.mode ?? 'parallel') === 'series'
  const division = String(params.division ?? '1/8')
  const feedback = num('feedback', 40)

  const taps = useRef<number[]>([])
  const [tempo, setTempo] = useState({ bpm: num('bpm', 120), external: false })
  const lastShown = useRef(0)

  // Tempo readout follows the clock, but only redraws when the number changes.
  useFrame(() => {
    const now = performance.now()
    if (now - lastShown.current < 250) return
    lastShown.current = now
    const t = impl()?.getTempo()
    if (!t) return
    const bpm = Math.round(t.bpm * 10) / 10
    setTempo((prev) => (prev.bpm === bpm && prev.external === t.external ? prev : { bpm, external: t.external }))
  })

  const tap = () => {
    const now = performance.now()
    const list = taps.current
    if (list.length && now - list[list.length - 1] > 2000) list.length = 0
    list.push(now)
    if (list.length > 6) list.shift()
    if (list.length >= 2) {
      const mean = (list[list.length - 1] - list[0]) / (list.length - 1)
      setParam('bpm', Math.round(Math.min(240, Math.max(40, 60000 / mean)) * 10) / 10)
    }
  }

  const reading = (side: 0 | 1) => () => {
    const lv = impl()?.getLevel(side)
    return lv ? { peak: ampToDb(lv.peak), rms: ampToDb(lv.rms) } : { peak: -100, rms: -100 }
  }

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        {/* ---------------------------------------------------------- delay */}
        <div className="space-y-2 rounded border p-1.5" style={{ borderColor: `${CYAN}55`, background: `${CYAN}0d` }}>
          <div className="text-[9px] font-bold uppercase tracking-[0.2em]" style={{ color: CYAN }}>
            Delay
          </div>
          <div className="flex gap-1">
            <Toggle on={sync} label="SYNC" color={CYAN} title="Lock delay time to the clock / tempo" onClick={() => setParam('sync', sync ? 0 : 1)} />
            <Toggle
              on={pingpong}
              label="PING-PONG"
              color={CYAN}
              title="Cross-feed the two delay lines"
              onClick={() => setParam('pingpong', pingpong ? 0 : 1)}
            />
          </div>
          <div className="flex gap-1">
            <button
              title="Tap the tempo (a quarter note per tap)"
              onClick={tap}
              className="nodrag nopan flex-1 rounded bg-slate-900 px-1.5 py-1 text-[9px] font-bold text-slate-200 ring-1 ring-white/10 hover:bg-slate-700 active:bg-cyan-500/30"
            >
              TAP {tempo.bpm.toFixed(0)}
              {tempo.external ? ' ⏱' : ''}
            </button>
          </div>
          {sync ? (
            <div className="flex gap-0.5" title="Delay note value">
              {Object.keys(SYNC_DIVISIONS).map((d) => (
                <button
                  key={d}
                  onClick={() => setParam('division', d)}
                  className="nodrag nopan flex-1 rounded px-0.5 py-1 text-[8px] font-bold ring-1 ring-white/10"
                  style={{ background: division === d ? `${CYAN}44` : '#0f172a', color: division === d ? CYAN : '#94a3b8' }}
                >
                  {d}
                </button>
              ))}
            </div>
          ) : (
            <div className="flex justify-center">
              <Knob
                label="Time"
                color={CYAN}
                title="Delay time"
                value={num('time', 375)}
                min={1}
                max={2000}
                log
                reset={375}
                format={(v) => `${Math.round(v)} ms`}
                onChange={(v) => setParam('time', Math.round(v))}
              />
            </div>
          )}
          <div className="grid grid-cols-4 gap-1">
            <Knob
              label="Fdbk"
              color={feedback > 100 ? '#f87171' : CYAN}
              title={feedback > 100 ? 'Feedback — self-oscillating, soft-clipped' : 'Feedback'}
              value={feedback}
              min={0}
              max={110}
              reset={40}
              format={(v) => `${Math.round(v)} %`}
              onChange={(v) => setParam('feedback', Math.round(v))}
            />
            <Knob label="Damp" color={CYAN} title="Feedback damping" value={num('dDamp', 0.4)} min={0} max={1} reset={0.4} onChange={(v) => setParam('dDamp', v)} />
            <Knob label="Wow" color={CYAN} title="Wow and flutter" value={num('wow', 0.15)} min={0} max={1} reset={0.15} onChange={(v) => setParam('wow', v)} />
            <Knob label="Level" color={CYAN} title="Delay level" value={num('delayLevel', 0.6)} min={0} max={1} reset={0.6} onChange={(v) => setParam('delayLevel', v)} />
          </div>
        </div>

        {/* --------------------------------------------------------- reverb */}
        <div className="space-y-2 rounded border p-1.5" style={{ borderColor: `${VIOLET}55`, background: `${VIOLET}0d` }}>
          <div className="text-[9px] font-bold uppercase tracking-[0.2em]" style={{ color: VIOLET }}>
            Plate Reverb
          </div>
          <div className="flex gap-1">
            <Toggle
              on={freeze}
              label="FREEZE"
              color={VIOLET}
              title="Hold the tail indefinitely and stop new sound entering the tank"
              onClick={() => setParam('freeze', freeze ? 0 : 1)}
            />
            <Toggle
              on={series}
              label={series ? 'SERIES' : 'PARALLEL'}
              color={VIOLET}
              title="Parallel: reverb hears the dry signal. Series: it also hears the echoes."
              onClick={() => setParam('mode', series ? 'parallel' : 'series')}
            />
          </div>
          <div className="flex justify-center">
            <Knob
              label="Decay"
              color={VIOLET}
              title="Decay time"
              value={num('decay', 2.5)}
              min={0.2}
              max={15}
              log
              reset={2.5}
              format={(v) => `${v.toFixed(1)} s`}
              onChange={(v) => setParam('decay', Math.round(v * 10) / 10)}
            />
          </div>
          <div className="grid grid-cols-4 gap-1">
            <Knob
              label="Pre"
              color={VIOLET}
              title="Pre-delay"
              value={num('predelay', 20)}
              min={0}
              max={120}
              reset={20}
              format={(v) => `${Math.round(v)} ms`}
              onChange={(v) => setParam('predelay', Math.round(v))}
            />
            <Knob label="Damp" color={VIOLET} title="Reverb damping" value={num('rDamp', 0.5)} min={0} max={1} reset={0.5} onChange={(v) => setParam('rDamp', v)} />
            <Knob label="Diff" color={VIOLET} title="Diffusion" value={num('diffusion', 0.7)} min={0} max={1} reset={0.7} onChange={(v) => setParam('diffusion', v)} />
            <Knob label="Level" color={VIOLET} title="Reverb level" value={num('reverbLevel', 0.5)} min={0} max={1} reset={0.5} onChange={(v) => setParam('reverbLevel', v)} />
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3 rounded bg-slate-900/60 px-2 py-1">
        <Knob
          label="Dry/Wet"
          color="#e2e8f0"
          title="Dry / wet (equal-power)"
          value={num('mix', 0.35)}
          min={0}
          max={1}
          reset={0.35}
          format={(v) => `${Math.round(v * 100)} %`}
          onChange={(v) => setParam('mix', v)}
        />
        <div className="flex-1" />
        <LedMeter read={reading(0)} width={8} height={40} leds={12} />
        <LedMeter read={reading(1)} width={8} height={40} leds={12} />
      </div>
    </div>
  )
}
