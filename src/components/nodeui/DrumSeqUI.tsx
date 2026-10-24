import { useCallback, useEffect, useRef, useState } from 'react'
import { engine } from '../../audio/AudioEngine'
import type { DrumSequencerImpl } from '../../audio/nodes/DrumSequencerImpl'
import {
  FACTORY_COUNT,
  MAX_STEPS,
  PATTERN_NAMES,
  PATTERN_SHORT,
  factoryPattern,
  isFactorySlot,
  TRACKS,
  TRACK_LABELS,
  parseBank,
  serializeBank,
  type Bank,
  type StepLevel,
  type TrackId,
} from '../../audio/sequencer/pattern'
import type { NodeUIProps } from './types'

/** The 808's own colour coding: one hue per beat of four. */
const BEAT_COLOURS = ['#ef4444', '#f97316', '#facc15', '#e2e8f0']

const levelStyle = (level: StepLevel, beat: string) =>
  level === 2
    ? { background: beat, boxShadow: `0 0 6px ${beat}` }
    : level === 1
      ? { background: `${beat}66` }
      : { background: '#1c1917' }

/** Seven-segment-ish readout for the tempo. */
function BpmDisplay({ bpm }: { bpm: number }) {
  return (
    <span
      className="rounded bg-black px-2 py-0.5 text-[15px] font-bold tabular-nums tracking-widest text-red-500"
      style={{ textShadow: '0 0 6px rgba(239,68,68,0.8)', fontFamily: 'ui-monospace, monospace' }}
    >
      {bpm.toFixed(1)}
    </span>
  )
}

