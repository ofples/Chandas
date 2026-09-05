import type { AvailabilityOverride, AvailabilityPolicy, TimerProgram, WeeklyAvailabilityWindow } from '../types'

/** Compatibility shape used only by the v1 screen/runtime during migration. */
export interface ActiveHoursSettings {
  activeHoursEnabled: boolean
  activeHoursStart: number
  activeHoursEnd: number
  activeHoursDays: number
}

export type AvailabilitySettings = AvailabilityPolicy | ActiveHoursSettings
export interface AvailabilitySegment { start: number; end: number }

/** Bounded runs are intentionally uninterrupted; saved schedules remain available for Continuous mode. */
export function effectiveAvailabilityForProgram(program: Pick<TimerProgram, 'runPolicy'>, availability: AvailabilityPolicy): AvailabilityPolicy {
  return program.runPolicy.kind === 'continuous' ? availability : { enabled: false, weeklyWindows: [], overrides: [] }
}

/** Merged civil-time spans for one local weekday, including overnight carry-in. */
export function scheduleSegmentsForDay(value: AvailabilityPolicy, day: number): AvailabilitySegment[] {
  if (!value.enabled) return [{ start: 0, end: 1_440 }]
  const normalizedDay = ((day % 7) + 7) % 7
  const previousDay = (normalizedDay + 6) % 7
  const segments = value.weeklyWindows.flatMap(window => {
    if (!window.enabled) return []
    const start = normalizeMinute(window.startMinutes)
    const end = normalizeMinute(window.endMinutes)
    const selected = (candidate: number) => ((window.days & 0b1111111) & (1 << candidate)) !== 0
    if (start === end) return selected(normalizedDay) ? [{ start: 0, end: 1_440 }] : []
    if (start < end) return selected(normalizedDay) ? [{ start, end }] : []
    const pieces: AvailabilitySegment[] = []
    if (selected(previousDay) && end > 0) pieces.push({ start: 0, end })
    if (selected(normalizedDay) && start < 1_440) pieces.push({ start, end: 1_440 })
    return pieces
  }).sort((left, right) => left.start - right.start)
  return segments.reduce<AvailabilitySegment[]>((merged, segment) => {
    const previous = merged.at(-1)
    if (!previous || segment.start > previous.end) merged.push({ ...segment })
    else previous.end = Math.max(previous.end, segment.end)
    return merged
  }, [])
}

/** Boundaries of the rendered union; hidden/subsumed ranges add no internal ticks. */
export function scheduleRenderedBoundaryMinutesForDay(value: AvailabilityPolicy, day: number): number[] {
  if (!value.enabled) return []
  return [...new Set(scheduleSegmentsForDay(value, day).flatMap(segment => [segment.start, segment.end]))]
    .sort((left, right) => left - right)
}

/**
 * User-authored availability transitions for one civil day. Unlike rendered
 * segments, an overnight range does not invent labels at 00:00 or 24:00: only
 * its real end and start remain visible in the compact timeline.
 */
export function scheduleBoundaryMinutesForDay(value: AvailabilityPolicy, day: number): number[] {
  if (!value.enabled) return []
  const normalizedDay = ((day % 7) + 7) % 7
  const previousDay = (normalizedDay + 6) % 7
  const boundaries = value.weeklyWindows.flatMap(window => {
    if (!window.enabled) return []
    const start = normalizeMinute(window.startMinutes)
    const end = normalizeMinute(window.endMinutes)
    const selected = (candidate: number) => ((window.days & 0b1111111) & (1 << candidate)) !== 0
    if (start === end) return selected(normalizedDay) ? [0, 1_440] : []
    if (start < end) return selected(normalizedDay) ? [start, end] : []
    const result: number[] = []
    if (selected(previousDay)) result.push(end)
    if (selected(normalizedDay)) result.push(start)
    return result
  })
  return [...new Set(boundaries)].sort((left, right) => left - right)
}

/** Count configured ranges that contribute time to this day, once per range. */
export function scheduleRangeCountForDay(value: AvailabilityPolicy, day: number): number {
  if (!value.enabled) return 0
  const normalizedDay = ((day % 7) + 7) % 7
  const previousDay = (normalizedDay + 6) % 7
  return value.weeklyWindows.filter(window => {
    if (!window.enabled) return false
    const start = normalizeMinute(window.startMinutes)
    const end = normalizeMinute(window.endMinutes)
    const selectedToday = isDayEnabled(window, normalizedDay)
    return selectedToday || (start > end && end > 0 && isDayEnabled(window, previousDay))
  }).length
}

const DAY_MS = 86_400_000

function minuteOfDay(timestamp: number): number {
  const date = new Date(timestamp)
  return date.getHours() * 60 + date.getMinutes()
}

function normalizeMinute(value: number): number {
  return ((Math.round(value) % 1_440) + 1_440) % 1_440
}

function isLegacy(settings: AvailabilitySettings): settings is ActiveHoursSettings {
  return 'activeHoursEnabled' in settings
}

