import { useEffect, useState } from 'react'
import { engine } from '../../audio/AudioEngine'
import type { LooperImpl } from '../../audio/nodes/LooperImpl'
import type { NodeUIProps } from './types'

/** Transport buttons for the phrase looper, reading live state from the impl. */
export function LooperUI({ nodeId, params, setParam }: NodeUIProps) {
  const [count, setCount] = useState(0)
  const recording = Number(params.record ?? 0) >= 0.5
  const overdub = Number(params.overdub ?? 0) >= 0.5

  // The impl owns the recorded events, so poll it for the readout rather than
  // duplicating that state in React.
  useEffect(() => {
    const t = setInterval(() => {
      const impl = engine.getImpl(nodeId) as LooperImpl | undefined
      setCount(impl?.eventCount ?? 0)
    }, 200)
    return () => clearInterval(t)
  }, [nodeId])

  const clear = () => {
    const impl = engine.getImpl(nodeId) as LooperImpl | undefined
    impl?.clear()
    setCount(0)
  }

  return (
    <div className="space-y-1.5">
      <div className="flex gap-1">
        <button
          title="Arm recording — incoming notes are captured in time with the clock"
          onClick={() => setParam('record', recording ? 0 : 1)}
          className={`nodrag nopan flex-1 rounded px-2 py-1 text-[11px] font-semibold transition-colors ${
            recording ? 'bg-rose-500 text-white' : 'bg-slate-900/70 text-slate-300 hover:bg-slate-900'
          }`}
        >
          {recording ? '● REC' : 'Record'}
        </button>
        <button
          title="Keep what is already recorded and layer new notes on top"
          onClick={() => setParam('overdub', overdub ? 0 : 1)}
          className={`nodrag nopan flex-1 rounded px-2 py-1 text-[11px] transition-colors ${
            overdub ? 'bg-amber-500/80 text-slate-950' : 'bg-slate-900/70 text-slate-300 hover:bg-slate-900'
          }`}
        >
          Overdub
        </button>
      </div>
      <div className="flex items-center gap-1">
        <button
          title="Erase every recorded note"
          onClick={clear}
          className="nodrag nopan flex-1 rounded bg-slate-900/70 px-2 py-1 text-[11px] text-slate-300 hover:bg-rose-500/20 hover:text-rose-200"
        >
          Clear
        </button>
        <span className="rounded bg-slate-900/70 px-2 py-1 text-[10px] tabular-nums text-slate-400">{count} ev</span>
      </div>
    </div>
  )
}
