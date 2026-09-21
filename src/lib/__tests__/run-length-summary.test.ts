import { describe, expect, it } from 'vitest'
import { runLengthSummary } from '../run-length-summary'

describe('runLengthSummary', () => {
  it('describes continuous runs without implying an end', () => {
    expect(runLengthSummary('pattern', { kind: 'continuous', cycleCount: 3, durationSeconds: 2_700 }, 1_800)).toBe('Keeps running continuously.')
  })

  it('combines a pattern cycle count with its resulting duration', () => {
    expect(runLengthSummary('pattern', { kind: 'cycles', cycleCount: 1, durationSeconds: 2_700 }, 1_800)).toBe('Runs for 1 cycle = 30m.')
    expect(runLengthSummary('pattern', { kind: 'cycles', cycleCount: 3, durationSeconds: 2_700 }, 1_800)).toBe('Runs for 3 cycles = 1hr 30m.')
  })

  it('uses round language for a sequence', () => {
    expect(runLengthSummary('sequence', { kind: 'cycles', cycleCount: 2, durationSeconds: 2_700 }, 1_920)).toBe('Runs for 2 rounds = 1hr 4m.')
  })

  it('describes an exact-duration run directly', () => {
    expect(runLengthSummary('pattern', { kind: 'duration', cycleCount: 3, durationSeconds: 2_700 }, 1_800)).toBe('Runs for 45m.')
    expect(runLengthSummary('pattern', { kind: 'duration', cycleCount: 3, durationSeconds: 75 }, 1_800)).toBe('Runs for 1m 15s.')
    expect(runLengthSummary('sequence', { kind: 'cycles', cycleCount: 3, durationSeconds: 75 }, 30)).toBe('Runs for 3 rounds = 1m 30s.')
  })
})
