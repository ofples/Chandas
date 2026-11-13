import type { AppTimerSettings, RunningControlId } from '../types'

export { type RunningControlId } from '../types'

export const RUNNING_CONTROL_DEFINITIONS: ReadonlyArray<{
  id: RunningControlId
  title: string
  description: string
  icon: 'restart' | 'clock' | 'alarm' | 'focus' | 'volume' | 'scrub'
}> = [
  { id: 'restart', title: 'Reset interval', description: 'Restart the current interval from now.', icon: 'restart' },
  { id: 'clock', title: 'Snap to clock', description: 'Align repeating cycles to a chosen clock time.', icon: 'clock' },
  { id: 'alarm', title: 'Alarm', description: 'Toggle an alarm at the end of an interval or step.', icon: 'alarm' },
  { id: 'stepAlarm', title: 'Step alarm', description: 'Toggle an alarm at the end of the current sequence step.', icon: 'alarm' },
  { id: 'focus', title: 'Chandas Focus', description: 'Let Chandas manage its Android Do Not Disturb rule.', icon: 'focus' },
  { id: 'sound', title: 'Sound and mute', description: 'Adjust volume, mixer, and mute duration.', icon: 'volume' },
  { id: 'scrub', title: 'Scrubbing', description: 'Hold for one second to scrub the timer ring or drag the step selector.', icon: 'scrub' },
]

export function enabledRunningControls(settings: Pick<AppTimerSettings, 'advancedModeEnabled' | 'runningControlIds'>): ReadonlySet<RunningControlId> {
  if (settings.runningControlIds) return new Set(settings.runningControlIds)
  // Keep existing saved setups behaving the same until their owner edits the list.
  return settings.advancedModeEnabled
    ? new Set<RunningControlId>(['restart', 'clock', 'alarm', 'stepAlarm', 'focus', 'sound'])
    : new Set<RunningControlId>(['restart', 'clock', 'stepAlarm', 'sound'])
}
