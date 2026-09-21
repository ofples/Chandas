import type { RunPolicy, TimerMode } from '../types'
import { formatCompactDurationSeconds } from './timerV2'

export function runLengthSummary(mode: TimerMode, value: RunPolicy, cycleDurationSeconds: number): string {
  if (value.kind === 'continuous') return 'Keeps running continuously.'
  if (value.kind === 'duration') return `Runs for ${formatCompactDurationSeconds(value.durationSeconds)}.`
  const unit = mode === 'sequence' ? 'round' : 'cycle'
  const count = value.cycleCount
  return `Runs for ${count} ${unit}${count === 1 ? '' : 's'} = ${formatCompactDurationSeconds(count * cycleDurationSeconds)}.`
}
