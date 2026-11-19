import type { AppTimerSettings, SoundRef, UnifiedTimerProgram } from '../types'
import {
  convertLegacyConfigStateToUnified, convertLegacyProgramToUnified,
} from './unified-timer'
import {
  UNNAMED_DRAFT_KEY, createUnsavedUnifiedConfigState, defaultUnifiedTimerName, convertLegacyTimerSettings,
  isUnifiedDraftDirty, makeLegacyRecoveryDraft, parseUnifiedConfigState, parseUnifiedTimerSettings,
  type ConfigStateDependencies, type UnifiedConfigState, type UnifiedLegacyRecovery,
  type UnifiedTimerConfig, type UnifiedTimerDraft,
} from './unified-config-state'
import { cueSounds, isSupportedSoundRef, soundRefKey } from './timerV2'
import { addFirstRunStarters } from './starter-timers'

export const UNIFIED_CONFIG_STORAGE_KEY = 'chandas-timer-unified-state-v3'
export const UNIFIED_MIGRATION_MARKER_KEY = 'chandas-timer-unified-migrated-v3'
export const LEGACY_TIMER_STORAGE_KEYS = {
  config: 'chandas-config',
  session: 'chandas-session',
  workingPrograms: 'chandas-working-programs-v2',
  presets: 'chandas-program-presets-v1',
  settings: 'chandas-app-timer-settings-v2',
  soundLibrary: 'chandas-sound-library-v2',
  v2Marker: 'chandas-timer-v2-migrated',
  v2Session: 'chandas-timer-v2-session',
} as const

export interface AsyncKeyValueStorage {
  getItem(key: string): Promise<string | null>
  setItem(key: string, value: string): Promise<void>
  removeItem?(key: string): Promise<void>
}

export interface UnifiedStorageDependencies extends ConfigStateDependencies {
  /** A stable/testable clock. Migration snapshots use this for updatedAt only. */
  now?: () => number
}

export type UnifiedLoadResult =
  | { status: 'loaded'; state: UnifiedConfigState; source: 'unified' | 'v2-migration' | 'v1-migration' | 'new-install'; migrationMarkerWritten: boolean }
  | { status: 'recovery-required'; reason: 'storage-unavailable' | 'invalid-unified-state' | 'future-unified-state' | 'invalid-legacy-records' | 'incomplete-legacy-records' | 'legacy-session-without-config'; raw?: string; legacyRaw: Record<string, string | null>; message: string }

export type UnifiedSaveResult =
  | { status: 'saved'; bytes: number }
  | { status: 'rejected'; reason: 'invalid-state'; message: string }
  | { status: 'failed'; reason: 'storage-unavailable' | 'readback-mismatch' | 'protected-record'; message: string }

const LEGACY_KEYS = Object.values(LEGACY_TIMER_STORAGE_KEYS)
const storageQueues = new WeakMap<object, Promise<unknown>>()
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const clone = <T>(value: T): T => typeof structuredClone === 'function' ? structuredClone(value) : JSON.parse(JSON.stringify(value)) as T
function setOwnDraft(drafts: Record<string, UnifiedTimerDraft>, key: string, draft: UnifiedTimerDraft): void {
  Object.defineProperty(drafts, key, { value: draft, writable: true, enumerable: true, configurable: true })
}

function parseRaw(raw: string | null): unknown | undefined {
  if (raw === null) return undefined
  return JSON.parse(raw) as unknown
}

function rawRecords(values: Map<string, string | null>): Record<string, string | null> {
  return Object.fromEntries(LEGACY_KEYS.map(key => [key, values.get(key) ?? null]))
}

function uniqueSounds(sounds: SoundRef[]): SoundRef[] {
  const seen = new Set<string>()
  return sounds.filter(sound => {
    if ((sound.kind !== 'android' && sound.kind !== 'document') || !isSupportedSoundRef(sound)) return false
    const key = soundRefKey(sound)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  }).map(sound => clone(sound))
}

function soundsInProgram(program: UnifiedTimerProgram): SoundRef[] {
  const sounds: SoundRef[] = []
  const add = (cue: { sound: SoundRef; sounds?: SoundRef[] } | null | undefined) => { if (cue) sounds.push(...cueSounds(cue)) }
  program.steps.forEach(step => { add(step.endCue); step.subBellTracks.forEach(add) })
  add(program.completionCue)
  return sounds
}

