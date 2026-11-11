import { useEffect, useState } from 'react'
import { engine } from '../../audio/AudioEngine'
import { MidiInImpl, type MidiStatus } from '../../audio/nodes/MidiInImpl'
import type { NodeUIProps } from './types'

const empty: MidiStatus = { supported: true, permission: 'unknown', devices: [] }

const readMidi = (nodeId: string) => {
  const node = engine.getImpl(nodeId)
  return node instanceof MidiInImpl ? node : null
}

export function MidiInUI({ nodeId, params, setParam }: NodeUIProps) {
  const [, setRev] = useState(0)

  useEffect(() => {
    const node = readMidi(nodeId)
    if (!node) return
    node.onStatus = () => setRev((n) => n + 1)
    return () => {
      node.onStatus = null
    }
  }, [nodeId])

  const impl = readMidi(nodeId)
  const status = impl?.status ?? empty

  const enable = async () => {
    const node = readMidi(nodeId)
    if (!node) return
    await node.enable()
    setRev((n) => n + 1)
  }

  if (!status.supported) {
    return <p className="text-[10px] leading-snug text-slate-500">Web MIDI is not available in this browser.</p>
  }

  if (status.permission !== 'ok') {
    return (
      <div className="space-y-1.5">
        <button
          type="button"
          onClick={() => void enable()}
          className="nodrag nopan w-full rounded bg-amber-400/90 px-2 py-1 text-[11px] font-semibold text-slate-950 hover:bg-amber-300"
        >
          Enable MIDI
        </button>
        {status.permission === 'denied' && (
          <p className="text-[10px] leading-snug text-rose-300">MIDI access was denied. Check the browser permission and try again.</p>
        )}
      </div>
    )
  }

  const device = String(params.device ?? '')

  return (
    <div className="space-y-1.5">
      <label className="flex items-center justify-between gap-2 text-[11px]">
        <span className="text-slate-400">Device</span>
        <select
          className="nodrag nopan min-w-0 flex-1 rounded bg-slate-900 px-1.5 py-0.5 text-[11px] text-slate-100 outline-none ring-1 ring-white/10 focus:ring-sky-400"
          value={device}
          onChange={(e) => setParam('device', e.target.value)}
        >
          <option value="">All devices</option>
          {status.devices.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
      </label>
      {status.devices.length === 0 && (
        <p className="text-[10px] leading-snug text-slate-500">No MIDI devices found. Plug one in and it should appear here.</p>
      )}
    </div>
  )
}
