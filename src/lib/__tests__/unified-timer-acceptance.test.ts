import { describe, expect, it } from 'vitest'
import fixture from '../../../fixtures/timer-unified-timeline.json'
import { convertLegacyProgramToUnified, convertSequenceToUnified, convertTimerV2State, parseUnifiedTimerProgram } from '../unified-timer'
import { defaultTimerV2State } from '../timerV2'
import type { UnifiedTimerProgram } from '../../types'

// Independent acceptance cases. Keep these separate from implementation tests.
describe('unified program acceptance boundaries', () => {
  it('accepts the multi-step scheduling contract without changing authored fields', () => {
    const source = structuredClone(fixture.program) as UnifiedTimerProgram
    const result = parseUnifiedTimerProgram(source)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.reason)
    expect(result.value).toEqual(fixture.program)
    result.value.steps[1].subBellTracks[0].randomRepeat!.minSeconds = 12
    result.value.steps[0].endCue.sound = { kind: 'builtin', id: 'bloom' }
    expect(source.steps[1].subBellTracks[0].randomRepeat!.minSeconds).toBe(10)
    expect(fixture.program.steps[0].endCue.sound.id).toBe('temple-gong')
  })

  it('retains infeasible authored offsets when an interval is shortened', () => {
    const program = structuredClone(fixture.program)
    program.steps[0].durationSeconds = 1
    const result = parseUnifiedTimerProgram(program)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.reason)
    expect(result.value.steps[0].subBellTracks[0].selectedOffsetsSeconds).toEqual([30])
    expect(result.value.steps[0].subBellTracks[0].afterStartSeconds).toBe(10)
    expect(result.value.steps[0].subBellTracks[0].beforeEndSeconds).toBe(5)
  })

  it('preserves future and malformed program payloads for recovery', () => {
    const future = { ...fixture.program, schemaVersion: 99 }
    const result = parseUnifiedTimerProgram(future)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('Future version was accepted')
    expect(result.raw).toEqual(future)
    const serialized = `  ${JSON.stringify(future)}\n`
    expect(parseUnifiedTimerProgram(serialized)).toMatchObject({ ok: false, raw: serialized })
    const broken = '{"schemaVersion":4,'
    expect(parseUnifiedTimerProgram(broken)).toMatchObject({ ok: false, raw: broken })
  })

  it('does not synthesize random replacement identities on duplicate legacy IDs', () => {
    const source = defaultTimerV2State().workingPrograms.sequence
    source.steps[1].id = source.steps[0].id
    const first = convertLegacyProgramToUnified(source, 'duplicate-source')
    expect(convertLegacyProgramToUnified(source, 'duplicate-source')).toEqual(first)
    // Invalid identity must remain recoverable rather than silently changing cue cursors.
    expect(first).toMatchObject({ ok: false, raw: source })
  })

  it.each(['wrong', -1, null])('rejects present malformed legacy durations: %s', duration => {
    const source = defaultTimerV2State().workingPrograms.pattern
    const raw = { ...source, mainDurationSeconds: duration }
    expect(convertLegacyProgramToUnified(raw)).toMatchObject({ ok: false, raw })
  })

  it.each(['javascript:alert(1)', 'https://example.org/audio.mp3', 'file:///temporary/sound.mp3'])(
    'rejects nonpersistent imported sound reference %s', uri => {
      const program = structuredClone(fixture.program)
      Object.assign(program.steps[0].endCue, { sound: { kind: 'document', uri, title: 'Imported' } })
      expect(parseUnifiedTimerProgram(program).ok).toBe(false)
    },
  )

  it('moves only cue fields into a migrated sequence end cue', () => {
    const source = defaultTimerV2State().workingPrograms.sequence
    source.steps[0].alarmEnabled = true
    const converted = convertSequenceToUnified(source)
    expect(converted.steps[0].endCue).toEqual({ sound: source.steps[0].sound, volume: source.steps[0].volume })
    expect(converted.steps[0].endAlarmEnabled).toBe(true)
    expect(converted.steps[0].id).toBe(source.steps[0].id)
  })

  it('keeps both working programs and captured preferences without aliasing legacy state', () => {
    const state = defaultTimerV2State()
    state.workingPrograms.selectedMode = 'sequence'
    state.settings.notificationsEnabled = false
    state.settings.liveCountdownEnabled = true
    state.presets = [{ id: 'saved', name: 'Saved', createdAt: 100, program: state.workingPrograms.pattern, settings: structuredClone(state.settings), showInRunningSelector: false }]
    const migrated = convertTimerV2State(state)
    expect(migrated.selected.steps.map(step => step.id)).toEqual(state.workingPrograms.sequence.steps.map(step => step.id))
    expect(migrated.recoveries).toHaveLength(1)
    expect(migrated.recoveries[0].sourceMode).toBe('pattern')
    expect(migrated.settings).toEqual(state.settings)
    expect(migrated.presets[0].settings).toEqual(state.settings)
    expect(migrated.presets[0].showInRunningSelector).toBe(false)
    migrated.settings.haptics.main.pattern = 'triple'
    expect(state.settings.haptics.main.pattern).not.toBe('triple')
  })
})