function parseLegacySettings(raw: string | null, namespace: string): AppTimerSettings | null {
  const value = parseRaw(raw)
  const exact = parseUnifiedTimerSettings(value)
  if (exact) return exact
  let next = 0
  const createId = () => `${namespace}:window-${++next}`
  return convertLegacyTimerSettings(value, createId)
}

function recoverResult(reason: Extract<UnifiedLoadResult, { status: 'recovery-required' }>['reason'], legacyRaw: Record<string, string | null>, message: string, raw?: string): UnifiedLoadResult {
  return { status: 'recovery-required', reason, legacyRaw: clone(legacyRaw), message, ...(raw !== undefined ? { raw } : {}) }
}

function sourcePreset(value: unknown): { id: string; name: string; createdAt: number; deleted?: boolean } | undefined | null {
  if (value === undefined) return undefined
  if (!record(value) || typeof value.id !== 'string' || !value.id || typeof value.name !== 'string' || !Number.isFinite(value.createdAt) || typeof value.createdAt !== 'number' || (value.deleted !== undefined && typeof value.deleted !== 'boolean')) return null
  return { id: value.id, name: value.name, createdAt: value.createdAt, ...(value.deleted === true ? { deleted: true } : {}) }
}

function migrateV2(legacy: Record<string, string | null>, now: number): UnifiedConfigState | null {
  const workingRaw = legacy[LEGACY_TIMER_STORAGE_KEYS.workingPrograms]
  const settingsRaw = legacy[LEGACY_TIMER_STORAGE_KEYS.settings]
  if (workingRaw === null || settingsRaw === null) return null
  const working = parseRaw(workingRaw)
  if (!record(working) || !record(working.pattern) || !record(working.sequence) || (working.selectedMode !== 'pattern' && working.selectedMode !== 'sequence')) return null
  const selectedMode = working.selectedMode
  const presetSource = sourcePreset(working.sourcePreset)
  if (presetSource === null) return null
  const selectedSourceKey = presetSource ? `preset-${presetSource.id}` : `working-${selectedMode}`
  const pattern = convertLegacyProgramToUnified(working.pattern, selectedMode === 'pattern' ? selectedSourceKey : 'working-pattern')
  const sequence = convertLegacyProgramToUnified(working.sequence, selectedMode === 'sequence' ? selectedSourceKey : 'working-sequence')
  if (!pattern.ok || !sequence.ok) return null
  const settings = parseLegacySettings(settingsRaw, 'legacy-v2-settings')
  if (!settings) return null

  let presetValues: unknown = []
  if (legacy[LEGACY_TIMER_STORAGE_KEYS.presets] !== null) presetValues = parseRaw(legacy[LEGACY_TIMER_STORAGE_KEYS.presets])
  if (!Array.isArray(presetValues)) return null
  const configs: UnifiedTimerConfig[] = []
  const seenIds = new Set<string>()
  for (let index = 0; index < presetValues.length; index += 1) {
    const entry = presetValues[index]
    if (!record(entry) || typeof entry.name !== 'string' || [...entry.name].length < 1 || [...entry.name].length > 80
      || (entry.id !== undefined && (typeof entry.id !== 'string' || !entry.id || entry.id.length > 200))
      || (entry.createdAt !== undefined && (typeof entry.createdAt !== 'number' || !Number.isFinite(entry.createdAt)))
      || (entry.showInRunningSelector !== undefined && typeof entry.showInRunningSelector !== 'boolean')) return null
    const id = entry.id === undefined ? `legacy:preset:${index + 1}` : entry.id
    if (seenIds.has(id)) return null
    seenIds.add(id)
    const converted = convertLegacyProgramToUnified(entry.program, `preset-${id}`)
    if (!converted.ok) return null
    let presetSettings: AppTimerSettings | undefined
    if (entry.settings !== undefined) {
      const rawSnapshot = JSON.stringify(entry.settings)
      presetSettings = parseLegacySettings(rawSnapshot, `legacy-preset-${index + 1}`) ?? undefined
      if (!presetSettings) return null
    }
    configs.push({
      id, name: entry.name.trim(), createdAt: typeof entry.createdAt === 'number' ? entry.createdAt : 0, updatedAt: now,
      program: converted.value, settings: presetSettings ?? clone(settings), showInRunningSelector: entry.showInRunningSelector !== false,
      editorOptions: { enabledActionIds: [] },
    })
  }

  const chosenProgram = selectedMode === 'pattern' ? pattern.value : sequence.value
  const unselectedProgram = selectedMode === 'pattern' ? sequence.value : pattern.value
  const selectedPreset = presetSource ? configs.find(config => config.id === presetSource.id) : undefined
  const selectedConfigId = selectedPreset?.id ?? null
  const selectedDraft: UnifiedTimerDraft = {
    ...(selectedConfigId ? { baseConfigId: selectedConfigId } : {}),
    name: selectedPreset?.name ?? chosenProgram.steps[0]?.label ?? 'Recovered timer',
    program: clone(chosenProgram), settings: clone(settings), editorOptions: clone(selectedPreset?.editorOptions ?? { enabledActionIds: [] }),
    updatedAt: now, dirty: true, ...(presetSource ? { sourcePreset: presetSource } : {}),
  }
  const otherMode = selectedMode === 'pattern' ? 'sequence' : 'pattern'
  const otherRecovery: UnifiedLegacyRecovery = makeLegacyRecoveryDraft({ sourceMode: otherMode, program: unselectedProgram }, settings, now)

  let library: unknown = []
  if (legacy[LEGACY_TIMER_STORAGE_KEYS.soundLibrary] !== null) library = parseRaw(legacy[LEGACY_TIMER_STORAGE_KEYS.soundLibrary])
  if (!Array.isArray(library) || library.some(item => !isSupportedSoundRef(item) || (item.kind !== 'android' && item.kind !== 'document'))) return null
  const soundRefs = [...library as SoundRef[], ...soundsInProgram(chosenProgram), ...soundsInProgram(unselectedProgram), ...configs.flatMap(config => soundsInProgram(config.program))]
  soundRefs.push({ ...settings.alarmSound }, ...configs.flatMap(config => [{ ...config.settings.alarmSound }]))
  const selectedDraftKey = selectedConfigId ?? UNNAMED_DRAFT_KEY
  const drafts: Record<string, UnifiedTimerDraft> = Object.fromEntries(configs.map(config => [config.id, {
    baseConfigId: config.id, name: config.name, program: clone(config.program), settings: clone(config.settings), editorOptions: clone(config.editorOptions),
    updatedAt: now, dirty: false,
  } satisfies UnifiedTimerDraft]))
  selectedDraft.dirty = isUnifiedDraftDirty(selectedDraft, selectedPreset)
  setOwnDraft(drafts, selectedDraftKey, selectedDraft)
  return {
    schemaVersion: 3, selectedConfigId, configs, drafts,
    legacyRecoveries: [otherRecovery], soundLibrary: uniqueSounds(soundRefs),
    globalAvailability: clone(settings.availability),
  }
}

