import { describe, expect, it } from 'vitest'
import { normalizeNativeFocusState } from '../focusState'
import type { NativeFocusState } from '../../native/ChandasTimerService'

const running: NativeFocusState = {
  policyAccess: true,
  automationEnabled: true,
  ruleExists: true,
  ruleEnabled: true,
  actual: 'inactive',
  reason: 'unknown',
  timerRunning: true,
  requestedActive: true,
  pausedByAndroid: false,
  ruleWasRemoved: false,
  withinActiveHours: true,
}

describe('native Focus presentation', () => {
  it('does not report a late Android deactivation as paused after Stop', () => {
    const state = normalizeNativeFocusState({
      ...running,
      timerRunning: false,
      requestedActive: false,
      pausedByAndroid: true,
      reason: 'paused-by-android',
    })
    expect(state.reason).toBe('timer-stopped')
  })

  it('reports an Android snooze while a running timer still requests Focus', () => {
    const state = normalizeNativeFocusState({ ...running, pausedByAndroid: true })
    expect(state.reason).toBe('paused-by-android')
  })

  it('keeps rule removal actionable even while the timer is stopped', () => {
    const state = normalizeNativeFocusState({
      ...running,
      automationEnabled: false,
      timerRunning: false,
      requestedActive: false,
      ruleExists: false,
      ruleWasRemoved: true,
    })
    expect(state.reason).toBe('rule-disabled')
  })

  it('preserves the reason supplied by an older binary without raw facts', () => {
    const legacy: NativeFocusState = {
      policyAccess: true,
      automationEnabled: true,
      ruleExists: true,
      ruleEnabled: true,
      actual: 'unknown',
      reason: 'outside-active-hours',
    }
    expect(normalizeNativeFocusState(legacy)).toBe(legacy)
  })
})
