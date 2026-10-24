import { useCallback } from 'react'
import { engine } from '../../audio/AudioEngine'
import { Piano, midiToFreq } from '../Piano'
import type { NodeUIProps } from './types'

/**
 * Keyboard node UI.
 *
 * QWERTY input is bound to whichever keyboard node is *selected*, so several
 * keyboards can live on one canvas without all answering the same keypress.
 * The Focus toggle pins it to this keyboard regardless of selection.
 */
export function KeyboardUI({ nodeId, params, selected, isDockTarget }: NodeUIProps) {
  const octave = Number(params.octave ?? 4)
  const velocity = Number(params.velocity ?? 0.8)
  const focusPinned = Number(params.focus ?? 1) >= 0.5
  const hold = Number(params.hold ?? 0) >= 0.5

  // Stable across renders: the Piano keys off these to decide when to reset.
  const noteOn = useCallback(
    (midi: number, vel: number) =>
      engine.sendToNode(nodeId, 'ui', { type: 'noteOn', note: midi, freq: midiToFreq(midi), velocity: vel }),
    [nodeId],
  )
  const noteOff = useCallback(
    (midi: number) => engine.sendToNode(nodeId, 'ui', { type: 'noteOff', note: midi }),
    [nodeId],
  )

  return (
    <div className="space-y-1">
      {isDockTarget && (
        <p className="rounded bg-amber-400/15 px-1.5 py-0.5 text-[9px] text-amber-200">
          ▼ The docked keyboard plays through this node
        </p>
      )}
      <Piano
        octave={octave}
        baseVelocity={velocity}
        onNoteOn={noteOn}
        onNoteOff={noteOff}
        qwerty={focusPinned && selected}
        hold={hold}
        height={64}
      />
      <p className="text-[9px] text-slate-500">
        {hold
          ? 'Hold on — keys latch; press again to clear, or switch Hold off'
          : focusPinned
          ? selected
              ? 'QWERTY active — A–K white, W/E/T/Y/U black'
              : 'Select this node to play with QWERTY'
            : 'QWERTY focus off'}
      </p>
    </div>
  )
}
