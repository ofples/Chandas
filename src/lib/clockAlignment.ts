const MINUTE_MS = 60_000

/** Clock offsets that represent distinct schedule phases for this interval. */
export function clockSnapPresets(mainMinutes: number): number[] {
  const duration = Math.max(1, Math.round(mainMinutes))
  const upperExclusive = Math.min(60, duration)
  const result: number[] = []
  for (let offset = 0; offset < upperExclusive; offset += 5) result.push(offset)
  return result
}

export function clockOffsetLabel(offsetMinutes: number): string {
  const normalized = Math.max(0, Math.min(59, Math.round(offsetMinutes)))
  return `:${String(normalized).padStart(2, '0')}`
}

/** Most recent local wall-clock boundary for a repeating Pattern. */
export function alignedClockAnchor(mainMinutes: number, offsetMinutes: number, now: number): number {
  const duration = Math.max(1, Math.round(mainMinutes))
  const date = new Date(now)
  const minuteOfDay = date.getHours() * 60 + date.getMinutes()
  const elapsedMinutes = ((minuteOfDay - offsetMinutes) % duration + duration) % duration
  return now - elapsedMinutes * MINUTE_MS - date.getSeconds() * 1_000 - date.getMilliseconds()
}
