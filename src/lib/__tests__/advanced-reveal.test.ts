import { describe, expect, it } from 'vitest'
import { advancedRevealState, shouldRevealAdvanced } from '../advanced-reveal'

describe('advanced reveal scroll tail', () => {
  const metrics = { contentHeight: 1100, viewportHeight: 700, pullDistance: 112 }

  it('starts only after the ordinary content reaches its resting bottom', () => {
    expect(advancedRevealState({ ...metrics, offsetY: 288 })).toEqual({
      maximumOffset: 400,
      restOffset: 288,
      pullOffset: 0,
      progress: 0,
    })
  })

  it('reports continuous progress through the pull zone', () => {
    const halfway = advancedRevealState({ ...metrics, offsetY: 344 })
    expect(halfway.pullOffset).toBe(56)
    expect(halfway.progress).toBe(0.5)
  })

  it('clamps progress before and after the pull zone', () => {
    expect(advancedRevealState({ ...metrics, offsetY: 100 }).progress).toBe(0)
    expect(advancedRevealState({ ...metrics, offsetY: 900 }).progress).toBe(1)
  })

  it('normalizes a pull zone on unusually tall viewports', () => {
    const state = advancedRevealState({ contentHeight: 730, viewportHeight: 700, offsetY: 30, pullDistance: 112 })
    expect(state.restOffset).toBe(0)
    expect(state.progress).toBe(1)
  })

  it('commits only at the deliberate release threshold', () => {
    expect(shouldRevealAdvanced(0.81, 0.82)).toBe(false)
    expect(shouldRevealAdvanced(0.82, 0.82)).toBe(true)
  })
})
