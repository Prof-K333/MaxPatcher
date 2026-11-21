import { useCallback, useEffect, useState } from 'react'
import { engine } from '../../audio/AudioEngine'
import type { VocalSynthImpl } from '../../audio/nodes/VocalSynthImpl'
import { VOWEL_NAMES } from '../../audio/vocal/chimera/planner'
import type { NodeUIProps } from './types'

const BODIES = ['male', 'female', 'child'] as const

/**
 * Compact singer panel: body, breath, vowel, and a lyrics box.
 * The lyrics field only captures keys while it is focused, so it does not
 * fight the Keyboard node's QWERTY bindings.
 */
export function VocalSynthUI({ nodeId, params, setParam }: NodeUIProps) {
  const impl = useCallback(() => engine.getImpl(nodeId) as VocalSynthImpl | undefined, [nodeId])
  const [, redraw] = useState(0)
  const body = String(params.body ?? 'female')
  const vowel = String(params.vowel ?? 'ah')
  const breath = Number(params.breath ?? 0.75)
  const lyrics = String(params.lyrics ?? '')

  useEffect(() => {
    const id = window.setInterval(() => redraw((n) => n + 1), 200)
    return () => window.clearInterval(id)
  }, [])

  const node = impl()
  const status = node?.status ?? ''
  const blocked = !!node?.blocked

  return (
    <div className="space-y-1.5">
      {status && (
        <p className={`rounded px-1.5 py-1 text-[10px] leading-snug ${blocked ? 'bg-amber-400/15 text-amber-200' : 'bg-slate-900 text-slate-400'}`}>
          {status}
        </p>
      )}

      <div className="flex gap-1">
        {BODIES.map((id) => (
          <button
            key={id}
            title={`Sing with a ${id} body`}
            onClick={() => setParam('body', id)}
            className={`nodrag nopan flex-1 rounded py-1 text-[10px] capitalize ${
              body === id ? 'bg-pink-400 font-semibold text-slate-950' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
          >
            {id}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-1.5">
        <label className="flex flex-1 items-center gap-1 text-[10px] text-slate-400">
          Breath
          <input
            title="How much air is in the tone — enough that a note still sings"
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={breath}
            onChange={(e) => setParam('breath', Number(e.target.value))}
            className="nodrag nopan h-1 flex-1 cursor-pointer appearance-none rounded bg-slate-700 accent-pink-400"
          />
        </label>
        <select
          title="Vowel held when there are no lyrics"
          value={VOWEL_NAMES.includes(vowel as (typeof VOWEL_NAMES)[number]) ? vowel : 'ah'}
          onChange={(e) => setParam('vowel', e.target.value)}
          className="nodrag nopan rounded bg-slate-900 px-1 py-0.5 text-[10px] text-slate-200 outline-none ring-1 ring-white/10"
        >
          {VOWEL_NAMES.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
      </div>

      <textarea
        title="Words the singer walks through, one syllable per note. Leave empty to hold the vowel."
        placeholder="Lyrics — or leave empty to sing “ah”"
        value={lyrics}
        onChange={(e) => setParam('lyrics', e.target.value)}
        rows={3}
        className="nodrag nopan w-full resize-y rounded bg-slate-900 px-1.5 py-1 text-[11px] leading-snug text-slate-100 placeholder:text-slate-600 outline-none ring-1 ring-white/10 focus:ring-pink-400"
      />
    </div>
  )
}
