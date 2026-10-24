import { useNodeConnections, useReactFlow } from '@xyflow/react'
import { MIXER_CHANNELS } from '../../audio/nodes/MixerImpl'
import { NODE_DEFS } from '../../audio/nodeDefs'
import type { PatchNodeData } from '../../audio/types'
import type { ParamSpec } from '../../audio/types'
import type { NodeUIProps } from './types'

const SPEC = (key: string): ParamSpec | undefined => NODE_DEFS.mixer.params.find((p) => p.key === key)

function Fader({
  spec,
  value,
  onChange,
  vertical,
}: {
  spec: ParamSpec
  value: number
  onChange: (v: number) => void
  vertical?: boolean
}) {
  if (spec.control !== 'slider') return null
  const pct = ((value - spec.min) / (spec.max - spec.min)) * 100
  return (
    <label className="block" title={`${spec.label}: ${value}`}>
      <div className={`relative ${vertical ? 'h-16 w-full' : 'h-1 w-full'} rounded bg-slate-900`}>
        <div
          className="absolute rounded bg-sky-500/70"
          style={vertical ? { bottom: 0, left: 0, right: 0, height: `${pct}%` } : { top: 0, bottom: 0, left: 0, width: `${pct}%` }}
        />
        <input
          type="range"
          className={`nodrag nopan absolute inset-0 w-full cursor-pointer appearance-none bg-transparent accent-sky-400 ${
            vertical ? 'h-16' : 'h-1'
          }`}
          style={vertical ? { writingMode: 'vertical-lr', direction: 'rtl' } : undefined}
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
 * Four channel strips plus a master fader.
 *
 * A channel lights up only when something is patched into it, so the strip
 * doubles as a readout of what is actually feeding the mix.
 */
export function MixerUI({ nodeId, params, setParam }: NodeUIProps) {
  const connections = useNodeConnections({ id: nodeId, handleType: 'target' })
  const { getNode } = useReactFlow()
  const live = new Set(connections.map((c) => c.targetHandle).filter(Boolean) as string[])
  const num = (key: string, fallback: number) => Number(params[key] ?? fallback)

  /**
   * A channel is named after whatever feeds it. Numbered strips tell you
   * nothing about which one is the drums, which is the only question anyone
   * actually asks a mixer.
   */
  const sourceName = (channel: number): string | null => {
    const link = connections.find((c) => c.targetHandle === `in${channel}`)
    if (!link) return null
    const node = getNode(link.source)
    if (!node) return null
    const data = node.data as PatchNodeData
    const custom = String(data.params?.name ?? '').trim()
    return custom || NODE_DEFS[data.type]?.label || link.source
  }

  return (
    <div className="space-y-1.5">
      <div className="grid grid-cols-4 gap-1 rounded bg-slate-900/60 p-1.5">
        {Array.from({ length: MIXER_CHANNELS }, (_, i) => {
          const ch = i + 1
          const muted = num(`mute${ch}`, 0) >= 0.5
          const patched = live.has(`in${ch}`)
          const feeding = sourceName(ch)
          return (
            <div key={ch} className={`flex flex-col items-center gap-1 rounded p-1 ${patched ? 'bg-sky-400/10' : ''}`}>
              <span
                title={feeding ? `Channel ${ch} — fed by ${feeding}` : `Channel ${ch} — nothing patched in`}
                className={`w-full truncate text-center text-[8px] font-semibold ${
                  patched ? 'text-sky-300' : 'text-slate-600'
                }`}
              >
                {feeding ?? ch}
              </span>
              <Fader
                spec={SPEC(`level${ch}`)!}
                value={num(`level${ch}`, 0.8)}
                onChange={(v) => setParam(`level${ch}`, v)}
                vertical
              />
              <span className="tabular-nums text-[8px] text-slate-400">{num(`level${ch}`, 0.8).toFixed(2)}</span>
              <Fader spec={SPEC(`pan${ch}`)!} value={num(`pan${ch}`, 0)} onChange={(v) => setParam(`pan${ch}`, v)} />
              <button
                title={`Mute channel ${ch}`}
                onClick={() => setParam(`mute${ch}`, muted ? 0 : 1)}
                className={`nodrag nopan w-full rounded px-1 py-0.5 text-[8px] font-semibold transition-colors ${
                  muted ? 'bg-rose-500 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                }`}
              >
                M
              </button>
            </div>
          )
        })}
      </div>

      <label className="block text-[10px]">
        <span className="mb-0.5 flex items-center justify-between">
          <span className="text-slate-400">Master</span>
          <span className="tabular-nums text-slate-200">{num('master', 0.9).toFixed(2)}</span>
        </span>
        <Fader spec={SPEC('master')!} value={num('master', 0.9)} onChange={(v) => setParam('master', v)} />
      </label>
    </div>
  )
}
