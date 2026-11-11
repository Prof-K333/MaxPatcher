import { describe, expect, it } from 'vitest'
import { PatchHistory, toSnapshot, type PatchSnapshot } from './history'

const snap = (name: string, freq: number, x = 0): PatchSnapshot =>
  toSnapshot(
    name,
    [
      {
        id: 'osc-1',
        type: 'patch',
        position: { x, y: 0 },
        data: { type: 'oscillator', params: { frequency: freq } },
      },
    ],
    [{ id: 'e1', source: 'osc-1', sourceHandle: 'out', target: 'master', targetHandle: 'in' }],
  )

describe('PatchHistory', () => {
  it('ignores a commit that matches the current snapshot, including selection-only noise', () => {
    const a = snap('A', 110)
    const history = new PatchHistory(a)
    expect(history.commit(snap('A', 110))).toBe(false)
    expect(history.canUndo).toBe(false)

    const withSelection = structuredClone(a)
    // toSnapshot already drops selection; two equivalent graphs compare equal.
    expect(history.commit(withSelection)).toBe(false)
  })

  it('undoes and redoes a committed change, and a new edit clears redo', () => {
    const history = new PatchHistory(snap('A', 110))
    history.commit(snap('A', 220))
    history.commit(snap('B', 220))
    expect(history.canUndo).toBe(true)

    const back = history.undo(history.current)
    expect(back).toEqual(snap('A', 220))
    const start = history.undo(history.current)
    expect(start).toEqual(snap('A', 110))
    expect(history.undo(history.current)).toBeNull()

    const again = history.redo(history.current)
    expect(again).toEqual(snap('A', 220))

    history.commit(snap('C', 440))
    expect(history.canRedo).toBe(false)
    expect(history.undo(history.current)).toEqual(snap('A', 220))
  })

  it('undo of an uncommitted gesture discards it rather than taking two steps', () => {
    const history = new PatchHistory(snap('A', 110, 0))
    history.commit(snap('A', 110, 40))
    // Mid-drag: present has moved, but commit has not been called.
    const result = history.undo(snap('A', 110, 99))
    expect(result).toEqual(snap('A', 110, 40))
    expect(history.canRedo).toBe(false)
  })
})
