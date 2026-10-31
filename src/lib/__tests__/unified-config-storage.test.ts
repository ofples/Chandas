import { describe, expect, it } from 'vitest'
import { defaultTimerV2State } from '../timerV2'
import {
  createDefaultUnifiedConfigState, parseUnifiedConfigState, reduceUnifiedConfigCommand,
} from '../unified-config-state'
import {
  bootstrapUnifiedConfigState, LEGACY_TIMER_STORAGE_KEYS, saveUnifiedConfigState,
  UNIFIED_CONFIG_STORAGE_KEY, UNIFIED_MIGRATION_MARKER_KEY,
  type AsyncKeyValueStorage,
} from '../unified-storage'

class MemoryStorage implements AsyncKeyValueStorage {
  values = new Map<string, string>()
  reads: string[] = []
  writes: Array<[string, string]> = []
  failSetFor = new Set<string>()
  failGetFor = new Set<string>()
  getItem = async (key: string) => {
    this.reads.push(key)
    if (this.failGetFor.has(key)) throw new Error('read failure')
    return this.values.get(key) ?? null
  }
  setItem = async (key: string, value: string) => {
    this.writes.push([key, value])
    if (this.failSetFor.has(key)) throw new Error('write failure')
    this.values.set(key, value)
  }
}

function setV2(storage: MemoryStorage) {
  const state = defaultTimerV2State()
  storage.values.set(LEGACY_TIMER_STORAGE_KEYS.workingPrograms, JSON.stringify(state.workingPrograms))
  storage.values.set(LEGACY_TIMER_STORAGE_KEYS.settings, JSON.stringify(state.settings))
  storage.values.set(LEGACY_TIMER_STORAGE_KEYS.presets, JSON.stringify(state.presets))
  storage.values.set(LEGACY_TIMER_STORAGE_KEYS.soundLibrary, JSON.stringify(state.soundLibrary))
}

describe('unified config drafts', () => {
  it('Save as activates a clean snapshot while retaining the outgoing dirty draft', () => {
    const initial = createDefaultUnifiedConfigState({ now: () => 100, createId: () => 'first' })
    const edited = reduceUnifiedConfigCommand(initial, { type: 'edit', changes: { name: 'Unsaved name' }, now: 101 }).state
    const savedAs = reduceUnifiedConfigCommand(edited, { type: 'saveAs', name: 'Second', id: 'second', now: 102 })
    expect(savedAs.state.selectedConfigId).toBe('second')
    expect(savedAs.state.drafts.first?.name).toBe('Unsaved name')
    expect(savedAs.state.drafts.first?.dirty).toBe(true)
    expect(savedAs.state.drafts.second?.dirty).toBe(false)
    expect(savedAs.state.configs.find(item => item.id === 'first')?.name).toBe('Timer')
  })

  it('keeps the selected saved config when duplicating and does not lose dirty edits on library changes', () => {
    const state = createDefaultUnifiedConfigState({ now: () => 100, createId: () => 'first' })
    const edited = reduceUnifiedConfigCommand(state, { type: 'edit', changes: { name: 'Draft title' } }).state
    const duplicate = reduceUnifiedConfigCommand(edited, { type: 'duplicate', id: 'first', newId: 'copy' }).state
    expect(duplicate.selectedConfigId).toBe('first')
    expect(duplicate.drafts.first?.dirty).toBe(true)
    expect(duplicate.drafts.copy?.dirty).toBe(false)
    expect(reduceUnifiedConfigCommand(duplicate, { type: 'setSoundLibrary', sounds: [] }).state.drafts.first?.name).toBe('Draft title')
  })

  it('keeps draft on switch, discards only on explicit discard, and cancel preserves selection', () => {
    const initial = createDefaultUnifiedConfigState({ now: () => 100, createId: () => 'one' })
    const added = reduceUnifiedConfigCommand(initial, { type: 'saveAs', name: 'Two', id: 'two', now: 101 }).state
    const edited = reduceUnifiedConfigCommand(added, { type: 'edit', changes: { name: 'Kept title' }, now: 102 }).state
    const cancelled = reduceUnifiedConfigCommand(edited, { type: 'switch', configId: 'one', choice: 'cancel' }).state
    expect(cancelled.selectedConfigId).toBe('two')
    const kept = reduceUnifiedConfigCommand(edited, { type: 'switch', configId: 'one', choice: 'keep' }).state
    expect(kept.drafts.two?.name).toBe('Kept title')
    expect(kept.drafts.two?.dirty).toBe(true)
    const back = reduceUnifiedConfigCommand(kept, { type: 'switch', configId: 'two', choice: 'keep' }).state
    expect(back.drafts.two?.name).toBe('Kept title')
  })

  it('deleting the selected clean config leaves its contents available as the unnamed draft', () => {
    const initial = createDefaultUnifiedConfigState({ now: () => 100, createId: () => 'one' })
    const deleted = reduceUnifiedConfigCommand(initial, { type: 'delete', id: 'one', now: 101 })
    expect(deleted.status).toBe('applied')
    expect(deleted.state.selectedConfigId).toBeNull()
    expect(deleted.state.drafts['draft:unnamed']?.program).toEqual(initial.configs[0]?.program)
    expect(deleted.state.drafts['draft:unnamed']?.dirty).toBe(true)
    expect(deleted.state.drafts['draft:unnamed']?.baseConfigId).toBeUndefined()
  })

  it('supports prototype-named config IDs safely and reserves the unnamed draft key', () => {
    const initial = createDefaultUnifiedConfigState({ now: () => 100, createId: () => '__proto__' })
    const parsed = parseUnifiedConfigState(initial)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const saved = reduceUnifiedConfigCommand(parsed.value, { type: 'saveAs', name: 'Ctor', id: 'constructor' })
    expect(saved.status).toBe('applied')
    expect(Object.prototype.hasOwnProperty.call(saved.state.drafts, 'constructor')).toBe(true)
    expect(saved.state.drafts.constructor?.name).toBe('Ctor')
    const reserved = reduceUnifiedConfigCommand(saved.state, { type: 'saveAs', name: 'Bad', id: 'draft:unnamed' })
    expect(reserved.status).toBe('blocked')
  })
})

