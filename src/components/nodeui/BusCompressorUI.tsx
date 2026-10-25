import { useCallback, useEffect, useRef } from 'react'
import { engine } from '../../audio/AudioEngine'
import type { BusCompressorImpl } from '../../audio/nodes/BusCompressorImpl'
import { Knob } from './Knob'
import { useFrame } from './useFrame'
import type { NodeUIProps } from './types'

const AMBER = '#f59e0b'
const GR_RANGE = 20
const GR_TICKS = [0, 3, 6, 10, 15, 20]
const GR_H = 120
const HPF_OPTIONS = ['off', '80', '120', '300']

/** Gain-reduction meter: starts at 0 dB at the top and falls toward -20 as it works. */
function GrMeter({ read }: { read: () => number }) {
  const bar = useRef<HTMLDivElement>(null)
  const peak = useRef<HTMLDivElement>(null)
  const state = useRef({ gr: 0, hold: 0, holdAt: 0 })

  useFrame(() => {
    const s = state.current
    const now = performance.now()
    const gr = Math.min(GR_RANGE, Math.max(0, read()))
    s.gr = gr > s.gr ? gr : Math.max(gr, s.gr - 0.8)
    if (gr >= s.hold) {
      s.hold = gr
      s.holdAt = now
    } else if (now - s.holdAt > 700) s.hold = Math.max(gr, s.hold - 0.4)
    if (bar.current) bar.current.style.height = `${(s.gr / GR_RANGE) * 100}%`
    if (peak.current) peak.current.style.top = `${(s.hold / GR_RANGE) * 100}%`
  })

  return (
    <div className="flex items-stretch gap-1" style={{ height: GR_H }} title="Gain reduction (dB)">
      <div className="relative w-3 overflow-hidden rounded-sm bg-black/70 ring-1 ring-black">
        <div ref={bar} className="absolute left-0 right-0 top-0" style={{ background: 'linear-gradient(#fbbf24, #f97316)' }} />
        <div ref={peak} className="absolute left-0 right-0 h-px bg-white/80" />
      </div>
      <div className="relative w-5">
        {GR_TICKS.map((db) => (
          <span
            key={db}
            className="absolute left-0 whitespace-nowrap text-[7px] leading-none text-amber-100/70"
            style={{ top: `${(db / GR_RANGE) * 100}%`, transform: 'translateY(-50%)' }}
          >
            {db === 0 ? '0' : `-${db}`}
          </span>
        ))}
      </div>
    </div>
  )
}

function RackButton({
  on,
  label,
  title,
  onClick,
  wide,
}: {
  on: boolean
  label: string
  title: string
  onClick: () => void
  wide?: boolean
}) {
  return (
    <button
      title={title}
      aria-pressed={on}
      onClick={onClick}
      className={`nodrag nopan flex items-center justify-center gap-1 rounded-sm border px-1.5 py-1 text-[9px] font-bold tracking-wider ${
        wide ? 'flex-1' : ''
      } ${on ? 'border-amber-300/60 bg-amber-200/90 text-stone-900' : 'border-stone-600 bg-stone-800 text-stone-300 hover:bg-stone-700'}`}
    >
      <span
        className="h-1.5 w-1.5 rounded-full"
        style={{ background: on ? '#b45309' : '#44403c', boxShadow: on ? '0 0 4px #f59e0b' : 'none' }}
      />
      {label}
    </button>
  )
}

const Screw = () => <span className="h-2 w-2 rounded-full bg-stone-500 ring-1 ring-black/60" />

