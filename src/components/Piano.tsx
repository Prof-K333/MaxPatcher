import { useCallback, useEffect, useRef, useState } from 'react'

/** QWERTY → semitone offset, the layout every tracker and DAW uses. */
export const KEY_MAP: Record<string, number> = {
  a: 0, w: 1, s: 2, e: 3, d: 4, f: 5, t: 6, g: 7, y: 8, h: 9, u: 10, j: 11, k: 12,
}

const WHITE = [0, 2, 4, 5, 7, 9, 11, 12]
const BLACK = [1, 3, 6, 8, 10]
/** Where each black key sits, as an index into the white keys it straddles. */
const BLACK_SLOT: Record<number, number> = { 1: 0, 3: 1, 6: 3, 8: 4, 10: 5 }

const LABELS: Record<number, string> = {
  0: 'A', 1: 'W', 2: 'S', 3: 'E', 4: 'D', 5: 'F', 6: 'T', 7: 'G', 8: 'Y', 9: 'H', 10: 'U', 11: 'J', 12: 'K',
}

export const midiToFreq = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12)

interface Props {
  octave: number
  /** Velocity used when a key is struck without a vertical position. */
  baseVelocity: number
  onNoteOn: (midi: number, velocity: number) => void
  onNoteOff: (midi: number) => void
  /** Whether this keyboard answers to the computer keyboard. */
  qwerty: boolean
  /**
   * Latch mode: a pressed note stays on after the key is released, so you can
   * go and turn knobs while it sounds. Pressing the same key again clears it,
   * and switching Hold off releases everything.
   */
  hold?: boolean
  height?: number
  showLabels?: boolean
}

/**
 * A playable piano.
 *
 * Every interactive element carries `nodrag nopan`: inside React Flow a plain
 * mousedown would drag the node across the canvas instead of playing a note.
 *
 * Pointer capture is deliberately *not* used — releasing it is what allows
 * glissando, where sliding across the keys retriggers each one in turn.
 */
