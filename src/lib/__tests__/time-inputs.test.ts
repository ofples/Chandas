import { describe, expect, it } from 'vitest'
import { formatClockDraft, formatDurationDraft, nextLocalClockTime, parseClockDraft, parseDurationDigits } from '../time-inputs'

describe('right-filled time inputs', () => {
  it('builds a 24-hour clock value one digit at a time', () => {
    expect(['2', '22', '220', '2200'].map(formatClockDraft)).toEqual(['2', '22', '2:20', '22:00'])
    expect(parseClockDraft('22:00')).toBe(22 * 60)
    expect(parseClockDraft('40:00')).toBeNull()
  })

  it('uses the next occurrence of a wall-clock mute deadline', () => {
    const now = new Date(2026, 10, 9, 22, 10, 30).getTime()
    expect(nextLocalClockTime(22 * 60 + 11, now)).toBe(new Date(2026, 10, 9, 22, 11).getTime())
    expect(nextLocalClockTime(22 * 60 + 10, now)).toBe(new Date(2026, 10, 10, 22, 10).getTime())
    expect(nextLocalClockTime(0, now)).toBe(new Date(2026, 10, 10, 0, 0).getTime())
  })

  it('builds a duration from seconds when second precision is enabled', () => {
    expect(['2', '22', '220', '2200', '22000'].map(value => formatDurationDraft(value, true))).toEqual(['2', '22', '2:20', '22:00', '2:20:00'])
    expect(parseDurationDigits('2:20:00', true)).toBe(8_400)
    expect(parseDurationDigits('1:99', true)).toBeNull()
  })

  it('builds a duration from minutes when second precision is disabled', () => {
    expect(formatDurationDraft('220', false)).toBe('2:20')
    expect(parseDurationDigits('2:20', false)).toBe(8_400)
  })
})
