import { describe, expect, it } from 'vitest'
import fixture from '../../../fixtures/timer-unified-timeline.json'
import type { UnifiedTimerProgram } from '../../types'
import type { NativeTimerCapabilities } from '../../native/ChandasTimerService'
import { nativeSupportsRuntimeProgram } from '../runtime-capabilities'
import { defaultPatternProgram } from '../timerV2'

const program = fixture.program as UnifiedTimerProgram
const caps = { contractVersion: 14, programSchemaMin: 2, programSchemaMax: 4, supportsUnifiedSteps: true, supportsStepSubBells: true, supportsSecondPrecision: true, supportsSubBellSecondPrecision: true, supportsStepAlarms: true, supportsRandomRepeat: true, supportsUnlimitedSounds: true } as NativeTimerCapabilities

describe('native runtime schema and semantic capability gates', () => {
  it('allows the verified unified contract while retaining compatible legacy programs', () => {
    expect(nativeSupportsRuntimeProgram(program, caps)).toBe(true)
    expect(nativeSupportsRuntimeProgram(defaultPatternProgram(), caps)).toBe(true)
    expect(nativeSupportsRuntimeProgram(defaultPatternProgram(), { ...caps, programSchemaMax: 3, supportsUnifiedSteps: undefined, supportsStepSubBells: undefined })).toBe(true)
  })
  it('rejects missing capabilities, older binaries and an incompatible minimum schema', () => {
    expect(nativeSupportsRuntimeProgram(program, null)).toBe(false)
    expect(nativeSupportsRuntimeProgram(program, { ...caps, programSchemaMax: 3 })).toBe(false)
    expect(nativeSupportsRuntimeProgram(program, { ...caps, programSchemaMin: 5 })).toBe(false)
  })
  it.each(['supportsUnifiedSteps', 'supportsStepSubBells', 'supportsSecondPrecision', 'supportsSubBellSecondPrecision', 'supportsRandomRepeat', 'supportsStepAlarms'] as const)('requires advertised %s rather than trusting schema number alone', feature => {
    expect(nativeSupportsRuntimeProgram(program, { ...caps, [feature]: false })).toBe(false)
    expect(nativeSupportsRuntimeProgram(program, { ...caps, [feature]: undefined })).toBe(false)
  })
  it('gates large sound lists even when attached to a sub-bell of a later step', () => {
    const copy = structuredClone(program)
    const track = copy.steps[1].subBellTracks[0]
    track.sounds = Array.from({ length: 9 }, (_, index) => ({ kind: 'document' as const, uri: `content://sounds/${index}`, title: `Sound ${index}` }))
    expect(nativeSupportsRuntimeProgram(copy, { ...caps, supportsUnlimitedSounds: false })).toBe(false)
  })
})