export function Piano({
  octave,
  baseVelocity,
  onNoteOn,
  onNoteOff,
  qwerty,
  hold = false,
  height = 72,
  showLabels = true,
}: Props) {
  // The ref is the source of truth and is mutated synchronously; the state
  // copy exists only so the keys re-render. Deriving the ref from state meant
  // several handlers firing in one tick (mouseup + mouseleave + window mouseup)
  // all saw a stale set and each sent its own redundant note-off.
  const heldRef = useRef<Set<number>>(new Set())
  const [held, setHeld] = useState<Set<number>>(heldRef.current)
  const draggingRef = useRef(false)
  const base = octave * 12

  // Callbacks live in a ref so press/release stay referentially stable. A
  // parent that rebuilds its handlers each render would otherwise invalidate
  // every effect below on every render — which silently released held notes.
  const cb = useRef({ onNoteOn, onNoteOff })
  cb.current = { onNoteOn, onNoteOff }

  const holdRef = useRef(hold)
  holdRef.current = hold

  const stop = useCallback((midi: number) => {
    if (!heldRef.current.delete(midi)) return
    setHeld(new Set(heldRef.current))
    cb.current.onNoteOff(midi)
  }, [])

  /** Releases everything — the panic path, and what Hold-off does. */
  const releaseAll = useCallback(() => {
    if (!heldRef.current.size) return
    const sounding = [...heldRef.current]
    heldRef.current.clear()
    setHeld(new Set())
    sounding.forEach((midi) => cb.current.onNoteOff(midi))
  }, [])

  const press = useCallback(
    (semi: number, velocity: number) => {
      const midi = base + semi
      // In Hold, striking a latched key is how you turn it off again.
      if (holdRef.current && heldRef.current.has(midi)) {
        stop(midi)
        return
      }
      if (heldRef.current.has(midi)) return
      heldRef.current.add(midi)
      setHeld(new Set(heldRef.current))
      cb.current.onNoteOn(midi, velocity)
    },
    [base, stop],
  )

  /** A key or mouse release. Ignored while Hold is latching. */
  const release = useCallback(
    (semi: number) => {
      if (holdRef.current) return
      stop(base + semi)
    },
    [base, stop],
  )

  // Switching Hold off is the "all notes off" gesture.
  useEffect(() => {
    if (!hold) releaseAll()
  }, [hold, releaseAll])

  // Changing octave would otherwise strand whatever is sounding.
  useEffect(() => {
    releaseAll()
  }, [octave, releaseAll])

  // Safety net: a note must never outlive the thing that started it. A mouse
  // released anywhere, the window losing focus, or this keyboard unmounting
  // all clear any sounding notes — except when Hold is deliberately latching.
  useEffect(() => {
    const endDrag = () => {
      draggingRef.current = false
      if (!holdRef.current) releaseAll()
    }
    const panic = () => releaseAll()
    window.addEventListener('mouseup', endDrag)
    window.addEventListener('blur', panic)
    return () => {
      window.removeEventListener('mouseup', endDrag)
      window.removeEventListener('blur', panic)
      releaseAll()
    }
  }, [releaseAll])

  // Computer keyboard. Only the focused keyboard listens, which is what stops
  // every keyboard node on the canvas from sounding at once.
  useEffect(() => {
    if (!qwerty) return
    const isTyping = (t: EventTarget | null) =>
      t instanceof HTMLElement && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.isContentEditable)

    const down = (e: KeyboardEvent) => {
      if (e.repeat || e.metaKey || e.ctrlKey || isTyping(e.target)) return
      const semi = KEY_MAP[e.key.toLowerCase()]
      if (semi === undefined) return
      e.preventDefault()
      press(semi, baseVelocity)
    }
    const up = (e: KeyboardEvent) => {
      const semi = KEY_MAP[e.key.toLowerCase()]
      if (semi === undefined) return
      release(semi)
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [qwerty, press, release, baseVelocity])

  // Losing QWERTY focus should not strand a note that key is still holding.
  useEffect(() => {
    if (!qwerty && !holdRef.current) releaseAll()
  }, [qwerty, releaseAll])

  /** Striking lower on a key plays harder, like a weighted action. */
  const velocityFrom = (e: React.MouseEvent<HTMLElement>) => {
    const box = e.currentTarget.getBoundingClientRect()
    const depth = (e.clientY - box.top) / box.height
    return Math.min(1, Math.max(0.15, 0.3 + depth * 0.7))
  }

  const whiteWidth = 100 / WHITE.length

  const keyHandlers = (semi: number) => ({
    onMouseDown: (e: React.MouseEvent<HTMLElement>) => {
      e.stopPropagation()
      draggingRef.current = true
      press(semi, velocityFrom(e))
    },
    onMouseEnter: (e: React.MouseEvent<HTMLElement>) => {
      if (draggingRef.current && !holdRef.current) press(semi, velocityFrom(e))
    },
    onMouseUp: () => release(semi),
    onMouseLeave: () => release(semi),
  })

  return (
    <div className="nodrag nopan relative select-none" style={{ height }}>
      {WHITE.map((semi, i) => {
        const midi = base + semi
        const on = held.has(midi)
        return (
          <div
            key={semi}
            role="button"
            aria-label={`note-${midi}`}
            data-note={midi}
            className={`nodrag nopan absolute bottom-0 top-0 rounded-b border border-slate-900 transition-colors ${
              on ? (hold ? 'bg-amber-400' : 'bg-sky-400') : 'bg-slate-100 hover:bg-white'
            }`}
            style={{ left: `${i * whiteWidth}%`, width: `${whiteWidth}%` }}
            {...keyHandlers(semi)}
          >
            {showLabels && (
              <span className="pointer-events-none absolute bottom-1 left-0 right-0 text-center text-[9px] font-medium text-slate-500">
                {LABELS[semi]}
              </span>
            )}
          </div>
        )
      })}

      {BLACK.map((semi) => {
        const midi = base + semi
        const on = held.has(midi)
        const slot = BLACK_SLOT[semi]
        return (
          <div
            key={semi}
            role="button"
            aria-label={`note-${midi}`}
            data-note={midi}
            className={`nodrag nopan absolute top-0 z-10 rounded-b border border-slate-950 transition-colors ${
              on ? (hold ? 'bg-amber-500' : 'bg-sky-500') : 'bg-slate-800 hover:bg-slate-700'
            }`}
            style={{
              left: `${(slot + 1) * whiteWidth - whiteWidth * 0.3}%`,
              width: `${whiteWidth * 0.6}%`,
              height: '62%',
            }}
            {...keyHandlers(semi)}
          >
            {showLabels && (
              <span className="pointer-events-none absolute bottom-0.5 left-0 right-0 text-center text-[8px] text-slate-400">
                {LABELS[semi]}
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
}
