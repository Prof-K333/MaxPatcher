/**
 * Walk a bank of memory slots as a long loop, without growing the 16-step grid.
 *
 * An 8-slot chain repeated 8 times is a 64-bar loop; repeated 16 times is 128.
 * Both the 808 sequencer and the Arp / Sequencer use this same rule.
 */

/** One bar, in sixteenth notes — the grid both sequencers show. */
export const BAR_STEPS = 16

/** Longest arrangement we will honour, in bars. */
export const MAX_ARRANGEMENT_BARS = 512

/** Drop anything that is not a real slot index. */
export function normalizeOrder(raw: unknown, slotCount: number): number[] {
  if (!Array.isArray(raw)) return []
  const out: number[] = []
  for (const item of raw) {
    const n = typeof item === 'number' ? item : Number(item)
    if (Number.isInteger(n) && n >= 0 && n < slotCount) out.push(n)
  }
  return out
}

/**
 * Requested loop length in bars. 0 means "just keep looping the order"
 * (one trip through the chain is the implicit loop).
 */
export function normalizeBars(raw: unknown): number {
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) return 0
  return Math.min(MAX_ARRANGEMENT_BARS, Math.max(1, Math.round(n)))
}

/**
 * How many bars make one full loop of this arrangement.
 * An 8-slot order with bars=128 is 16 trips through the chain.
 */
export function loopLength(orderLength: number, bars: number): number {
  if (orderLength <= 0) return 1
  if (bars > 0) return bars
  return orderLength
}

/** Which entry in the order plays at this bar of the loop. */
export function orderIndexAtBar(orderLength: number, bar: number): number {
  if (orderLength <= 0) return 0
  return ((bar % orderLength) + orderLength) % orderLength
}

/** Which memory slot plays at this bar, or null when there is no order. */
export function slotAtBar(order: number[], bar: number): number | null {
  if (!order.length) return null
  return order[orderIndexAtBar(order.length, bar)]
}

/** How many times the chain must repeat to fill `bars` (8 slots, 128 bars → 16). */
export function chainRepeats(orderLength: number, bars: number): number {
  if (orderLength <= 0) return 0
  return Math.ceil(loopLength(orderLength, bars) / orderLength)
}

/** Advance one bar through a chain; wraps after `loopLength` bars. */
export function nextArrangeBar(orderLength: number, bars: number, arrangeBar: number): number {
  const loop = loopLength(orderLength, bars)
  return (arrangeBar + 1) % Math.max(1, loop)
}
