export interface ActiveHoursSettings {
  activeHoursEnabled: boolean
  activeHoursStart: number
  activeHoursEnd: number
  activeHoursDays: number
}

function minuteOfDay(timestamp: number): number {
  const date = new Date(timestamp)
  return date.getHours() * 60 + date.getMinutes()
}

function normalizedDays(settings: ActiveHoursSettings): number {
  return settings.activeHoursDays & 0b1111111
}

function isDayEnabled(settings: ActiveHoursSettings, day: number): boolean {
  return (normalizedDays(settings) & (1 << day)) !== 0
}

export function isWithinActiveHours(settings: ActiveHoursSettings, timestamp = Date.now()): boolean {
  if (!settings.activeHoursEnabled) return true
  const start = ((settings.activeHoursStart % 1_440) + 1_440) % 1_440
  const end = ((settings.activeHoursEnd % 1_440) + 1_440) % 1_440
  const date = new Date(timestamp)
  const minute = minuteOfDay(timestamp)
  if (start === end) return isDayEnabled(settings, date.getDay())
  if (start < end) return isDayEnabled(settings, date.getDay()) && minute >= start && minute < end
  if (minute >= start) return isDayEnabled(settings, date.getDay())
  if (minute < end) return isDayEnabled(settings, (date.getDay() + 6) % 7)
  return false
}

export function nextActiveHoursStart(settings: ActiveHoursSettings, timestamp = Date.now()): number {
  const start = ((settings.activeHoursStart % 1_440) + 1_440) % 1_440
  // Equal endpoints mean the selected civil day is active for all 24 hours,
  // so the next selected window begins at midnight rather than at an arbitrary
  // (equal) endpoint minute.
  const boundaryMinute = start === ((settings.activeHoursEnd % 1_440) + 1_440) % 1_440 ? 0 : start
  const candidate = new Date(timestamp)
  candidate.setHours(Math.floor(boundaryMinute / 60), boundaryMinute % 60, 0, 0)
  for (let offset = 0; offset <= 7; offset += 1) {
    if (candidate.getTime() > timestamp && isDayEnabled(settings, candidate.getDay())) {
      return candidate.getTime()
    }
    candidate.setDate(candidate.getDate() + 1)
  }
  return candidate.getTime()
}