export function DrumSeqUI({ nodeId, params, setParam }: NodeUIProps) {
  const impl = useCallback(() => engine.getImpl(nodeId) as DrumSequencerImpl | undefined, [nodeId])
  const [bank, setBank] = useState<Bank>(() => parseBank(params.patterns))
  const [selected, setSelected] = useState<{ track: TrackId; step: number } | null>(null)
  const [, redraw] = useState(0)
  const playheadRef = useRef<Record<string, number>>({})

  const running = Number(params.running ?? 0) >= 0.5
  const bpm = Number(params.bpm ?? 120)
  const swing = Number(params.swing ?? 0.5)
  const pattern = bank.patterns[bank.current]

  // The impl owns the live bank; the UI pushes edits down as serialized JSON.
  useEffect(() => {
    impl()?.setBank(bank)
  }, [impl, bank])

  useEffect(() => {
    const next = parseBank(params.patterns)
    if (params.patterns) setBank(next)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeId])

  /** Playhead LEDs come straight from the scheduler, not from React state. */
  useEffect(() => {
    let frame = 0
    const loop = () => {
      const node = impl()
      if (node) {
        const d = node.display
        let changed = false
        for (const t of TRACKS) {
          if (playheadRef.current[t] !== d[t]) {
            playheadRef.current[t] = d[t]
            changed = true
          }
        }
        if (changed) redraw((n) => n + 1)
      }
      frame = requestAnimationFrame(loop)
    }
    frame = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(frame)
  }, [impl])

  const commit = (next: Bank) => {
    setBank(next)
    setParam('patterns', serializeBank(next))
  }

  const clone = (): Bank => ({
    current: bank.current,
    patterns: bank.patterns.map((p) =>
      Object.fromEntries(
        TRACKS.map((t) => [
          t,
          { ...p[t], level: [...p[t].level], ratchet: [...p[t].ratchet], prob: [...p[t].prob] },
        ]),
      ),
    ) as Bank['patterns'],
  })

  const cycleStep = (track: TrackId, step: number) => {
    const next = clone()
    const t = next.patterns[next.current][track]
    t.level[step] = ((t.level[step] + 1) % 3) as StepLevel
    commit(next)
  }

  const editTrack = (track: TrackId, change: (t: Bank['patterns'][number][TrackId]) => void) => {
    const next = clone()
    change(next.patterns[next.current][track])
    commit(next)
  }

  /** Ratchet and probability edits are just track edits aimed at one step. */
  const editStep = (track: TrackId, change: (t: Bank['patterns'][number][TrackId]) => void) =>
    editTrack(track, change)

  /** Copies what is playing into one of your own slots. */
  const storeInto = (slot: number) => {
    const next = clone()
    next.patterns[slot] = next.patterns[next.current]
    next.current = slot
    commit(next)
  }

  const restoreFactory = () => {
    const next = clone()
    next.patterns[next.current] = factoryPattern(next.current)
    commit(next)
  }

  const clearPattern = () => {
    const next = clone()
    for (const t of TRACKS) {
      const tr = next.patterns[next.current][t]
      tr.level = Array(MAX_STEPS).fill(0)
      tr.ratchet = Array(MAX_STEPS).fill(1)
      tr.prob = Array(MAX_STEPS).fill(1)
    }
    commit(next)
  }

  const randomize = (track: TrackId) =>
    editTrack(track, (t) => {
      t.level = Array.from({ length: MAX_STEPS }, () =>
        Math.random() < 0.28 ? ((Math.random() < 0.25 ? 2 : 1) as StepLevel) : 0,
      )
    })

  const sel = selected ? pattern[selected.track] : null

  return (
    <div className="space-y-2">
      {/* Transport */}
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
          title="Send every lane back to step 1"
          onClick={() => impl()?.reset()}
          className="nodrag nopan rounded bg-slate-800 px-2 py-1 text-[11px] text-slate-300 hover:bg-slate-700"
        >
          ⟲ Cue
        </button>

        <BpmDisplay bpm={bpm} />
        <input
          title="Tempo in beats per minute"
          type="range"
          min={40}
          max={260}
          step={0.1}
          value={bpm}
          onChange={(e) => setParam('bpm', Number(e.target.value))}
          className="nodrag nopan h-1 w-24 cursor-pointer appearance-none rounded bg-slate-700 accent-red-500"
        />

        <label className="flex items-center gap-1 text-[10px] text-slate-400">
          Swing
          <input
            title="Delays every second 16th — 50% is straight, 75% is a heavy shuffle"
            type="range"
            min={0.5}
            max={0.75}
            step={0.005}
            value={swing}
            onChange={(e) => setParam('swing', Number(e.target.value))}
            className="nodrag nopan h-1 w-20 cursor-pointer appearance-none rounded bg-slate-700 accent-amber-400"
          />
          <span className="w-8 tabular-nums text-slate-300">{Math.round(swing * 100)}%</span>
        </label>

        <div className="ml-auto flex items-center gap-1">
          <button
            title="Hold for an instant 16th-note roll on every active step"
            onMouseDown={() => {
              const node = impl()
              if (node) node.fill = true
            }}
            onMouseUp={() => {
              const node = impl()
              if (node) node.fill = false
            }}
            onMouseLeave={() => {
              const node = impl()
              if (node) node.fill = false
            }}
            className="nodrag nopan rounded bg-amber-500/80 px-2 py-1 text-[10px] font-semibold text-slate-950"
          >
            FILL
          </button>
          <button
            title="Erase every step in this pattern"
            onClick={clearPattern}
            className="nodrag nopan rounded bg-slate-800 px-1.5 py-1 text-[10px] text-slate-400 hover:bg-rose-500/30"
          >
            Clear
          </button>
          {isFactorySlot(bank.current) && (
            <button
              title="Put the shipped beat back in this slot"
              onClick={restoreFactory}
              className="nodrag nopan rounded bg-slate-800 px-1.5 py-1 text-[10px] text-slate-400 hover:bg-slate-700"
            >
              ↺
            </button>
          )}
        </div>
      </div>

      {/* Two rows: the beats that ship, and eight slots of your own. */}
      <div className="space-y-1 rounded bg-slate-900/60 p-1.5">
        {[0, 1].map((row) => (
          <div key={row} className="flex items-center gap-1">
            <span className="w-10 shrink-0 text-[8px] uppercase tracking-wider text-slate-500">
              {row === 0 ? 'Beats' : 'Yours'}
            </span>
            {Array.from({ length: 8 }, (_, col) => {
              const slot = row * FACTORY_COUNT + col
              const active = bank.current === slot
              const used = TRACKS.some((t) => bank.patterns[slot][t].level.some((v) => v > 0))
              return (
                <button
                  key={slot}
                  title={
                    row === 0
                      ? `Play “${PATTERN_NAMES[slot]}”`
                      : used
                        ? `Play your ${PATTERN_NAMES[slot]} — shift-click to overwrite it with the current pattern`
                        : `Empty slot — shift-click to store the current pattern here`
                  }
                  onClick={(e) => {
                    if (e.shiftKey && row === 1) storeInto(slot)
                    else commit({ ...clone(), current: slot })
                  }}
                  className={`nodrag nopan flex-1 rounded py-1 text-[9px] transition-colors ${
                    active
                      ? 'bg-red-500 font-semibold text-slate-950'
                      : used
                        ? 'bg-slate-700 text-slate-200 hover:bg-slate-600'
                        : 'bg-slate-800/60 text-slate-600 hover:bg-slate-700'
                  }`}
                >
                  {PATTERN_SHORT[slot]}
                </button>
              )
            })}
          </div>
        ))}
      </div>

      <p className="px-0.5 text-[9px] text-slate-500">
        Pattern <span className="text-red-300">{PATTERN_NAMES[bank.current]}</span> · switching is instant,
        so chain slots while it runs
      </p>

      {/* Matrix */}
      <div className="space-y-0.5 rounded bg-black/40 p-1.5">
        {TRACKS.map((id) => {
          const track = pattern[id]
          const head = playheadRef.current[id] ?? 0
          return (
            <div key={id} className="flex items-center gap-1">
              <span className="w-7 shrink-0 text-[9px] font-bold text-slate-400">{TRACK_LABELS[id]}</span>

              <button
                title={`Mute ${TRACK_LABELS[id]}`}
                onClick={() => editTrack(id, (t) => (t.mute = !t.mute))}
                className={`nodrag nopan h-4 w-4 shrink-0 rounded text-[8px] font-bold ${
                  track.mute ? 'bg-rose-500 text-white' : 'bg-slate-800 text-slate-500'
                }`}
              >
                M
              </button>
              <button
                title={`Solo ${TRACK_LABELS[id]}`}
                onClick={() => editTrack(id, (t) => (t.solo = !t.solo))}
                className={`nodrag nopan h-4 w-4 shrink-0 rounded text-[8px] font-bold ${
                  track.solo ? 'bg-amber-400 text-slate-950' : 'bg-slate-800 text-slate-500'
                }`}
              >
                S
              </button>

              <div className="flex gap-[3px]">
                {Array.from({ length: MAX_STEPS }, (_, i) => {
                  const beat = BEAT_COLOURS[Math.floor(i / 4)]
                  const active = i < track.length
                  const isHead = running && head === i
                  const cell = track.level[i]
                  return (
                    <button
                      key={i}
                      title={`${TRACK_LABELS[id]} step ${i + 1} — click to cycle off / on / accent, right-click for ratchet and probability`}
                      onClick={() => cycleStep(id, i)}
                      onContextMenu={(e) => {
                        e.preventDefault()
                        setSelected({ track: id, step: i })
                      }}
                      className="nodrag nopan relative h-[18px] w-[18px] rounded-[3px] transition-all"
                      style={{
                        ...levelStyle(cell, beat),
                        opacity: active ? (track.prob[i] < 1 ? 0.45 + track.prob[i] * 0.55 : 1) : 0.18,
                        outline: isHead ? `1.5px solid ${beat}` : 'none',
                        outlineOffset: '1px',
                      }}
                    >
                      {track.ratchet[i] > 1 && (
                        <span className="pointer-events-none absolute inset-x-0 bottom-0 text-center text-[7px] font-bold text-slate-900">
                          {track.ratchet[i]}
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>

              <div className="ml-1 flex shrink-0 items-center gap-0.5">
                <button
                  title={`Nudge ${TRACK_LABELS[id]} one step earlier`}
                  onClick={() => editTrack(id, (t) => (t.shift = t.shift - 1))}
                  className="nodrag nopan h-4 w-3.5 rounded bg-slate-800 text-[8px] text-slate-400 hover:bg-slate-700"
                >
                  ‹
                </button>
                <button
                  title={`Nudge ${TRACK_LABELS[id]} one step later`}
                  onClick={() => editTrack(id, (t) => (t.shift = t.shift + 1))}
                  className="nodrag nopan h-4 w-3.5 rounded bg-slate-800 text-[8px] text-slate-400 hover:bg-slate-700"
                >
                  ›
                </button>
                <input
                  title={`Steps before ${TRACK_LABELS[id]} wraps — shorten it for polymeter`}
                  type="number"
                  min={1}
                  max={MAX_STEPS}
                  value={track.length}
                  onChange={(e) =>
                    editTrack(id, (t) => (t.length = Math.min(MAX_STEPS, Math.max(1, Number(e.target.value) || 1))))
                  }
                  className="nodrag nopan h-4 w-7 rounded bg-slate-900 px-0.5 text-[9px] tabular-nums text-slate-300 outline-none ring-1 ring-white/10"
                />
                <button
                  title={`Randomise the ${TRACK_LABELS[id]} lane`}
                  onClick={() => randomize(id)}
                  className="nodrag nopan h-4 w-4 rounded bg-slate-800 text-[8px] text-slate-400 hover:bg-slate-700"
                >
                  ⚄
                </button>
              </div>
            </div>
          )
        })}
      </div>

      {/* Step inspector */}
      {selected && sel && (
        <div className="flex items-center gap-2 rounded border border-white/10 bg-slate-900/80 px-2 py-1.5">
          <span className="text-[10px] font-semibold text-slate-300">
            {TRACK_LABELS[selected.track]} · step {selected.step + 1}
          </span>
          <label className="flex items-center gap-1 text-[10px] text-slate-400">
            Ratchet
            <select
              title="How many sub-hits this step fires"
              value={sel.ratchet[selected.step]}
              onChange={(e) =>
                editStep(selected.track, (t) => (t.ratchet[selected.step] = Number(e.target.value)))
              }
              className="nodrag nopan rounded bg-slate-800 px-1 text-[10px] text-slate-200 outline-none"
            >
              {[1, 2, 3, 4].map((r) => (
                <option key={r} value={r}>
                  {r}×
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-1 items-center gap-1 text-[10px] text-slate-400">
            Chance
            <input
              title="How often this step actually fires"
              type="range"
              min={0}
              max={1}
              step={0.1}
              value={sel.prob[selected.step]}
              onChange={(e) =>
                editStep(selected.track, (t) => (t.prob[selected.step] = Number(e.target.value)))
              }
              className="nodrag nopan h-1 flex-1 cursor-pointer appearance-none rounded bg-slate-700 accent-sky-400"
            />
            <span className="w-8 tabular-nums text-slate-300">{Math.round(sel.prob[selected.step] * 100)}%</span>
          </label>
          <button
            title="Close the step inspector"
            onClick={() => setSelected(null)}
            className="nodrag nopan rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-400"
          >
            ✕
          </button>
        </div>
      )}
    </div>
  )
}
