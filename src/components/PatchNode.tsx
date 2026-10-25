import { memo, type ComponentType } from 'react'
import { Handle, Position, useNodeConnections, useReactFlow, type NodeProps, type Node } from '@xyflow/react'
import { NODE_DEFS, modDepthKey } from '../audio/nodeDefs'
import type { PatchNodeData, PortKind, PortSpec } from '../audio/types'
import { ParamControl } from './ParamControl'
import { KeyboardUI } from './nodeui/KeyboardUI'
import { SamplerUI } from './nodeui/SamplerUI'
import { LooperUI } from './nodeui/LooperUI'
import { GranularUI } from './nodeui/GranularUI'
import { Drums808UI } from './nodeui/Drums808UI'
import { MixerUI } from './nodeui/MixerUI'
import { PerformanceMixerUI } from './nodeui/PerformanceMixerUI'
import { LiveLooperUI } from './nodeui/LiveLooperUI'
import { DrumSeqUI } from './nodeui/DrumSeqUI'
import { ArpUI } from './nodeui/ArpUI'
import { MasterUI } from './nodeui/MasterUI'
import type { NodeUIProps } from './nodeui/types'

type PatchNode = Node<PatchNodeData>

/** Custom bodies, keyed by a node definition's `ui` field. */
const NODE_UI: Record<string, ComponentType<NodeUIProps>> = {
  keyboard: KeyboardUI,
  sampler: SamplerUI,
  looper: LooperUI,
  granular: GranularUI,
  drums808: Drums808UI,
  mixer: MixerUI,
  performanceMixer: PerformanceMixerUI,
  liveLooper: LiveLooperUI,
  drumSeq: DrumSeqUI,
  arp: ArpUI,
  master: MasterUI,
}

/** Each port kind gets its own colour and shape so cables read at a glance. */
const PORT_STYLE: Record<PortKind, { color: string; radius: string }> = {
  audio: { color: '#38bdf8', radius: '2px' },
  param: { color: '#a78bfa', radius: '50%' },
  cv: { color: '#a78bfa', radius: '50%' },
  event: { color: '#fbbf24', radius: '2px' },
}

const portOffset = (index: number, total: number) => `${((index + 1) / (total + 1)) * 100}%`

function PortRow({ ports, position }: { ports: PortSpec[]; position: Position }) {
  const horizontal = position === Position.Left || position === Position.Right
  const isTarget = position === Position.Top || position === Position.Left
  return (
    <>
      {ports.map((port, i) => {
        const style = PORT_STYLE[port.kind]
        const offset = portOffset(i, ports.length)
        return (
          <Handle
            key={port.id}
            id={port.id}
            type={isTarget ? 'target' : 'source'}
            position={position}
            title={port.label}
            style={{
              ...(horizontal ? { top: offset } : { left: offset }),
              background: style.color,
              borderRadius: style.radius,
              width: 11,
              height: 11,
            }}
          />
        )
      })}
    </>
  )
}

/** Edge-hugging labels for a node whose ports run down its sides. */
function SidePortLabels({ ports, side }: { ports: PortSpec[]; side: 'left' | 'right' }) {
  if (!ports.length) return null
  return (
    <div className="pointer-events-none absolute inset-y-0" style={{ [side]: 4, fontSize: 8 } as React.CSSProperties}>
      {ports.map((port, i) => (
        <span
          key={port.id}
          className="absolute -translate-y-1/2 whitespace-nowrap"
          style={{
            top: portOffset(i, ports.length),
            [side]: 0,
            color: PORT_STYLE[port.kind].color,
            opacity: 0.8,
          }}
        >
          {port.label}
        </span>
      ))}
    </div>
  )
}

/** Tiny labels under/over the handles, so a dense node stays patchable. */
function PortLabels({ ports, side }: { ports: PortSpec[]; side: 'top' | 'bottom' }) {
  if (!ports.length) return null
  return (
    <div
      className={`pointer-events-none absolute left-0 right-0 flex ${side === 'top' ? 'top-0.5' : 'bottom-0.5'}`}
      style={{ fontSize: 8 }}
    >
      {ports.map((port, i) => (
        <span
          key={port.id}
          className="absolute -translate-x-1/2 whitespace-nowrap"
          style={{ left: portOffset(i, ports.length), color: PORT_STYLE[port.kind].color, opacity: 0.75 }}
        >
          {port.label}
        </span>
      ))}
    </div>
  )
}

