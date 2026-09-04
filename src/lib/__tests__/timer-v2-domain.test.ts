import { describe, expect, it } from 'vitest'
import type { PatternProgram, SequenceProgram } from '../../types'
import { chooseProgramMode, deleteProgramPreset, loadProgramPreset, patchSequenceStep, saveProgramPreset, setPatternSubBellsEnabled, updatePatternMainMinutes } from '../programActions'
import { alarmBehaviorAfterGesture, gateProgramAudio, isFreshScheduledEvent, iterationMuteFor, muteAfterScheduleChange, shouldSurfaceTimerSignal } from '../runtimeV2'
import { defaultTimerV2State, migrateLegacyConfig, normalizeAvailabilityPolicy, normalizePatternProgram, normalizeSequenceProgram, normalizeSoundRef, parseTimerProgram, validOffsets } from '../timerV2'
import { nextPatternEvent, nextProgramEvent, nextSequenceEvent, runEndAt, timelinePosition } from '../timeline'
import { hasAvailableTime, isWithinActiveHours, nextActiveHoursStart, windowsOverlap } from '../activeHours'
import timelineFixtures from '../../../fixtures/timer-v2-timeline.json'

const minute = 60_000

function pattern(): PatternProgram {
  return {
    schemaVersion: 2,
    mode: 'pattern',
    label: 'Focus cycle',
    mainMinutes: 30,
    mainCue: { sound: { kind: 'builtin', id: 'temple-gong' }, volume: 0.8 },
    subBellsEnabled: true,
    tracks: [
      { id: 'top', label: 'Breathe', enabled: true, cadenceMinutes: 5, selectedOffsetsMinutes: [10], sound: { kind: 'builtin', id: 'soft-bowl' }, volume: 0.6 },
      { id: 'bottom', label: 'Posture', enabled: true, cadenceMinutes: 2, selectedOffsetsMinutes: [10], sound: { kind: 'builtin', id: 'clear-bell' }, volume: 0.7 },
    ],
    alignment: { kind: 'elapsed' },
    runPolicy: { kind: 'continuous', cycleCount: 1, durationSeconds: 30 * 60 },
  }
}

function sequence(): SequenceProgram {
  return {
    schemaVersion: 2,
    mode: 'sequence',
    steps: [
      { id: 'work', label: 'Work', durationMinutes: 5, sound: { kind: 'builtin', id: 'clear-bell' }, volume: 0.8 },
      { id: 'rest', label: 'Rest', durationMinutes: 2, sound: { kind: 'builtin', id: 'soft-bowl' }, volume: 0.6 },
    ],
    runPolicy: { kind: 'continuous', cycleCount: 1, durationSeconds: 30 * 60 },
  }
}

