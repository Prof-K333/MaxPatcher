/**
 * Shared vocabulary between the visual graph and the audio graph.
 *
 * Ports come in three flavours:
 *   audio  — `"in"` / `"out"`, ordinary signal flow.
 *   param  — `"param:<name>"`, an audio-rate modulation inlet on a Tone Param.
 *   event  — `"ev:<name>"`, discrete messages (note on/off, bangs). These are
 *            delivered as JS calls, not signals, which is what makes polyphony
 *            and step sequencing possible.
 *
 * A `cv` port is an audio-rate signal that a JS scheduler samples rather than
 * patching into a Param — used by the granular node, whose grain scheduler
 * runs in JS and reads its modulation inlets once per grain.
 */
export type PortKind = 'audio' | 'param' | 'event' | 'cv'

export interface PortSpec {
  id: string
  label: string
  kind: PortKind
}

export type ParamControl =
  | { control: 'slider'; min: number; max: number; step: number; unit?: string; curve?: 'linear' | 'log' }
  | { control: 'select'; options: string[] }
  | { control: 'toggle' }
  | { control: 'text'; placeholder?: string; maxLength?: number }

export type ParamSpec = {
  key: string
  label: string
  default: number | string
  /** Keeps a param out of the node body when a custom UI already shows it. */
  hidden?: boolean
} & ParamControl

export type NodeCategory = 'source' | 'effect' | 'modulator' | 'output' | 'control' | 'voice'

export interface NodeDef {
  type: string
  label: string
  category: NodeCategory
  /** Tailwind-ish hex accents, used for the node header and its edges. */
  accent: string
  inputs: PortSpec[]
  outputs: PortSpec[]
  params: ParamSpec[]
  /** Shown in the palette so a module is recognisable at a glance. */
  icon?: string
  /** One line in the palette saying what this node is for. */
  description?: string
  /** Named custom UI rendered inside the node, above its params. */
  ui?: string
  width?: number
  /**
   * Where handles sit. 'vertical' (the default) puts inlets on top and
   * outlets underneath; 'horizontal' uses the left and right edges, which
   * suits a wide node carrying many ports.
   */
  ports?: 'vertical' | 'horizontal'
}

export type ParamValues = Record<string, number | string>

export interface PatchNodeData extends Record<string, unknown> {
  type: string
  params: ParamValues
}

/** Discrete messages that travel along event cables. */
export type PatchEvent =
  | { type: 'noteOn'; note: number; freq: number; velocity: number; time?: number }
  | { type: 'noteOff'; note: number; time?: number }
  | { type: 'bang'; velocity?: number; time?: number }

export const isNoteOn = (e: PatchEvent): e is Extract<PatchEvent, { type: 'noteOn' }> => e.type === 'noteOn'
