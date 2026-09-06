import { describe, expect, it } from 'vitest'
import { defaultTimerHapticsSettings, hapticProfileSummary, normalizeTimerHapticsSettings } from '../haptic-profiles'

describe('timer haptic profiles', () => {
  it('uses quiet sub-bells and a repeating-friendly double alarm by default', () => {
    expect(defaultTimerHapticsSettings()).toEqual({
      enabled: true,
      main: { pattern: 'single', strength: 'strong' },
      subBell: { pattern: 'single', strength: 'gentle' },
      alarm: { pattern: 'double', strength: 'strong' },
    })
  })

  it('repairs malformed settings without discarding valid choices', () => {
    expect(normalizeTimerHapticsSettings({
      enabled: false,
      main: { pattern: 'double', strength: 'balanced' },
      subBell: { pattern: 'unknown', strength: 'strong' },
      alarm: null,
    })).toEqual({
      enabled: false,
      main: { pattern: 'double', strength: 'balanced' },
      subBell: { pattern: 'single', strength: 'strong' },
      alarm: { pattern: 'double', strength: 'strong' },
    })
  })

  it('formats a compact profile summary', () => {
    expect(hapticProfileSummary({ pattern: 'triple', strength: 'gentle' })).toBe('Triple · Gentle')
  })
})
