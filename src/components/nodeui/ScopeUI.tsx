import { useEffect, useRef } from 'react'
import { engine } from '../../audio/AudioEngine'
import { ScopeImpl } from '../../audio/nodes/ScopeImpl'
import type { NodeUIProps } from './types'
import { useFrame } from './useFrame'

const W = 196
const WAVE_H = 72
const FFT_H = 56

export function ScopeUI({ nodeId, params }: NodeUIProps) {
  const waveRef = useRef<HTMLCanvasElement>(null)
  const fftRef = useRef<HTMLCanvasElement>(null)
  const mode = String(params.mode ?? 'both')

  useEffect(() => {
    for (const el of [waveRef.current, fftRef.current]) {
      if (!el) continue
      const dpr = window.devicePixelRatio || 1
      el.width = W * dpr
      el.height = Number(el.dataset.height) * dpr
    }
  }, [mode])

  useFrame(() => {
    const node = engine.getImpl(nodeId)
    const scope = node instanceof ScopeImpl ? node : null
    if (mode !== 'spectrum') drawWave(waveRef.current, engine.running ? scope?.getWaveform() : undefined)
    if (mode !== 'oscilloscope') drawSpectrum(fftRef.current, engine.running ? scope?.getSpectrum() : undefined)
  })

  return (
    <div className="nodrag nopan space-y-1">
      {mode !== 'spectrum' && (
        <canvas
          ref={waveRef}
          data-height={WAVE_H}
          className="block w-full rounded bg-slate-950 ring-1 ring-white/10"
          style={{ height: WAVE_H }}
        />
      )}
      {mode !== 'oscilloscope' && (
        <canvas
          ref={fftRef}
          data-height={FFT_H}
          className="block w-full rounded bg-slate-950 ring-1 ring-white/10"
          style={{ height: FFT_H }}
        />
      )}
    </div>
  )
}

function drawWave(el: HTMLCanvasElement | null, data: Float32Array | undefined) {
  const g = el?.getContext('2d')
  if (!el || !g) return
  const w = el.width
  const h = el.height
  g.clearRect(0, 0, w, h)
  g.strokeStyle = '#38bdf8'
  g.lineWidth = Math.max(1, el.width / W)
  g.beginPath()
  if (!data || data.length === 0) {
    g.moveTo(0, h / 2)
    g.lineTo(w, h / 2)
  } else {
    for (let i = 0; i < data.length; i++) {
      const x = (i / (data.length - 1)) * w
      const y = (1 - (data[i] + 1) / 2) * h
      if (i === 0) g.moveTo(x, y)
      else g.lineTo(x, y)
    }
  }
  g.stroke()
}

function drawSpectrum(el: HTMLCanvasElement | null, data: Float32Array | undefined) {
  const g = el?.getContext('2d')
  if (!el || !g) return
  const w = el.width
  const h = el.height
  g.clearRect(0, 0, w, h)
  if (!data || data.length === 0) {
    g.strokeStyle = '#1e293b'
    g.beginPath()
    g.moveTo(0, h - 1)
    g.lineTo(w, h - 1)
    g.stroke()
    return
  }
  const bar = w / data.length
  for (let i = 0; i < data.length; i++) {
    // fft values from Tone are in dB, typically -100 to 0.
    const db = Number.isFinite(data[i]) ? data[i] : -100
    const mag = Math.max(0, Math.min(1, (db + 100) / 100))
    const bh = mag * h
    g.fillStyle = '#67e8f9'
    g.fillRect(i * bar, h - bh, Math.max(1, bar - 1), bh)
  }
}
