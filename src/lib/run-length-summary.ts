import type { RunPolicy, TimerMode } from '../types'
import { formatCompactDurationSeconds } from './timerV2'
import { formatClockTime } from './time-inputs'

export function runLengthSummary(mode: TimerMode, value: RunPolicy, cycleDurationSeconds: number, rounds = mode === 'sequence'): string {
  if (value.kind === 'continuous') return 'Keeps running continuously.'
  if (value.kind === 'duration') return `Runs for ${formatCompactDurationSeconds(value.durationSeconds)}.`
  if (value.kind === 'until') return `Stops at the next ${formatClockTime(value.untilMinutes ?? 0)} local time.`
  const unit = rounds ? 'round' : 'cycle'
  const count = value.cycleCount
  return `Runs for ${count} ${unit}${count === 1 ? '' : 's'} = ${formatCompactDurationSeconds(count * cycleDurationSeconds)}.`
}
