import { useCallback, useEffect, useRef, useState } from 'react'
import { engine } from '../../audio/AudioEngine'
import type { LiveLooperImpl, LooperStatus } from '../../audio/nodes/LiveLooperImpl'
import type { NodeUIProps } from './types'

const W = 226
const H = 44

/** What the big button does next, and how it should look while doing it. */
const TRANSPORT: Record<string, { label: string; hint: string; bg: string; fg: string }> = {
  LOADING: { label: '…', hint: 'loading', bg: '#334155', fg: '#94a3b8' },
  EMPTY: { label: '● REC', hint: 'record the first take', bg: '#ef4444', fg: '#fff' },
  RECORDING: { label: '■ SET', hint: 'punch out to set the loop', bg: '#f87171', fg: '#450a0a' },
  PLAYING: { label: '● DUB', hint: 'layer onto the loop', bg: '#22c55e', fg: '#052e16' },
  OVERDUBBING: { label: '◉ DUB', hint: 'overdubbing — tap to stop layering', bg: '#f59e0b', fg: '#451a03' },
  STOPPED: { label: '● DUB', hint: 'stopped', bg: '#64748b', fg: '#0f172a' },
}

/**
 * Tape-machine face for the live looper.
 *
 * Transport state is owned by the worklet, not by React: the UI renders
 * whatever status the audio thread reports, so the button can never claim the
 * looper is recording when it is not.
 */
