import { useCallback, useEffect, useRef, useState } from 'react'
import { engine } from '../../audio/AudioEngine'
import { AUDIO_ACCEPT, decodeAudioFile, computePeaks } from '../../audio/decode'
import type { GranularImpl } from '../../audio/nodes/GranularImpl'
import type { NodeUIProps } from './types'

const W = 316
const H = 92

/**
 * Waveform viewport and transport for the granular node.
 *
 * All drawing happens on one canvas driven by a single rAF loop, which is the
 * only way this stays smooth: at 80 grains a second, a React re-render per
 * grain would melt the UI thread. The loop reads the engine's grain trail
 * directly and never touches React state.
 */
export function GranularUI({ nodeId, params, setParam }: NodeUIProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const peaksRef = useRef<Array<[number, number]> | null>(null)
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [dragging, setDragging] = useState(false)
  const [, forceRender] = useState(0)
  const fileRef = useRef<HTMLInputElement>(null)
  const scrubbing = useRef(false)

  const impl = useCallback(() => engine.getImpl(nodeId) as GranularImpl | undefined, [nodeId])

  const position = Number(params.position ?? 0.25)
  const spray = Number(params.spray ?? 0.05)
  const frozen = Number(params.freeze ?? 0) >= 0.5
  const sliceMode = params.mode === 'slice'
  const liveMode = params.source === 'live'

  /** Peaks are expensive, so they are recomputed only when the buffer changes. */
  const refreshPeaks = useCallback(() => {
    const buffer = impl()?.buffer
    peaksRef.current = buffer ? computePeaks(buffer, W) : null
    setName(impl()?.fileName ?? '')
    forceRender((n) => n + 1)
  }, [impl])

  useEffect(() => {
    refreshPeaks()
    const node = impl()
    if (node) node.onBufferChange = refreshPeaks
    return () => {
      if (node) node.onBufferChange = null
    }
  }, [impl, refreshPeaks])

  // A live ring is rewritten constantly, so the waveform has to be redrawn.
  useEffect(() => {
    if (!liveMode) return
    const t = setInterval(refreshPeaks, 500)
    return () => clearInterval(t)
  }, [liveMode, refreshPeaks])

  // One animation loop drives the whole viewport.
  useEffect(() => {
    let frame = 0
    const draw = () => {
      const canvas = canvasRef.current
      const ctx = canvas?.getContext('2d')
      if (!canvas || !ctx) return
      const node = impl()

      ctx.clearRect(0, 0, W, H)
      ctx.fillStyle = '#0b1220'
      ctx.fillRect(0, 0, W, H)

      const peaks = peaksRef.current
      const mid = H / 2

      if (peaks) {
        // Spray zone: the band the playhead actually draws grains from.
        const buffer = node?.buffer
        if (buffer && spray > 0) {
          const halfWidth = (spray / buffer.duration) * W
          ctx.fillStyle = 'rgba(34,211,238,0.12)'
          ctx.fillRect(position * W - halfWidth, 0, halfWidth * 2, H)
        }

        ctx.strokeStyle = '#1e40af'
        ctx.beginPath()
        for (let x = 0; x < peaks.length; x++) {
          const [min, max] = peaks[x]
          ctx.moveTo(x + 0.5, mid + min * mid * 0.92)
          ctx.lineTo(x + 0.5, mid + max * mid * 0.92)
        }
        ctx.stroke()
      } else {
        ctx.fillStyle = '#334155'
        ctx.font = '11px ui-sans-serif, system-ui'
        ctx.fillText('No buffer', 8, mid)
      }

      // Slice markers.
      if (sliceMode && node) {
        ctx.strokeStyle = '#fbbf24'
        ctx.lineWidth = 1
        for (const s of node.getSlices()) {
          ctx.beginPath()
          ctx.moveTo(s * W, 0)
          ctx.lineTo(s * W, H)
          ctx.stroke()
        }
      }

      // Grain particles: each spawned grain drifts upward and fades, which
      // makes density and spray legible at a glance.
      const now = performance.now()
      const trail = node?.grainTrail ?? []
      for (const g of trail) {
        const age = (now - g.born) / 900
        if (age > 1) continue
        const x = g.pos * W
        const y = mid - age * mid * 0.9
        ctx.fillStyle = `rgba(103,232,249,${(1 - age) * 0.85})`
        ctx.beginPath()
        ctx.arc(x + g.pan * 8, y, 1.6 + (1 - age) * 1.4, 0, Math.PI * 2)
        ctx.fill()
      }

      // Playhead.
      ctx.strokeStyle = frozen ? '#f472b6' : '#22d3ee'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(position * W, 0)
      ctx.lineTo(position * W, H)
      ctx.stroke()

      frame = requestAnimationFrame(draw)
    }
    frame = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(frame)
  }, [impl, position, spray, frozen, sliceMode])

  const scrubTo = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const box = e.currentTarget.getBoundingClientRect()
    setParam('position', Math.min(1, Math.max(0, (e.clientX - box.left) / box.width)))
  }

  const load = async (file: File) => {
    setError('')
    try {
      const buffer = await decodeAudioFile(file)
      impl()?.loadBuffer(buffer, file.name)
      refreshPeaks()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load that file.')
    }
  }

  return (
    <div className="space-y-1.5">
      <div
        className="relative"
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          const file = e.dataTransfer.files?.[0]
          if (file) void load(file)
        }}
      >
        <canvas
          ref={canvasRef}
          width={W}
          height={H}
          className="nodrag nopan w-full cursor-ew-resize rounded border border-white/10"
          onMouseDown={(e) => {
            e.stopPropagation()
            scrubbing.current = true
            scrubTo(e)
          }}
          onMouseMove={(e) => scrubbing.current && scrubTo(e)}
          onMouseUp={() => (scrubbing.current = false)}
          onMouseLeave={() => (scrubbing.current = false)}
        />
        {dragging && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded border-2 border-dashed border-cyan-400 bg-cyan-400/10 text-[11px] text-cyan-200">
            Drop audio
          </div>
        )}
      </div>

      <div className="flex items-center gap-1">
        <span className="min-w-0 flex-1 truncate text-[9px] text-slate-400">
          {liveMode ? (
            <span className="flex items-center gap-1 text-rose-300">
              <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-rose-400" />
              live input · {impl()?.liveSeconds ?? 8}s window
            </span>
          ) : (
            name || 'No sample'
          )}
        </span>
        <button
          onClick={() => setParam('source', liveMode ? 'file' : 'live')}
          title="Granulate whatever is patched into the audio inlet"
          className={`nodrag nopan rounded px-1.5 py-0.5 text-[10px] transition-colors ${
            liveMode ? 'bg-rose-500/80 text-white' : 'bg-slate-900/80 text-slate-300 hover:bg-slate-900'
          }`}
        >
          Live
        </button>
        <button
          title="Load an audio file to granulate"
          onClick={() => fileRef.current?.click()}
          className="nodrag nopan rounded bg-slate-900/80 px-1.5 py-0.5 text-[10px] text-slate-300 hover:bg-slate-900"
        >
          Load
        </button>
        <button
          title="Find the hits in the sample and mark them as slices"
          onClick={() => {
            impl()?.resliceFromTransients()
            forceRender((n) => n + 1)
          }}
          className="nodrag nopan rounded bg-slate-900/80 px-1.5 py-0.5 text-[10px] text-slate-300 hover:bg-slate-900"
        >
          Slice
        </button>
        <button
          title="Hold the playhead where it is and keep granulating that spot"
          onClick={() => setParam('freeze', frozen ? 0 : 1)}
          className={`nodrag nopan flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold transition-colors ${
            frozen ? 'bg-pink-500/80 text-white' : 'bg-slate-900/80 text-slate-300 hover:bg-slate-900'
          }`}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${frozen ? 'bg-pink-200' : 'bg-slate-600'}`} />
          Freeze
        </button>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept={AUDIO_ACCEPT}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) void load(file)
          e.target.value = ''
        }}
      />

      {error && <p className="text-[9px] text-rose-300">{error}</p>}
    </div>
  )
}