function migrateV1(raw: string, now: number): UnifiedConfigState | null {
  const parsed = parseRaw(raw)
  if (!record(parsed)) return null
  if (parsed.schemaVersion !== undefined && parsed.schemaVersion !== 1) return null
  if (parsed.mode !== undefined) return null
  try {
    const migrated = convertLegacyConfigStateToUnified(parsed)
    const program = clone(migrated.program)
    const isCustom = program.steps[0].labelIsCustom === true
    const name = isCustom ? program.steps[0].label : defaultUnifiedTimerName(program.steps[0].durationSeconds)
    program.steps[0].label = name
    const draft: UnifiedTimerDraft = {
      name, program, settings: clone(migrated.settings), editorOptions: { enabledActionIds: [], configurationNameIsCustom: isCustom }, updatedAt: now, dirty: true,
    }
    return {
      schemaVersion: 3, selectedConfigId: null, configs: [], drafts: { [UNNAMED_DRAFT_KEY]: draft }, legacyRecoveries: [],
      soundLibrary: uniqueSounds(migrated.soundLibrary), globalAvailability: clone(migrated.settings.availability),
      legacyRuntimeMetadata: { alarmModeEnabled: migrated.legacyRuntime.alarmModeEnabled },
    }
  } catch { return null }
}

function looksFuture(raw: string): boolean {
  try { const parsed = JSON.parse(raw) as unknown; return record(parsed) && typeof parsed.schemaVersion === 'number' && parsed.schemaVersion > 3 } catch { return false }
}

