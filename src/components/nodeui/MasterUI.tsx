import { useCallback, useEffect, useState } from 'react'
import { engine } from '../../audio/AudioEngine'
import type { MasterOutImpl } from '../../audio/nodes/MasterOutImpl'
import { downloadRecording } from '../../audio/recorder'
import type { NodeUIProps } from './types'

const clock = (seconds: number) => {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`

/**
 * Records whatever is going to the speakers.
 *
 * The take is held in memory until you stop, so the readout shows elapsed
 * time while running and the finished size afterwards — a few minutes of
 * stereo is tens of megabytes, which is worth seeing before you download it.
 */
export function MasterUI({ nodeId }: NodeUIProps) {
  const impl = useCallback(() => engine.getImpl(nodeId) as MasterOutImpl | undefined, [nodeId])
  const [, redraw] = useState(0)
  const [error, setError] = useState('')

  useEffect(() => {
    const node = impl()
    if (!node) return
    node.onChange = () => redraw((n) => n + 1)
    node.onError = (message) => setError(message)
    return () => {
      node.onChange = null
      node.onError = null
    }
  }, [impl])

  const node = impl()
  const recording = !!node?.recording
  const take = node?.lastTake ?? null

  return (
    <div className="space-y-1.5">
      <div className="flex gap-1">
        <button
          title={recording ? 'Finish the take and keep it' : 'Record everything you hear to a .wav'}
          onClick={() => {
            setError('')
            if (recording) impl()?.stop()
            else void impl()?.start()
          }}
          className={`nodrag nopan flex flex-1 items-center justify-center gap-1.5 rounded px-2 py-1.5 text-[11px] font-semibold transition-colors ${
            recording ? 'bg-rose-500 text-white' : 'bg-slate-800 text-slate-200 hover:bg-slate-700'
          }`}
        >
          <span className={`h-2 w-2 rounded-full ${recording ? 'animate-pulse bg-white' : 'bg-rose-500'}`} />
          {recording ? 'Stop' : 'Record'}
        </button>
        <span className="flex w-14 items-center justify-center rounded bg-black/50 text-[11px] tabular-nums text-rose-300">
          {clock(recording ? (node?.elapsed ?? 0) : (take?.seconds ?? 0))}
        </span>
      </div>

      {take && !recording && (
        <div className="flex items-center gap-1">
          <button
            title="Save the take as a .wav file"
            onClick={() => downloadRecording(take)}
            className="nodrag nopan flex-1 rounded bg-emerald-500/85 px-2 py-1 text-[10px] font-semibold text-slate-950 hover:bg-emerald-400"
          >
            ⭳ Save {mb(take.bytes)}
          </button>
          <button
            title="Throw this take away"
            onClick={() => impl()?.discard()}
            className="nodrag nopan rounded bg-slate-800 px-2 py-1 text-[10px] text-slate-400 hover:bg-rose-500/25"
          >
            ✕
          </button>
        </div>
      )}

      {error && <p className="text-[9px] text-amber-300">{error}</p>}
      {!take && !recording && !error && (
        <p className="text-[9px] text-slate-500">Captures the final mix, master volume included.</p>
      )}
    </div>
  )
}