/** Vintage rack face: brushed panel, cream legends, amber GR meter. */
export function BusCompressorUI({ nodeId, params, setParam }: NodeUIProps) {
  const impl = useCallback(() => engine.getImpl(nodeId) as BusCompressorImpl | undefined, [nodeId])
  const num = (key: string, fallback: number) => Number(params[key] ?? fallback)
  const mode = String(params.mode ?? 'bus')
  const duck = mode === 'duck'
  const inf = num('inf', 0) >= 0.5
  const auto = num('auto', 0) >= 0.5
  const listen = num('listen', 0) >= 0.5
  const hpf = String(params.hpf ?? 'off')

  // Listening to the trigger must not outlive the Listen button being visible.
  useEffect(() => {
    if (!duck && listen) setParam('listen', 0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [duck])

  return (
    <div
      className="space-y-2 rounded border border-stone-950 p-2"
      style={{ background: 'linear-gradient(180deg,#44403c,#292524 40%,#1c1917)' }}
    >
      <div className="flex items-center justify-between">
        <Screw />
        <span className="font-serif text-[10px] font-semibold uppercase tracking-[0.25em] text-amber-100/80">
          {duck ? 'Sidechain Ducker' : 'Bus Compressor'}
        </span>
        <Screw />
      </div>

      <div className="flex gap-1">
        <RackButton on={!duck} wide label="BUS" title="Master-bus glue compressor" onClick={() => setParam('mode', 'bus')} />
        <RackButton on={duck} wide label="DUCK" title="Sidechain ducking" onClick={() => setParam('mode', 'duck')} />
      </div>

      <div className="flex items-start gap-2">
        <div className="grid flex-1 grid-cols-3 gap-x-1 gap-y-2 rounded-sm bg-black/25 p-1.5">
          <Knob
            label="Thresh"
            color={AMBER}
            title="Threshold (dB)"
            value={num('threshold', -18)}
            min={-60}
            max={0}
            reset={-18}
            format={(v) => `${v.toFixed(1)} dB`}
            onChange={(v) => setParam('threshold', Math.round(v * 2) / 2)}
          />
          <div className="flex flex-col items-center gap-1">
            <Knob
              label="Ratio"
              color={AMBER}
              title="Ratio"
              value={inf ? 20 : num('ratio', 4)}
              min={1}
              max={20}
              reset={4}
              format={(v) => (inf ? '∞:1' : `${v.toFixed(1)}:1`)}
              onChange={(v) => {
                if (inf) setParam('inf', 0)
                setParam('ratio', Math.round(v * 10) / 10)
              }}
            />
            <RackButton on={inf} label="∞" title="Infinity ratio — brickwall" onClick={() => setParam('inf', inf ? 0 : 1)} />
          </div>
          <Knob
            label="Attack"
            color={AMBER}
            title="Attack (ms)"
            value={num('attack', 10)}
            min={0.1}
            max={100}
            log
            reset={10}
            format={(v) => `${v.toFixed(1)} ms`}
            onChange={(v) => setParam('attack', Math.round(v * 10) / 10)}
          />
          <div className="flex flex-col items-center gap-1">
            <Knob
              label="Release"
              color={AMBER}
              title="Release (ms)"
              value={num('release', 150)}
              min={10}
              max={1200}
              log
              reset={150}
              format={(v) => `${Math.round(v)} ms`}
              onChange={(v) => setParam('release', Math.round(v))}
            />
            <RackButton on={auto} label="AUTO" title="Program-dependent release" onClick={() => setParam('auto', auto ? 0 : 1)} />
          </div>
          <Knob
            label="Makeup"
            color={AMBER}
            title="Makeup gain (dB)"
            value={num('makeup', 0)}
            min={0}
            max={24}
            reset={0}
            format={(v) => `+${v.toFixed(1)} dB`}
            onChange={(v) => setParam('makeup', Math.round(v * 10) / 10)}
          />
          <div className={duck ? '' : 'opacity-40'}>
            <Knob
              label="Depth"
              color="#fde68a"
              title="Ducking depth (%) — duck mode"
              value={num('depth', 100)}
              min={0}
              max={100}
              reset={100}
              format={(v) => `${Math.round(v)} %`}
              onChange={(v) => setParam('depth', Math.round(v))}
            />
          </div>
        </div>

        <div className="rounded-sm bg-black/40 p-1.5">
          <GrMeter read={() => impl()?.getGainReductionDb() ?? 0} />
          <div className="mt-0.5 text-center text-[7px] font-semibold uppercase tracking-wider text-amber-100/70">GR dB</div>
        </div>
      </div>

      <div className={`flex items-center gap-1 ${duck ? '' : 'opacity-40'}`}>
        <span className="text-[8px] font-semibold uppercase tracking-wider text-amber-100/70">SC HPF</span>
        {HPF_OPTIONS.map((opt) => (
          <RackButton
            key={opt}
            on={hpf === opt}
            wide
            label={opt === 'off' ? 'OFF' : opt}
            title={opt === 'off' ? 'No sidechain filter' : `Sidechain high-pass at ${opt} Hz`}
            onClick={() => setParam('hpf', opt)}
          />
        ))}
        <RackButton
          on={listen}
          label="LISTEN SC"
          title="Audition the sidechain trigger (post filter) in place of the output"
          onClick={() => setParam('listen', listen ? 0 : 1)}
        />
      </div>
    </div>
  )
}