function policyFor(settings: AvailabilitySettings): AvailabilityPolicy {
  if (!isLegacy(settings)) return settings
  return {
    enabled: settings.activeHoursEnabled,
    weeklyWindows: [{
      id: 'legacy-active-hours',
      enabled: true,
      startMinutes: settings.activeHoursStart,
      endMinutes: settings.activeHoursEnd,
      days: settings.activeHoursDays,
    }],
    overrides: [],
  }
}

function isDayEnabled(window: WeeklyAvailabilityWindow, day: number): boolean {
  return ((window.days & 0b1111111) & (1 << day)) !== 0
}

function isWithinWindow(window: WeeklyAvailabilityWindow, timestamp: number): boolean {
  if (!window.enabled) return false
  const start = normalizeMinute(window.startMinutes)
  const end = normalizeMinute(window.endMinutes)
  const date = new Date(timestamp)
  const minute = minuteOfDay(timestamp)
  if (start === end) return isDayEnabled(window, date.getDay())
  if (start < end) return isDayEnabled(window, date.getDay()) && minute >= start && minute < end
  if (minute >= start) return isDayEnabled(window, date.getDay())
  if (minute < end) return isDayEnabled(window, (date.getDay() + 6) % 7)
  return false
}

function matchingOverride(overrides: AvailabilityOverride[], timestamp: number, behavior: AvailabilityOverride['behavior']): boolean {
  return overrides.some(override => override.behavior === behavior && override.startAt <= timestamp && timestamp < override.endAt)
}

/** Resolves weekly civil time and future calendar-derived absolute overrides. */
export function isWithinActiveHours(settings: AvailabilitySettings, timestamp = Date.now()): boolean {
  const policy = policyFor(settings)
  const weeklyActive = !policy.enabled || policy.weeklyWindows.some(window => isWithinWindow(window, timestamp))
  const active = weeklyActive || matchingOverride(policy.overrides, timestamp, 'active')
  return active && !matchingOverride(policy.overrides, timestamp, 'mute')
}

function weeklyBoundary(window: WeeklyAvailabilityWindow, timestamp: number, dayOffset: number): number {
  const start = normalizeMinute(window.startMinutes)
  const boundaryMinute = start === normalizeMinute(window.endMinutes) ? 0 : start
  const candidate = new Date(timestamp)
  candidate.setHours(Math.floor(boundaryMinute / 60), boundaryMinute % 60, 0, 0)
  candidate.setDate(candidate.getDate() + dayOffset)
  return candidate.getTime()
}

/** Returns the earliest future instant at which resolved availability is active. */
export function nextActiveHoursStart(settings: AvailabilitySettings, timestamp = Date.now()): number {
  const policy = policyFor(settings)
  if (isWithinActiveHours(policy, timestamp)) return timestamp
  const candidates = new Set<number>()
  for (const override of policy.overrides) {
    if (override.startAt > timestamp) candidates.add(override.startAt)
    if (override.endAt > timestamp) candidates.add(override.endAt)
  }
  for (const window of policy.weeklyWindows) {
    if (!policy.enabled || !window.enabled || (window.days & 0b1111111) === 0) continue
    for (let dayOffset = 0; dayOffset <= 8; dayOffset += 1) {
      const start = weeklyBoundary(window, timestamp, dayOffset)
      if (start > timestamp && isDayEnabled(window, new Date(start).getDay())) candidates.add(start)
    }
  }
  const sorted = [...candidates].sort((left, right) => left - right)
  return sorted.find(candidate => isWithinActiveHours(policy, candidate)) ?? timestamp + 8 * DAY_MS
}

/** True when a schedule has at least one possible base or future active slot. */
export function hasAvailableTime(settings: AvailabilitySettings, timestamp = Date.now()): boolean {
  const policy = policyFor(settings)
  if (!policy.enabled) return true
  if (policy.weeklyWindows.some(window => window.enabled && (window.days & 0b1111111) !== 0)) return true
  return policy.overrides.some(override => override.behavior === 'active' && override.endAt > timestamp)
}

export function windowsOverlap(left: WeeklyAvailabilityWindow, right: WeeklyAvailabilityWindow): boolean {
  if (!left.enabled || !right.enabled) return false
  const segments = (window: WeeklyAvailabilityWindow): Array<[number, number]> => {
    const result: Array<[number, number]> = []
    const start = normalizeMinute(window.startMinutes)
    const end = normalizeMinute(window.endMinutes)
    for (let day = 0; day < 7; day += 1) {
      if (!isDayEnabled(window, day)) continue
      const dayStart = day * 1_440
      const rawEnd = start === end ? dayStart + 1_440 : start < end ? dayStart + end : dayStart + 1_440 + end
      const rawStart = start === end ? dayStart : dayStart + start
      if (rawEnd <= 7 * 1_440) result.push([rawStart, rawEnd])
      else {
        result.push([rawStart, 7 * 1_440])
        result.push([0, rawEnd - 7 * 1_440])
      }
    }
    return result
  }
  const leftSegments = segments(left)
  const rightSegments = segments(right)
  return leftSegments.some(([leftStart, leftEnd]) => rightSegments.some(([rightStart, rightEnd]) => leftStart < rightEnd && rightStart < leftEnd))
}