export function LiveLooperUI({ nodeId, params, setParam }: NodeUIProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const peaksRef = useRef<Float32Array | null>(null)
  const statusRef = useRef<LooperStatus>({ state: 'LOADING', loopSeconds: 0, phase: 0, recordedSeconds: 0 })
  const [status, setStatus] = useState<LooperStatus>(statusRef.current)

  const impl = useCallback(() => engine.getImpl(nodeId) as LiveLooperImpl | undefined, [nodeId])

  useEffect(() => {
    const node = impl()
    if (!node) return
    setStatus(node.status)
    node.onStatus = (s) => {
      statusRef.current = s
      // Only the cheap fields drive React; the phase ring reads the ref.
      setStatus((prev) =>
        prev.state === s.state && Math.abs(prev.recordedSeconds - s.recordedSeconds) < 0.05 ? prev : s,
      )
    }
    node.onPeaks = (p) => {
      peaksRef.current = p
    }
    return () => {
      node.onStatus = null
      node.onPeaks = null
    }
  }, [impl])

  // Ask for a fresh waveform whenever the recording could have changed.
  useEffect(() => {
    impl()?.requestPeaks(W)
    const t = setInterval(() => {
      const s = statusRef.current.state
      if (s === 'RECORDING' || s === 'OVERDUBBING') impl()?.requestPeaks(W)
    }, 400)
    return () => clearInterval(t)
  }, [impl, status.state])

  // One rAF loop paints waveform, playhead and progress ring.
  useEffect(() => {
    let frame = 0
    const draw = () => {
      const canvas = canvasRef.current
      const ctx = canvas?.getContext('2d')
      if (canvas && ctx) {
        const s = statusRef.current
        ctx.clearRect(0, 0, W, H)
        ctx.fillStyle = '#140d14'
        ctx.fillRect(0, 0, W, H)

        const peaks = peaksRef.current
        const mid = H / 2
        if (peaks && peaks.length) {
          const cols = peaks.length / 2
          ctx.strokeStyle = s.state === 'OVERDUBBING' ? '#fbbf24' : '#f472b6'
          ctx.beginPath()
          for (let c = 0; c < cols; c++) {
            const x = (c / cols) * W + 0.5
            ctx.moveTo(x, mid + peaks[c * 2] * mid * 0.9)
            ctx.lineTo(x, mid + peaks[c * 2 + 1] * mid * 0.9)
          }
          ctx.stroke()
        } else {
          ctx.fillStyle = '#4c1d3d'
          ctx.font = '10px ui-sans-serif, system-ui'
          ctx.fillText(s.state === 'RECORDING' ? 'recording…' : 'no loop', 8, mid + 3)
        }

        if (s.loopSeconds > 0) {
          const x = s.phase * W
          ctx.strokeStyle = '#fde68a'
          ctx.lineWidth = 1.5
          ctx.beginPath()
          ctx.moveTo(x, 0)
          ctx.lineTo(x, H)
          ctx.stroke()
          ctx.lineWidth = 1
        }
      }

      const ring = ringRef.current
      if (ring) ring.style.strokeDashoffset = String(CIRC * (1 - statusRef.current.phase))
      frame = requestAnimationFrame(draw)
    }
    frame = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(frame)
  }, [])

  const ringRef = useRef<SVGCircleElement>(null)
  const t = TRANSPORT[status.state] ?? TRANSPORT.EMPTY
  const reverse = Number(params.reverse ?? 0) >= 0.5
  const half = Number(params.halfSpeed ?? 0) >= 0.5
  const busy = status.state === 'LOADING'

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <button
          title="Record the first take, punch out to set the loop, then layer on top"
          disabled={busy}
          onClick={() => impl()?.command('recordOrDub')}
          className="nodrag nopan flex-1 rounded px-2 py-2 text-[12px] font-bold tracking-wider shadow-inner transition-transform active:scale-95 disabled:opacity-50"
          style={{ background: t.bg, color: t.fg }}
        >
          {t.label}
        </button>

        {/* Loop phase as a radial ring, driven straight from the audio thread. */}
        <svg width="38" height="38" viewBox="0 0 38 38" className="shrink-0">
          <circle cx="19" cy="19" r={R} fill="none" stroke="#2a1620" strokeWidth="4" />
          <circle
            ref={ringRef}
            cx="19"
            cy="19"
            r={R}
            fill="none"
            stroke={status.state === 'OVERDUBBING' ? '#fbbf24' : '#f472b6'}
            strokeWidth="4"
            strokeLinecap="round"
            strokeDasharray={CIRC}
            strokeDashoffset={CIRC}
            transform="rotate(-90 19 19)"
          />
        </svg>
      </div>

      <canvas ref={canvasRef} width={W} height={H} className="nodrag nopan w-full rounded border border-white/10" />

      <div className="flex items-center justify-between text-[9px] text-slate-400">
        <span className="uppercase tracking-wider text-pink-300/80">{status.state.toLowerCase()}</span>
        <span className="tabular-nums">
          {status.loopSeconds > 0 ? `${status.loopSeconds.toFixed(2)}s loop` : `${status.recordedSeconds.toFixed(1)}s`}
        </span>
      </div>
      <p className="text-[9px] text-slate-500">{t.hint}</p>

      <div className="flex gap-1">
        <button
          title="Start or stop loop playback"
          onClick={() => impl()?.command('playStop')}
          className="nodrag nopan flex-1 rounded bg-slate-900/70 px-2 py-1 text-[10px] text-slate-300 hover:bg-slate-900"
        >
          {status.state === 'STOPPED' ? '▶ Play' : '■ Stop'}
        </button>
        <button
          title="Erase the loop and start again"
          onClick={() => {
            impl()?.command('clear')
            peaksRef.current = null
          }}
          className="nodrag nopan flex-1 rounded bg-slate-900/70 px-2 py-1 text-[10px] text-slate-400 hover:bg-rose-500/20 hover:text-rose-200"
        >
          Clear
        </button>
      </div>

      <div className="flex gap-1">
        <button
          title="Play the loop backwards"
          onClick={() => setParam('reverse', reverse ? 0 : 1)}
          className={`nodrag nopan flex-1 rounded px-2 py-1 text-[10px] transition-colors ${
            reverse ? 'bg-pink-500/80 text-slate-950' : 'bg-slate-900/70 text-slate-400'
          }`}
        >
          ◀ Reverse
        </button>
        <button
          title="Play at half speed, an octave down"
          onClick={() => setParam('halfSpeed', half ? 0 : 1)}
          className={`nodrag nopan flex-1 rounded px-2 py-1 text-[10px] transition-colors ${
            half ? 'bg-pink-500/80 text-slate-950' : 'bg-slate-900/70 text-slate-400'
          }`}
        >
          ½ Speed
        </button>
      </div>
    </div>
  )
}

const R = 16
const CIRC = 2 * Math.PI * R
