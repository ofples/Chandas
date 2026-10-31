import { describe, expect, it } from 'vitest'
import fixture from '../../../fixtures/timer-unified-timeline.json'
import type { UnifiedTimerProgram } from '../../types'
import { unifiedCueIdentity, unifiedIterationEnd, unifiedProgramDurationMs, unifiedRunEndAt, unifiedSkipTarget, unifiedTimelinePosition, nextUnifiedProgramEvent } from '../unified-timeline'

const base = fixture.program as UnifiedTimerProgram
const query = (now: number, program = base, visibleOnly = false) => nextUnifiedProgramEvent(program, fixture.anchor, now, fixture.anchor, null, fixture.randomSeed, visibleOnly)

describe('unified timer timeline', () => {
  it('matches the independent step/collision/visibility fixture', () => {
    for (const expected of fixture.queries) {
      const event = query(expected.now)
      expect(event?.at, expected.name).toBe(expected.at)
      expect(event?.stepId, expected.name).toBe(expected.stepId)
      expect(event?.roundIndex, expected.name).toBe(expected.roundIndex)
      expect(event?.winner.sourceCueId, expected.name).toBe(expected.winnerCueId)
      expect(event?.candidates.map(candidate => candidate.sourceCueId), expected.name).toEqual(expected.candidateCueIds)
      expect(event?.showOnWatchFace, expected.name).toBe(expected.visible)
      expect(event?.completesRun, expected.name).toBe(expected.completesRun)
      if (expected.alarmEnabled !== undefined) expect(event?.winner.alarmEnabled).toBe(expected.alarmEnabled)
    }
    for (const expected of fixture.visibleQueries) {
      const event = query(expected.now, base, true)
      expect(event?.at).toBe(expected.at)
      expect(event?.winner.sourceCueId).toBe(expected.winnerCueId)
    }
  })

  it('preserves distinct track cue identities across repeated IDs and delimiter characters', () => {
    const program = structuredClone(base)
    program.steps[0].id = 'a:b'
    program.steps[0].subBellTracks[0].id = 'c'
    program.steps[1].id = 'a'
    program.steps[1].subBellTracks[0].id = 'c'
    const firstIdentity = unifiedCueIdentity(program.steps[0].id, program.steps[0].subBellTracks[0].id)
    const secondIdentity = unifiedCueIdentity(program.steps[1].id, program.steps[1].subBellTracks[0].id)
    expect(firstIdentity).not.toBe(secondIdentity)
    expect(unifiedCueIdentity('a:b', 'c')).not.toBe(unifiedCueIdentity('a', 'b:c'))
    const first = query(1_000, program)
    const second = query(61_000, program)
    expect(first?.winner.cueId).not.toBe(second?.winner.cueId)
    expect(first?.winner.sourceCueId).toBe(second?.winner.sourceCueId)
  })

  it('filters infeasible offsets only at scheduling time and keeps collision visibility independent of winner', () => {
    const program = structuredClone(base)
    program.steps[0].durationSeconds = 1
    const track = program.steps[0].subBellTracks[0]
    track.selectedOffsetsSeconds = [30]
    track.afterStartSeconds = 10
    track.beforeEndSeconds = 5
    expect(track.selectedOffsetsSeconds).toEqual([30])
    expect(query(1_000, program)?.winner.sourceCueId).toBe('work')

    const hiddenWinner = query(30_000)
    expect(hiddenWinner?.winner.sourceCueId).toBe('slow-hidden')
    expect(hiddenWinner?.showOnWatchFace).toBe(true)
    expect(query(30_000, base, true)?.winner.sourceCueId).toBe('fast-visible')
    expect(query(51_000)?.showOnWatchFace).toBe(false)
  })

  it('applies cadence priority only when repeating while random and point sources remain active', () => {
    const program = structuredClone(base)
    const track = program.steps[1].subBellTracks[0]
    track.repeatEnabled = false
    track.afterStartSeconds = 5
    track.selectedOffsetsSeconds = [5]
    track.randomRepeat = { minSeconds: 5, maxSeconds: 5 }
    const first = query(61_000, program)
    expect(first?.at).toBe(66_000)
    expect(first?.candidates).toHaveLength(1)
    expect(first?.winner.cadencePriority).toBe(0)
    expect(query(66_000, program)?.at).toBe(71_000)
  })

  it('uses step-relative offsets, exact round duration and stable random schedules', () => {
    const program = structuredClone(base)
    expect(unifiedProgramDurationMs(program)).toBe(100_000)
    const position = unifiedTimelinePosition(program, fixture.anchor, 71_000, fixture.anchor, null, fixture.randomSeed)
    expect(position).toMatchObject({ roundIndex: 0, currentStepIndex: 1, currentStepId: 'rest', stepProgress: 0.25 })
    const track = program.steps[1].subBellTracks[0]
    track.randomRepeat = { minSeconds: 7, maxSeconds: 19 }
    track.repeatEnabled = false
    track.selectedOffsetsSeconds = []
    track.afterStartSeconds = undefined
    track.beforeEndSeconds = undefined
    const firstAt = query(61_000, program)?.at
    expect(firstAt).toBeGreaterThan(61_000)
    expect(query(61_000, program)?.at).toBe(firstAt)
    const nextRound = query(161_000, program)?.at
    expect(nextRound).toBeGreaterThan(161_000)
    expect(nextRound).not.toBe(firstAt! + 100_000)
  })

  it('honors duration and round-count terminals, natural boundary replacement, and fallback cue', () => {
    const durationProgram = { ...structuredClone(base), runPolicy: { kind: 'duration', cycleCount: 1, durationSeconds: 75 } } as UnifiedTimerProgram
    expect(unifiedRunEndAt(durationProgram, 1_000, 1_000)).toBe(76_000)
    const between = nextUnifiedProgramEvent(durationProgram, 1_000, 71_000, 1_000, 76_000, 1_000)
    expect(between).toMatchObject({ at: 76_000, boundary: 'run-complete', completesRun: true, winner: { sourceCueId: 'run-complete', sound: { id: 'bloom' } } })
    const exactDuration = { ...durationProgram, runPolicy: { kind: 'duration', cycleCount: 1, durationSeconds: 60 } } as UnifiedTimerProgram
    expect(nextUnifiedProgramEvent(exactDuration, 1_000, 60_999, 1_000, 61_000, 1_000)).toMatchObject({ at: 61_000, boundary: 'step-end', completesRun: true })
    const customCompletion = { ...exactDuration, completionCue: { sound: { kind: 'builtin', id: 'page' }, volume: 0.4 } } as UnifiedTimerProgram
    expect(nextUnifiedProgramEvent(customCompletion, 1_000, 60_999, 1_000, 61_000, 1_000)).toMatchObject({ at: 61_000, boundary: 'step-end', completesRun: true, winner: { sourceCueId: 'run-complete', sound: { id: 'page' } } })
    const cycles = { ...structuredClone(base), runPolicy: { kind: 'cycles', cycleCount: 2, durationSeconds: 75 } } as UnifiedTimerProgram
    expect(unifiedRunEndAt(cycles, 1_000, 46_000)).toBe(201_000)
    expect(nextUnifiedProgramEvent(cycles, 1_000, 191_000, 46_000, 201_000, 1_000)).toMatchObject({ at: 201_000, boundary: 'round-end', completesRun: true })
  })

  it('computes whole-round mute boundaries and adjacent step skips', () => {
    const end = unifiedIterationEnd(base, 1_000, 71_000, 2)
    expect(end).toMatchObject({ at: 201_000, iterations: 2 })
    expect(end.logicalId).toBe(nextUnifiedProgramEvent(base, 1_000, 200_999, 1_000, null, 1_000)?.logicalId)
    expect(unifiedSkipTarget(base, 1_000, 71_000, 1_000, null, 'next')).toMatchObject({ anchor: -29_000, startedAt: 1_000, completesRun: false })
    expect(unifiedSkipTarget(base, 1_000, 71_000, 1_000, null, 'previous')).toMatchObject({ anchor: 71_000, startedAt: 1_000, completesRun: false })
    expect(unifiedSkipTarget({ ...base, steps: [base.steps[0]] }, 1_000, 2_000, 1_000, null, 'next')).toBeNull()
  })
})
