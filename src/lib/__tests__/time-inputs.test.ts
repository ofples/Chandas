import { describe, expect, it } from 'vitest'
import { formatClockDraft, formatDurationDraft, parseClockDraft, parseDurationDigits } from '../time-inputs'

describe('right-filled time inputs', () => {
  it('builds a 24-hour clock value one digit at a time', () => {
    expect(['2', '22', '220', '2200'].map(formatClockDraft)).toEqual(['2', '22', '2:20', '22:00'])
    expect(parseClockDraft('22:00')).toBe(22 * 60)
    expect(parseClockDraft('40:00')).toBeNull()
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
