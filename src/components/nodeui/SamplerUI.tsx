import { useEffect, useRef, useState } from 'react'
import { engine } from '../../audio/AudioEngine'
import { AUDIO_ACCEPT, decodeAudioFile } from '../../audio/decode'
import type { SamplerImpl } from '../../audio/nodes/SamplerImpl'
import type { NodeUIProps } from './types'

/** Drop target, file picker and transport for the sampler node. */
export function SamplerUI({ nodeId, params, setParam }: NodeUIProps) {
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [dragging, setDragging] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const impl = () => engine.getImpl(nodeId) as SamplerImpl | undefined

  useEffect(() => {
    setName(impl()?.fileName ?? '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeId])

  const load = async (file: File) => {
    setError('')
    try {
      const buffer = await decodeAudioFile(file)
      impl()?.loadBuffer(buffer, file.name)
      setName(file.name)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load that file.')
    }
  }

  const looping = Number(params.loop ?? 0) >= 0.5

  return (
    <div className="space-y-1.5">
      <div
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
        className={`nodrag nopan rounded border border-dashed px-2 py-2 text-center text-[10px] transition-colors ${
          dragging ? 'border-teal-400 bg-teal-400/10 text-teal-200' : 'border-white/15 text-slate-400'
        }`}
      >
        {name ? <span className="block truncate text-slate-200">{name}</span> : 'Drop audio here'}
        <div className="mt-1 flex justify-center gap-1">
          <button
          title="Choose an audio file"
            onClick={() => fileRef.current?.click()}
            className="nodrag nopan rounded bg-slate-900/80 px-2 py-0.5 text-[10px] text-slate-300 hover:bg-slate-900"
          >
            Import…
          </button>
          {name && (
            <button
              title="Unload this sample"
              onClick={() => {
                impl()?.clear()
                setName('')
              }}
              className="nodrag nopan rounded bg-slate-900/80 px-2 py-0.5 text-[10px] text-slate-400 hover:text-rose-300"
            >
              Eject
            </button>
          )}
        </div>
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

      <div className="flex gap-1">
        <button
          title="Play the sample from the trim-in point"
          onClick={() => impl()?.play()}
          className="nodrag nopan flex-1 rounded bg-teal-500/80 px-2 py-1 text-[11px] font-semibold text-slate-950 hover:bg-teal-400"
        >
          ▶ Play
        </button>
        <button
          title="Stop playback"
          onClick={() => impl()?.stop()}
          className="nodrag nopan flex-1 rounded bg-slate-900/70 px-2 py-1 text-[11px] text-slate-300 hover:bg-slate-900"
        >
          ■ Stop
        </button>
        <button
          title="Loop between the trim points instead of playing once"
          onClick={() => setParam('loop', looping ? 0 : 1)}
          className={`nodrag nopan rounded px-2 py-1 text-[11px] ${
            looping ? 'bg-teal-500/30 text-teal-200' : 'bg-slate-900/70 text-slate-400'
          }`}
        >
          ↻
        </button>
      </div>
    </div>
  )
}
