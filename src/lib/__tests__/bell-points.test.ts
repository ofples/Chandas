import { describe, expect, it } from 'vitest'
import { bellPointOffsets, bellPoints, validBellPoints } from '../bell-points'
import { createStarterTimers } from '../starter-timers'
import { parseUnifiedTimerProgram } from '../unified-timer'
import { nextUnifiedProgramEvent } from '../unified-timeline'
import { nativeSupportsRuntimeProgram } from '../runtime-capabilities'
import type { NativeTimerCapabilities } from '../../native/ChandasTimerService'

function program() {
  const p = createStarterTimers()[2].program
  const step = p.steps[0]
  step.durationSeconds = 100
  const t = step.subBellTracks[0]
  Object.assign(t, { repeatEnabled: false, selectedOffsetsSeconds: [], points: [{ id: 'quarter', kind: 'percent', value: 25 }, { id: 'fixed', kind: 'start', value: 80 }, { id: 'last', kind: 'end', value: 10 }] })
  return p
}
describe('authored bell points', () => {
  it('rescales percentages, keeps fixed times dormant and resolves legacy markers', () => {
    const t = program().steps[0].subBellTracks[0]
    expect(bellPointOffsets(t, 100)).toEqual([25, 80, 90])
    expect(bellPointOffsets(t, 40)).toEqual([10, 30])
    expect(bellPointOffsets(t, 200)).toEqual([50, 80, 190])
    expect(bellPoints({ afterStartSeconds: 12, beforeEndSeconds: 7 })).toEqual([{ id: 'legacy-after', kind: 'start', value: 12 }, { id: 'legacy-before', kind: 'end', value: 7 }])
    expect(bellPointOffsets({ ...t, afterStartSeconds: 25 }, 100)).toEqual([25, 80, 90])
  })
  it('schedules actual cues on each round, including fractional percentages rounded once', () => {
    const p = program(); p.runPolicy.kind = 'continuous'
    let at = 1000
    const events = []
    for (let i = 0; i < 8; i++) { const event = nextUnifiedProgramEvent(p, 1000, at, 1000, null)!; events.push([event.at, event.winner.kind]); at = event.at }
    expect(events).toEqual([[26000, 'sub-bell'], [81000, 'sub-bell'], [91000, 'sub-bell'], [101000, 'step-end'], [126000, 'sub-bell'], [181000, 'sub-bell'], [191000, 'sub-bell'], [201000, 'step-end']])
    expect(bellPointOffsets({ points: [{ id: 'fraction', kind: 'percent', value: 12.5 }] }, 60)).toEqual([8])
    expect(bellPointOffsets({ points: [{ id: 'tiny', kind: 'percent', value: 0.1 }] }, 1)).toEqual([])
  })
  it('deduplicates coincident points and gives explicit points precedence over cadence', () => {
    const p = program(), t = p.steps[0].subBellTracks[0]
    t.points!.push({ id: 'same', kind: 'start', value: 25 })
    p.steps[0].subBellTracks.unshift({ ...t, id: 'cadence', repeatEnabled: true, cadenceSeconds: 25, points: [], selectedOffsetsSeconds: [25, 50, 75] })
    const event = nextUnifiedProgramEvent(p, 1000, 1000, 1000, null)!
    expect(event.candidates).toHaveLength(2)
    expect(event.winner.trackId).toBe(t.id)
    expect(event.winner.explicitMarker).toBe(true)
  })
  it('validates and independently clones authored positions through saved programs', () => {
    const p = program(), parsed = parseUnifiedTimerProgram(JSON.stringify(p))
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.value.steps[0].subBellTracks[0].points).toEqual(p.steps[0].subBellTracks[0].points)
    expect(parsed.value.steps[0].subBellTracks[0].points).not.toBe(p.steps[0].subBellTracks[0].points)
    for (const points of [null, [{ id: 'x', kind: 'percent', value: 100 }], [{ id: 'x', kind: 'start', value: 1.5 }], [{ id: 'x', kind: 'percent', value: 1.23 }], [{ id: 'x', kind: 'start', value: 2 }, { id: 'x', kind: 'end', value: 3 }]]) {
      expect(validBellPoints(points)).toBe(false)
      expect(parseUnifiedTimerProgram({ ...p, steps: [{ ...p.steps[0], subBellTracks: [{ ...p.steps[0].subBellTracks[0], points }] }] }).ok).toBe(false)
    }
  })
  it('requires native support instead of silently dropping point cues on older binaries', () => {
    const caps = { programSchemaMin: 2, programSchemaMax: 4, supportsUnifiedSteps: true, supportsStepSubBells: true, supportsSecondPrecision: true, supportsSubBellSecondPrecision: true, supportsUnlimitedSounds: true } as NativeTimerCapabilities
    expect(nativeSupportsRuntimeProgram(program(), caps)).toBe(false)
    expect(nativeSupportsRuntimeProgram(program(), { ...caps, supportsBellPoints: true })).toBe(true)
  })
})
