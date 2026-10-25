import { useEffect, useRef } from 'react'
import { useFrame } from './useFrame'

export interface DbReading {
  peak: number
  rms: number
}

interface Props {
  /** Returns the current level in dBFS. */
  read: () => DbReading
  width?: number
  height?: number
  /** Ladder range, dBFS. */
  min?: number
  max?: number
  leds?: number
}

const colour = (db: number) => (db > -3 ? '#ef4444' : db > -12 ? '#eab308' : '#22c55e')

/** Vertical LED ladder: lit bar follows RMS, a single held LED rides the peak. */
export function LedMeter({ read, width = 10, height = 110, min = -60, max = 6, leds = 24 }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const state = useRef({ rms: min, hold: min, holdAt: 0 })

  useEffect(() => {
    const el = canvas.current
    if (!el) return
    const dpr = window.devicePixelRatio || 1
    el.width = width * dpr
    el.height = height * dpr
  }, [width, height])

  useFrame(() => {
    const el = canvas.current
    const g = el?.getContext('2d')
    if (!el || !g) return
    const { peak, rms } = read()
    const s = state.current
    const now = performance.now()
    // Fast attack, slow fall on the bar; the peak LED holds, then falls.
    s.rms = rms > s.rms ? rms : Math.max(rms, s.rms - 1.2)
    if (peak >= s.hold) {
      s.hold = peak
      s.holdAt = now
    } else if (now - s.holdAt > 900) {
      s.hold = Math.max(peak, s.hold - 1.5)
    }

    const dpr = window.devicePixelRatio || 1
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    g.clearRect(0, 0, width, height)
    const cell = height / leds
    for (let i = 0; i < leds; i++) {
      const db = min + ((i + 1) / leds) * (max - min)
      const y = height - (i + 1) * cell
      const step = (max - min) / leds
      const lit = s.rms >= db - step
      const holdHere = s.hold >= db - step && s.hold < db
      g.globalAlpha = lit || holdHere ? 1 : 0.16
      g.fillStyle = colour(db)
      g.fillRect(0, y + 0.5, width, Math.max(1, cell - 1))
    }
    g.globalAlpha = 1
  })

  return <canvas ref={canvas} style={{ width, height }} className="rounded-sm bg-black/60" />
}