async function readLegacy(storage: AsyncKeyValueStorage): Promise<Map<string, string | null>> {
  const entries = await Promise.all(LEGACY_KEYS.map(async key => [key, await storage.getItem(key)] as const))
  return new Map(entries)
}

async function bootstrapUnlocked(storage: AsyncKeyValueStorage, deps: UnifiedStorageDependencies = {}): Promise<UnifiedLoadResult> {
  let newRaw: string | null
  try { newRaw = await storage.getItem(UNIFIED_CONFIG_STORAGE_KEY) }
  catch { return recoverResult('storage-unavailable', {}, 'Could not read unified timer state') }
  if (newRaw !== null) {
    const parsed = parseUnifiedConfigState(newRaw)
    if (!parsed.ok) {
      let legacyRaw: Record<string, string | null> = {}
      try { legacyRaw = rawRecords(await readLegacy(storage)) } catch { /* raw new record remains the primary recovery evidence */ }
      return recoverResult(looksFuture(newRaw) ? 'future-unified-state' : 'invalid-unified-state', legacyRaw, parsed.reason, newRaw)
    }
    let markerWritten = false
    try {
      const marker = await storage.getItem(UNIFIED_MIGRATION_MARKER_KEY)
      if (marker !== '3') { await storage.setItem(UNIFIED_MIGRATION_MARKER_KEY, '3'); markerWritten = true }
      else markerWritten = true
    } catch { /* a verified new state remains authoritative; the marker is advisory */ }
    return { status: 'loaded', state: parsed.value, source: 'unified', migrationMarkerWritten: markerWritten }
  }

  let records: Map<string, string | null>
  try { records = await readLegacy(storage) }
  catch { return recoverResult('storage-unavailable', {}, 'Could not read legacy timer records') }
  const legacy = rawRecords(records)
  const v2Keys = [LEGACY_TIMER_STORAGE_KEYS.workingPrograms, LEGACY_TIMER_STORAGE_KEYS.presets, LEGACY_TIMER_STORAGE_KEYS.settings, LEGACY_TIMER_STORAGE_KEYS.soundLibrary]
  const hasV2 = v2Keys.some(key => records.get(key) !== null) || records.get(LEGACY_TIMER_STORAGE_KEYS.v2Marker) !== null
  const v1Raw = records.get(LEGACY_TIMER_STORAGE_KEYS.config) ?? null
  const hasLegacySession = records.get(LEGACY_TIMER_STORAGE_KEYS.session) !== null || records.get(LEGACY_TIMER_STORAGE_KEYS.v2Session) !== null
  if (hasV2) {
    if (records.get(LEGACY_TIMER_STORAGE_KEYS.workingPrograms) === null || records.get(LEGACY_TIMER_STORAGE_KEYS.settings) === null) {
      return recoverResult('incomplete-legacy-records', legacy, 'Legacy V2 marker or partial records exist without both working programs and settings')
    }
    let state: UnifiedConfigState | null = null
    try { state = migrateV2(legacy, deps.now?.() ?? Date.now()) } catch { state = null }
    if (!state) return recoverResult('invalid-legacy-records', legacy, 'Legacy V2 timer records are malformed or incomplete')
    return persistMigration(storage, state, 'v2-migration', legacy)
  }
  if (v1Raw !== null) {
    let state: UnifiedConfigState | null = null
    try { state = migrateV1(v1Raw, deps.now?.() ?? Date.now()) } catch { state = null }
    if (!state) return recoverResult('invalid-legacy-records', legacy, 'Legacy V1 timer configuration could not be converted')
    return persistMigration(storage, state, 'v1-migration', legacy)
  }
  if (hasLegacySession || records.get(LEGACY_TIMER_STORAGE_KEYS.v2Marker) !== null) {
    return recoverResult('legacy-session-without-config', legacy, 'Legacy runtime or migration records exist without a recoverable configuration')
  }
  const state = addFirstRunStarters(createUnsavedUnifiedConfigState({ now: deps.now, createId: deps.createId }), deps.now?.() ?? Date.now())
  return persistMigration(storage, state, 'new-install', legacy)
}

