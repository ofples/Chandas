import { describe, expect, it, vi } from 'vitest'
import { stopAndVerifyNativeTimer } from '../verifiedTimerStop'

describe('verified native timer stop', () => {
  it('succeeds only after Android reports the timer inactive', () => {
    const stop = vi.fn()
    expect(stopAndVerifyNativeTimer({ stop, getState: () => ({ active: false }) })).toBe(true)
    expect(stop).toHaveBeenCalledOnce()
  })

  it('accepts a secondary cleanup exception when the schedule is inactive', () => {
    expect(stopAndVerifyNativeTimer({
      stop: () => { throw new Error('window cleanup failed') },
      getState: () => ({ active: false }),
    })).toBe(true)
  })

  it('does not claim success while Android still owns an active schedule', () => {
    expect(stopAndVerifyNativeTimer({ stop: () => undefined, getState: () => ({ active: true }) })).toBe(false)
  })

  it('fails closed when the authoritative state cannot be read', () => {
    expect(stopAndVerifyNativeTimer({
      stop: () => undefined,
      getState: () => { throw new Error('bridge unavailable') },
    })).toBe(false)
  })
})
