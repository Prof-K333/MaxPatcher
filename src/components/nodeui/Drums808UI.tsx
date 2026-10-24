import { useEffect, useRef, useState } from 'react'
import { engine } from '../../audio/AudioEngine'
import type { DrumMachine808Impl } from '../../audio/nodes/DrumMachine808Impl'
import type { VoiceId } from '../../audio/drums/DrumSynth808Engine'
import { NODE_DEFS } from '../../audio/nodeDefs'
import type { ParamSpec } from '../../audio/types'
import type { NodeUIProps } from './types'

/** Which sound-shaping params belong on each voice strip. */
const STRIPS: Array<{ id: VoiceId; label: string; tint: string; params: string[] }> = [
  { id: 'bd', label: 'BD', tint: '#f97316', params: ['bdTone', 'bdSub', 'bdSweep', 'bdDecay', 'bdDrive'] },
  { id: 'sd', label: 'SD', tint: '#fb923c', params: ['sdTune', 'sdSnappy', 'sdDecay'] },
  { id: 'cp', label: 'CP', tint: '#fbbf24', params: ['cpDecay', 'cpSpread'] },
  { id: 'ch', label: 'CH', tint: '#facc15', params: ['chDecay', 'hhTune'] },
  { id: 'oh', label: 'OH', tint: '#fde047', params: ['ohDecay'] },
  { id: 'cb', label: 'CB', tint: '#f59e0b', params: ['cbDecay'] },
]

const SPEC = (key: string): ParamSpec | undefined => NODE_DEFS.drums808.params.find((p) => p.key === key)

/** A very small vertical fader, sized for six strips side by side. */
function MiniSlider({
  spec,
  value,
  onChange,
}: {
  spec: ParamSpec
  value: number
  onChange: (v: number) => void
}) {
  if (spec.control !== 'slider') return null
  const pct = ((value - spec.min) / (spec.max - spec.min)) * 100
  return (
    <label className="block" title={`${spec.label}: ${value}`}>
      <span className="mb-px flex items-center justify-between text-[8px] leading-tight text-slate-400">
        <span className="truncate">{spec.label}</span>
        <span className="tabular-nums text-slate-300">{value >= 100 ? value.toFixed(0) : value.toFixed(2)}</span>
      </span>
      <div className="relative h-1 w-full rounded bg-slate-900">
        <div className="absolute inset-y-0 left-0 rounded bg-amber-500/70" style={{ width: `${pct}%` }} />
        <input
          type="range"
          className="nodrag nopan absolute inset-0 h-1 w-full cursor-pointer appearance-none bg-transparent accent-amber-400"
          min={spec.min}
          max={spec.max}
          step={spec.step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
        />
      </div>
    </label>
  )
}

/**
 * Retro drum-machine face: one strip per voice, each with its own pad,
 * sound-shaping faders and mixer controls.
 *
 * Pads flash from the engine's own trigger callback rather than from the
 * click handler, so a hit arriving over a cable lights the pad too.
 */
export function Drums808UI({ nodeId, params, setParam }: NodeUIProps) {
  const [flash, setFlash] = useState<Partial<Record<VoiceId, number>>>({})
  const timers = useRef<Partial<Record<VoiceId, number>>>({})

  useEffect(() => {
    const impl = engine.getImpl(nodeId) as DrumMachine808Impl | undefined
    if (!impl) return
    impl.onVoiceTrigger = (voice) => {
      setFlash((f) => ({ ...f, [voice]: (f[voice] ?? 0) + 1 }))
      window.clearTimeout(timers.current[voice])
      timers.current[voice] = window.setTimeout(() => setFlash((f) => ({ ...f, [voice]: 0 })), 110)
    }
    return () => {
      impl.onVoiceTrigger = null
      Object.values(timers.current).forEach((t) => window.clearTimeout(t))
    }
  }, [nodeId])

  const hit = (voice: VoiceId) => {
    const impl = engine.getImpl(nodeId) as DrumMachine808Impl | undefined
    impl?.triggerVoice(voice, Number(params.accent ?? 0.8) + 0.2)
  }

  const drive = Number(params.drive ?? 1) >= 0.5
  const num = (key: string, fallback: number) => Number(params[key] ?? fallback)

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-6 gap-1 rounded-md bg-gradient-to-b from-slate-900 to-slate-950 p-1.5 ring-1 ring-amber-500/20">
        {STRIPS.map((strip) => (
          <div key={strip.id} className="flex flex-col gap-1 rounded bg-slate-900/70 p-1">
            <button
              title={`Play the ${strip.label} voice`}
              onPointerDown={(e) => {
                e.stopPropagation()
                hit(strip.id)
              }}
              className="nodrag nopan relative rounded border border-black/40 py-1.5 text-[10px] font-bold tracking-wider text-slate-950 transition-transform active:scale-95"
              style={{
                background: flash[strip.id] ? '#fff7ed' : strip.tint,
                boxShadow: flash[strip.id] ? `0 0 10px 2px ${strip.tint}` : 'inset 0 -2px 0 rgba(0,0,0,0.35)',
              }}
            >
              {strip.label}
            </button>

            {strip.params.map((key) => {
              const spec = SPEC(key)
              if (!spec || spec.control !== 'slider') return null
              return (
                <MiniSlider
                  key={key}
                  spec={spec}
                  value={num(key, Number(spec.default))}
                  onChange={(v) => setParam(key, v)}
                />
              )
            })}

            <div className="mt-auto space-y-0.5 border-t border-white/5 pt-1">
              {(['level', 'pan'] as const).map((which) => {
                const spec = SPEC(`${which}_${strip.id}`)
                if (!spec || spec.control !== 'slider') return null
                return (
                  <MiniSlider
                    key={which}
                    spec={{ ...spec, label: which === 'level' ? 'Vol' : 'Pan' }}
                    value={num(`${which}_${strip.id}`, Number(spec.default))}
                    onChange={(v) => setParam(`${which}_${strip.id}`, v)}
                  />
                )
              })}
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-end gap-2 rounded-md bg-slate-900/70 p-1.5">
        <div className="flex-1">
          <MiniSlider
            spec={{ ...(SPEC('masterVolume') as ParamSpec), label: 'Master' }}
            value={num('masterVolume', 0.9)}
            onChange={(v) => setParam('masterVolume', v)}
          />
        </div>
        <div className="flex-1">
          <MiniSlider
            spec={{ ...(SPEC('accent') as ParamSpec), label: 'Accent' }}
            value={num('accent', 0.8)}
            onChange={(v) => setParam('accent', v)}
          />
        </div>
        <button
          title="Global saturation — analog warmth across the whole kit"
          onClick={() => setParam('drive', drive ? 0 : 1)}
          className={`nodrag nopan rounded px-2 py-1 text-[9px] font-semibold transition-colors ${
            drive ? 'bg-orange-500 text-slate-950' : 'bg-slate-800 text-slate-400'
          }`}
        >
          SAT
        </button>
      </div>
    </div>
  )
}
