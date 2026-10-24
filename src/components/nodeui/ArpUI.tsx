import { useCallback, useEffect, useRef, useState } from 'react'
import { engine } from '../../audio/AudioEngine'
import type { ArpImpl } from '../../audio/nodes/ArpImpl'
import {
  NOTE_STEPS,
  ROLL_ROWS,
  SEQ_FACTORY_COUNT,
  SEQ_NAMES,
  SEQ_SHORT,
  emptySequence,
  factorySequence,
  isFactorySeqSlot,
  parseSeqBank,
  serializeSeqBank,
  type NoteSequence,
  type SeqBank,
} from '../../audio/sequencer/noteSeq'
import type { NodeUIProps } from './types'

/** Top row is the octave, so the roll reads like a keyboard turned sideways. */
const ROW_NAMES = ['C', 'B', 'A#', 'A', 'G#', 'G', 'F#', 'F', 'E', 'D#', 'D', 'C#', 'C']
const IS_BLACK = ROW_NAMES.map((n) => n.includes('#'))
const rowToPitch = (row: number) => ROLL_ROWS - 1 - row

export function ArpUI({ nodeId, params, setParam }: NodeUIProps) {
  const impl = useCallback(() => engine.getImpl(nodeId) as ArpImpl | undefined, [nodeId])
  const [bank, setBank] = useState<SeqBank>(() => parseSeqBank(params.steps))
  const seq = bank.sequences[bank.current]
  const [, redraw] = useState(0)
  const headRef = useRef(0)

  const running = Number(params.running ?? 0) >= 0.5
  const hold = Number(params.hold ?? 0) >= 0.5
  const mode = String(params.mode ?? 'arp')
  const length = Number(params.length ?? NOTE_STEPS)
  const bpm = Number(params.bpm ?? 120)

  useEffect(() => {
    impl()?.setBank(bank)
  }, [impl, bank])

  // Playhead and held-note readout come from the impl, not React state.
  useEffect(() => {
    let frame = 0
    const loop = () => {
      const node = impl()
      if (node && headRef.current !== node.displayStep) {
        headRef.current = node.displayStep
        redraw((n) => n + 1)
      }
      frame = requestAnimationFrame(loop)
    }
    frame = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(frame)
  }, [impl])

  const commit = (next: SeqBank) => {
    setBank(next)
    setParam('steps', serializeSeqBank(next))
  }

  const clone = (): SeqBank => ({
    current: bank.current,
    sequences: bank.sequences.map((s) => s.map((c) => ({ ...c }))),
  })

  /** Replaces just the selected slot's notes. */
  const commitSeq = (next: NoteSequence) => {
    const b = clone()
    b.sequences[b.current] = next
    commit(b)
  }

  /** Copies what is selected into one of your own slots. */
  const storeInto = (slot: number) => {
    const b = clone()
    b.sequences[slot] = b.sequences[b.current].map((c) => ({ ...c }))
    b.current = slot
    commit(b)
  }

  const restoreFactory = () => {
    const b = clone()
    b.sequences[b.current] = factorySequence(b.current)
    commit(b)
  }

  const setCell = (step: number, row: number, accent: boolean) => {
    const pitch = rowToPitch(row)
    const next = seq.map((c, i) => (i === step ? { ...c } : c))
    // Clicking the lit cell again clears the step: one pitch per step.
    next[step] = next[step].pitch === pitch && !accent ? { pitch: null, accent: false } : { pitch, accent }
    commitSeq(next)
  }

  const held = impl()?.heldNotes ?? []

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-1.5 rounded bg-slate-900/70 p-1.5">
        <button
          title={running ? 'Stop the sequencer' : 'Start the sequencer'}
          onClick={() => setParam('running', running ? 0 : 1)}
          className={`nodrag nopan rounded px-2.5 py-1 text-[11px] font-bold ${
            running ? 'bg-emerald-500 text-slate-950' : 'bg-slate-700 text-slate-200'
          }`}
        >
          {running ? '■ STOP' : '▶ PLAY'}
        </button>
        <button
          title="Back to step 1"
          onClick={() => impl()?.reset()}
          className="nodrag nopan rounded bg-slate-800 px-2 py-1 text-[11px] text-slate-300 hover:bg-slate-700"
        >
          ⟲
        </button>
        <button
          title="Keep arpeggiating after you let go of the keys"
          onClick={() => setParam('hold', hold ? 0 : 1)}
          className={`nodrag nopan rounded px-2 py-1 text-[10px] ${
            hold ? 'bg-amber-400 text-slate-950' : 'bg-slate-800 text-slate-400'
          }`}
        >
          Hold
        </button>

        <span
          className="rounded bg-black px-1.5 py-0.5 text-[12px] font-bold tabular-nums text-emerald-400"
          style={{ textShadow: '0 0 6px rgba(52,211,153,0.7)', fontFamily: 'ui-monospace, monospace' }}
        >
          {bpm.toFixed(1)}
        </span>
        <input
          title="Internal tempo — ignored while a clock cable is patched in"
          type="range"
          min={40}
          max={260}
          step={0.1}
          value={bpm}
          onChange={(e) => setParam('bpm', Number(e.target.value))}
          className="nodrag nopan h-1 w-20 cursor-pointer appearance-none rounded bg-slate-700 accent-emerald-400"
        />

        <label className="flex items-center gap-1 text-[10px] text-slate-400">
          Steps
          <input
            title="How many steps before the sequence repeats"
            type="number"
            min={1}
            max={NOTE_STEPS}
            value={length}
            onChange={(e) => setParam('length', Math.min(NOTE_STEPS, Math.max(1, Number(e.target.value) || 1)))}
            className="nodrag nopan h-4 w-9 rounded bg-slate-900 px-1 text-[10px] tabular-nums text-slate-200 outline-none ring-1 ring-white/10"
          />
        </label>

        <span className={`ml-auto text-[9px] ${running ? 'text-slate-500' : 'text-amber-300'}`}>
          {!running
            ? 'stopped — nothing patched through here will sound'
            : mode === 'arp'
              ? held.length
                ? `holding ${held.length} note${held.length > 1 ? 's' : ''}`
                : 'play keys into the notes inlet'
              : 'grid plays the melody'}
        </span>
      </div>

      {/* Two rows of slots: shipped lines, then eight of your own. */}
      <div className={`space-y-1 rounded bg-slate-900/60 p-1.5 ${mode === 'arp' ? 'opacity-45' : ''}`}>
        {[0, 1].map((row) => (
          <div key={row} className="flex items-center gap-1">
            <span className="w-10 shrink-0 text-[8px] uppercase tracking-wider text-slate-500">
              {row === 0 ? 'Lines' : 'Yours'}
            </span>
            {Array.from({ length: 8 }, (_, col) => {
              const slot = row * SEQ_FACTORY_COUNT + col
              const active = bank.current === slot
              const used = bank.sequences[slot].some((c) => c.pitch !== null)
              return (
                <button
                  key={slot}
                  title={
                    row === 0
                      ? `Play “${SEQ_NAMES[slot]}”`
                      : used
                        ? `Play your ${SEQ_NAMES[slot]} — shift-click to overwrite it with the current line`
                        : 'Empty slot — shift-click to store the current line here'
                  }
                  onClick={(e) => {
                    if (e.shiftKey && row === 1) storeInto(slot)
                    else commit({ ...clone(), current: slot })
                  }}
                  className={`nodrag nopan flex-1 rounded py-1 text-[9px] transition-colors ${
                    active
                      ? 'bg-emerald-500 font-semibold text-slate-950'
                      : used
                        ? 'bg-slate-700 text-slate-200 hover:bg-slate-600'
                        : 'bg-slate-800/60 text-slate-600 hover:bg-slate-700'
                  }`}
                >
                  {SEQ_SHORT[slot]}
                </button>
              )
            })}
          </div>
        ))}
      </div>

      {/* Piano roll — only meaningful in sequence mode, dimmed in arp. */}
      <div className={`rounded bg-black/40 p-1 ${mode === 'arp' ? 'opacity-45' : ''}`}>
        {Array.from({ length: ROLL_ROWS }, (_, row) => (
          <div key={row} className="flex items-center gap-[2px]">
            <span
              className={`w-5 shrink-0 text-right text-[7px] ${IS_BLACK[row] ? 'text-slate-600' : 'text-slate-400'}`}
            >
              {ROW_NAMES[row]}
            </span>
            {Array.from({ length: NOTE_STEPS }, (_, step) => {
              const cell = seq[step]
              const on = cell.pitch === rowToPitch(row)
              const inLoop = step < length
              const isHead = running && mode === 'sequence' && headRef.current === step
              return (
                <button
                  key={step}
                  title={`Step ${step + 1} · ${ROW_NAMES[row]} — click to place the note, shift-click to accent it`}
                  onClick={(e) => setCell(step, row, e.shiftKey)}
                  className="nodrag nopan h-[11px] flex-1 rounded-[2px] transition-colors"
                  style={{
                    background: on
                      ? cell.accent
                        ? '#6ee7b7'
                        : '#34d399'
                      : IS_BLACK[row]
                        ? '#0f172a'
                        : '#1e293b',
                    opacity: inLoop ? 1 : 0.3,
                    outline: isHead ? '1px solid #fde68a' : 'none',
                  }}
                />
              )
            })}
          </div>
        ))}
      </div>

      <div className="flex gap-1">
        <button
          title="Erase every step in the melody"
          onClick={() => commitSeq(emptySequence())}
          className="nodrag nopan flex-1 rounded bg-slate-800 px-2 py-1 text-[10px] text-slate-400 hover:bg-rose-500/25"
        >
          Clear
        </button>
        {isFactorySeqSlot(bank.current) && (
          <button
            title="Put the shipped line back in this slot"
            onClick={restoreFactory}
            className="nodrag nopan rounded bg-slate-800 px-2 py-1 text-[10px] text-slate-400 hover:bg-slate-700"
          >
            ↺
          </button>
        )}
        <button
          title="Scatter a fresh melody across the grid"
          onClick={() =>
            commitSeq(
              Array.from({ length: NOTE_STEPS }, () =>
                Math.random() < 0.55
                  ? { pitch: [0, 2, 3, 5, 7, 10, 12][Math.floor(Math.random() * 7)], accent: Math.random() < 0.25 }
                  : { pitch: null, accent: false },
              ),
            )
          }
          className="nodrag nopan flex-1 rounded bg-slate-800 px-2 py-1 text-[10px] text-slate-400 hover:bg-slate-700"
        >
          ⚄ Randomise
        </button>
      </div>
    </div>
  )
}