describe('timer v2 timeline contracts', () => {
  it('matches the shared native Pattern collision fixture', () => {
    const fixture = timelineFixtures.patternCollision
    const event = nextPatternEvent(fixture.program as PatternProgram, fixture.anchor, fixture.now)
    expect({ at: event.at, logicalId: event.logicalId, winnerCueId: event.winner.cueId, boundary: event.boundary, collision: event.collision }).toEqual(fixture.expected)
  })

  it('matches every shared native Sequence boundary fixture', () => {
    const fixture = timelineFixtures.sequence
    for (const query of fixture.queries) {
      const event = nextSequenceEvent(fixture.program as SequenceProgram, fixture.anchor, query.now)
      expect(event.at).toBeGreaterThan(query.now)
      expect({ at: event.at, logicalId: event.logicalId, winnerCueId: event.winner.cueId, boundary: event.boundary }).toEqual({ at: query.at, logicalId: query.logicalId, winnerCueId: query.winnerCueId, boundary: query.boundary })
    }
  })

  it('lets the longer repeat interval win an overlap', () => {
    const event = nextPatternEvent(pattern(), 0, 9 * minute)
    expect(event.collision).toBe(true)
    expect(event.candidates.map(candidate => candidate.cueId)).toEqual(['top', 'bottom'])
    expect(event.winner.cueId).toBe('top')
    expect(event.boundary).toBe('pattern-offset')
  })

  it('normalizes sub-bells into automatic longer-cadence priority order', () => {
    const reversed = pattern()
    reversed.tracks.reverse()
    expect(normalizePatternProgram(reversed).tracks.map(track => track.id)).toEqual(['top', 'bottom'])
  })

  it('uses stable source order when colliding tracks have equal cadence', () => {
    const equal = pattern()
    equal.tracks[0].cadenceMinutes = 2
    expect(nextPatternEvent(equal, 0, 9 * minute).winner.cueId).toBe('top')
  })

  it('ignores disabled tracks and keeps main boundaries independent', () => {
    const program = pattern()
    program.tracks[0].enabled = false
    program.tracks[1].enabled = false
    const event = nextPatternEvent(program, 0, 0)
    expect(event.at).toBe(30 * minute)
    expect(event.boundary).toBe('pattern-main')
    expect(event.collision).toBe(false)
    expect(event.candidates.map(candidate => candidate.cueId)).toEqual(['main'])
  })

  it('keeps configured tracks quiet when the sub-bell layer is off', () => {
    const program = pattern()
    program.subBellsEnabled = false
    const event = nextPatternEvent(program, 0, 0)
    expect(event.at).toBe(30 * minute)
    expect(event.candidates.map(candidate => candidate.cueId)).toEqual(['main'])
  })

  it('toggles the sub-bell layer without destroying its track settings', () => {
    const initial = defaultTimerV2State()
    expect(initial.workingPrograms.pattern.subBellsEnabled).toBe(false)
    const enabled = setPatternSubBellsEnabled(initial, true)
    const disabled = setPatternSubBellsEnabled(enabled, false)
    expect(enabled.workingPrograms.pattern.tracks).toEqual(initial.workingPrograms.pattern.tracks)
    expect(disabled.workingPrograms.pattern.tracks).toEqual(initial.workingPrograms.pattern.tracks)
    expect(disabled.workingPrograms.pattern.subBellsEnabled).toBe(false)
  })

  it('always returns an event strictly after an exact boundary', () => {
    const program = pattern()
    expect(nextPatternEvent(program, 0, 10 * minute).at).toBe(30 * minute)
    expect(nextPatternEvent(program, 0, 30 * minute).at).toBe(40 * minute)
    expect(nextSequenceEvent(sequence(), 0, 5 * minute).at).toBe(7 * minute)
  })

  it('derives restored Sequence step and progress from the immutable anchor', () => {
    const position = timelinePosition(sequence(), 1_000, 1_000 + 6 * minute)
    expect(position.currentStepIndex).toBe(1)
    expect(position.stepProgress).toBeCloseTo(0.5)
    expect(position.cycleIndex).toBe(0)
    expect(position.nextEvent?.at).toBe(1_000 + 7 * minute)
  })

  it('distinguishes a Sequence cycle boundary from a Pattern main boundary', () => {
    const first = nextSequenceEvent(sequence(), 0, 0)
    const final = nextSequenceEvent(sequence(), 0, first.at)
    expect(first.boundary).toBe('sequence-step')
    expect(final.boundary).toBe('sequence-cycle')
  })
})

