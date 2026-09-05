import type { NativeFocusState } from '../native/ChandasTimerService'

/**
 * Converts raw Android rule facts into an OTA-owned presentation reason.
 * Older native contracts omit the facts and keep their native reason.
 */
export function normalizeNativeFocusState(state: NativeFocusState): NativeFocusState {
  if (
    typeof state.timerRunning !== 'boolean' ||
    typeof state.requestedActive !== 'boolean' ||
    typeof state.pausedByAndroid !== 'boolean' ||
    typeof state.ruleWasRemoved !== 'boolean' ||
    typeof state.withinActiveHours !== 'boolean'
  ) return state

  const reason: NativeFocusState['reason'] = !state.policyAccess
    ? state.automationEnabled ? 'access-required' : 'off'
    : state.ruleWasRemoved || (state.ruleExists && !state.ruleEnabled)
      ? 'rule-disabled'
      : !state.automationEnabled
        ? 'off'
        : !state.timerRunning
          ? 'timer-stopped'
          : state.pausedByAndroid && state.requestedActive
            ? 'paused-by-android'
            : state.actual === 'active'
              ? 'active'
              : !state.withinActiveHours
                ? 'outside-active-hours'
                : 'unknown'
  return state.reason === reason ? state : { ...state, reason }
}
