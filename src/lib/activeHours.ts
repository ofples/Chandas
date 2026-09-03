import type { AvailabilityOverride, AvailabilityPolicy, WeeklyAvailabilityWindow } from '../types'

/** Compatibility shape used only by the v1 screen/runtime during migration. */
export interface ActiveHoursSettings {
  activeHoursEnabled: boolean
  activeHoursStart: number
  activeHoursEnd: number
  activeHoursDays: number
}

export type AvailabilitySettings = AvailabilityPolicy | ActiveHoursSettings

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
  // Probe one representative week minute-by-minute. This editor-only helper
  // deliberately shares the runtime's cross-midnight/start-day semantics.
  const base = new Date(2026, 0, 4, 0, 0, 0, 0).getTime() // Sunday
  for (let minute = 0; minute < 7 * 1_440; minute += 1) {
    const timestamp = base + minute * 60_000
    if (isWithinWindow(left, timestamp) && isWithinWindow(right, timestamp)) return true
  }
  return false
}
