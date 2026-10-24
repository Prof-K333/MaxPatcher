import { useEffect, useRef, useState, type ReactNode } from 'react'
import { engine } from '../audio/AudioEngine'
import { NODE_DEFS } from '../audio/nodeDefs'

interface Props {
  children?: ReactNode
  running: boolean
  onToggle: () => void
  masterVolume: number
  onMasterVolume: (db: number) => void
  onAdd: (type: string) => void
  onClear: () => void
}

/** Post-master peak meter, polled off the render loop. */
function LevelMeter({ running }: { running: boolean }) {
  const barRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!running) {
      if (barRef.current) barRef.current.style.width = '0%'
      return
    }
    let frame = 0
    const tick = () => {
      const db = engine.getMasterLevel()
      const pct = Number.isFinite(db) ? Math.max(0, Math.min(1, (db + 60) / 66)) * 100 : 0
      if (barRef.current) barRef.current.style.width = `${pct}%`
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [running])

  return (
    <div className="h-1.5 w-24 overflow-hidden rounded-full bg-slate-700">
      <div ref={barRef} className="h-full w-0 rounded-full bg-emerald-400 transition-[width] duration-75" />
    </div>
  )
}

const PALETTE = Object.values(NODE_DEFS).filter((d) => d.type !== 'destination')

/** Palette order, so related modules sit together. */
const GROUPS: Array<{ title: string; categories: string[] }> = [
  { title: 'Sources', categories: ['source', 'voice'] },
  { title: 'Shaping', categories: ['effect'] },
  { title: 'Control', categories: ['control', 'modulator'] },
]

/** Reminds you what the coloured ports mean and how to join them. */
function PatchLegend() {
  return (
    <div className="sticky top-0 z-10 space-y-1 border-b border-white/10 bg-slate-900 px-3 py-2">
      <p className="text-[10px] text-slate-300">
        Drag from a port on one node to a port on another to patch them.
      </p>
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[9px] text-slate-400">
        <span className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-[2px] bg-sky-400" /> audio
        </span>
        <span className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-full bg-violet-400" /> modulation
        </span>
        <span className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-[2px] bg-amber-400" /> notes &amp; triggers
        </span>
      </div>
      <p className="text-[9px] text-slate-500">Inlets sit on the top edge, outlets on the bottom.</p>
    </div>
  )
}

export function Toolbar({ children, running, onToggle, masterVolume, onMasterVolume, onAdd, onClear }: Props) {
  const [open, setOpen] = useState(false)

  return (
    <header className="z-10 flex items-center gap-4 border-b border-white/10 bg-slate-900/80 px-4 py-2.5 backdrop-blur">
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold tracking-tight text-slate-100">Patcher</span>
        <span className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] text-slate-400">Web Audio</span>
      </div>

      <button
          title="Start or stop the audio engine — browsers stay silent until you do"
        onClick={onToggle}
        className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
          running ? 'bg-rose-500/90 text-white hover:bg-rose-500' : 'bg-emerald-500/90 text-slate-950 hover:bg-emerald-400'
        }`}
      >
        {running ? '■ Stop Audio' : '▶ Start Audio'}
      </button>

      <div className="flex items-center gap-2">
        <span className="text-[11px] text-slate-400">Master</span>
        <input
          type="range"
          min={-60}
          max={6}
          step={1}
          value={masterVolume}
          onChange={(e) => onMasterVolume(Number(e.target.value))}
          className="h-1 w-32 cursor-pointer appearance-none rounded bg-slate-700 accent-emerald-400"
        />
        <span className="w-14 tabular-nums text-[11px] text-slate-300">{masterVolume} dB</span>
        <LevelMeter running={running} />
      </div>

      <div className="relative ml-auto flex items-center gap-2">
        <button
          title="Add a module to the canvas"
          onClick={() => setOpen((v) => !v)}
          className="rounded-md bg-sky-500/90 px-3 py-1.5 text-xs font-semibold text-slate-950 hover:bg-sky-400"
        >
          + Add Node
        </button>
        {children}
        <button
          title="Throw away this patch and start from the default one"
          onClick={onClear}
          className="rounded-md bg-white/5 px-3 py-1.5 text-xs text-slate-300 hover:bg-white/10"
        >
          Reset Patch
        </button>

        {open && (
          <div
            className="absolute right-0 top-10 max-h-[70vh] w-72 overflow-y-auto rounded-lg border border-white/10 bg-slate-800 shadow-xl"
            onMouseLeave={() => setOpen(false)}
          >
            <PatchLegend />
            {GROUPS.map((group) => {
              const defs = PALETTE.filter((d) => group.categories.includes(d.category))
              if (!defs.length) return null
              return (
                <div key={group.title}>
                  <p className="sticky top-0 bg-slate-800/95 px-3 py-1 text-[9px] font-semibold uppercase tracking-wider text-slate-500">
                    {group.title}
                  </p>
                  {defs.map((def) => (
                    <button
                      key={def.type}
                      title={def.description}
                      onClick={() => {
                        onAdd(def.type)
                        setOpen(false)
                      }}
                      className="flex w-full items-start gap-2 px-3 py-1.5 text-left hover:bg-white/5"
                    >
                      <span
                        className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded text-[13px]"
                        style={{ background: `${def.accent}22` }}
                      >
                        {def.icon ?? '●'}
                      </span>
                      <span className="min-w-0">
                        <span className="block text-xs text-slate-100">{def.label}</span>
                        <span className="block text-[10px] leading-tight text-slate-500">{def.description}</span>
                      </span>
                    </button>
                  ))}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </header>
  )
}
