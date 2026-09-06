import type { RunPolicy, TimerMode } from '../types'

export function runLengthSummary(mode: TimerMode, value: RunPolicy, cycleDurationSeconds: number): string {
  if (value.kind === 'continuous') return 'Keeps running continuously.'
  if (value.kind === 'duration') return `Runs for ${formatCompactDuration(value.durationSeconds)}.`
  const unit = mode === 'sequence' ? 'round' : 'cycle'
  const count = value.cycleCount
  return `Runs for ${count} ${unit}${count === 1 ? '' : 's'} = ${formatCompactDuration(count * cycleDurationSeconds)}.`
}

function formatCompactDuration(seconds: number): string {
  const totalMinutes = Math.max(1, Math.round(seconds / 60))
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours === 0) return `${minutes}m`
  return minutes === 0 ? `${hours}hr` : `${hours}hr ${minutes}m`
}