describe('timer v2 audio gate', () => {
  it('surfaces only fresh events while the app is active', () => {
    expect(isFreshScheduledEvent(10_000, 14_999)).toBe(true)
    expect(isFreshScheduledEvent(10_000, 15_001)).toBe(false)
    expect(shouldSurfaceTimerSignal({ suppressed: false, firedAt: 10_000 }, 14_999, true)).toBe(true)
    expect(shouldSurfaceTimerSignal({ suppressed: false, firedAt: 10_000 }, 15_001, true)).toBe(false)
    expect(shouldSurfaceTimerSignal({ suppressed: false, firedAt: 10_000 }, 10_100, false)).toBe(false)
    expect(shouldSurfaceTimerSignal({ suppressed: true, firedAt: 10_000 }, 10_100, true)).toBe(false)
    expect(shouldSurfaceTimerSignal({ suppressed: false }, 10_100, true)).toBe(false)
  })

  it('implements the full exclusive single/double alarm gesture table', () => {
    expect(alarmBehaviorAfterGesture('off', 'single')).toBe('once')
    expect(alarmBehaviorAfterGesture('off', 'double')).toBe('locked')
    expect(alarmBehaviorAfterGesture('once', 'single')).toBe('off')
    expect(alarmBehaviorAfterGesture('once', 'double')).toBe('locked')
    expect(alarmBehaviorAfterGesture('locked', 'single')).toBe('off')
    expect(alarmBehaviorAfterGesture('locked', 'double')).toBe('off')
  })

  it('clears only cycle mute when a schedule identity changes', () => {
    expect(muteAfterScheduleChange({ mutedUntil: 123, iteration: { endsAtLogicalId: 'old', endsAt: 456, iterations: 2 } })).toEqual({ mutedUntil: 123 })
    expect(muteAfterScheduleChange({ mutedUntil: 123 })).toEqual({ mutedUntil: 123 })
  })

  it('rings and then consumes Alarm Once at a Pattern main boundary', () => {
    const event = nextPatternEvent(pattern(), 0, 29 * minute)
    const result = gateProgramAudio({ event, now: event.at, masterVolume: 1, mute: { mutedUntil: 0 }, alarmBehavior: 'once', callActive: false })
    expect(result.disposition).toBe('continuous-alarm')
    expect(result.consumeAlarmOnce).toBe(true)
    expect(result.nextAlarmBehavior).toBe('off')
  })

  it('never starts a continuous alarm for a Sequence cycle', () => {
    const event = nextSequenceEvent(sequence(), 0, 5 * minute)
    const result = gateProgramAudio({ event, now: event.at, masterVolume: 1, mute: { mutedUntil: 0 }, alarmBehavior: 'locked', callActive: false })
    expect(event.boundary).toBe('sequence-cycle')
    expect(result.disposition).toBe('one-shot')
    expect(result.nextAlarmBehavior).toBe('locked')
  })

  it('keeps bounded Pattern completion one-shot even when Alarm is locked', () => {
    const event = { ...nextPatternEvent(pattern(), 0, 29 * minute), completesRun: true }
    const result = gateProgramAudio({ event, now: event.at, masterVolume: 1, mute: { mutedUntil: 0 }, alarmBehavior: 'locked', callActive: false })
    expect(result.disposition).toBe('one-shot')
    expect(result.nextAlarmBehavior).toBe('off')
  })

  it('suppresses an ordinary cue during a call without consuming runtime state', () => {
    const event = nextSequenceEvent(sequence(), 0, 0)
    const mute = { mutedUntil: event.at + minute }
    const result = gateProgramAudio({ event, now: event.at, masterVolume: 1, mute, alarmBehavior: 'once', callActive: true })
    expect(result.disposition).toBe('suppressed')
    expect(result.reason).toBe('call-active')
    expect(result.nextMute).toEqual(mute)
    expect(result.nextAlarmBehavior).toBe('once')
  })

  it('leaves a user-armed Pattern alarm to Android alarm and call policy', () => {
    const event = nextPatternEvent(pattern(), 0, 29 * minute)
    const result = gateProgramAudio({ event, now: event.at, masterVolume: 1, mute: { mutedUntil: 0 }, alarmBehavior: 'once', callActive: true })
    expect(result.disposition).toBe('continuous-alarm')
    expect(result.reason).toBe('none')
    expect(result.consumeAlarmOnce).toBe(true)
    expect(result.nextAlarmBehavior).toBe('off')
  })

  it('clears iteration mute and plays its ending boundary', () => {
    const program = pattern()
    const mute = iterationMuteFor(program, 0, minute, 1)
    const event = nextPatternEvent(program, 0, 29 * minute)
    const result = gateProgramAudio({ event, now: event.at, masterVolume: 1, mute: { mutedUntil: 0, iteration: mute }, alarmBehavior: 'off', callActive: false })
    expect(event.logicalId).toBe(mute.endsAtLogicalId)
    expect(result.disposition).toBe('one-shot')
    expect(result.nextMute).toEqual({ mutedUntil: 0 })
  })

  it('keeps every interior cue muted across three Pattern iterations', () => {
    const program = pattern()
    const mute = iterationMuteFor(program, 0, minute, 3)
    expect(mute).toEqual({ endsAtLogicalId: 'pattern:0:2:main', endsAt: 90 * minute, iterations: 3 })
    const interior = nextPatternEvent(program, 0, 69 * minute)
    const interiorResult = gateProgramAudio({ event: interior, now: interior.at, masterVolume: 1, mute: { mutedUntil: 0, iteration: mute }, alarmBehavior: 'off', callActive: false })
    expect(interiorResult.reason).toBe('iteration-mute')
    const ending = nextPatternEvent(program, 0, 89 * minute)
    const endingResult = gateProgramAudio({ event: ending, now: ending.at, masterVolume: 1, mute: interiorResult.nextMute, alarmBehavior: 'off', callActive: false })
    expect(ending.logicalId).toBe(mute.endsAtLogicalId)
    expect(endingResult.shouldPlay).toBe(true)
    expect(endingResult.nextMute).toEqual({ mutedUntil: 0 })
  })

  it('uses a Sequence cycle boundary as the audible end of cycle mute', () => {
    const program = sequence()
    const mute = iterationMuteFor(program, 0, minute, 1)
    const ending = nextSequenceEvent(program, 0, 5 * minute)
    const result = gateProgramAudio({ event: ending, now: ending.at, masterVolume: 1, mute: { mutedUntil: 0, iteration: mute }, alarmBehavior: 'off', callActive: false })
    expect(ending.logicalId).toBe(mute.endsAtLogicalId)
    expect(result.shouldPlay).toBe(true)
    expect(result.nextMute).toEqual({ mutedUntil: 0 })
  })

  it('plays an event exactly at minute-mute expiry without losing volume settings', () => {
    const event = nextPatternEvent(pattern(), 0, 9 * minute)
    const result = gateProgramAudio({ event, now: event.at, masterVolume: 0.25, mute: { mutedUntil: event.at }, alarmBehavior: 'off', callActive: false })
    expect(result.shouldPlay).toBe(true)
    expect(result.nextMute).toEqual({ mutedUntil: 0 })
  })

  it('does not consume Alarm Once while master volume is zero', () => {
    const event = nextPatternEvent(pattern(), 0, 29 * minute)
    const result = gateProgramAudio({ event, now: event.at, masterVolume: 0, mute: { mutedUntil: 0 }, alarmBehavior: 'once', callActive: false })
    expect(result.reason).toBe('master-muted')
    expect(result.nextAlarmBehavior).toBe('once')
    expect(result.consumeAlarmOnce).toBe(false)
  })
})

