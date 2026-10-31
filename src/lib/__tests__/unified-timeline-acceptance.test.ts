import { describe, expect, it } from 'vitest'
import fixture from '../../../fixtures/timer-unified-timeline.json'
import type { UnifiedTimerProgram } from '../../types'
import { nextUnifiedProgramEvent, unifiedCueIdentity, unifiedIterationEnd, unifiedRunEndAt, unifiedSkipTarget } from '../unified-timeline'
import { defaultPatternProgram } from '../timerV2'
import { convertPatternToUnified } from '../unified-timer'
import { nextPatternEvent } from '../timeline'
import randomVectors from '../../../fixtures/timer-unified-random-vectors.json'

const source = fixture.program as UnifiedTimerProgram

describe('independent shared unified timing vectors', () => {
  it.each(randomVectors.vectors)('matches frozen random vectors for $trackId across pause and rounds', vector => {
    const program = structuredClone(source)
    program.steps = [{ ...program.steps[0], durationSeconds: randomVectors.stepDurationSeconds }]
    program.steps[0].subBellTracks = [{ ...program.steps[0].subBellTracks[0], id: vector.trackId, repeatEnabled: false, selectedOffsetsSeconds: [], randomRepeat: randomVectors.range, afterStartSeconds: undefined, beforeEndSeconds: undefined }]
    for (const anchor of [1000, 71000]) {
      vector.roundOffsets.forEach((offsets, roundIndex) => {
        const stepStart = anchor + roundIndex * 300000
        let now = stepStart
        for (const offset of offsets) {
          const event = nextUnifiedProgramEvent(program, anchor, now, anchor, null, vector.randomSeed)!
          expect(event.at).toBe(stepStart + offset * 1000)
          expect(event.winner.trackId).toBe(vector.trackId)
          now = event.at
        }
        expect(nextUnifiedProgramEvent(program, anchor, now, anchor, null, vector.randomSeed)!.at).toBe(stepStart + 300000)
      })
    }
  })
  it.each(fixture.queries)('$name', query => {
    const event = nextUnifiedProgramEvent(source, fixture.anchor, query.now, fixture.anchor, null, fixture.randomSeed)
    expect(event).toMatchObject({ at: query.at, stepId: query.stepId, roundIndex: query.roundIndex, completesRun: query.completesRun, showOnWatchFace: query.visible })
    expect(event!.winner.sourceCueId).toBe(query.winnerCueId)
    expect(event!.candidates.map(candidate => candidate.sourceCueId)).toEqual(query.candidateCueIds)
    if ('alarmEnabled' in query) expect(event!.winner.alarmEnabled).toBe(query.alarmEnabled)
  })

  it.each(fixture.visibleQueries)('display skips hidden-only cue after $now', query => {
    const event = nextUnifiedProgramEvent(source, fixture.anchor, query.now, fixture.anchor, null, fixture.randomSeed, true)
    expect(event!.at).toBe(query.at)
    expect(event!.winner.sourceCueId).toBe(query.winnerCueId)
  })

  it.each(fixture.boundedQueries)('$name', query => {
    const program = structuredClone(source)
    program.runPolicy = 'cycleCount' in query
      ? { ...program.runPolicy, kind: 'cycles', cycleCount: query.cycleCount! }
      : { ...program.runPolicy, kind: 'duration', durationSeconds: query.durationSeconds! }
    const startedAt = 'startedAt' in query ? query.startedAt! : fixture.anchor
    expect(unifiedRunEndAt(program, fixture.anchor, startedAt)).toBe(query.at)
    const event = nextUnifiedProgramEvent(program, fixture.anchor, query.now, startedAt)
    expect(event).toMatchObject({ at: query.at, completesRun: true })
    if ('winnerCueId' in query) expect(event!.winner.sourceCueId).toBe(query.winnerCueId)
    if ('soundId' in query) expect(event!.winner.sound).toEqual({ kind: 'builtin', id: query.soundId })
    if ('visible' in query) expect(event!.showOnWatchFace).toBe(query.visible)
    expect(nextUnifiedProgramEvent(program, fixture.anchor, query.at, startedAt)).toBeNull()
  })

  it('uses distinct cue namespaces for repeated and delimiter-containing IDs', () => {
    expect(unifiedCueIdentity('a:b', 'c')).not.toBe(unifiedCueIdentity('a', 'b:c'))
    expect(unifiedCueIdentity('work', 'same')).not.toBe(unifiedCueIdentity('rest', 'same'))
    expect(unifiedCueIdentity('🔔', 'same')).not.toBe(unifiedCueIdentity('bell', 'same'))
  })

  it('changes event identity when the accepted phase anchor changes', () => {
    const first = nextUnifiedProgramEvent(source, 1_000, 1_000)!
    const reanchored = nextUnifiedProgramEvent(source, 2_000, 2_000)!
    expect(reanchored.logicalId).not.toBe(first.logicalId)
  })

  it('iteration mute ends at the exact round-closing event identity', () => {
    const iteration = unifiedIterationEnd(source, fixture.anchor, 50_000, 2)
    const event = nextUnifiedProgramEvent(source, fixture.anchor, iteration.at - 1)!
    expect(iteration.at).toBe(201_000)
    expect(event.logicalId).toBe(iteration.logicalId)
    expect(event.isRoundEnd).toBe(true)
  })

  it('a dormant bell configuration produces only the step end until it fits', () => {
    const program = structuredClone(source)
    program.steps = [{ ...program.steps[0], durationSeconds: 1 }]
    const event = nextUnifiedProgramEvent(program, 1000, 1000)!
    expect(event.at).toBe(2000)
    expect(event.winner.sourceCueId).toBe('work')
    expect(program.steps[0].subBellTracks[0].afterStartSeconds).toBe(10)
  })

  it.each(['layer', 'tracks'])('disabled %s leaves authored bells intact and schedules the step end', kind => {
    const program = structuredClone(source)
    if (kind === 'layer') program.steps[0].subBellsEnabled = false
    else program.steps[0].subBellTracks.forEach(track => { track.enabled = false })
    const event = nextUnifiedProgramEvent(program, 1000, 1000)!
    expect(event.at).toBe(61000)
    expect(event.winner.sourceCueId).toBe('work')
    expect(program.steps[0].subBellTracks[0].selectedOffsetsSeconds).toEqual([30])
  })

  it('Next closes the final bounded round despite intervening sub-bells', () => {
    const program = structuredClone(source)
    program.runPolicy.kind = 'cycles'
    program.runPolicy.cycleCount = 2
    const terminal = unifiedRunEndAt(program, 1000, 1000)
    expect(unifiedSkipTarget(program, 1000, 161000, 1000, terminal, 'next')).toMatchObject({ completesRun: true, terminalAt: 201000 })
    expect(unifiedSkipTarget(program, 1000, 61000, 1000, terminal, 'next')!.completesRun).toBe(false)
  })

  it('does not expand tracks in earlier steps during a later step query', () => {
    const program = structuredClone(source)
    Object.defineProperty(program.steps[0], 'subBellTracks', { get() { throw new Error('Earlier tracks were expanded') } })
    expect(nextUnifiedProgramEvent(program, 1000, 61000)!.at).toBe(66000)
  })

  it('preserves the legacy random schedule through conversion, later rounds and a paused-anchor shift', () => {
    const legacy = defaultPatternProgram()
    legacy.mainDurationSeconds = 137
    legacy.tracks = [{ ...legacy.tracks[0], id: '🔔:random', enabled: true, repeatEnabled: false, selectedOffsetsSeconds: [], randomRepeat: { minSeconds: 5, maxSeconds: 47 }, afterStartSeconds: 2, beforeEndSeconds: 9 }]
    const program = convertPatternToUnified(legacy)
    const seed = 987654321
    for (const anchor of [1000, 71000]) {
      let now = anchor
      for (let count = 0; count < 100; count += 1) {
        const old = nextPatternEvent(legacy, anchor, now, seed)
        const unified = nextUnifiedProgramEvent(program, anchor, now, anchor, null, seed)!
        expect(unified.at).toBe(old.at)
        expect(unified.winner.sound).toEqual(old.winner.sound)
        expect(unified.winner.volume).toBe(old.winner.volume)
        expect(unified.roundIndex).toBe(old.cycleIndex)
        expect(unified.winner.sourceCueId).toBe(old.winner.cueId === 'main' ? program.steps[0].id : old.winner.cueId)
        now = old.at
      }
    }
  })
})
