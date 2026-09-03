import { describe, expect, it } from 'vitest'
import type { PatternProgram, SequenceProgram } from '../../types'
import { deleteProgramPreset, chooseProgramMode, loadProgramPreset } from '../programActions'
import { gateProgramAudio, iterationMuteFor } from '../runtimeV2'
import { defaultTimerV2State, normalizeSoundRef } from '../timerV2'
import { nextPatternEvent, nextSequenceEvent } from '../timeline'

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

  it('does not consume alarm or mute state during a call', () => {
    const event = nextPatternEvent(pattern(), 0, 29 * minute)
    const mute = { mutedUntil: event.at + minute }
    const result = gateProgramAudio({ event, now: event.at, masterVolume: 1, mute, alarmBehavior: 'once', callActive: true })
    expect(result.disposition).toBe('suppressed')
    expect(result.reason).toBe('call-active')
    expect(result.nextMute).toEqual(mute)
    expect(result.nextAlarmBehavior).toBe('once')
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
  it('rejects malformed and unknown sound references', () => {
    const fallback = { kind: 'builtin', id: 'clear-bell' } as const
    expect(normalizeSoundRef({ kind: 'builtin', id: 'not-real' }, fallback)).toEqual(fallback)
    expect(normalizeSoundRef({ kind: 'document', uri: '', title: 'Missing' }, fallback)).toEqual(fallback)
    expect(normalizeSoundRef({ kind: 'android', uri: 'content://tone', title: 'Tone', ringtoneType: 'future' }, fallback)).toEqual({
      kind: 'android', uri: 'content://tone', title: 'Tone', ringtoneType: 'unknown',
    })
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
})
