import { describe, expect, it } from 'vitest'
import { defaultPatternProgram, defaultSequenceProgram, defaultTimerV2State } from '../timerV2'
import { createUnifiedDefaultProgram } from '../unified-config-state'
import {
  convertLegacyConfigStateToUnified, convertLegacyConfigToUnified, convertLegacyWorkingPrograms, convertPatternToUnified,
  convertLegacyProgramToUnified, convertSequenceToUnified, convertTimerV2State, normalizeUnifiedTimerProgram,
  parseUnifiedTimerProgram, defaultUnifiedStepLabel,
} from '../unified-timer'

describe('unified timer model', () => {
  it('uses step terminology for automatic unified labels while formatting exact seconds', () => {
    expect(defaultUnifiedStepLabel(60)).toBe('1-minute step')
    expect(defaultUnifiedStepLabel(1)).toBe('1-second step')
    expect(defaultUnifiedStepLabel(75)).toBe('1m 15s step')
    let id = 0
    expect(createUnifiedDefaultProgram(() => `fixture-${++id}`).steps[0]?.label).toBe('30-minute step')
  })

  it('validates exact-second bounds and rejects malformed or future versions with raw recovery data', () => {
    const source = convertPatternToUnified(defaultPatternProgram())
    expect(parseUnifiedTimerProgram({ ...source, steps: [{ ...source.steps[0], durationSeconds: 1 }] }).ok).toBe(true)
    expect(parseUnifiedTimerProgram({ ...source, steps: [{ ...source.steps[0], durationSeconds: 14_400 }] }).ok).toBe(true)
    for (const invalidDuration of [0, 14_401, 1.5]) {
      const raw = { ...source, steps: [{ ...source.steps[0], durationSeconds: invalidDuration }] }
      const result = parseUnifiedTimerProgram(raw)
      expect(result).toMatchObject({ ok: false, raw })
    }
    const future = { ...source, schemaVersion: 5 }
    expect(parseUnifiedTimerProgram(future)).toMatchObject({ ok: false, raw: future, reason: expect.stringContaining('Unsupported') })
    const badJson = '{broken'
    expect(parseUnifiedTimerProgram(badJson)).toMatchObject({ ok: false, raw: badJson })
  })

  it('preserves Pattern cue choices, custom label intent, disabled layers, stable IDs and dormant authored offsets', () => {
    const pattern = defaultPatternProgram()
    pattern.mainDurationSeconds = 61
    pattern.mainMinutes = 2
    pattern.label = 'A custom cycle'
    pattern.labelIsCustom = true
    pattern.tracks = [{
      ...pattern.tracks[0], id: 'track-original', enabled: false, repeatEnabled: false,
      selectedOffsetsSeconds: [60, 120], selectedOffsetsMinutes: [], cadenceSeconds: 7,
      afterStartSeconds: 90, beforeEndSeconds: 91,
      randomRepeat: { minSeconds: 5, maxSeconds: 9 },
      sounds: [{ kind: 'builtin', id: 'clear-bell' }, { kind: 'builtin', id: 'handpan' }], soundMode: 'random',
      hapticOverride: { pattern: 'double', strength: 'strong' },
    }]
    pattern.subBellsEnabled = false
    const result = convertPatternToUnified(pattern, 'test-pattern')
    const step = result.steps[0]
    expect(step).toMatchObject({ id: 'legacy:test-pattern:step', label: 'A custom cycle', labelIsCustom: true, durationSeconds: 61, subBellsEnabled: false })
    expect(step.endCue).toEqual(pattern.mainCue)
    expect(step.subBellTracks[0]).toMatchObject({ id: 'track-original', enabled: false, repeatEnabled: false, selectedOffsetsSeconds: [60, 120], afterStartSeconds: 90, beforeEndSeconds: 91, cadenceSeconds: 7, soundMode: 'random', hapticOverride: { pattern: 'double', strength: 'strong' } })
    expect(convertPatternToUnified(pattern, 'test-pattern')).toEqual(result)
  })

  it('preserves Sequence order, IDs, alarm choices, exact durations and cue settings', () => {
    const sequence = defaultSequenceProgram()
    sequence.steps[0].id = 'original-a'
    sequence.steps[0].durationSeconds = 1
    sequence.steps[0].alarmEnabled = true
    sequence.steps[1].id = 'original-b'
    sequence.steps[1].durationSeconds = 14_400
    sequence.steps[1].sounds = [{ kind: 'builtin', id: 'temple-gong' }, { kind: 'builtin', id: 'page' }]
    sequence.steps[1].soundMode = 'sequence'
    const unified = convertSequenceToUnified(sequence)
    expect(unified.steps.map(step => step.id)).toEqual(['original-a', 'original-b', sequence.steps[2].id])
    expect(unified.steps.map(step => step.durationSeconds)).toEqual([1, 14_400, sequence.steps[2].durationSeconds])
    expect(unified.steps[0].endAlarmEnabled).toBe(true)
    expect(unified.steps[1].endCue).toMatchObject({ sounds: sequence.steps[1].sounds, soundMode: 'sequence' })
    expect(unified.steps.every(step => !step.subBellsEnabled && step.subBellTracks.length === 0)).toBe(true)
  })

  it('converts V1 repeatably and preserves both V2 working copies and each settings snapshot', () => {
    const v1 = convertLegacyConfigToUnified({ mainInterval: 17, subInterval: 3, subEnabled: false, snapEnabled: true, snapOffset: 11, volume: 0.37, notificationsEnabled: false, focusModeEnabled: true, alarmModeEnabled: true })
    expect(v1).toEqual(convertLegacyConfigToUnified({ mainInterval: 17, subInterval: 3, subEnabled: false, snapEnabled: true, snapOffset: 11, volume: 0.37, notificationsEnabled: false, focusModeEnabled: true, alarmModeEnabled: true }))
    expect(v1.steps[0]).toMatchObject({ id: 'legacy:v1:step', durationSeconds: 1_020, subBellsEnabled: false })
    expect(v1.steps[0].subBellTracks[0].id).toBe('legacy:v1:track-1')
    const legacyState = convertLegacyConfigStateToUnified({ mainInterval: 17, subInterval: 3, subEnabled: false, snapEnabled: true, snapOffset: 11, volume: 0.37, notificationsEnabled: false, focusModeEnabled: true, alarmModeEnabled: true, activeHoursEnabled: true, activeHoursStart: 480, activeHoursEnd: 1_200, activeHoursDays: 42, alarmDurationSeconds: 180 })
    expect(legacyState).toEqual(convertLegacyConfigStateToUnified({ mainInterval: 17, subInterval: 3, subEnabled: false, snapEnabled: true, snapOffset: 11, volume: 0.37, notificationsEnabled: false, focusModeEnabled: true, alarmModeEnabled: true, activeHoursEnabled: true, activeHoursStart: 480, activeHoursEnd: 1_200, activeHoursDays: 42, alarmDurationSeconds: 180 }))
    expect(legacyState.settings).toMatchObject({ masterVolume: 0.37, notificationsEnabled: false, focusAutomationEnabled: true, alarmDurationSeconds: 180, availability: { enabled: true, weeklyWindows: [{ id: 'legacy:v1:availability-window-1', startMinutes: 480, endMinutes: 1_200, days: 42 }] } })
    expect(legacyState.legacyRuntime.alarmModeEnabled).toBe(true)
    expect(legacyState).not.toHaveProperty('sequence')

    const state = defaultTimerV2State()
    state.workingPrograms.selectedMode = 'sequence'
    state.workingPrograms.pattern.label = 'unsaved pattern copy'
    state.workingPrograms.sequence.steps[0].label = 'selected sequence copy'
    state.workingPrograms.sourcePreset = { id: 'source-id', name: 'Source name', createdAt: 456, deleted: true }
    state.settings.masterVolume = 0.23
    state.presets = [{ id: 'preset-id', name: 'Snapshot', createdAt: 123, program: state.workingPrograms.pattern, settings: { ...state.settings, masterVolume: 0.71 }, showInRunningSelector: false }]
    const converted = convertTimerV2State(state)
    expect(converted.selected.steps[0].label).toBe('selected sequence copy')
    expect(converted.recoveries).toHaveLength(1)
    expect(converted.recoveries[0]).toMatchObject({ sourceMode: 'pattern', program: { steps: [{ label: 'unsaved pattern copy' }] } })
    expect(converted.settings.masterVolume).toBe(0.23)
    expect(converted.presets[0]).toMatchObject({ id: 'preset-id', name: 'Snapshot', createdAt: 123, settings: { masterVolume: 0.71 }, showInRunningSelector: false })
    expect(converted.presets[0].program.steps[0].label).toBe('unsaved pattern copy')
    expect(converted.sourcePreset).toEqual(state.workingPrograms.sourcePreset)
    expect(converted.sourcePreset).not.toBe(state.workingPrograms.sourcePreset)
    expect(converted.soundLibrary).toEqual(state.soundLibrary)
    expect(normalizeUnifiedTimerProgram(converted.selected)).toEqual(converted.selected)

    const patternSelected = convertLegacyWorkingPrograms({ ...state.workingPrograms, selectedMode: 'pattern' })
    expect(patternSelected.selected.steps[0].label).toBe('unsaved pattern copy')
    expect(patternSelected.recoveries[0].sourceMode).toBe('sequence')
  })

  it('safely converts legacy import entry points with deterministic omitted IDs and rejects malformed or future inputs', () => {
    const pattern = defaultPatternProgram() as unknown as Record<string, unknown>
    const { tracks: _tracks, ...withoutTracks } = pattern
    const legacy = { ...withoutTracks, schemaVersion: 2, mode: 'pattern', tracks: [{ label: 'Legacy track', cadenceMinutes: 4, selectedOffsetsMinutes: [4, 100] }] }
    const first = convertLegacyProgramToUnified(legacy, 'import-a')
    const second = convertLegacyProgramToUnified(legacy, 'import-a')
    expect(first).toEqual(second)
    expect(first.ok).toBe(true)
    if (first.ok) {
      expect(first.value.steps[0].subBellTracks[0].id).toBe('legacy:import-a:track-1')
      expect(first.value.steps[0].subBellTracks[0].selectedOffsetsSeconds).toContain(6_000)
    }
    expect(convertLegacyProgramToUnified({ ...legacy, schemaVersion: 99 })).toMatchObject({ ok: false, raw: { schemaVersion: 99 } })
    expect(convertLegacyProgramToUnified({ ...legacy, tracks: 'bad' })).toMatchObject({ ok: false, reason: expect.stringContaining('array') })
    expect(() => convertLegacyConfigToUnified({ mainInterval: '30' as unknown as number })).toThrow(/invalid field types/i)
    const dormant = convertLegacyProgramToUnified({ ...legacy, mainDurationSeconds: 1, tracks: [{ id: 'original', label: 'Dormant', enabled: true, cadenceMinutes: 5, selectedOffsetsSeconds: [60], selectedOffsetsMinutes: [], sound: { kind: 'builtin', id: 'clear-bell' }, volume: 1 }] })
    expect(dormant.ok).toBe(true)
    if (dormant.ok) expect(dormant.value.steps[0].subBellTracks[0]).toMatchObject({ enabled: true, selectedOffsetsSeconds: [60] })
    const duplicateIds = { ...legacy, tracks: [{ id: 'same' }, { id: 'same' }] }
    expect(convertLegacyProgramToUnified(duplicateIds)).toMatchObject({ ok: false, raw: duplicateIds })
    const malformed = JSON.stringify({ ...legacy, mainDurationSeconds: -1 })
    expect(convertLegacyProgramToUnified(malformed)).toMatchObject({ ok: false, raw: malformed })
    const badSound = { kind: 'document', uri: 'https://example.test/audio.mp3', title: 'remote' }
    const unified = convertPatternToUnified(defaultPatternProgram())
    const invalidCanonical = { ...unified, steps: [{ ...unified.steps[0], endCue: { sound: badSound, volume: 1 } }] }
    expect(parseUnifiedTimerProgram(invalidCanonical)).toMatchObject({ ok: false, reason: expect.stringContaining('end cue') })
  })
})
