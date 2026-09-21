const MINUTE_MS = 60_000

function greatestCommonDivisor(left: number, right: number): number {
  let a = Math.abs(Math.round(left))
  let b = Math.abs(Math.round(right))
  while (b !== 0) [a, b] = [b, a % b]
  return Math.max(1, a)
}

/** Number of distinct phases reachable through a whole-minute offset. */
export function clockMinutePhaseCount(cycleDurationSeconds: number): number {
  const rounded = Math.round(cycleDurationSeconds)
  const seconds = Number.isFinite(rounded) ? Math.max(1, rounded) : 1
  return Math.min(60, seconds / greatestCommonDivisor(seconds, 60))
}

/** Minute-first clock offsets that represent distinct phases for an exact cycle. */
export function clockSnapPresets(cycleDurationSeconds: number): number[] {
  const upperExclusive = clockMinutePhaseCount(cycleDurationSeconds)
  const result: number[] = []
  for (let offset = 0; offset < upperExclusive; offset += 5) result.push(offset)
  return result
}

export function canonicalClockOffset(cycleDurationSeconds: number, offsetMinutes: number): number {
  const rounded = Math.round(offsetMinutes)
  const bounded = Number.isFinite(rounded) ? Math.max(0, Math.min(59, rounded)) : 0
  return bounded % clockMinutePhaseCount(cycleDurationSeconds)
}

export function clockOffsetLabel(offsetMinutes: number): string {
  const normalized = Math.max(0, Math.min(59, Math.round(offsetMinutes)))
  return `:${String(normalized).padStart(2, '0')}`
}

/** Most recent local wall-clock boundary for an exact repeating cycle. */
export function alignedClockAnchor(cycleDurationSeconds: number, offsetMinutes: number, now: number): number {
  const roundedDuration = Math.round(cycleDurationSeconds)
  const durationMs = (Number.isFinite(roundedDuration) ? Math.max(1, roundedDuration) : 1) * 1_000
  const date = new Date(now)
  const localTimeOfDayMs = (((date.getHours() * 60 + date.getMinutes()) * 60 + date.getSeconds()) * 1_000) + date.getMilliseconds()
  const roundedOffset = Math.round(offsetMinutes)
  const phaseMs = (Number.isFinite(roundedOffset) ? Math.max(0, Math.min(59, roundedOffset)) : 0) * MINUTE_MS
  const elapsedMs = ((localTimeOfDayMs - phaseMs) % durationMs + durationMs) % durationMs
  return now - elapsedMs
}
