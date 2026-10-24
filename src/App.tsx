import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  addEdge,
  useNodesState,
  useEdgesState,
  type Connection,
  type Edge,
  type Node,
  type OnConnect,
} from '@xyflow/react'

import { engine } from './audio/AudioEngine'
import { NODE_DEFS, defaultParams } from './audio/nodeDefs'
import type { PatchNodeData } from './audio/types'
import { PatchNodeView } from './components/PatchNode'
import { Toolbar } from './components/Toolbar'
import { PatchMenu } from './components/PatchMenu'
import { DockedKeyboard } from './components/DockedKeyboard'
import { midiToFreq } from './components/Piano'
import { deserialize, serialize, PatchParseError } from './patch/format'
import { PRESETS } from './patch/presets'
import { downloadPatch, readFileAsJSON } from './patch/file'
import { deleteSlot, loadAutosave, readSlot, saveAutosave, saveSlot } from './patch/storage'

type PNode = Node<PatchNodeData>

const makeNode = (type: string, position: { x: number; y: number }, id?: string): PNode => ({
  id: id ?? `${type}-${crypto.randomUUID().slice(0, 8)}`,
  type: 'patch',
  position,
  data: { type, params: defaultParams(type) },
})

/**
 * Starting patch: a playable voice on the left — keyboard → looper → FM synth
 * → filter — and a drum machine on the right, already sequenced. Both feed the
 * master, which sums them.
 */
const initialNodes = (): PNode[] => [
  makeNode('keyboard', { x: 40, y: 20 }, 'kbd-1'),
  makeNode('looper', { x: 430, y: 40 }, 'loop-1'),
  makeNode('fmsynth', { x: 90, y: 290 }, 'fm-1'),
  makeNode('lfo', { x: 430, y: 330 }, 'lfo-1'),
  makeNode('filter', { x: 130, y: 700 }, 'filter-1'),
  makeNode('destination', { x: 160, y: 980 }, 'master'),
  makeNode('drumSeq', { x: 760, y: 30 }, 'seq-1'),
  makeNode('drums808', { x: 820, y: 420 }, 'drums-1'),
]

const DRUM_VOICES = ['bd', 'sd', 'cp', 'ch', 'oh', 'cb']

const initialEdges = (): Edge[] => [
  { id: 'e1', source: 'kbd-1', sourceHandle: 'ev:note', target: 'loop-1', targetHandle: 'ev:in' },
  { id: 'e2', source: 'loop-1', sourceHandle: 'ev:out', target: 'fm-1', targetHandle: 'ev:note' },
  { id: 'e3', source: 'fm-1', sourceHandle: 'out', target: 'filter-1', targetHandle: 'in' },
  { id: 'e4', source: 'lfo-1', sourceHandle: 'out', target: 'filter-1', targetHandle: 'param:detune' },
  { id: 'e5', source: 'filter-1', sourceHandle: 'out', target: 'master', targetHandle: 'in' },

  // One trigger cable per drum voice, plus the accent lane as CV.
  ...DRUM_VOICES.map((voice) => ({
    id: `e-trig-${voice}`,
    source: 'seq-1',
    sourceHandle: `ev:${voice}`,
    target: 'drums-1',
    targetHandle: `ev:${voice}`,
  })),
  { id: 'e-accent', source: 'seq-1', sourceHandle: 'accent', target: 'drums-1', targetHandle: 'cv:accent' },
  { id: 'e-drums', source: 'drums-1', sourceHandle: 'out', target: 'master', targetHandle: 'in' },
]

/** Restores the last session, falling back to the demo patch. */
const restored = (() => {
  const saved = loadAutosave()
  if (!saved) return null
  try {
    return deserialize(saved)
  } catch {
    return null
  }
})()

type Toast = { kind: 'info' | 'error'; text: string }

