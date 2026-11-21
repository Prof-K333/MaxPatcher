import { loopLength } from '../../audio/sequencer/arrangement'

/** Shared "memory chain + 64/128-bar loop" strip for the 808 and the Arp / Sequencer. */
export function MemoryChain({
  order,
  bars,
  current,
  playing,
  names,
  accent = 'emerald',
  onChange,
}: {
  order: number[]
  bars: number
  current: number
  playing?: number
  names: string[]
  accent?: 'emerald' | 'red'
  onChange: (order: number[], bars: number) => void
}) {
  const lit = accent === 'red'
  const loop = order.length ? loopLength(order.length, bars) : 0
  const repeats = order.length && loop ? Math.ceil(loop / order.length) : 0

  const setBars = (next: number) => onChange(order, next)
  const addCurrent = () => onChange([...order, current], bars)
  const fillEight = (length: number) => onChange([0, 1, 2, 3, 4, 5, 6, 7], length)
  const removeAt = (i: number) => onChange(order.filter((_, j) => j !== i), bars)

  const chip = lit
    ? { on: 'bg-red-500 text-slate-950', off: 'bg-slate-800 text-slate-400 hover:bg-slate-700' }
    : { on: 'bg-emerald-500 text-slate-950', off: 'bg-slate-800 text-slate-400 hover:bg-slate-700' }

  return (
    <div className="space-y-1 rounded bg-slate-900/60 p-1.5">
      <div className="flex flex-wrap items-center gap-1">
        <span className="w-10 shrink-0 text-[8px] uppercase tracking-wider text-slate-500">Chain</span>
        {order.length === 0 && (
          <span className="text-[9px] text-slate-500">empty — looping the selected slot only</span>
        )}
        {order.map((slot, i) => (
          <button
            key={`${slot}-${i}`}
            title={`Step ${i + 1} of the chain plays “${names[slot] ?? slot}” — click to remove`}
            onClick={() => removeAt(i)}
            className={`nodrag nopan rounded px-1.5 py-0.5 text-[9px] ${
              playing === slot ? chip.on : 'bg-slate-700 text-slate-200 hover:bg-rose-500/40'
            }`}
          >
            {names[slot] ?? slot}
          </button>
        ))}
        <button
          title="Append the selected memory slot to the chain"
          onClick={addCurrent}
          className="nodrag nopan rounded bg-slate-800 px-1.5 py-0.5 text-[9px] text-slate-300 hover:bg-slate-700"
        >
          + add
        </button>
        {order.length > 0 && (
          <button
            title="Clear the chain and go back to looping one slot"
            onClick={() => onChange([], 0)}
            className="nodrag nopan rounded px-1.5 py-0.5 text-[9px] text-slate-500 hover:text-rose-300"
          >
            clear
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-1">
        <span className="w-10 shrink-0 text-[8px] uppercase tracking-wider text-slate-500">Loop</span>
        {[
          { label: 'off', value: 0, title: 'Walk the chain and keep going, with no fixed loop length' },
          { label: '64', value: 64, title: '64-bar loop — e.g. 8 slots, eight times around' },
          { label: '128', value: 128, title: '128-bar loop — e.g. 8 slots, sixteen times around' },
        ].map((opt) => {
          const on = bars === opt.value || (opt.value === 0 && bars === 0)
          return (
            <button
              key={opt.label}
              title={opt.title}
              onClick={() => setBars(opt.value)}
              className={`nodrag nopan rounded px-1.5 py-0.5 text-[9px] ${on ? chip.on : chip.off}`}
            >
              {opt.label}
            </button>
          )
        })}
        <button
          title="Load all eight shipped slots into the chain and loop them for 64 bars"
          onClick={() => fillEight(64)}
          className={`nodrag nopan rounded px-1.5 py-0.5 text-[9px] ${chip.off}`}
        >
          8×64
        </button>
        <button
          title="Load all eight shipped slots into the chain and loop them for 128 bars"
          onClick={() => fillEight(128)}
          className={`nodrag nopan rounded px-1.5 py-0.5 text-[9px] ${chip.off}`}
        >
          8×128
        </button>
        <label className="ml-auto flex items-center gap-1 text-[9px] text-slate-500">
          bars
          <input
            title="Custom loop length in bars"
            type="number"
            min={0}
            max={512}
            value={bars || ''}
            placeholder="—"
            onChange={(e) => setBars(Math.max(0, Number(e.target.value) || 0))}
            className="nodrag nopan h-4 w-12 rounded bg-slate-900 px-1 text-[10px] tabular-nums text-slate-200 outline-none ring-1 ring-white/10"
          />
        </label>
      </div>

      {order.length > 0 && (
        <p className="px-0.5 text-[9px] text-slate-500">
          {loop} bars · {order.length} slot{order.length === 1 ? '' : 's'}
          {repeats > 1 ? ` × ${repeats}` : ''}
          {playing !== undefined ? ` · playing ${names[playing] ?? playing}` : ''}
        </p>
      )}
    </div>
  )
}