export const PatchNodeView = memo(({ id, data, selected }: NodeProps<PatchNode>) => {
  const def = NODE_DEFS[data.type]
  const { updateNodeData } = useReactFlow()

  const setParam = (key: string, value: number | string) =>
    updateNodeData(id, { params: { ...data.params, [key]: value } })

  const CustomUI = def.ui ? NODE_UI[def.ui] : undefined
  const customName = String(data.params.name ?? '').trim()

  // Depth controls appear only for inlets that actually have a cable, so an
  // unpatched node stays uncluttered.
  const connections = useNodeConnections({ id, handleType: 'target' })
  const patchedInlets = new Set(connections.map((c) => c.targetHandle).filter(Boolean) as string[])
  const modSpecs = def.inputs
    .filter((inlet) => patchedInlets.has(inlet.id))
    .map((inlet) => modDepthKey(inlet.id))
    .filter((key): key is string => !!key)
    .map((key) => def.params.find((p) => p.key === key))
    .filter((spec): spec is NonNullable<typeof spec> => !!spec)

  const visibleParams = def.params.filter((p) => !p.hidden)
  // Dense nodes get two columns rather than a scroll of sliders.
  const twoColumn = visibleParams.length > 8
  const horizontal = def.ports === 'horizontal'

  return (
    <div
      className={`relative rounded-lg border bg-slate-800/95 shadow-lg backdrop-blur transition-colors ${
        selected ? 'border-sky-400' : 'border-white/10'
      }`}
      style={{ width: def.width ?? 188 }}
    >
      <PortRow ports={def.inputs} position={horizontal ? Position.Left : Position.Top} />

      {horizontal && <SidePortLabels ports={def.inputs} side="left" />}
      {horizontal && <SidePortLabels ports={def.outputs} side="right" />}

      <header
        className={`relative flex items-center gap-1.5 rounded-t-lg text-[11px] font-semibold tracking-wide ${
          horizontal ? 'px-2.5 py-1.5' : 'px-2.5 pb-1.5 pt-3'
        }`}
        style={{ background: `${def.accent}22`, color: def.accent }}
      >
        {!horizontal && <PortLabels ports={def.inputs} side="top" />}
        <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ background: def.accent }} />
        <span className="truncate">{customName || def.label}</span>
        {customName && <span className="shrink-0 text-[9px] font-normal opacity-60">{def.label}</span>}
      </header>

      <div className={`space-y-2 py-2 ${horizontal ? 'px-9' : 'px-2.5'}`}>
        {CustomUI && (
          <CustomUI
            nodeId={id}
            params={data.params}
            setParam={setParam}
            selected={!!selected}
            isDockTarget={!!data.isDockTarget}
          />
        )}

        <div className={twoColumn ? 'grid grid-cols-2 gap-x-2 gap-y-1.5' : 'space-y-2'}>
          {visibleParams.map((spec) => (
            <ParamControl
              key={spec.key}
              spec={spec}
              value={data.params[spec.key] ?? spec.default}
              onChange={(v) => setParam(spec.key, v)}
              compact={twoColumn}
            />
          ))}
        </div>

        {modSpecs.length > 0 && (
          <div className="space-y-1 rounded border border-violet-400/25 bg-violet-400/5 px-1.5 py-1">
            <p className="text-[8px] font-semibold uppercase tracking-wider text-violet-300/80">Mod depth</p>
            {modSpecs.map((spec) => (
              <ParamControl
                key={spec.key}
                spec={spec}
                value={data.params[spec.key] ?? spec.default}
                onChange={(v) => setParam(spec.key, v)}
                compact
              />
            ))}
          </div>
        )}
      </div>

      {!horizontal && (
        <div className="relative h-3">
          <PortLabels ports={def.outputs} side="bottom" />
        </div>
      )}

      <PortRow ports={def.outputs} position={horizontal ? Position.Right : Position.Bottom} />
    </div>
  )
})

PatchNodeView.displayName = 'PatchNodeView'
