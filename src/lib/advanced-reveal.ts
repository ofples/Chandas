export interface AdvancedRevealMetrics {
  contentHeight: number
  viewportHeight: number
  offsetY: number
  pullDistance: number
}

export interface AdvancedRevealState {
  maximumOffset: number
  restOffset: number
  pullOffset: number
  progress: number
}

/**
 * Treats the final part of the scroll content as a deliberate pull zone.
 * At rest, none of that zone has been consumed. Scrolling through it supplies
 * continuous progress, including on Android where visual overscroll events are
 * not consistently delivered to JavaScript.
 */
export function advancedRevealState({ contentHeight, viewportHeight, offsetY, pullDistance }: AdvancedRevealMetrics): AdvancedRevealState {
  const maximumOffset = Math.max(0, contentHeight - viewportHeight)
  const availablePull = Math.min(Math.max(0, pullDistance), maximumOffset)
  const restOffset = Math.max(0, maximumOffset - availablePull)
  const pullOffset = Math.max(0, Math.min(availablePull, offsetY - restOffset))
  const progress = availablePull > 0 ? pullOffset / availablePull : 0

  return { maximumOffset, restOffset, pullOffset, progress }
}

export function shouldRevealAdvanced(progress: number, threshold: number): boolean {
  return progress >= threshold
}
