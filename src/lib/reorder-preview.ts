export interface ReorderPreview {
  stepId: string
  from: number
  to: number
  rowHeight: number
}

export const REORDER_ACTIVATION_DELAY_MS = 260

export function reorderGestureIntent(elapsedMs: number, distance: number, scrollGesture: boolean, itemCount: number): 'wait' | 'scroll' | 'drag' {
  if (scrollGesture) return 'scroll'
  if (elapsedMs < REORDER_ACTIVATION_DELAY_MS) return distance > 8 ? 'scroll' : 'wait'
  return itemCount > 1 && distance > 2 ? 'drag' : 'wait'
}

/** Position an item occupies while another item is hovering over a new slot. */
export function previewIndexForItem(index: number, from: number, to: number): number {
  if (index === from) return to
  if (from < to && index > from && index <= to) return index - 1
  if (from > to && index >= to && index < from) return index + 1
  return index
}

/** Transform needed to open the hovered slot without mutating the saved order. */
export function previewOffsetForItem(index: number, from: number, to: number, rowHeight: number): number {
  const previewIndex = previewIndexForItem(index, from, to)
  return index === from ? 0 : (previewIndex - index) * rowHeight
}

/** Signed per-frame scroll step near a visible edge; zero when movement cannot reveal another slot. */
export function edgeAutoScrollStep(pageY: number, top: number, bottom: number, edgeSize: number, canMoveEarlier: boolean, canMoveLater: boolean, maximumStep = 10): number {
  if (edgeSize <= 0 || bottom <= top || maximumStep <= 0) return 0
  if (pageY < top + edgeSize && canMoveEarlier) return -Math.ceil(maximumStep * Math.min(1, (top + edgeSize - pageY) / edgeSize))
  if (pageY > bottom - edgeSize && canMoveLater) return Math.ceil(maximumStep * Math.min(1, (pageY - (bottom - edgeSize)) / edgeSize))
  return 0
}