function Patcher() {
  const [nodes, setNodes, onNodesChange] = useNodesState<PNode>(restored?.nodes ?? initialNodes())
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(restored?.edges ?? initialEdges())
  const [running, setRunning] = useState(engine.running)
  const [patchName, setPatchName] = useState(restored?.name ?? 'Untitled')
  const [toast, setToast] = useState<Toast | null>(null)

  const nodeTypes = useMemo(() => ({ patch: PatchNodeView }), [])

  const notify = useCallback((kind: Toast['kind'], text: string) => setToast({ kind, text }), [])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), toast.kind === 'error' ? 6000 : 2500)
    return () => clearTimeout(t)
  }, [toast])

  // The one place the visual graph drives the audio graph. Guarded because an
  // exception escaping an effect unmounts the entire React tree — the UI would
  // vanish mid-performance and leave notes sounding with nothing to stop them.
  useEffect(() => {
    try {
      engine.sync(nodes, edges)
    } catch (err) {
      console.error('[audio] graph sync failed', err)
    }
  }, [nodes, edges])

  // Autosave, debounced so dragging a slider does not thrash localStorage.
  const warnedQuota = useRef(false)
  useEffect(() => {
    const t = setTimeout(() => {
      const ok = saveAutosave(serialize(patchName, nodes, edges))
      if (!ok && !warnedQuota.current) {
        warnedQuota.current = true
        notify('error', 'Could not autosave — browser storage is unavailable.')
      }
    }, 500)
    return () => clearTimeout(t)
  }, [nodes, edges, patchName, notify])

  useEffect(() => {
    const unsubscribe = engine.subscribe(() => setRunning(engine.running))
    return () => {
      unsubscribe()
    }
  }, [])

  const onConnect: OnConnect = useCallback(
    (connection: Connection) => setEdges((eds) => addEdge({ ...connection, animated: true }, eds)),
    [setEdges],
  )

  /** Cable colour follows the port kind: audio, modulation or events. */
  const styledEdges = useMemo(
    () =>
      edges.map((e) => {
        const target = e.targetHandle ?? 'in'
        const isEvent = target.startsWith('ev:') || (e.sourceHandle ?? '').startsWith('ev:')
        const isMod = target.startsWith('param:') || target.startsWith('cv:')
        const stroke = isEvent ? '#fbbf24' : isMod ? '#a78bfa' : '#38bdf8'
        return {
          ...e,
          animated: true,
          style: { stroke, strokeDasharray: isEvent ? '2 3' : isMod ? '6 4' : undefined },
        }
      }),
    [edges],
  )

  // Keyboard nodes are the dock's possible destinations.
  // A keyboard keeps its own name if given one; otherwise it is numbered by
  // the order it was added, which is stable enough to navigate by.
  const keyboardNodes = useMemo(
    () =>
      nodes
        .filter((n) => n.data.type === 'keyboard')
        .map((n, i) => ({
          id: n.id,
          label: String(n.data.params.name ?? '').trim() || `Keyboard ${i + 1}`,
        })),
    [nodes],
  )
  const [dockTarget, setDockTarget] = useState<string | null>(null)
  const activeDockTarget = dockTarget && keyboardNodes.some((k) => k.id === dockTarget) ? dockTarget : keyboardNodes[0]?.id ?? null

  // A selected keyboard node with focus enabled owns QWERTY; the dock yields.
  const qwertyTakenByNode = nodes.some(
    (n) => n.data.type === 'keyboard' && n.selected && Number(n.data.params.focus ?? 1) >= 0.5,
  )

  // The dock is a surface for one node, so it reads that node's settings
  // rather than keeping a competing set of its own.
  const dockNode = nodes.find((n) => n.id === activeDockTarget)
  const dockOctave = Number(dockNode?.data.params.octave ?? 4)
  const dockVelocity = Number(dockNode?.data.params.velocity ?? 0.8)
  const dockHold = Number(dockNode?.data.params.hold ?? 0) >= 0.5

  const setDockOctave = useCallback(
    (octave: number) =>
      setNodes((ns) =>
        ns.map((n) => (n.id === activeDockTarget ? { ...n, data: { ...n.data, params: { ...n.data.params, octave } } } : n)),
      ),
    [activeDockTarget, setNodes],
  )

  /** Rings the keyboard node the docked keyboard is currently playing. */
  const dockMarkedNodes = useMemo(
    () =>
      nodes.map((n) =>
        n.id === activeDockTarget
          ? { ...n, className: 'dock-target', data: { ...n.data, isDockTarget: true } }
          : n,
      ),
    [nodes, activeDockTarget],
  )

  const setDockHold = useCallback(
    (hold: boolean) =>
      setNodes((ns) =>
        ns.map((n) =>
          n.id === activeDockTarget ? { ...n, data: { ...n.data, params: { ...n.data.params, hold: hold ? 1 : 0 } } } : n,
        ),
      ),
    [activeDockTarget, setNodes],
  )

  const dockNoteOn = useCallback(
    (targetId: string, midi: number, velocity: number) =>
      engine.sendToNode(targetId, 'ui', { type: 'noteOn', note: midi, freq: midiToFreq(midi), velocity }),
    [],
  )
  const dockNoteOff = useCallback(
    (targetId: string, midi: number) => engine.sendToNode(targetId, 'ui', { type: 'noteOff', note: midi }),
    [],
  )

  const masterNode = nodes.find((n) => n.data.type === 'destination')
  const masterVolume = Number(masterNode?.data.params.volume ?? -6)

  const setMasterVolume = (db: number) =>
    setNodes((ns) =>
      ns.map((n) => (n.data.type === 'destination' ? { ...n, data: { ...n.data, params: { ...n.data.params, volume: db } } } : n)),
    )

  /** Drops new nodes in a free column to the right, so nothing lands on top. */
  const addNode = (type: string) =>
    setNodes((ns) => {
      const rightEdge = ns.reduce((max, n) => Math.max(max, n.position.x + (NODE_DEFS[n.data.type]?.width ?? 188)), 0)
      const column = rightEdge + 48
      const stacked = ns.filter((n) => n.position.x >= column - 24).length
      return [...ns, makeNode(type, { x: column, y: 20 + stacked * 60 })]
    })

  const clearPatch = () => {
    setEdges(initialEdges())
    setNodes(initialNodes())
    setPatchName('Untitled')
  }

  // ------------------------------------------------------------- persistence

  const applyPatch = (next: ReturnType<typeof deserialize>) => {
    // Edges go first: dropping them before the nodes change means the engine
    // never sees a cable pointing at a node that is no longer there.
    setEdges([])
    setNodes(next.nodes)
    setEdges(next.edges)
    setPatchName(next.name)
    if (next.warnings.length) notify('error', `Loaded with ${next.warnings.length} issue(s): ${next.warnings[0]}`)
  }

  const handleSave = (name: string) => {
    const ok = saveSlot(serialize(name, nodes, edges))
    notify(ok ? 'info' : 'error', ok ? `Saved "${name}"` : 'Could not save — browser storage is unavailable.')
  }

  const handleLoad = (name: string) => {
    const file = readSlot(name)
    if (!file) return notify('error', `"${name}" is no longer in storage.`)
    try {
      applyPatch(deserialize(file))
      notify('info', `Loaded "${name}"`)
    } catch (err) {
      notify('error', err instanceof PatchParseError ? err.message : 'That saved patch could not be read.')
    }
  }

  const handleDelete = (name: string) => {
    deleteSlot(name)
    notify('info', `Deleted "${name}"`)
  }

  const handleLoadPreset = (name: string) => {
    const preset = PRESETS.find((p) => p.name === name)
    if (!preset) return
    try {
      // Presets go through the same validation as an imported file, so a
      // broken one surfaces as a warning instead of a silent dead patch.
      applyPatch(deserialize(preset.build()))
      notify('info', `Loaded "${name}"`)
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'That example could not be loaded.')
    }
  }

  const handleExport = () => downloadPatch(serialize(patchName, nodes, edges))

  const handleImport = async (file: File) => {
    try {
      const parsed = deserialize(await readFileAsJSON(file))
      applyPatch(parsed)
      if (!parsed.warnings.length) notify('info', `Imported "${parsed.name}"`)
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'That file could not be imported.')
    }
  }

  return (
    <div className="flex h-full flex-col">
      <Toolbar
        running={running}
        onToggle={() => void engine.toggle()}
        masterVolume={masterVolume}
        onMasterVolume={setMasterVolume}
        onAdd={addNode}
        onClear={clearPatch}
      >
        <PatchMenu
          patchName={patchName}
          onNameChange={setPatchName}
          onSave={handleSave}
          onLoad={handleLoad}
          onDelete={handleDelete}
          onExport={handleExport}
          onImport={handleImport}
          onLoadPreset={handleLoadPreset}
        />
      </Toolbar>

      <div className="relative flex-1">
        <ReactFlow
          nodes={dockMarkedNodes}
          edges={styledEdges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          nodeTypes={nodeTypes}
          defaultEdgeOptions={{ animated: true }}
          fitView
          proOptions={{ hideAttribution: true }}
          colorMode="dark"
        >
          <Background variant={BackgroundVariant.Dots} gap={18} size={1} color="#1e293b" />
          <Controls className="!bg-slate-800 !text-slate-200" />
          <MiniMap
            pannable
            zoomable
            className="!bg-slate-900"
            nodeColor={(n) => NODE_DEFS[(n.data as PatchNodeData).type]?.accent ?? '#64748b'}
          />
        </ReactFlow>

        {toast && (
          <div
            data-testid="toast"
            className={`absolute left-1/2 top-4 z-20 -translate-x-1/2 rounded-md px-3 py-1.5 text-xs shadow-lg ring-1 ${
              toast.kind === 'error'
                ? 'bg-rose-950/90 text-rose-200 ring-rose-500/30'
                : 'bg-slate-800/95 text-slate-200 ring-white/10'
            }`}
          >
            {toast.text}
          </div>
        )}

        {!running && (
          <div className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-slate-800/90 px-4 py-1.5 text-xs text-slate-300 ring-1 ring-white/10">
            Audio context suspended — press <span className="font-semibold text-emerald-400">Start Audio</span> to hear the patch
          </div>
        )}
      </div>

      <DockedKeyboard
        targets={keyboardNodes}
        selectedTarget={activeDockTarget}
        onSelectTarget={setDockTarget}
        octave={dockOctave}
        velocity={dockVelocity}
        hold={dockHold}
        onOctaveChange={setDockOctave}
        onHoldChange={setDockHold}
        onNoteOn={dockNoteOn}
        onNoteOff={dockNoteOff}
        qwertyTakenByNode={qwertyTakenByNode}
      />
    </div>
  )
}

export default function App() {
  return (
    <ReactFlowProvider>
      <Patcher />
    </ReactFlowProvider>
  )
}
