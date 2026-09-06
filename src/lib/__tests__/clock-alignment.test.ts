import { describe, expect, it } from 'vitest'
import { alignedClockAnchor, canonicalClockOffset, clockMinutePhaseCount, clockOffsetLabel, clockSnapPresets } from '../clockAlignment'

describe('clock alignment', () => {
  it('offers only distinct five-minute phases', () => {
    expect(clockSnapPresets(60)).toEqual([0])
    expect(clockSnapPresets(5 * 60)).toEqual([0])
    expect(clockSnapPresets(10 * 60)).toEqual([0, 5])
    expect(clockSnapPresets(30 * 60)).toEqual([0, 5, 10, 15, 20, 25])
    expect(clockSnapPresets(90 * 60)).toEqual([0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55])
  })

  it('derives and canonicalizes minute-selected phases for exact cycles', () => {
    expect(clockMinutePhaseCount(75)).toBe(5)
    expect(clockMinutePhaseCount(90)).toBe(3)
    expect(clockMinutePhaseCount(30)).toBe(1)
    expect(canonicalClockOffset(75, 29)).toBe(4)
    expect(canonicalClockOffset(30, 25)).toBe(0)
    expect(clockMinutePhaseCount(Number.NaN)).toBe(1)
    expect(canonicalClockOffset(75, Number.NaN)).toBe(0)
  })

  it('finds the most recent matching local-clock boundary', () => {
    const now = new Date(2026, 8, 5, 10, 17, 42, 123).getTime()
    const anchor = new Date(alignedClockAnchor(30 * 60, 20, now))
    expect([anchor.getHours(), anchor.getMinutes(), anchor.getSeconds(), anchor.getMilliseconds()]).toEqual([9, 50, 0, 0])
  })

  it('keeps an exact boundary stable', () => {
    const now = new Date(2026, 8, 5, 10, 5, 0, 0).getTime()
    expect(alignedClockAnchor(30 * 60, 5, now)).toBe(now)
  })

  it('aligns exact-second cycles to the selected minute phase', () => {
    const now = new Date(2026, 8, 5, 10, 17, 42, 123).getTime()
    const anchor = new Date(alignedClockAnchor(75, 0, now))
    expect([anchor.getHours(), anchor.getMinutes(), anchor.getSeconds(), anchor.getMilliseconds()]).toEqual([10, 17, 30, 0])
  })

  it('aligns a five-minute sequence round assembled from exact-second steps', () => {
    const now = new Date(2026, 8, 5, 10, 17, 42, 123).getTime()
    const anchor = new Date(alignedClockAnchor(90 + 210, 0, now))
    expect([anchor.getHours(), anchor.getMinutes(), anchor.getSeconds(), anchor.getMilliseconds()]).toEqual([10, 15, 0, 0])
  })

  it('formats bounded minute labels consistently', () => {
    expect(clockOffsetLabel(5)).toBe(':05')
    expect(clockOffsetLabel(73)).toBe(':59')
    expect(clockOffsetLabel(-2)).toBe(':00')
  })
})
