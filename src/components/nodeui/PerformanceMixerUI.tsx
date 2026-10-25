import { useCallback } from 'react'
import { engine } from '../../audio/AudioEngine'
import { PERF_CHANNELS, type PerformanceMixerImpl } from '../../audio/nodes/PerformanceMixerImpl'
import { ampToDb, dbToFader, faderToDb } from '../../audio/mixMath'
import { Knob } from './Knob'
import { LedMeter } from './LedMeter'
import type { NodeUIProps } from './types'

const CYAN = '#22d3ee'
const VIOLET = '#a78bfa'
const TICKS = [6, 0, -10, -25, -50]
const FADER_H = 112

const sign = (db: number) => (db > 0 ? `+${db}` : `${db}`)

/** Reads a fader position as dB text. */
const faderText = (pos: number) => {
  const db = faderToDb(pos)
  return Number.isFinite(db) ? `${db.toFixed(1)} dB` : '-∞'
}

function Fader({ value, onChange, title }: { value: number; onChange: (v: number) => void; title: string }) {
  return (
    <div className="relative flex" style={{ height: FADER_H, width: 30 }} title={`${title}: ${faderText(value)}`}>
      <div className="relative" style={{ width: 16, height: FADER_H }}>
        <div className="absolute inset-y-0 left-1/2 w-1 -translate-x-1/2 rounded bg-slate-900" />
        <div
          className="pointer-events-none absolute left-0 right-0 h-3 rounded-sm border border-slate-400 bg-slate-300 shadow"
          style={{ bottom: `calc(${value * 100}% - 6px)` }}
        />
        <input
          type="range"
          aria-label={title}
          className="nodrag nopan absolute inset-0 h-full w-full cursor-pointer opacity-0"
          style={{ writingMode: 'vertical-lr', direction: 'rtl' }}
          min={0}
          max={1}
          step={0.005}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          onDoubleClick={() => onChange(0.75)}
        />
      </div>
      <div className="pointer-events-none relative ml-0.5 flex-1">
        {TICKS.map((db) => (
          <span
            key={db}
            className="absolute whitespace-nowrap text-[6px] leading-none text-slate-500"
            style={{ bottom: `${dbToFader(db) * 100}%`, transform: 'translateY(50%)' }}
          >
            {sign(db)}
          </span>
        ))}
      </div>
    </div>
  )
}

function LedButton({
  on,
  color,
  label,
  title,
  onClick,
}: {
  on: boolean
  color: string
  label: string
  title: string
  onClick: () => void
}) {
  return (
    <button
      title={title}
      aria-pressed={on}
      onClick={onClick}
      className="nodrag nopan flex w-full items-center justify-center gap-1 rounded bg-slate-900 px-1 py-0.5 text-[8px] font-bold text-slate-300 hover:bg-slate-800"
    >
      <span
        className="h-1.5 w-1.5 rounded-full"
        style={{ background: on ? color : '#334155', boxShadow: on ? `0 0 5px ${color}` : 'none' }}
      />
      {label}
    </button>
  )
}

