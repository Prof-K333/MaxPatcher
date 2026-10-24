import { useCallback, useState } from 'react'
import { Piano } from './Piano'

interface Props {
  /** Keyboard nodes currently on the canvas, to route notes into. */
  targets: Array<{ id: string; label: string }>
  selectedTarget: string | null
  onSelectTarget: (id: string) => void
  /** Octave, velocity and hold belong to the target node, not to the dock. */
  octave: number
  velocity: number
  hold: boolean
  onOctaveChange: (octave: number) => void
  onHoldChange: (hold: boolean) => void
  onNoteOn: (targetId: string, midi: number, velocity: number) => void
  onNoteOff: (targetId: string, midi: number) => void
  /** True when a keyboard node has claimed QWERTY, so the dock yields it. */
  qwertyTakenByNode: boolean
}

/**
 * The always-available keyboard docked at the bottom of the window.
 *
 * This is not a second instrument. It is a bigger playing surface for one
 * chosen Keyboard node: notes travel that node's cables, and octave and
 * velocity are read from — and written back to — that node, so its controls
 * govern whichever surface you play.
 */
export function DockedKeyboard({
  targets,
  selectedTarget,
  onSelectTarget,
  octave,
  velocity,
  hold,
  onOctaveChange,
  onHoldChange,
  onNoteOn,
  onNoteOff,
  qwertyTakenByNode,
}: Props) {
  const [collapsed, setCollapsed] = useState(false)
  // Bumping this remounts the Piano, which clears any sounding note.
  const [panicKey, setPanicKey] = useState(0)
  const target = selectedTarget ?? targets[0]?.id ?? null

  // Stable identities, so the Piano's effects do not re-run every render.
  const noteOn = useCallback(
    (midi: number, velocity: number) => target && onNoteOn(target, midi, velocity),
    [target, onNoteOn],
  )
  const noteOff = useCallback((midi: number) => target && onNoteOff(target, midi), [target, onNoteOff])

  if (collapsed) {
    return (
      <div className="flex justify-center border-t border-white/10 bg-slate-900/90 py-1">
        <button
          title="Show the keyboard" onClick={() => setCollapsed(false)} className="text-[11px] text-slate-400 hover:text-slate-200">
          ▴ Show keyboard
        </button>
      </div>
    )
  }

  return (
    <div className="border-t border-white/10 bg-slate-900/90 px-4 py-2 backdrop-blur">
      <div className="mb-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
        {/* Stated as a route, not a label: this surface has no voice of its
            own, and not saying so is what makes two keyboards confusing. */}
        <span className="flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded bg-amber-400/15 px-2 py-0.5 text-[11px] text-amber-200 ring-1 ring-amber-400/30">
          <span className="font-semibold">Playing through</span>
          <select
            value={target ?? ''}
            onChange={(e) => onSelectTarget(e.target.value)}
            disabled={!targets.length}
            className="rounded bg-slate-900 px-1.5 py-0.5 text-[11px] text-amber-100 outline-none ring-1 ring-amber-400/30 disabled:opacity-40"
          >
            {targets.length === 0 && <option value="">no keyboard node</option>}
            {targets.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </span>

        <div className="flex items-center gap-1">
          <button
            title="Shift the keyboard down an octave"
            onClick={() => onOctaveChange(Math.max(1, octave - 1))}
            className="rounded bg-white/5 px-1.5 text-[11px] text-slate-300 hover:bg-white/10"
          >
            −
          </button>
          <span className="w-10 text-center text-[11px] tabular-nums text-slate-300">Oct {octave}</span>
          <button
            title="Shift the keyboard up an octave"
            onClick={() => onOctaveChange(Math.min(7, octave + 1))}
            className="rounded bg-white/5 px-1.5 text-[11px] text-slate-300 hover:bg-white/10"
          >
            +
          </button>
        </div>

        <button
          onClick={() => onHoldChange(!hold)}
          title="Latch notes so you can turn knobs while they sound"
          className={`rounded px-2 py-0.5 text-[11px] font-semibold transition-colors ${
            hold ? 'bg-amber-400 text-slate-950' : 'bg-white/5 text-slate-300 hover:bg-white/10'
          }`}
        >
          Hold
        </button>

        <button
          onClick={() => {
            onHoldChange(false)
            setPanicKey((k) => k + 1)
          }}
          title="Stop every sounding note"
          className="shrink-0 whitespace-nowrap rounded bg-white/5 px-2 py-0.5 text-[11px] text-slate-300 hover:bg-rose-500/20 hover:text-rose-200"
        >
          All notes off
        </button>

        <span className="hidden text-[10px] text-slate-500 lg:inline">
          {hold
            ? 'Hold on — press a latched key again to clear it'
            : qwertyTakenByNode
              ? 'QWERTY is bound to the selected keyboard node'
              : 'A–K white · W/E/T/Y/U black'}
        </span>

        <button
          title="Hide the keyboard" onClick={() => setCollapsed(true)} className="ml-auto text-[11px] text-slate-500 hover:text-slate-300">
          ▾ Hide
        </button>
      </div>

      <Piano
        key={panicKey}
        octave={octave}
        baseVelocity={velocity}
        qwerty={!qwertyTakenByNode && !!target}
        hold={hold}
        onNoteOn={noteOn}
        onNoteOff={noteOff}
        height={76}
      />

      {!targets.length && (
        <p className="mt-1 text-[10px] text-amber-300/80">
          Add a Keyboard node to play — this dock has no voice of its own, it drives one.
        </p>
      )}
    </div>
  )
}
