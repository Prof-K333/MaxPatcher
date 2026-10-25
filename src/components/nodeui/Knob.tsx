import { useRef } from 'react'

interface Props {
  value: number
  min: number
  max: number
  onChange: (v: number) => void
  /** Double-click target. */
  reset?: number
  color?: string
  size?: number
  title?: string
  label?: string
  /** Logarithmic travel; min must be > 0. */
  log?: boolean
  /** Optional value → text for the title / readout. */
  format?: (v: number) => string
}

/** Rotary pot: drag vertically, wheel to nudge, double-click to reset. */
export function Knob({ value, min, max, onChange, reset, color = '#94a3b8', size = 26, title, label, format, log }: Props) {
  const drag = useRef<{ y: number; f: number } | null>(null)
  const span = max - min
  const clamp = (v: number) => Math.min(max, Math.max(min, v))
  const toFrac = (v: number) => (log ? Math.log(clamp(v) / min) / Math.log(max / min) : (clamp(v) - min) / span)
  const fromFrac = (f: number) => {
    const k = Math.min(1, Math.max(0, f))
    return log ? min * Math.pow(max / min, k) : min + k * span
  }
  const frac = toFrac(value)
  const angle = -135 + frac * 270
  const r = size / 2 - 2
  const cx = size / 2
  const pt = (deg: number, rad: number) => {
    const a = ((deg - 90) * Math.PI) / 180
    return [cx + Math.cos(a) * rad, cx + Math.sin(a) * rad]
  }
  const [x1, y1] = pt(-135, r)
  const [x2, y2] = pt(angle, r)
  const [px, py] = pt(angle, r - 3)
  const text = format ? format(value) : value.toFixed(2)

  return (
    <div className="flex flex-col items-center gap-0.5" title={`${title ?? label ?? ''} ${text}`.trim()}>
      <svg
        width={size}
        height={size}
        role="slider"
        aria-label={title ?? label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        className="nodrag nopan cursor-ns-resize touch-none select-none"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          drag.current = { y: e.clientY, f: frac }
        }}
        onPointerMove={(e) => {
          if (!drag.current) return
          const fine = e.shiftKey ? 0.2 : 1
          onChange(fromFrac(drag.current.f + ((drag.current.y - e.clientY) / 120) * fine))
        }}
        onPointerUp={() => (drag.current = null)}
        onPointerCancel={() => (drag.current = null)}
        onWheel={(e) => onChange(fromFrac(frac - Math.sign(e.deltaY) * 0.02))}
        onDoubleClick={() => reset !== undefined && onChange(reset)}
      >
        <circle cx={cx} cy={cx} r={r} fill="#0f172a" stroke="#334155" />
        <path
          d={`M ${x1} ${y1} A ${r} ${r} 0 ${frac * 270 > 180 ? 1 : 0} 1 ${x2} ${y2}`}
          stroke={color}
          strokeWidth={2}
          fill="none"
          strokeLinecap="round"
        />
        <line x1={cx} y1={cx} x2={px} y2={py} stroke="#e2e8f0" strokeWidth={1.5} strokeLinecap="round" />
      </svg>
      {label && <span className="text-[7px] font-semibold uppercase tracking-wider" style={{ color }}>{label}</span>}
    </div>
  )
}