/** Six console strips and a master section. */
export function PerformanceMixerUI({ nodeId, params, setParam }: NodeUIProps) {
  const num = (key: string, fallback: number) => Number(params[key] ?? fallback)
  const impl = useCallback(() => engine.getImpl(nodeId) as PerformanceMixerImpl | undefined, [nodeId])
  const zero = { peak: -100, rms: -100 }

  const readChannel = (ch: number) => () => {
    const lv = impl()?.getChannelLevel(ch)
    return lv ? { peak: ampToDb(lv.peak), rms: ampToDb(lv.rms) } : zero
  }
  const readMaster = (side: 'l' | 'r') => () => {
    const lv = impl()?.getMasterLevel()[side]
    return lv ? { peak: ampToDb(lv.peak), rms: ampToDb(lv.rms) } : zero
  }

  return (
    <div className="flex gap-1 rounded bg-slate-950/70 p-1.5">
      {Array.from({ length: PERF_CHANNELS }, (_, i) => {
        const ch = i + 1
        const muted = num(`mute${ch}`, 0) >= 0.5
        const solo = num(`solo${ch}`, 0) >= 0.5
        return (
          <div key={ch} className="flex w-[66px] flex-col items-center gap-1 rounded bg-slate-800/80 p-1">
            <input
              type="text"
              aria-label={`Channel ${ch} label`}
              maxLength={8}
              value={String(params[`label${ch}`] ?? '')}
              placeholder={`CH ${ch}`}
              onChange={(e) => setParam(`label${ch}`, e.target.value)}
              className="nodrag nopan w-full rounded bg-slate-900 px-1 py-0.5 text-center text-[9px] font-semibold text-slate-200 outline-none ring-1 ring-white/10 placeholder:text-slate-600 focus:ring-sky-400"
            />
            <Knob
              label="Trim"
              title={`Ch ${ch} trim (dB)`}
              value={num(`trim${ch}`, 0)}
              min={-12}
              max={12}
              reset={0}
              size={24}
              format={(v) => `${v.toFixed(1)} dB`}
              onChange={(v) => setParam(`trim${ch}`, v)}
            />
            <Knob
              label="Aux A"
              color={CYAN}
              title={`Ch ${ch} Aux A send`}
              value={num(`auxA${ch}`, 0)}
              min={0}
              max={1}
              reset={0}
              onChange={(v) => setParam(`auxA${ch}`, v)}
            />
            <LedButton
              on={num(`preA${ch}`, 0) >= 0.5}
              color={CYAN}
              label="PRE"
              title="Aux A send taps pre-fader (lit) or post-fader"
              onClick={() => setParam(`preA${ch}`, num(`preA${ch}`, 0) >= 0.5 ? 0 : 1)}
            />
            <Knob
              label="Aux B"
              color={VIOLET}
              title={`Ch ${ch} Aux B send`}
              value={num(`auxB${ch}`, 0)}
              min={0}
              max={1}
              reset={0}
              onChange={(v) => setParam(`auxB${ch}`, v)}
            />
            <LedButton
              on={num(`preB${ch}`, 0) >= 0.5}
              color={VIOLET}
              label="PRE"
              title="Aux B send taps pre-fader (lit) or post-fader"
              onClick={() => setParam(`preB${ch}`, num(`preB${ch}`, 0) >= 0.5 ? 0 : 1)}
            />
            <Knob
              label="Pan"
              color="#cbd5e1"
              title={`Ch ${ch} pan`}
              value={num(`pan${ch}`, 0)}
              min={-1}
              max={1}
              reset={0}
              format={(v) => (Math.abs(v) < 0.02 ? 'C' : v < 0 ? `L${Math.round(-v * 100)}` : `R${Math.round(v * 100)}`)}
              onChange={(v) => setParam(`pan${ch}`, v)}
            />
            <div className="flex w-full gap-0.5">
              <LedButton
                on={muted}
                color="#ef4444"
                label="M"
                title={`Mute channel ${ch}`}
                onClick={() => setParam(`mute${ch}`, muted ? 0 : 1)}
              />
              <LedButton
                on={solo}
                color="#f59e0b"
                label="S"
                title={`Solo channel ${ch} (silences un-soloed channels without changing their mute)`}
                onClick={() => setParam(`solo${ch}`, solo ? 0 : 1)}
              />
            </div>
            <div className="flex items-end gap-1">
              <Fader title={`Ch ${ch} fader`} value={num(`fader${ch}`, 0.75)} onChange={(v) => setParam(`fader${ch}`, v)} />
              <LedMeter read={readChannel(ch)} width={8} height={FADER_H} />
            </div>
          </div>
        )
      })}

      <div className="flex w-[84px] flex-col items-center gap-1 rounded bg-slate-800/80 p-1">
        <span className="py-0.5 text-[9px] font-bold tracking-wider text-slate-300">MASTER</span>
        <Knob
          label="Ret A"
          color={CYAN}
          title="Aux A return level"
          value={num('retA', 1)}
          min={0}
          max={1.5}
          reset={1}
          onChange={(v) => setParam('retA', v)}
        />
        <Knob
          label="Ret B"
          color={VIOLET}
          title="Aux B return level"
          value={num('retB', 1)}
          min={0}
          max={1.5}
          reset={1}
          onChange={(v) => setParam('retB', v)}
        />
        <div className="flex-1" />
        <div className="flex items-end gap-1">
          <Fader title="Master fader" value={num('master', 0.75)} onChange={(v) => setParam('master', v)} />
          <LedMeter read={readMaster('l')} width={8} height={FADER_H} />
          <LedMeter read={readMaster('r')} width={8} height={FADER_H} />
        </div>
      </div>
    </div>
  )
}
