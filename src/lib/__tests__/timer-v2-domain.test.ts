import { describe, expect, it } from 'vitest'
import type { PatternProgram, SequenceProgram } from '../../types'
import { chooseProgramMode, deleteProgramPreset, loadProgramPreset, patchSequenceStep, saveProgramPreset, updatePatternMainMinutes } from '../programActions'
import { alarmBehaviorAfterGesture, gateProgramAudio, iterationMuteFor, muteAfterScheduleChange } from '../runtimeV2'
import { defaultTimerV2State, normalizePatternProgram, normalizeSequenceProgram, normalizeSoundRef, parseTimerProgram } from '../timerV2'
import { nextPatternEvent, nextSequenceEvent } from '../timeline'
import timelineFixtures from '../../../fixtures/timer-v2-timeline.json'

const minute = 60_000

function pattern(): PatternProgram {
  return {
    schemaVersion: 2,
    mode: 'pattern',
    mainMinutes: 30,
    mainCue: { sound: { kind: 'builtin', id: 'temple-gong' }, volume: 0.8 },
    tracks: [
      { id: 'top', enabled: true, cadenceMinutes: 5, selectedOffsetsMinutes: [10], sound: { kind: 'builtin', id: 'soft-bowl' }, volume: 0.6 },
      { id: 'bottom', enabled: true, cadenceMinutes: 2, selectedOffsetsMinutes: [10], sound: { kind: 'builtin', id: 'clear-bell' }, volume: 0.7 },
    ],
    alignment: { kind: 'elapsed' },
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

  it('uses track order as the sole overlap priority', () => {
    const event = nextPatternEvent(pattern(), 0, 9 * minute)
    expect(event.collision).toBe(true)
    expect(event.candidates.map(candidate => candidate.cueId)).toEqual(['top', 'bottom'])
    expect(event.winner.cueId).toBe('top')
    expect(event.boundary).toBe('pattern-offset')
  })

  it('distinguishes a Sequence cycle boundary from a Pattern main boundary', () => {
    const first = nextSequenceEvent(sequence(), 0, 0)
    const final = nextSequenceEvent(sequence(), 0, first.at)
    expect(first.boundary).toBe('sequence-step')
    expect(final.boundary).toBe('sequence-cycle')
  })
})

describe('timer v2 audio gate', () => {
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
})
