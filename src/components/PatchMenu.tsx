import { useEffect, useRef, useState } from 'react'
import { listSlots, type SavedSlot } from '../patch/storage'
import { PRESETS } from '../patch/presets'

interface Props {
  patchName: string
  onNameChange: (name: string) => void
  onSave: (name: string) => void
  onLoad: (name: string) => void
  onDelete: (name: string) => void
  onExport: () => void
  onImport: (file: File) => void
  onLoadPreset: (name: string) => void
}

const relative = (iso: string) => {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

export function PatchMenu({ patchName, onNameChange, onSave, onLoad, onDelete, onExport, onImport, onLoadPreset }: Props) {
  const [open, setOpen] = useState(false)
  const [slots, setSlots] = useState<SavedSlot[]>([])
  const fileRef = useRef<HTMLInputElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  // The slot list is only read while the menu is actually on screen.
  useEffect(() => {
    if (open) setSlots(listSlots())
  }, [open])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!panelRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const refresh = () => setSlots(listSlots())

  return (
    <div className="relative" ref={panelRef}>
      <button
          title="Save, load, import and export patches"
        onClick={() => setOpen((v) => !v)}
        className="rounded-md bg-white/5 px-3 py-1.5 text-xs text-slate-200 hover:bg-white/10"
      >
        Patches ▾
      </button>

      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) onImport(file)
          // Reset so re-picking the same file fires change again.
          e.target.value = ''
          setOpen(false)
        }}
      />

      {open && (
        <div className="absolute right-0 top-10 z-20 w-72 overflow-hidden rounded-lg border border-white/10 bg-slate-800 shadow-xl">
          <div className="flex gap-1.5 border-b border-white/5 p-2">
            <input
              value={patchName}
              onChange={(e) => onNameChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && patchName.trim()) {
                  onSave(patchName.trim())
                  refresh()
                }
              }}
              placeholder="Patch name"
              className="min-w-0 flex-1 rounded bg-slate-900 px-2 py-1 text-xs text-slate-100 outline-none ring-1 ring-white/10 focus:ring-sky-400"
            />
            <button
          title="Save this patch under the name on the left"
              disabled={!patchName.trim()}
              onClick={() => {
                onSave(patchName.trim())
                refresh()
              }}
              className="rounded bg-sky-500/90 px-2.5 py-1 text-xs font-semibold text-slate-950 hover:bg-sky-400 disabled:opacity-40"
            >
              Save
            </button>
          </div>

          {/* Examples come first: with nothing saved yet they are the only
              way in, and they are the quickest way to hear what each module
              actually does. */}
          <div className="border-b border-white/5">
            <p className="px-3 py-1 text-[9px] font-semibold uppercase tracking-wider text-slate-500">Example patches</p>
            {PRESETS.map((preset) => (
              <button
                key={preset.name}
                title={preset.blurb}
                onClick={() => {
                  onLoadPreset(preset.name)
                  setOpen(false)
                }}
                className="block w-full px-3 py-1.5 text-left hover:bg-white/5"
              >
                <span className="block text-xs text-slate-200">{preset.name}</span>
                <span className="block text-[10px] leading-tight text-slate-500">{preset.blurb}</span>
              </button>
            ))}
          </div>

          <div className="max-h-56 overflow-y-auto">
            <p className="px-3 py-1 text-[9px] font-semibold uppercase tracking-wider text-slate-500">Your patches</p>
            {slots.length === 0 && <p className="px-3 py-3 text-center text-[11px] text-slate-500">No saved patches yet</p>}
            {slots.map((slot) => (
              <div key={slot.name} className="group flex items-center gap-2 px-3 py-1.5 hover:bg-white/5">
                <button
                  onClick={() => {
                    onLoad(slot.name)
                    setOpen(false)
                  }}
                  className="min-w-0 flex-1 text-left"
                >
                  <span className="block truncate text-xs text-slate-200">{slot.name}</span>
                  <span className="text-[10px] text-slate-500">{relative(slot.savedAt)}</span>
                </button>
                <button
                  title={`Delete "${slot.name}"`}
                  onClick={() => {
                    onDelete(slot.name)
                    refresh()
                  }}
                  className="rounded px-1.5 py-0.5 text-[11px] text-slate-500 opacity-0 transition-opacity hover:bg-rose-500/20 hover:text-rose-300 group-hover:opacity-100"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>

          <div className="flex border-t border-white/5">
            <button
          title="Download this patch as a .json file"
              onClick={() => {
                onExport()
                setOpen(false)
              }}
              className="flex-1 px-3 py-2 text-xs text-slate-300 hover:bg-white/5"
            >
              ⭳ Export JSON
            </button>
            <button
          title="Load a patch from a .json file"
              onClick={() => fileRef.current?.click()}
              className="flex-1 border-l border-white/5 px-3 py-2 text-xs text-slate-300 hover:bg-white/5"
            >
              ⭱ Import JSON
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