describe('active hours civil-time semantics', () => {
  const base = { activeHoursEnabled: true, activeHoursStart: 8 * 60, activeHoursEnd: 17 * 60, activeHoursDays: 0b1111111 }
  const local = (year: number, month: number, day: number, hour: number, minutes = 0) => new Date(year, month, day, hour, minutes, 0, 0).getTime()

  it('treats the end minute as exclusive', () => {
    expect(isWithinActiveHours(base, local(2026, 8, 4, 16, 59))).toBe(true)
    expect(isWithinActiveHours(base, local(2026, 8, 4, 17))).toBe(false)
  })

  it('attributes the after-midnight half of a cross-midnight window to its start day', () => {
    const fridayOnly = { ...base, activeHoursStart: 22 * 60, activeHoursEnd: 2 * 60, activeHoursDays: 1 << 5 }
    expect(isWithinActiveHours(fridayOnly, local(2026, 8, 4, 23))).toBe(true)
    expect(isWithinActiveHours(fridayOnly, local(2026, 8, 5, 1))).toBe(true)
    expect(isWithinActiveHours(fridayOnly, local(2026, 8, 5, 3))).toBe(false)
  })

  it('never silently converts an empty day selection to every day', () => {
    const noDays = { ...base, activeHoursDays: 0 }
    expect(isWithinActiveHours(noDays, local(2026, 8, 4, 10))).toBe(false)
  })

  it('finds the next selected local-day start strictly in the future', () => {
    const sundayOnly = { ...base, activeHoursDays: 1 }
    const fromFriday = local(2026, 8, 4, 18)
    expect(new Date(nextActiveHoursStart(sundayOnly, fromFriday)).getDay()).toBe(0)
    expect(new Date(nextActiveHoursStart(sundayOnly, fromFriday)).getHours()).toBe(8)
  })

  it('treats equal endpoints as a full selected civil day beginning at midnight', () => {
    const sundayAllDay = { ...base, activeHoursStart: 8 * 60, activeHoursEnd: 8 * 60, activeHoursDays: 1 }
    const sundayMorning = local(2026, 8, 6, 3)
    const mondayMorning = local(2026, 8, 7, 3)
    expect(isWithinActiveHours(sundayAllDay, sundayMorning)).toBe(true)
    expect(isWithinActiveHours(sundayAllDay, mondayMorning)).toBe(false)
    const next = new Date(nextActiveHoursStart(sundayAllDay, mondayMorning))
    expect(next.getDay()).toBe(0)
    expect(next.getHours()).toBe(0)
    expect(next.getMinutes()).toBe(0)
  })
})

