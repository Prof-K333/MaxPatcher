import type { ParamSpec } from '../audio/types'

interface Props {
  spec: ParamSpec
  value: number | string
  onChange: (value: number | string) => void
  compact?: boolean
}

type SliderSpec = Extract<ParamSpec, { control: 'slider' }>

/** Sliders with a `log` curve move smoothly across musical, not linear, range. */
const toSlider = (spec: SliderSpec, value: number) => {
  if (spec.curve !== 'log') return value
  const lo = Math.log(Math.max(spec.min, 0.0001))
  const hi = Math.log(spec.max)
  return ((Math.log(Math.max(value, 0.0001)) - lo) / (hi - lo)) * 1000
}

const fromSlider = (spec: SliderSpec, raw: number) => {
  if (spec.curve !== 'log') return raw
  const lo = Math.log(Math.max(spec.min, 0.0001))
  const hi = Math.log(spec.max)
  return Math.exp(lo + (raw / 1000) * (hi - lo))
}

const format = (value: number, unit?: string) => {
  const abs = Math.abs(value)
  const text = abs >= 100 ? value.toFixed(0) : abs >= 10 ? value.toFixed(1) : value.toFixed(2)
  return unit ? `${text} ${unit}` : text
}

export function ParamControl({ spec, value, onChange, compact }: Props) {
  if (spec.control === 'text') {
    return (
      <input
        type="text"
        value={String(value ?? '')}
        placeholder={spec.placeholder}
        maxLength={spec.maxLength ?? 24}
        onChange={(e) => onChange(e.target.value)}
        className="nodrag nopan w-full rounded bg-slate-900 px-1.5 py-0.5 text-[11px] text-slate-100 placeholder:text-slate-600 outline-none ring-1 ring-white/10 focus:ring-sky-400"
      />
    )
  }

  if (spec.control === 'toggle') {
    const on = Number(value) >= 0.5
    return (
      <button
        title={`${spec.label} — ${on ? 'on' : 'off'}`}
        onClick={() => onChange(on ? 0 : 1)}
        className={`nodrag nopan flex w-full items-center justify-between rounded px-1.5 py-1 text-[11px] transition-colors ${
          on ? 'bg-sky-500/20 text-sky-200' : 'bg-slate-900/60 text-slate-400 hover:bg-slate-900'
        }`}
      >
        <span>{spec.label}</span>
        <span className={`h-2 w-2 rounded-full ${on ? 'bg-sky-400' : 'bg-slate-600'}`} />
      </button>
    )
  }

  if (spec.control === 'select') {
    return (
      <label className="flex items-center justify-between gap-2 text-[11px]">
        <span className="text-slate-400">{spec.label}</span>
        <select
          className="nodrag nopan min-w-0 flex-1 rounded bg-slate-900 px-1.5 py-0.5 text-[11px] text-slate-100 outline-none ring-1 ring-white/10 focus:ring-sky-400"
          value={String(value)}
          onChange={(e) => onChange(e.target.value)}
        >
          {spec.options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      </label>
    )
  }

  const numeric = Number(value)
  return (
    <label className="block text-[11px]">
      <span className="mb-0.5 flex items-center justify-between gap-1">
        <span className="truncate text-slate-400">{spec.label}</span>
        <span className="shrink-0 tabular-nums text-slate-200">{format(numeric, spec.unit)}</span>
      </span>
      <input
        type="range"
        className={`nodrag nopan w-full cursor-pointer appearance-none rounded bg-slate-700 accent-sky-400 ${compact ? 'h-0.5' : 'h-1'}`}
        min={spec.curve === 'log' ? 0 : spec.min}
        max={spec.curve === 'log' ? 1000 : spec.max}
        step={spec.curve === 'log' ? 1 : spec.step}
        value={toSlider(spec, numeric)}
        onChange={(e) => onChange(fromSlider(spec, Number(e.target.value)))}
      />
    </label>
  )
}