function enqueueStorageOperation<T>(storage: AsyncKeyValueStorage, operation: () => Promise<T>): Promise<T> {
  const previous = storageQueues.get(storage as object) ?? Promise.resolve()
  const current = previous.catch(() => undefined).then(operation)
  storageQueues.set(storage as object, current)
  return current
}

/** Bootstrap and writes share one queue, so concurrent mounts cannot race to replace state. */
export function bootstrapUnifiedConfigState(storage: AsyncKeyValueStorage, deps: UnifiedStorageDependencies = {}): Promise<UnifiedLoadResult> {
  return enqueueStorageOperation(storage, () => bootstrapUnlocked(storage, deps))
}

async function persistMigration(storage: AsyncKeyValueStorage, state: UnifiedConfigState, source: 'v2-migration' | 'v1-migration' | 'new-install', legacyRaw: Record<string, string | null>): Promise<UnifiedLoadResult> {
  // A new valid record that appeared while legacy records were read is authoritative.
  let existing: string | null
  try { existing = await storage.getItem(UNIFIED_CONFIG_STORAGE_KEY) }
  catch { return recoverResult('storage-unavailable', legacyRaw, 'Could not recheck unified timer state before migration') }
  if (existing !== null) {
    const existingState = parseUnifiedConfigState(existing)
    if (!existingState.ok) return recoverResult(looksFuture(existing) ? 'future-unified-state' : 'invalid-unified-state', legacyRaw, existingState.reason, existing)
    let migrationMarkerWritten = false
    try {
      const marker = await storage.getItem(UNIFIED_MIGRATION_MARKER_KEY)
      if (marker !== '3') await storage.setItem(UNIFIED_MIGRATION_MARKER_KEY, '3')
      migrationMarkerWritten = true
    } catch { /* the valid new record remains authoritative */ }
    return { status: 'loaded', state: existingState.value, source: 'unified', migrationMarkerWritten }
  }
  const parsed = parseUnifiedConfigState(state)
  if (!parsed.ok) return recoverResult('invalid-legacy-records', legacyRaw, `Converted state failed validation: ${parsed.reason}`)
  const snapshot = JSON.stringify(parsed.value)
  try {
    await storage.setItem(UNIFIED_CONFIG_STORAGE_KEY, snapshot)
    const readback = await storage.getItem(UNIFIED_CONFIG_STORAGE_KEY)
    const verified = readback === snapshot && parseUnifiedConfigState(readback)
    if (!verified || !verified.ok) return recoverResult('storage-unavailable', legacyRaw, 'Unified migration write could not be verified', snapshot)
    try { await storage.setItem(UNIFIED_MIGRATION_MARKER_KEY, '3') }
    catch { return { status: 'loaded', state: verified.value, source, migrationMarkerWritten: false } }
    return { status: 'loaded', state: verified.value, source, migrationMarkerWritten: true }
  } catch {
    return recoverResult('storage-unavailable', legacyRaw, 'Unified migration could not be written and verified', snapshot)
  }
}

export async function saveUnifiedConfigState(storage: AsyncKeyValueStorage, input: UnifiedConfigState): Promise<UnifiedSaveResult> {
  const parsed = parseUnifiedConfigState(input)
  if (!parsed.ok) return { status: 'rejected', reason: 'invalid-state', message: parsed.reason }
  const snapshot = JSON.stringify(parsed.value)
  return enqueueStorageOperation(storage, async (): Promise<UnifiedSaveResult> => {
    try {
      const existing = await storage.getItem(UNIFIED_CONFIG_STORAGE_KEY)
      if (existing !== null && !parseUnifiedConfigState(existing).ok) {
        return { status: 'failed', reason: 'protected-record', message: 'An invalid or future timer record is preserved for recovery' }
      }
      await storage.setItem(UNIFIED_CONFIG_STORAGE_KEY, snapshot)
      const readback = await storage.getItem(UNIFIED_CONFIG_STORAGE_KEY)
      if (readback !== snapshot || !parseUnifiedConfigState(readback).ok) return { status: 'failed', reason: 'readback-mismatch', message: 'Saved timer state did not match its readback' }
      return { status: 'saved', bytes: snapshot.length }
    } catch { return { status: 'failed', reason: 'storage-unavailable', message: 'Timer state could not be saved and verified' } }
  })
}

