export function formatClockTime(minutes: number): string {
  const value = ((Math.round(minutes) % 1_440) + 1_440) % 1_440
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`
}

export function nextLocalClockTime(minutes: number, now: number): number {
  const deadline = new Date(now)
  const hour = Math.floor(minutes / 60)
  const minute = minutes % 60
  deadline.setHours(hour, minute, 0, 0)
  if (deadline.getTime() <= now) {
    deadline.setTime(now)
    deadline.setDate(deadline.getDate() + 1)
    deadline.setHours(hour, minute, 0, 0)
  }
  return deadline.getTime()
}

/** Right-filled clock entry: 2, 22, 2:20, 22:00. */
export function formatClockDraft(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 4)
  if (digits.length <= 2) return digits
  return digits.length === 3 ? `${digits[0]}:${digits.slice(1)}` : `${digits.slice(0, 2)}:${digits.slice(2)}`
}

export function parseClockDraft(value: string): number | null {
  const digits = value.replace(/\D/g, '')
  if (digits.length === 0 || digits.length > 4) return null
  if (digits.length <= 2) return Number(digits) <= 59 ? Number(digits) : null
  const hours = Number(digits.slice(0, -2))
  const minutes = Number(digits.slice(-2))
  return hours <= 23 && minutes <= 59 ? hours * 60 + minutes : null
}

export function formatDurationDraft(value: string, secondPrecision: boolean): string {
  const digits = value.replace(/\D/g, '') || '0'
  const groups: string[] = []
  let remaining = digits
  const groupCount = secondPrecision ? 2 : 1
  for (let index = 0; index < groupCount && remaining.length > 2; index += 1) {
    groups.unshift(remaining.slice(-2))
    remaining = remaining.slice(0, -2)
  }
  groups.unshift(remaining)
  return groups.join(':')
}

export function parseDurationDigits(value: string, secondPrecision: boolean): number | null {
  const digits = value.replace(/\D/g, '')
  if (!digits) return null
  let remaining = digits
  const seconds = secondPrecision ? Number(remaining.slice(-2)) : 0
  if (secondPrecision) remaining = remaining.slice(0, -2)
  const minutes = Number(remaining.slice(-2) || 0)
  const hours = Number(remaining.slice(0, -2) || 0)
  if (minutes > 59 || seconds > 59) return null
  return hours * 3_600 + minutes * 60 + seconds
}
