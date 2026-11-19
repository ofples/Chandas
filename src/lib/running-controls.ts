import type { AppTimerSettings, RunningControlId } from '../types'

export { type RunningControlId } from '../types'

export const RUNNING_CONTROL_DEFINITIONS: ReadonlyArray<{
  id: RunningControlId
  title: string
  description: string
  icon: 'restart' | 'clock' | 'alarm' | 'focus' | 'volume' | 'scrub'
}> = [
  { id: 'restart', title: 'Reset timer', description: 'Start again immediately from the beginning. Clock alignment turns off.', icon: 'restart' },
  { id: 'clock', title: 'Snap to clock', description: 'Choose a clock offset for the repeating cycle. Not used for bells-only timers.', icon: 'clock' },
  { id: 'alarm', title: 'Interval alarm', description: 'For single-interval timers: tap for the next alarm, double-tap for every interval. Tap again to turn it off.', icon: 'alarm' },
  { id: 'stepAlarm', title: 'Step alarm', description: 'Turn the current step’s alarm on or off, including future rounds.', icon: 'alarm' },
  { id: 'focus', title: 'Chandas Focus', description: 'Let Chandas manage its Android Do Not Disturb rule.', icon: 'focus' },
  { id: 'sound', title: 'Sound and mute', description: 'Adjust volume and individual sounds, or mute until a duration, time, or bell.', icon: 'volume' },
  { id: 'scrub', title: 'Scrubbing', description: 'Hold for half a second, then turn the ring or drag the step strip. Holding alone leaves the time unchanged.', icon: 'scrub' },
]

export function enabledRunningControls(settings: Pick<AppTimerSettings, 'advancedModeEnabled' | 'runningControlIds'>): ReadonlySet<RunningControlId> {
  if (settings.runningControlIds) return new Set(settings.runningControlIds)
  // Keep existing saved setups behaving the same until their owner edits the list.
  return settings.advancedModeEnabled
    ? new Set<RunningControlId>(['restart', 'clock', 'alarm', 'stepAlarm', 'focus', 'sound'])
    : new Set<RunningControlId>(['restart', 'clock', 'stepAlarm', 'sound'])
}
