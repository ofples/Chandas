import { describe, expect, it } from 'vitest'
import fixture from '../../../fixtures/timer-unified-timeline.json'
import type { UnifiedTimerProgram } from '../../types'
import { unifiedCueIdentity, unifiedIterationEnd, unifiedProgramDurationMs, unifiedRunEndAt, unifiedSkipTarget, unifiedTimelinePosition, nextUnifiedProgramEvent } from '../unified-timeline'
import { seekStepTarget, timelinePosition } from '../timeline'

const base = fixture.program as UnifiedTimerProgram
const query = (now: number, program = base, visibleOnly = false) => nextUnifiedProgramEvent(program, fixture.anchor, now, fixture.anchor, null, fixture.randomSeed, visibleOnly)

describe('unified timer timeline', () => {
  it('keeps bells on their own cadence past the stored finite interval', () => {
    const step = structuredClone(base.steps[0])
    step.durationSeconds = 60
    step.endAlarmEnabled = true
    const [minute, five] = step.subBellTracks
    Object.assign(minute, { repeatEnabled: true, enabled: true, cadenceSeconds: 60, selectedOffsetsSeconds: [], afterStartSeconds: 5, randomRepeat: undefined })
    Object.assign(five, { repeatEnabled: true, enabled: true, cadenceSeconds: 300, selectedOffsetsSeconds: [], beforeEndSeconds: 10, randomRepeat: undefined })
    const program: UnifiedTimerProgram = { ...base, steps: [step], noMainInterval: true, alignment: { kind: 'elapsed' }, completionCue: null }
    expect(query(fixture.anchor, program)?.at).toBe(fixture.anchor + 60_000)
    expect(query(fixture.anchor + 299_999, program)?.winner).toMatchObject({ trackId: five.id, kind: 'sub-bell' })
    const done = nextUnifiedProgramEvent(program, fixture.anchor, fixture.anchor, fixture.anchor, fixture.anchor + 30_000)
    expect(done).toMatchObject({ completesRun: true, winner: { volume: 0, hapticOverride: 'off' } })
    expect(seekStepTarget(program, fixture.anchor, fixture.anchor, fixture.anchor, null, 0.5)).toBeNull()
  })

  it('can find deterministic bounded random gaps after a long restore', () => {
    const step = structuredClone(base.steps[0])
    const [track] = step.subBellTracks
    Object.assign(track, { enabled: true, repeatEnabled: false, randomRepeat: { minSeconds: 30, maxSeconds: 73 } })
    step.subBellTracks = [track]
    const program: UnifiedTimerProgram = { ...base, steps: [step], noMainInterval: true, alignment: { kind: 'elapsed' } }
    let at = query(fixture.anchor + 100 * 86_400_000, program)!.at
    for (let i = 0; i < 40; i++) {
      const next = query(at, program)!.at
      expect(next - at).toBeGreaterThanOrEqual(30_000)
      expect(next - at).toBeLessThanOrEqual(73_000)
      expect(query(next - 1, program)?.at).toBe(next)
      at = next
    }
  })

  it('scrubs within the current step and keeps a fixed end time', () => {
    const now = 71_000
    const program: UnifiedTimerProgram = { ...base, runPolicy: { ...base.runPolicy, kind: 'duration' } }
    const target = seekStepTarget(program, 1_000, now, 1_000, 130_000, 0.5)!
    expect(target.terminalAt).toBe(130_000)
    expect(timelinePosition(program, target.anchor, now, target.startedAt, target.terminalAt)).toMatchObject({ currentStepIndex: 1, stepProgress: 0.5 })
  })

  it('mutes a main sound while keeping its alarm and sound choice', () => {
    const program = structuredClone(base)
    program.steps[0].endCue.soundMuted = true
    program.steps[0].endAlarmEnabled = true
    expect(query(fixture.anchor + program.steps[0].durationSeconds * 1000 - 1, program)?.winner)
      .toMatchObject({ alarmEnabled: true, sound: program.steps[0].endCue.sound, volume: 0 })
  })
  it('plays both step markers ahead of coincident cadence cues', () => {
    const program = structuredClone(base)
    const step = program.steps[0]
    step.durationSeconds = 300
    const [cadence, marker] = step.subBellTracks
    cadence.selectedOffsetsSeconds = [120, 180]
    cadence.repeatEnabled = true
    marker.repeatEnabled = false
    marker.afterStartSeconds = 120
    marker.beforeEndSeconds = 120
    for (const seconds of [120, 180]) {
      const event = query(fixture.anchor + seconds * 1_000 - 1, program)
      expect(event?.at).toBe(fixture.anchor + seconds * 1_000)
      expect(event?.candidates).toHaveLength(2)
      expect(event?.winner.trackId).toBe(marker.id)
    }
  })

  it('uses the next local occurrence of Until and ends between step boundaries', () => {
    const program = structuredClone(base)
    const startedAt = new Date(2026, 10, 6, 23, 59, 55).getTime()
    program.runPolicy = { ...program.runPolicy, kind: 'until', untilMinutes: 0 }
    const midnight = new Date(2026, 10, 7).getTime()
    expect(unifiedRunEndAt(program, startedAt, startedAt)).toBe(midnight)
    expect(nextUnifiedProgramEvent(program, startedAt, midnight - 1, startedAt)).toMatchObject({ at: midnight, completesRun: true })
    expect(nextUnifiedProgramEvent(program, startedAt, midnight, startedAt)).toBeNull()
  })

  it('keeps ending alarms attached to the correct step in a 10s then 5s sequence', () => {
    const program = structuredClone(base)
    Object.assign(program.steps[0], { durationSeconds: 10, subBellsEnabled: false, endAlarmEnabled: true })
    Object.assign(program.steps[1], { durationSeconds: 5, subBellsEnabled: false, endAlarmEnabled: false })
    expect(query(fixture.anchor, program)).toMatchObject({ at: fixture.anchor + 10_000, stepIndex: 0, winner: { alarmEnabled: true } })
    expect(query(fixture.anchor + 10_000, program)).toMatchObject({ at: fixture.anchor + 15_000, stepIndex: 1 })
    expect(query(fixture.anchor + 10_000, program)?.winner.alarmEnabled).toBeUndefined()
  })
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
