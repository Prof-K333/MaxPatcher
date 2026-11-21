import { describe, expect, it } from 'vitest'
import { chainRepeats, loopLength, nextArrangeBar, normalizeBars, normalizeOrder, slotAtBar } from './arrangement'

describe('arrangement chain math', () => {
  it('makes a 64-bar loop from 8 memory slots repeated 8 times', () => {
    const order = [0, 1, 2, 3, 4, 5, 6, 7]
    expect(loopLength(order.length, 64)).toBe(64)
    expect(chainRepeats(order.length, 64)).toBe(8)
    expect(slotAtBar(order, 0)).toBe(0)
    expect(slotAtBar(order, 8)).toBe(0)
    expect(slotAtBar(order, 63)).toBe(7)
  })

  it('makes a 128-bar loop from 8 memory slots repeated 16 times', () => {
    const order = [0, 1, 2, 3, 4, 5, 6, 7]
    expect(loopLength(order.length, 128)).toBe(128)
    expect(chainRepeats(order.length, 128)).toBe(16)
    expect(slotAtBar(order, 15)).toBe(7)
    expect(slotAtBar(order, 16)).toBe(0)
    expect(slotAtBar(order, 127)).toBe(7)
  })

  it('walks the chain and wraps after the requested length', () => {
    const order = [2, 0, 1]
    expect(slotAtBar(order, 0)).toBe(2)
    expect(slotAtBar(order, 1)).toBe(0)
    expect(slotAtBar(order, 2)).toBe(1)
    expect(nextArrangeBar(3, 6, 5)).toBe(0)
    expect(nextArrangeBar(3, 6, 0)).toBe(1)
  })

  it('drops an empty or invalid order so playback stays on the current slot', () => {
    expect(normalizeOrder(undefined, 16)).toEqual([])
    expect(normalizeOrder([0, -1, 99, 2, '3'], 16)).toEqual([0, 2, 3])
    expect(normalizeBars(undefined)).toBe(0)
    expect(normalizeBars(128)).toBe(128)
    expect(slotAtBar([], 4)).toBeNull()
    expect(loopLength(0, 128)).toBe(1)
  })
})
