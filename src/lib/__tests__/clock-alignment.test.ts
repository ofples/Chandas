import { describe, expect, it } from 'vitest'
import { alignedClockAnchor, clockOffsetLabel, clockSnapPresets } from '../clockAlignment'

describe('clock alignment', () => {
  it('offers only distinct five-minute phases', () => {
    expect(clockSnapPresets(1)).toEqual([0])
    expect(clockSnapPresets(5)).toEqual([0])
    expect(clockSnapPresets(10)).toEqual([0, 5])
    expect(clockSnapPresets(30)).toEqual([0, 5, 10, 15, 20, 25])
    expect(clockSnapPresets(90)).toEqual([0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55])
  })

  it('finds the most recent matching local-clock boundary', () => {
    const now = new Date(2026, 8, 5, 10, 17, 42, 123).getTime()
    const anchor = new Date(alignedClockAnchor(30, 20, now))
    expect([anchor.getHours(), anchor.getMinutes(), anchor.getSeconds(), anchor.getMilliseconds()]).toEqual([9, 50, 0, 0])
  })

  it('keeps an exact boundary stable', () => {
    const now = new Date(2026, 8, 5, 10, 5, 0, 0).getTime()
    expect(alignedClockAnchor(30, 5, now)).toBe(now)
  })

  it('formats bounded minute labels consistently', () => {
    expect(clockOffsetLabel(5)).toBe(':05')
    expect(clockOffsetLabel(73)).toBe(':59')
    expect(clockOffsetLabel(-2)).toBe(':00')
  })
})