describe('bounded runs and availability policies', () => {
  const local = (year: number, month: number, day: number, hour: number, minutes = 0) => new Date(year, month, day, hour, minutes, 0, 0).getTime()
  const window = (id: string, startMinutes: number, endMinutes: number, days = 0b1111111) => ({ id, enabled: true, startMinutes, endMinutes, days })

  it('ends a cycle-bounded Pattern on exactly the requested future main boundary', () => {
    const program = { ...pattern(), runPolicy: { kind: 'cycles', cycleCount: 2, durationSeconds: 30 * 60 } as const }
    const anchor = 0
    const startedAt = 12 * minute
    expect(runEndAt(program, anchor, startedAt)).toBe(60 * minute)
    const first = nextProgramEvent(program, anchor, 29 * minute, startedAt)
    expect(first).toMatchObject({ at: 30 * minute, completesRun: false })
    const final = nextProgramEvent(program, anchor, 59 * minute, startedAt)
    expect(final).toMatchObject({ at: 60 * minute, boundary: 'pattern-main', completesRun: true })
    expect(nextProgramEvent(program, anchor, 60 * minute, startedAt)).toBeNull()
  })

  it('creates one terminal cue when an elapsed duration ends between normal cues', () => {
    const program = { ...sequence(), runPolicy: { kind: 'duration', cycleCount: 1, durationSeconds: 90 } as const }
    const event = nextProgramEvent(program, 1_000, 1_000, 1_000)
    expect(event).toMatchObject({ at: 91_000, boundary: 'run-complete', completesRun: true, winner: { kind: 'run-complete', sound: program.steps.at(-1)!.sound } })
  })

  it('deduplicates a duration deadline that lands on a normal cue', () => {
    const program = { ...pattern(), runPolicy: { kind: 'duration', cycleCount: 1, durationSeconds: 30 * 60 } as const }
    const event = nextProgramEvent(program, 0, 29 * minute, 0)
    expect(event).toMatchObject({ at: 30 * minute, boundary: 'pattern-main', completesRun: true })
    expect(event?.candidates).toHaveLength(1)
  })

  it('keeps the promised terminal instant when a snapped phase realigns', () => {
    const program = { ...pattern(), runPolicy: { kind: 'cycles', cycleCount: 2, durationSeconds: 30 * 60 } as const }
    const startedAt = 12 * minute
    const fixedEnd = runEndAt(program, 0, startedAt)!
    const event = nextProgramEvent(program, 7 * minute, fixedEnd - 1, startedAt, fixedEnd)
    expect(event).toMatchObject({ at: fixedEnd, boundary: 'run-complete', completesRun: true })
  })

  it('treats multiple weekly windows as a union and finds the next one', () => {
    const policy = { enabled: true, weeklyWindows: [window('morning', 8 * 60, 10 * 60), window('evening', 17 * 60, 20 * 60)], overrides: [] }
    expect(isWithinActiveHours(policy, local(2026, 8, 4, 9))).toBe(true)
    expect(isWithinActiveHours(policy, local(2026, 8, 4, 12))).toBe(false)
    const next = new Date(nextActiveHoursStart(policy, local(2026, 8, 4, 12)))
    expect([next.getHours(), next.getMinutes()]).toEqual([17, 0])
  })

  it('lets mute overrides win and active overrides open a closed weekly base', () => {
    const atNoon = local(2026, 8, 4, 12)
    const base = { enabled: true, weeklyWindows: [window('morning', 8 * 60, 10 * 60)], overrides: [] }
    const active = { id: 'calendar-active', source: 'calendar', behavior: 'active', startAt: atNoon, endAt: atNoon + 60 * minute } as const
    const mute = { id: 'calendar-mute', source: 'calendar', behavior: 'mute', startAt: atNoon, endAt: atNoon + 30 * minute } as const
    expect(isWithinActiveHours({ ...base, overrides: [active] }, atNoon)).toBe(true)
    expect(isWithinActiveHours({ ...base, overrides: [active, mute] }, atNoon)).toBe(false)
    expect(isWithinActiveHours({ ...base, overrides: [active, mute] }, atNoon + 30 * minute)).toBe(true)
  })

  it('detects cross-window overlap and rejects an empty enabled schedule', () => {
    expect(windowsOverlap(window('late', 22 * 60, 2 * 60, 1 << 5), window('early', 1 * 60, 3 * 60, 1 << 6))).toBe(true)
    expect(hasAvailableTime({ enabled: true, weeklyWindows: [], overrides: [] })).toBe(false)
  })

  it('normalizes bounds, duplicate window ids, expired overrides, and maximum payload sizes', () => {
    const now = 10_000
    const policy = normalizeAvailabilityPolicy({
      enabled: true,
      weeklyWindows: [window('same', -1, 2_000), window('same', 60, 120)],
      overrides: [{ id: 'old', source: 'calendar', behavior: 'mute', startAt: 0, endAt: 5_000 }],
    }, now)
    expect(policy.weeklyWindows[0]).toMatchObject({ startMinutes: 0, endMinutes: 1_439 })
    expect(new Set(policy.weeklyWindows.map(value => value.id)).size).toBe(2)
    expect(policy.overrides).toEqual([])
  })
})

