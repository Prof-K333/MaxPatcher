import type { ParamValues } from '../../audio/types'

export interface NodeUIProps {
  nodeId: string
  params: ParamValues
  setParam: (key: string, value: number | string) => void
  selected: boolean
  /** True when the docked keyboard is currently playing through this node. */
  isDockTarget?: boolean
}