describe('unified config storage migration', () => {
  it('creates deterministic defaults only when no authored timer records exist', async () => {
    const storage = new MemoryStorage()
    const result = await bootstrapUnifiedConfigState(storage, { now: () => 50, createId: () => 'default-id' })
    expect(result.status).toBe('loaded')
    if (result.status !== 'loaded') return
    expect(result.source).toBe('new-install')
    expect(result.state.configs[0]?.id).toBe('default-id')
    expect(storage.values.has(UNIFIED_MIGRATION_MARKER_KEY)).toBe(true)
    expect(storage.values.has(LEGACY_TIMER_STORAGE_KEYS.config)).toBe(false)
  })

  it('does not create a default over a legacy session without its configuration', async () => {
    const storage = new MemoryStorage()
    storage.values.set(LEGACY_TIMER_STORAGE_KEYS.session, JSON.stringify({ phase: 3 }))
    const result = await bootstrapUnifiedConfigState(storage)
    expect(result.status).toBe('recovery-required')
    if (result.status === 'recovery-required') expect(result.reason).toBe('legacy-session-without-config')
    expect(storage.values.has(UNIFIED_CONFIG_STORAGE_KEY)).toBe(false)
  })

  it('migrates both V2 working copies and is stable across an interrupted-marker retry', async () => {
    const storage = new MemoryStorage()
    setV2(storage)
    const rawWorking = storage.values.get(LEGACY_TIMER_STORAGE_KEYS.workingPrograms)
    storage.failSetFor.add(UNIFIED_MIGRATION_MARKER_KEY)
    const first = await bootstrapUnifiedConfigState(storage, { now: () => 500 })
    expect(first.status).toBe('loaded')
    if (first.status !== 'loaded') return
    expect(first.source).toBe('v2-migration')
    expect(first.migrationMarkerWritten).toBe(false)
    expect(first.state.legacyRecoveries).toHaveLength(1)
    expect(first.state.drafts['draft:unnamed']?.program.steps.length).toBe(1)
    expect(storage.values.get(LEGACY_TIMER_STORAGE_KEYS.workingPrograms)).toBe(rawWorking)
    storage.failSetFor.delete(UNIFIED_MIGRATION_MARKER_KEY)
    const retry = await bootstrapUnifiedConfigState(storage)
    expect(retry.status).toBe('loaded')
    if (retry.status !== 'loaded') return
    expect(retry.source).toBe('unified')
    expect(retry.state).toEqual(first.state)
    expect(storage.values.get(UNIFIED_MIGRATION_MARKER_KEY)).toBe('3')
  })

  it('retains V2 preset snapshots, running visibility, source linkage and global working settings', async () => {
    const storage = new MemoryStorage()
    const state = defaultTimerV2State()
    const preset = { id: 'preset-1', name: 'Saved', createdAt: 123, program: state.workingPrograms.pattern, settings: { ...state.settings, masterVolume: 0.17 }, showInRunningSelector: false }
    state.presets = [preset]
    state.workingPrograms.sourcePreset = { id: preset.id, name: preset.name, createdAt: preset.createdAt }
    storage.values.set(LEGACY_TIMER_STORAGE_KEYS.workingPrograms, JSON.stringify(state.workingPrograms))
    storage.values.set(LEGACY_TIMER_STORAGE_KEYS.settings, JSON.stringify({ ...state.settings, masterVolume: 0.63 }))
    storage.values.set(LEGACY_TIMER_STORAGE_KEYS.presets, JSON.stringify(state.presets))
    storage.values.set(LEGACY_TIMER_STORAGE_KEYS.soundLibrary, JSON.stringify([]))
    const result = await bootstrapUnifiedConfigState(storage, { now: () => 500 })
    expect(result.status).toBe('loaded')
    if (result.status !== 'loaded') return
    expect(result.state.configs[0]?.showInRunningSelector).toBe(false)
    expect(result.state.configs[0]?.settings.masterVolume).toBe(0.17)
    expect(result.state.selectedConfigId).toBe('preset-1')
    expect(result.state.drafts['preset-1']?.settings.masterVolume).toBe(0.63)
    expect(result.state.drafts['preset-1']?.sourcePreset?.id).toBe('preset-1')
    expect(result.state.drafts['preset-1']?.dirty).toBe(true)
  })

  it('unions shared imported sounds from stored library, both working copies, snapshots and alarm settings', async () => {
    const storage = new MemoryStorage()
    const state = defaultTimerV2State()
    const stored = { kind: 'document' as const, uri: 'content://library/one', title: 'Stored', mimeType: 'audio/mpeg' }
    const patternSound = { kind: 'android' as const, uri: 'content://pattern/two', title: 'Pattern', ringtoneType: 'alarm' as const }
    const sequenceSound = { kind: 'android' as const, uri: 'content://sequence/three', title: 'Sequence', ringtoneType: 'notification' as const }
    const presetSound = { kind: 'document' as const, uri: 'content://preset/four', title: 'Preset', mimeType: 'audio/wav' }
    state.workingPrograms.pattern.mainCue.sound = patternSound
    state.workingPrograms.sequence.steps[0]!.sound = sequenceSound
    state.settings.alarmSound = patternSound
    state.presets = [{ id: 'sound-preset', name: 'Sounds', createdAt: 1, program: state.workingPrograms.pattern, settings: { ...state.settings, alarmSound: presetSound } }]
    storage.values.set(LEGACY_TIMER_STORAGE_KEYS.workingPrograms, JSON.stringify(state.workingPrograms))
    storage.values.set(LEGACY_TIMER_STORAGE_KEYS.settings, JSON.stringify(state.settings))
    storage.values.set(LEGACY_TIMER_STORAGE_KEYS.presets, JSON.stringify(state.presets))
    storage.values.set(LEGACY_TIMER_STORAGE_KEYS.soundLibrary, JSON.stringify([stored]))
    const result = await bootstrapUnifiedConfigState(storage)
    expect(result.status).toBe('loaded')
    if (result.status !== 'loaded') return
    expect(result.state.soundLibrary.filter(sound => sound.kind !== 'builtin').map(sound => sound.uri).sort()).toEqual([
      'content://library/one', 'content://pattern/two', 'content://preset/four', 'content://sequence/three',
    ])
  })

  it('preserves exact invalid/future unified bytes and never writes a replacement default', async () => {
    const storage = new MemoryStorage()
    const raw = '{ "schemaVersion": 91, "futureField": [1,2] }'
    storage.values.set(UNIFIED_CONFIG_STORAGE_KEY, raw)
    const result = await bootstrapUnifiedConfigState(storage)
    expect(result.status).toBe('recovery-required')
    if (result.status !== 'recovery-required') return
    expect(result.reason).toBe('future-unified-state')
    expect(result.raw).toBe(raw)
    expect(storage.values.get(UNIFIED_CONFIG_STORAGE_KEY)).toBe(raw)
    expect(storage.writes).toHaveLength(0)
  })

  it('preserves malformed legacy input for recovery instead of normalizing it into defaults', async () => {
    const storage = new MemoryStorage()
    const state = defaultTimerV2State()
    const malformed = { ...state.workingPrograms, pattern: { ...state.workingPrograms.pattern, mainDurationSeconds: 'garbage' } }
    storage.values.set(LEGACY_TIMER_STORAGE_KEYS.workingPrograms, JSON.stringify(malformed))
    storage.values.set(LEGACY_TIMER_STORAGE_KEYS.settings, JSON.stringify(state.settings))
    const result = await bootstrapUnifiedConfigState(storage)
    expect(result.status).toBe('recovery-required')
    if (result.status === 'recovery-required') {
      expect(result.reason).toBe('invalid-legacy-records')
      expect(result.legacyRaw[LEGACY_TIMER_STORAGE_KEYS.workingPrograms]).toBe(JSON.stringify(malformed))
    }
    expect(storage.values.has(UNIFIED_CONFIG_STORAGE_KEY)).toBe(false)
  })

  it('migrates V1 settings with deterministic schedule identity and keeps alarm-mode evidence', async () => {
    const storage = new MemoryStorage()
    storage.values.set(LEGACY_TIMER_STORAGE_KEYS.config, JSON.stringify({ mainInterval: 7, volume: 0.42, activeHoursEnabled: true, activeHoursStart: 480, activeHoursEnd: 900, alarmModeEnabled: true }))
    const result = await bootstrapUnifiedConfigState(storage, { now: () => 900, createId: () => 'ignored' })
    expect(result.status).toBe('loaded')
    if (result.status !== 'loaded') return
    expect(result.source).toBe('v1-migration')
    expect(result.state.configs[0]?.settings.masterVolume).toBe(0.42)
    expect(result.state.configs[0]?.settings.availability.weeklyWindows[0]?.id).toBe('legacy:v1:availability-window-1')
    expect(result.state.legacyRuntimeMetadata?.alarmModeEnabled).toBe(true)
  })

  it('does not overwrite valid legacy records when the first unified write fails, and retry is repeatable', async () => {
    const storage = new MemoryStorage()
    setV2(storage)
    const originalWorking = storage.values.get(LEGACY_TIMER_STORAGE_KEYS.workingPrograms)
    const originalSettings = storage.values.get(LEGACY_TIMER_STORAGE_KEYS.settings)
    const originalPresets = storage.values.get(LEGACY_TIMER_STORAGE_KEYS.presets)
    const originalLibrary = storage.values.get(LEGACY_TIMER_STORAGE_KEYS.soundLibrary)
    storage.failSetFor.add(UNIFIED_CONFIG_STORAGE_KEY)
    const failed = await bootstrapUnifiedConfigState(storage, { now: () => 42 })
    expect(failed.status).toBe('recovery-required')
    if (failed.status === 'recovery-required') expect(failed.reason).toBe('storage-unavailable')
    expect(storage.values.has(UNIFIED_CONFIG_STORAGE_KEY)).toBe(false)
    expect(storage.values.get(LEGACY_TIMER_STORAGE_KEYS.workingPrograms)).toBe(originalWorking)
    storage.failSetFor.clear()
    const retryA = await bootstrapUnifiedConfigState(storage, { now: () => 42 })
    expect(retryA.status).toBe('loaded')
    const retryB = new MemoryStorage()
    retryB.values.set(LEGACY_TIMER_STORAGE_KEYS.workingPrograms, originalWorking!)
    retryB.values.set(LEGACY_TIMER_STORAGE_KEYS.settings, originalSettings!)
    retryB.values.set(LEGACY_TIMER_STORAGE_KEYS.presets, originalPresets!)
    retryB.values.set(LEGACY_TIMER_STORAGE_KEYS.soundLibrary, originalLibrary!)
    const independent = await bootstrapUnifiedConfigState(retryB, { now: () => 42 })
    expect(retryA.status === 'loaded' && independent.status === 'loaded' ? retryA.state : null).toEqual(independent.status === 'loaded' ? independent.state : null)
  })

  it('serializes durable saves, validates state and readback, and never touches the prototype key', async () => {
    const storage = new MemoryStorage()
    const state = createDefaultUnifiedConfigState({ now: () => 10, createId: () => 'stable' })
    const result = await Promise.all([
      saveUnifiedConfigState(storage, state),
      saveUnifiedConfigState(storage, { ...state, selectedConfigId: 'missing' }),
    ])
    expect(result[0]?.status).toBe('saved')
    expect(result[1]?.status).toBe('rejected')
    expect(storage.values.has('chandas.experimental-unified-setup.v1')).toBe(false)
    expect(storage.reads).not.toContain('chandas.experimental-unified-setup.v1')
    expect(storage.writes.map(([key]) => key)).toEqual([UNIFIED_CONFIG_STORAGE_KEY])
  })
})