describe('timer v2 validation and presets', () => {
  it('repairs duplicate persisted cue identifiers deterministically', () => {
    const duplicateTracks = pattern()
    duplicateTracks.tracks[1] = { ...duplicateTracks.tracks[1], id: duplicateTracks.tracks[0].id }
    const normalizedPattern = normalizePatternProgram(duplicateTracks)
    expect(new Set(normalizedPattern.tracks.map(track => track.id)).size).toBe(normalizedPattern.tracks.length)

    const duplicateSteps = sequence()
    duplicateSteps.steps[1] = { ...duplicateSteps.steps[1], id: duplicateSteps.steps[0].id }
    const normalizedSequence = normalizeSequenceProgram(duplicateSteps)
    expect(new Set(normalizedSequence.steps.map(step => step.id)).size).toBe(normalizedSequence.steps.length)
  })

  it('rejects malformed and unknown sound references', () => {
    const fallback = { kind: 'builtin', id: 'clear-bell' } as const
    expect(normalizeSoundRef({ kind: 'builtin', id: 'not-real' }, fallback)).toEqual(fallback)
    expect(normalizeSoundRef({ kind: 'document', uri: '', title: 'Missing' }, fallback)).toEqual(fallback)
    expect(normalizeSoundRef({ kind: 'android', uri: 'content://tone', title: 'Tone', ringtoneType: 'future' }, fallback)).toEqual({
      kind: 'android', uri: 'content://tone', title: 'Tone', ringtoneType: 'unknown',
    })
  })

  it('rejects unsupported program schema versions without throwing', () => {
    expect(parseTimerProgram('{"schemaVersion":99,"mode":"pattern"}')).toBeNull()
    expect(parseTimerProgram('{not json')).toBeNull()
    expect(parseTimerProgram(JSON.stringify(pattern()))).toEqual(pattern())
  })

  it('adds names to older Pattern records', () => {
    const old = pattern() as Partial<PatternProgram>
    delete old.label
    delete old.subBellsEnabled
    delete (old.tracks![0] as Partial<PatternProgram['tracks'][number]>).label
    const normalized = normalizePatternProgram(old)
    expect(normalized.label).toBe('Main interval')
    expect(normalized.subBellsEnabled).toBe(true)
    expect(normalized.tracks[0].label).toBe('Sub-bell 1')
  })

  it('renumbers untouched default sub-bell labels after automatic sorting', () => {
    const base = defaultTimerV2State().workingPrograms.pattern.tracks[0]
    const normalized = normalizePatternProgram({
      ...pattern(),
      tracks: [
        { ...base, id: 'short', label: 'Sub-bell 1', cadenceMinutes: 2 },
        { ...base, id: 'long', label: 'Sub-bell 2', cadenceMinutes: 5 },
      ],
    })
    expect(normalized.tracks.map(track => [track.id, track.label])).toEqual([['long', 'Sub-bell 1'], ['short', 'Sub-bell 2']])
  })

  it('marks a loaded preset deleted without mutating the working copy', () => {
    const initial = defaultTimerV2State()
    const preset = { id: 'preset', name: 'Morning', createdAt: 123, program: pattern() }
    const loaded = loadProgramPreset({ ...initial, presets: [preset] }, preset.id)
    const workingBefore = loaded.workingPrograms.pattern
    const deleted = deleteProgramPreset(loaded, preset.id)
    expect(deleted.presets).toEqual([])
    expect(deleted.workingPrograms.pattern).toEqual(workingBefore)
    expect(deleted.workingPrograms.sourcePreset).toEqual({ id: 'preset', name: 'Morning', createdAt: 123, deleted: true })
  })

  it('clears stale preset provenance when switching modes', () => {
    const initial = defaultTimerV2State()
    const withSource = { ...initial, workingPrograms: { ...initial.workingPrograms, sourcePreset: { id: 'p', name: 'P', createdAt: 1 } } }
    expect(chooseProgramMode(withSource, 'sequence').workingPrograms.sourcePreset).toBeUndefined()
  })

  it('records Save As provenance while keeping later edits in the working copy', () => {
    const initial = chooseProgramMode(defaultTimerV2State(), 'sequence')
    const saved = saveProgramPreset(initial, 'Deep work', 456)
    expect(saved.presets).toHaveLength(1)
    expect(saved.workingPrograms.sourcePreset).toMatchObject({ name: 'Deep work', createdAt: 456 })
    const presetSnapshot = saved.presets[0].program
    const edited = patchSequenceStep(saved, saved.workingPrograms.sequence.steps[0].id, { label: 'Changed working copy' })
    expect(edited.workingPrograms.sourcePreset?.id).toBe(saved.presets[0].id)
    expect(edited.presets[0].program).toEqual(presetSnapshot)
    expect(edited.workingPrograms.sequence.steps[0].label).toBe('Changed working copy')
  })

  it('loads a deep working copy and permits duplicate names without ID reuse', () => {
    const preset = { id: 'source', name: 'Morning', createdAt: 123, program: pattern() }
    const initial = { ...defaultTimerV2State(), presets: [preset] }
    const loaded = loadProgramPreset(initial, preset.id)
    loaded.workingPrograms.pattern.tracks[0].selectedOffsetsMinutes.push(20)
    expect((initial.presets[0].program as PatternProgram).tracks[0].selectedOffsetsMinutes).toEqual([10])

    const once = saveProgramPreset(initial, 'Morning', 456)
    const twice = saveProgramPreset(once, 'Morning', 456)
    expect(twice.presets.filter(value => value.name === 'Morning')).toHaveLength(3)
    expect(new Set(twice.presets.map(value => value.id)).size).toBe(3)
  })

  it('retains track cadence while shortening a Pattern and drops only invalid offsets', () => {
    const initial = defaultTimerV2State()
    const track = initial.workingPrograms.pattern.tracks[0]
    const configured = {
      ...initial,
      workingPrograms: {
        ...initial.workingPrograms,
        pattern: { ...initial.workingPrograms.pattern, tracks: [{ ...track, cadenceMinutes: 15, selectedOffsetsMinutes: [15] }] },
      },
    }
    const shortened = updatePatternMainMinutes(configured, 10)
    expect(shortened.workingPrograms.pattern.tracks[0].cadenceMinutes).toBe(15)
    expect(shortened.workingPrograms.pattern.tracks[0].selectedOffsetsMinutes).toEqual([])
  })

  it('allows a cadence longer than the main interval as an empty selectable lattice', () => {
    expect(validOffsets(10, 15)).toEqual([])
    const normalized = normalizePatternProgram({ ...pattern(), mainMinutes: 10, tracks: [{ ...pattern().tracks[0], cadenceMinutes: 15, selectedOffsetsMinutes: [] }] })
    expect(normalized.tracks[0].cadenceMinutes).toBe(15)
    expect(normalized.tracks[0].selectedOffsetsMinutes).toEqual([])
  })

  it('migrates legacy timing, disabled sub-bells, settings, and snap without deletion semantics', () => {
    const migrated = migrateLegacyConfig({ mainInterval: 45, subInterval: 9, subEnabled: false, snapEnabled: true, snapOffset: 17, volume: 0.35, activeHoursEnabled: true, activeHoursDays: 0b0101010, focusModeEnabled: true })
    expect(migrated.workingPrograms.pattern).toMatchObject({ mainMinutes: 45, alignment: { kind: 'local-clock', offsetMinutes: 17 } })
    expect(migrated.workingPrograms.pattern.tracks[0]).toMatchObject({ enabled: false, cadenceMinutes: 9, selectedOffsetsMinutes: [9, 18, 27, 36] })
    expect(migrated.settings).toMatchObject({ masterVolume: 0.35, availability: { enabled: true, weeklyWindows: [{ days: 0b0101010 }] }, focusAutomationEnabled: true })
  })

  it('repairs corrupt duration, volume, labels, offsets, and overlong arrays', () => {
    const malformed = normalizePatternProgram({
      ...pattern(), mainMinutes: Number.POSITIVE_INFINITY,
      mainCue: { ...pattern().mainCue, volume: -4 },
      tracks: Array.from({ length: 9 }, (_, index) => ({ ...pattern().tracks[0], id: `id-${index}`, cadenceMinutes: 3, selectedOffsetsMinutes: [-1, 3, 3, 31, 4], volume: 9 })),
    })
    expect(malformed.mainMinutes).toBe(30)
    expect(malformed.mainCue.volume).toBe(0)
    expect(normalizePatternProgram({ ...pattern(), runPolicy: { kind: 'cycles', cycleCount: 50_000, durationSeconds: 0 } }).runPolicy).toEqual({ kind: 'cycles', cycleCount: 999, durationSeconds: 1 })
    expect(malformed.tracks).toHaveLength(5)
    expect(malformed.tracks[0].selectedOffsetsMinutes).toEqual([3])
    expect(malformed.tracks[0].volume).toBe(1)

    const malformedSequence = normalizeSequenceProgram({ ...sequence(), steps: [{ ...sequence().steps[0], label: '   ', durationMinutes: -2, volume: Number.NaN }] })
    expect(malformedSequence.steps[0]).toMatchObject({ label: 'Step 1', durationMinutes: 1, volume: 1 })
  })
})
