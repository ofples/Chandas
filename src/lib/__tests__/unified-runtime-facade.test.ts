import { describe, expect, it } from 'vitest'
import fixture from '../../../fixtures/timer-unified-timeline.json'
import type { UnifiedTimerProgram } from '../../types'
import { currentStepEndAt, hasFollowingStep, nextProgramEvent, programCycleDurationMs, runEndAt, sequenceSkipTarget, timelinePosition } from '../timeline'
import { alarmBehaviorForReanchor, emptyRuntimeMute, gateProgramAudio, iterationMuteFor, programEventIsVisible } from '../runtimeV2'
import { programForVisibleCues } from '../timerV2'
import { programEventLabel, upcomingProgramEvents } from '../upcoming-events'

const source = fixture.program as UnifiedTimerProgram
const query = (now: number, program = source) => nextProgramEvent(program, 1000, now)!

describe('unified programs through existing JS runtime contracts', () => {
  it('keeps current alarm controls on alignment restarts and uses a saved mode when switching timers', () => {
    const program = { ...structuredClone(source), steps: [structuredClone(source.steps[0])], alarmBehavior: 'once' as const }
    expect(alarmBehaviorForReanchor(program, 'off')).toBe('off')
    expect(alarmBehaviorForReanchor(program, 'off', program.alarmBehavior)).toBe('once')
    expect(alarmBehaviorForReanchor({ ...program, steps: [...program.steps, structuredClone(program.steps[0])] }, 'locked', 'once')).toBe('off')
  })

  it('uses step boundaries rather than interior bells to describe bounded transport', () => {
    const program = structuredClone(source)
    program.runPolicy = { ...program.runPolicy, kind: 'cycles', cycleCount: 1 }
    const position = timelinePosition(program, 1000, 62000, 1000)
    expect(position.nextEvent?.boundary).toBe('pattern-offset')
    expect(position.nextEvent?.completesRun).toBe(false)
    expect(currentStepEndAt(program, position)).toBe(101000)
    expect(hasFollowingStep(program, position, 101000)).toBe(false)
    expect(hasFollowingStep(program, position, 99000)).toBe(false)
    expect(hasFollowingStep(program, position, 201000)).toBe(true)
    expect(hasFollowingStep(program, position, 0)).toBe(true)
    const first = timelinePosition(program, 1000, 1000, 1000)
    expect(hasFollowingStep(program, first, 101000)).toBe(true)
    expect(hasFollowingStep(program, first, 30000)).toBe(false)
  })

  it('preserves candidate identity, hidden collisions and audio/display separation', () => {
    const audible = query(1000)
    expect(audible).toMatchObject({ at: 11000, boundary: 'pattern-offset', stepId: 'work', collision: true, showOnWatchFace: true, winner: { kind: 'pattern-track', sourceCueId: 'slow-hidden', showOnWatchFace: false } })
    expect(audible.candidates).toHaveLength(2)
    expect(programEventIsVisible(source, audible)).toBe(true)
    expect(programEventLabel(source, audible)).toBe('Slow')
    expect(query(51000)).toMatchObject({ at: 56000, showOnWatchFace: false })
    expect(programEventIsVisible(source, query(51000))).toBe(false)
    const visible = nextProgramEvent(programForVisibleCues(source), 1000, 51000)!
    expect(visible.at).toBe(61000)
    expect(programEventLabel(source, visible)).toBe('Work')
  })

  it('uses the same step alarm gate while keeping one-step Once and Locked controls', () => {
    const gate = (program: UnifiedTimerProgram, now: number, alarmBehavior: 'off' | 'once' | 'locked') => gateProgramAudio({ event: query(now, program), now: query(now, program).at, masterVolume: 1, mute: emptyRuntimeMute(), alarmBehavior, callActive: false })
    expect(gate(source, 91000, 'off').disposition).toBe('continuous-alarm')
    expect(gate(source, 56000, 'once')).toMatchObject({ disposition: 'one-shot', nextAlarmBehavior: 'once', consumeAlarmOnce: false })
    const single = { ...structuredClone(source), steps: [structuredClone(source.steps[0])] }
    expect(gate(single, 56000, 'once')).toMatchObject({ disposition: 'continuous-alarm', nextAlarmBehavior: 'off', consumeAlarmOnce: true })
    expect(gate(single, 56000, 'locked')).toMatchObject({ disposition: 'continuous-alarm', nextAlarmBehavior: 'locked' })
    single.steps[0].endAlarmEnabled = true
    expect(gate(single, 56000, 'off').disposition).toBe('continuous-alarm')
  })

  it('iteration mute suppresses interior bells and leaves its exact closing boundary audible', () => {
    const iteration = iterationMuteFor(source, 1000, 1000, 2)
    expect(iteration.endsAt).toBe(201000)
    const mute = { mutedUntil: 0, iteration }
    const interior = query(1000)
    expect(gateProgramAudio({ event: interior, now: interior.at, masterVolume: 1, mute, alarmBehavior: 'off', callActive: false }).shouldPlay).toBe(false)
    const ending = query(iteration.endsAt - 1)
    expect(ending.logicalId).toBe(iteration.endsAtLogicalId)
    expect(gateProgramAudio({ event: ending, now: ending.at, masterVolume: 1, mute, alarmBehavior: 'off', callActive: false })).toMatchObject({ shouldPlay: true, nextMute: { mutedUntil: 0 } })
  })

  it('retains call gates without consuming armed alarms or mute', () => {
    const event = query(1000)
    const mute = { mutedUntil: 30000 }
    expect(gateProgramAudio({ event, now: event.at, masterVolume: 1, mute, alarmBehavior: 'once', callActive: true })).toMatchObject({ shouldPlay: false, reason: 'call-active', nextAlarmBehavior: 'once', nextMute: mute, consumeAlarmOnce: false })
  })

  it('terminal completion clears alarms and replaces the natural step boundary', () => {
    const program = structuredClone(source)
    program.runPolicy.kind = 'cycles'
    program.completionCue = { sound: { kind: 'builtin', id: 'page' }, volume: 0.4 }
    const event = query(91000, program)
    expect(event).toMatchObject({ at: 101000, completesRun: true, winner: { kind: 'run-complete', sound: { id: 'page' } } })
    expect(gateProgramAudio({ event, now: event.at, masterVolume: 1, mute: emptyRuntimeMute(), alarmBehavior: 'locked', callActive: false })).toMatchObject({ disposition: 'one-shot', nextAlarmBehavior: 'off' })
  })

  it('exposes round position, duration and bounded transport through the runtime API', () => {
    const program = structuredClone(source)
    program.runPolicy.kind = 'cycles'
    program.runPolicy.cycleCount = 2
    expect(programCycleDurationMs(program)).toBe(100000)
    expect(runEndAt(program, 1000, 46000)).toBe(201000)
    expect(timelinePosition(program, 1000, 71000)).toMatchObject({ mode: 'sequence', currentStepIndex: 1, stepProgress: 0.25 })
    expect(sequenceSkipTarget(program, 1000, 161000, 1000, 201000, 'next')!.completesRun).toBe(true)
  })

  it('projects actual sub-bells and step cues for setup preview', () => {
    const events = upcomingProgramEvents(source, { enabled: false, weeklyWindows: [], overrides: [] }, 1000, 51000, 1000, null, 3)
    expect(events.map(value => value.event.at)).toEqual([56000, 61000, 66000])
    expect(events.map(value => programEventLabel(source, value.event))).toEqual(['Slow', 'Work', 'Independent sources'])
  })
})
