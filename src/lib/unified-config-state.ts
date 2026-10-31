import type {
  AppTimerSettings, AvailabilityOverride, AvailabilityPolicy,
  SoundRef, TimerHapticsSettings, TimerMode, TimerV2State, UnifiedTimerProgram, WeeklyAvailabilityWindow,
  WorkingProgramState,
} from '../types'
import {
  MAX_AVAILABILITY_OVERRIDES, MAX_WEEKLY_WINDOWS, defaultAppTimerSettings, defaultPatternProgram,
  createProgramId, defaultTimerV2State, isSupportedSoundRef, normalizeSoundRef,
  cueSounds, soundRefKey,
} from './timerV2'
import { normalizeTimerHapticsSettings } from './haptic-profiles'
import { parseUnifiedTimerProgram, type LegacyWorkingRecovery } from './unified-timer'

export const UNIFIED_CONFIG_STATE_SCHEMA_VERSION = 3 as const
export const UNNAMED_DRAFT_KEY = 'draft:unnamed'

export interface UnifiedEditorOptions {
  enabledActionIds: string[]
}

export interface UnifiedTimerConfig {
  id: string
  name: string
  createdAt: number
  updatedAt: number
  program: UnifiedTimerProgram
  settings: AppTimerSettings
  showInRunningSelector: boolean
  editorOptions: UnifiedEditorOptions
}

export interface UnifiedTimerDraft {
  baseConfigId?: string
  name: string
  program: UnifiedTimerProgram
  settings: AppTimerSettings
  editorOptions: UnifiedEditorOptions
  updatedAt: number
  dirty: boolean
  sourcePreset?: { id: string; name: string; createdAt: number; deleted?: boolean }
}

export interface UnifiedLegacyRecovery {
  id: string
  sourceMode: TimerMode
  draft: UnifiedTimerDraft
}

export interface UnifiedConfigState {
  schemaVersion: 3
  selectedConfigId: string | null
  configs: UnifiedTimerConfig[]
  drafts: Record<string, UnifiedTimerDraft>
  legacyRecoveries: UnifiedLegacyRecovery[]
  soundLibrary: SoundRef[]
  legacyRuntimeMetadata?: { alarmModeEnabled: boolean }
}

export interface ConfigStateDependencies {
  now?: () => number
  createId?: () => string
}

export type ConfigStateCommand =
  | { type: 'edit'; changes: Partial<Pick<UnifiedTimerDraft, 'name' | 'program' | 'settings' | 'editorOptions'>>; now?: number }
  | { type: 'save'; now?: number }
  | { type: 'saveAs'; name: string; id?: string; now?: number }
  | { type: 'rename'; id: string; name: string; now?: number }
  | { type: 'duplicate'; id: string; newId?: string; now?: number }
  | { type: 'delete'; id: string; now?: number }
  | { type: 'setVisibility'; id: string; showInRunningSelector: boolean; now?: number }
  | { type: 'importConfig'; config: UnifiedTimerConfig; select?: boolean; now?: number }
  | { type: 'switch'; configId: string | null; choice: 'save' | 'keep' | 'discard' | 'cancel'; now?: number }
  | { type: 'setSoundLibrary'; sounds: SoundRef[] }

export interface ConfigCommandResult {
  state: UnifiedConfigState
  status: 'applied' | 'blocked'
  reason?: 'missing-config' | 'duplicate-id' | 'dirty-draft' | 'unnamed-needs-save-as' | 'invalid-name' | 'invalid-sounds'
  createdConfigId?: string
}

export type UnifiedConfigParseResult =
  | { ok: true; value: UnifiedConfigState }
  | { ok: false; raw: unknown; reason: string }

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const integer = (value: unknown, min: number, max: number): value is number => finite(value) && Number.isSafeInteger(value) && value >= min && value <= max
const idValid = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 200
const boolean = (value: unknown): value is boolean => typeof value === 'boolean'
const clone = <T>(value: T): T => typeof structuredClone === 'function' ? structuredClone(value) : JSON.parse(JSON.stringify(value)) as T
const hasOwn = (value: object, key: PropertyKey): boolean => Object.prototype.hasOwnProperty.call(value, key)
const getDraft = (drafts: Record<string, UnifiedTimerDraft>, key: string): UnifiedTimerDraft | undefined => hasOwn(drafts, key) ? drafts[key] : undefined
function setDraft(drafts: Record<string, UnifiedTimerDraft>, key: string, value: UnifiedTimerDraft): void {
  Object.defineProperty(drafts, key, { value, writable: true, enumerable: true, configurable: true })
}
const configIdValid = (value: unknown): value is string => idValid(value) && value !== UNNAMED_DRAFT_KEY

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(item => item === undefined ? 'null' : stableJson(item)).join(',')}]`
  if (record(value)) return `{${Object.keys(value).filter(key => value[key] !== undefined).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`
  return JSON.stringify(value)
}

function snapshotOf(value: Pick<UnifiedTimerConfig | UnifiedTimerDraft, 'name' | 'program' | 'settings' | 'editorOptions'>) {
  return { name: value.name, program: value.program, settings: value.settings, editorOptions: value.editorOptions }
}

export function isUnifiedDraftDirty(draft: UnifiedTimerDraft, config: UnifiedTimerConfig | undefined): boolean {
  return !config || stableJson(snapshotOf(draft)) !== stableJson(snapshotOf(config))
}

function draftKey(configId: string | undefined): string {
  return configId ?? UNNAMED_DRAFT_KEY
}

function recomputeDraft(draft: UnifiedTimerDraft, config: UnifiedTimerConfig | undefined): UnifiedTimerDraft {
  return { ...draft, dirty: isUnifiedDraftDirty(draft, config) }
}

function configName(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const name = value.trim()
  return name.length > 0 && [...name].length <= 80 ? name : null
}

function copyDraft(draft: UnifiedTimerDraft): UnifiedTimerDraft {
  return clone(draft)
}

function copyConfigAsDraft(config: UnifiedTimerConfig, now: number): UnifiedTimerDraft {
  return {
    baseConfigId: config.id,
    name: config.name,
    program: clone(config.program),
    settings: clone(config.settings),
    editorOptions: clone(config.editorOptions),
    updatedAt: now,
    dirty: false,
  }
}

export function createUnifiedDefaultProgram(createId: () => string = () => 'default-id'): UnifiedTimerProgram {
  const legacy = defaultPatternProgram()
  legacy.tracks = legacy.tracks.map((track, index) => ({ ...track, id: createId() || `default-track-${index + 1}` }))
  const parsed = parseUnifiedTimerProgram({
    schemaVersion: 4,
    mode: 'unified',
    steps: [{
      id: createId() || 'default-step',
      label: legacy.label,
      labelIsCustom: false,
      durationSeconds: legacy.mainDurationSeconds ?? legacy.mainMinutes * 60,
      endCue: clone(legacy.mainCue),
      endAlarmEnabled: false,
      subBellsEnabled: legacy.subBellsEnabled,
      subBellTracks: legacy.tracks.map(track => ({
        id: track.id, label: track.label, enabled: track.enabled, color: track.color,
        showOnWatchFace: track.showOnWatchFace !== false, cadenceSeconds: track.cadenceSeconds ?? track.cadenceMinutes * 60,
        repeatEnabled: track.repeatEnabled !== false, selectedOffsetsSeconds: track.selectedOffsetsSeconds ?? track.selectedOffsetsMinutes.map(value => value * 60),
        sound: clone(track.sound), volume: track.volume, ...(track.sounds ? { sounds: clone(track.sounds) } : {}),
        ...(track.soundMode ? { soundMode: track.soundMode } : {}), ...(track.hapticOverride ? { hapticOverride: clone(track.hapticOverride) } : {}),
      })),
    }],
    alignment: clone(legacy.alignment),
    completionCue: null,
    runPolicy: clone(legacy.runPolicy),
  })
  if (!parsed.ok) throw new Error(parsed.reason)
  return parsed.value
}

export function createDefaultUnifiedConfigState(deps: ConfigStateDependencies = {}): UnifiedConfigState {
  const now = deps.now?.() ?? Date.now()
  const createId = deps.createId ?? createProgramId
  const generatedId = createId()
  const id = generatedId === UNNAMED_DRAFT_KEY ? createProgramId() : generatedId
  const settings = clone(defaultAppTimerSettings())
  settings.availability.weeklyWindows = settings.availability.weeklyWindows.map((window, index) => ({ ...window, id: `default-window-${index + 1}` }))
  const program = createUnifiedDefaultProgram(createId)
  const config: UnifiedTimerConfig = {
    id, name: 'Timer', createdAt: now, updatedAt: now, program, settings,
    showInRunningSelector: true, editorOptions: { enabledActionIds: [] },
  }
  return {
    schemaVersion: UNIFIED_CONFIG_STATE_SCHEMA_VERSION,
    selectedConfigId: id,
    configs: [config],
    drafts: { [id]: copyDraft(copyConfigAsDraft(config, now)) },
    legacyRecoveries: [],
    soundLibrary: [],
  }
}

function validHaptics(value: unknown): value is TimerHapticsSettings {
  if (!record(value) || !boolean(value.enabled)) return false
  const validProfile = (profile: unknown) => record(profile)
    && (profile.pattern === 'single' || profile.pattern === 'double' || profile.pattern === 'triple')
    && (profile.strength === 'gentle' || profile.strength === 'balanced' || profile.strength === 'strong')
  return validProfile(value.main) && validProfile(value.subBell) && validProfile(value.alarm)
}

function parseAvailability(value: unknown, createId: () => string, allowMissing = false): AvailabilityPolicy | null {
  if (value === undefined && allowMissing) {
    const defaults = defaultAppTimerSettings().availability
    return { ...clone(defaults), weeklyWindows: defaults.weeklyWindows.map((window, index) => ({ ...window, id: createId() || `availability-${index + 1}` })) }
  }
  if (!record(value)) return null
  const enabled = value.enabled === undefined && allowMissing ? false : value.enabled
  if (!boolean(enabled)) return null
  const rawWindows = value.weeklyWindows === undefined && allowMissing ? [] : value.weeklyWindows
  const rawOverrides = value.overrides === undefined && allowMissing ? [] : value.overrides
  if (!Array.isArray(rawWindows) || rawWindows.length > MAX_WEEKLY_WINDOWS || !Array.isArray(rawOverrides) || rawOverrides.length > MAX_AVAILABILITY_OVERRIDES) return null
  const windows: WeeklyAvailabilityWindow[] = []
  for (let index = 0; index < rawWindows.length; index += 1) {
    const window = rawWindows[index]
    if (!record(window) || (allowMissing ? window.id !== undefined && !idValid(window.id) : !idValid(window.id)) || !boolean(window.enabled)
      || !integer(window.startMinutes, 0, 1_439) || !integer(window.endMinutes, 0, 1_439)
      || !integer(window.days, 0, 0b1111111) || (window.behavior !== undefined && window.behavior !== 'active' && window.behavior !== 'mute')) return null
    windows.push({
      id: window.id as string | undefined ?? createId(),
      enabled: window.enabled,
      startMinutes: window.startMinutes,
      endMinutes: window.endMinutes,
      days: window.days,
      ...(window.behavior ? { behavior: window.behavior } : {}),
    })
  }
  const overrides: AvailabilityOverride[] = []
  for (const override of rawOverrides) {
    if (!record(override) || (allowMissing ? override.id !== undefined && !idValid(override.id) : !idValid(override.id))
      || !finite(override.startAt) || !finite(override.endAt) || override.endAt <= override.startAt
      || (override.behavior !== 'active' && override.behavior !== 'mute') || override.source !== 'calendar'
      || (override.sourceId !== undefined && !idValid(override.sourceId))) return null
    overrides.push({
      id: override.id as string | undefined ?? createId(),
      startAt: override.startAt, endAt: override.endAt, behavior: override.behavior, source: 'calendar',
      ...(override.sourceId ? { sourceId: override.sourceId } : {}),
    })
  }
  const ids = new Set<string>()
  if ([...windows, ...overrides].some(entry => ids.has(entry.id) || !ids.add(entry.id))) return null
  return { enabled, weeklyWindows: windows, overrides }
}

export function parseUnifiedTimerSettings(input: unknown): AppTimerSettings | null {
  if (!record(input)
    || !finite(input.masterVolume) || input.masterVolume < 0 || input.masterVolume > 1
    || !boolean(input.advancedModeEnabled) || !boolean(input.secondPrecisionEnabled)
    || !isSupportedSoundRef(input.alarmSound, false)
    || !finite(input.alarmVolume) || input.alarmVolume < 0 || input.alarmVolume > 1
    || !validHaptics(input.haptics) || !boolean(input.notificationsEnabled) || !boolean(input.liveCountdownEnabled)
    || !boolean(input.muteDuringCallsEnabled) || !boolean(input.focusAutomationEnabled)
    || !integer(input.alarmDurationSeconds, 5, 3_600)) return null
  const availability = parseAvailability(input.availability, () => '', false)
  if (!availability) return null
  return clone(input) as unknown as AppTimerSettings
}

/** Legacy snapshot adapter permits fields omitted by older app versions, but rejects malformed present values. */
export function convertLegacyTimerSettings(input: unknown, createId: () => string = () => 'legacy-window'): AppTimerSettings | null {
  if (input === undefined || input === null) return null
  if (!record(input)) return null
  const defaults = defaultAppTimerSettings()
  const masterVolume = input.masterVolume === undefined ? defaults.masterVolume : input.masterVolume
  const alarmVolume = input.alarmVolume === undefined ? defaults.alarmVolume : input.alarmVolume
  if (!finite(masterVolume) || masterVolume < 0 || masterVolume > 1 || !finite(alarmVolume) || alarmVolume < 0 || alarmVolume > 1) return null
  for (const key of ['advancedModeEnabled', 'secondPrecisionEnabled', 'notificationsEnabled', 'liveCountdownEnabled', 'muteDuringCallsEnabled', 'focusAutomationEnabled'] as const) {
    if (input[key] !== undefined && !boolean(input[key])) return null
  }
  const alarmSoundInput = input.alarmSound === undefined ? defaults.alarmSound : input.alarmSound
  if (!isSupportedSoundRef(alarmSoundInput, true)) return null
  const alarmDurationSeconds = input.alarmDurationSeconds === undefined ? defaults.alarmDurationSeconds : input.alarmDurationSeconds
  if (!integer(alarmDurationSeconds, 5, 3_600)) return null
  const haptics = input.haptics === undefined ? defaults.haptics : input.haptics
  if (!validHaptics(haptics)) return null
  const legacy = input as Record<string, unknown>
  const availabilityInput = legacy.availability ?? (legacy.activeHoursEnabled === undefined && legacy.activeHoursStart === undefined && legacy.activeHoursEnd === undefined && legacy.activeHoursDays === undefined
    ? undefined
    : {
        enabled: legacy.activeHoursEnabled,
        weeklyWindows: [{
          id: undefined, enabled: true,
          startMinutes: legacy.activeHoursStart ?? 8 * 60,
          endMinutes: legacy.activeHoursEnd ?? 22 * 60,
          days: legacy.activeHoursDays ?? 0b1111111,
        }],
        overrides: [],
      })
  const availability = parseAvailability(availabilityInput, createId, true)
  if (!availability) return null
  return {
    masterVolume,
    advancedModeEnabled: input.advancedModeEnabled === true,
    secondPrecisionEnabled: input.secondPrecisionEnabled === true,
    alarmSound: normalizeSoundRef(alarmSoundInput, defaults.alarmSound),
    alarmVolume,
    haptics: normalizeTimerHapticsSettings(haptics),
    notificationsEnabled: input.notificationsEnabled !== false,
    liveCountdownEnabled: input.liveCountdownEnabled === true,
    muteDuringCallsEnabled: input.muteDuringCallsEnabled !== false,
    availability,
    focusAutomationEnabled: input.focusAutomationEnabled === true,
    alarmDurationSeconds,
  }
}

function validEditorOptions(value: unknown): value is UnifiedEditorOptions {
  return record(value) && Array.isArray(value.enabledActionIds)
    && value.enabledActionIds.every(id => typeof id === 'string' && id.length > 0 && id.length <= 120)
    && new Set(value.enabledActionIds).size === value.enabledActionIds.length
}

function validSourcePreset(value: unknown): value is UnifiedTimerDraft['sourcePreset'] {
  return value === undefined || (record(value) && idValid(value.id) && typeof value.name === 'string'
    && value.name.length <= 80 && finite(value.createdAt) && (value.deleted === undefined || boolean(value.deleted)))
}

function parseDraft(value: unknown): UnifiedTimerDraft | null {
  if (!record(value) || !configName(value.name) || !finite(value.updatedAt)
    || (value.baseConfigId !== undefined && !idValid(value.baseConfigId))
    || !validEditorOptions(value.editorOptions) || typeof value.dirty !== 'boolean'
    || !validSourcePreset(value.sourcePreset)) return null
  const program = parseUnifiedTimerProgram(value.program)
  const settings = parseUnifiedTimerSettings(value.settings)
  if (!program.ok || !settings) return null
  return {
    ...(value.baseConfigId ? { baseConfigId: value.baseConfigId } : {}),
    name: configName(value.name)!,
    program: program.value,
    settings,
    editorOptions: clone(value.editorOptions),
    updatedAt: value.updatedAt,
    dirty: value.dirty,
    ...(value.sourcePreset ? { sourcePreset: clone(value.sourcePreset) } : {}),
  }
}

export function parseUnifiedConfigState(input: unknown): UnifiedConfigParseResult {
  let raw = input
  if (typeof input === 'string') {
    try { raw = JSON.parse(input) as unknown } catch { return { ok: false, raw: input, reason: 'State is not valid JSON' } }
  }
  const fail = (reason: string): UnifiedConfigParseResult => ({ ok: false, raw: input, reason })
  if (!record(raw)) return fail('State must be an object')
  if (raw.schemaVersion !== UNIFIED_CONFIG_STATE_SCHEMA_VERSION) return fail(`Unsupported state schema version: ${String(raw.schemaVersion)}`)
  if (raw.selectedConfigId !== null && !idValid(raw.selectedConfigId)) return fail('Invalid selected config id')
  if (!Array.isArray(raw.configs) || !record(raw.drafts) || !Array.isArray(raw.legacyRecoveries) || !Array.isArray(raw.soundLibrary)) return fail('Invalid state collections')
  const configIds = new Set<string>()
  const configs: UnifiedTimerConfig[] = []
  for (const value of raw.configs) {
    if (!record(value) || !configIdValid(value.id) || configIds.has(value.id) || !configName(value.name)
      || !finite(value.createdAt) || !finite(value.updatedAt) || !boolean(value.showInRunningSelector)
      || !validEditorOptions(value.editorOptions)) return fail('Invalid saved config')
    const program = parseUnifiedTimerProgram(value.program)
    const settings = parseUnifiedTimerSettings(value.settings)
    if (!program.ok || !settings) return fail('Invalid saved config program or settings')
    configIds.add(value.id)
    configs.push({ id: value.id, name: configName(value.name)!, createdAt: value.createdAt, updatedAt: value.updatedAt, program: program.value, settings, showInRunningSelector: value.showInRunningSelector, editorOptions: clone(value.editorOptions) })
  }
  if (raw.selectedConfigId !== null && !configIds.has(raw.selectedConfigId)) return fail('Selected config does not exist')
  const drafts: Record<string, UnifiedTimerDraft> = {}
  for (const [key, value] of Object.entries(raw.drafts)) {
    if (key !== UNNAMED_DRAFT_KEY && !configIds.has(key)) return fail('Draft references a missing config')
    const draft = parseDraft(value)
    if (!draft || draftKey(draft.baseConfigId) !== key) return fail('Invalid saved draft')
    const config = configs.find(item => item.id === draft.baseConfigId)
    if (draft.baseConfigId && !config) return fail('Draft base config does not exist')
    if (draft.dirty !== isUnifiedDraftDirty(draft, config)) return fail('Draft dirty state does not match its snapshot')
    setDraft(drafts, key, draft)
  }
  if (raw.selectedConfigId !== null && !getDraft(drafts, raw.selectedConfigId)) return fail('Selected config draft is missing')
  const legacyRecoveries: UnifiedLegacyRecovery[] = []
  for (const value of raw.legacyRecoveries) {
    if (!record(value) || !idValid(value.id) || (value.sourceMode !== 'pattern' && value.sourceMode !== 'sequence')) return fail('Invalid legacy recovery')
    const draft = parseDraft(value.draft)
    if (!draft) return fail('Invalid legacy recovery draft')
    legacyRecoveries.push({ id: value.id, sourceMode: value.sourceMode, draft })
  }
  if (raw.soundLibrary.some(sound => !isSupportedSoundRef(sound, false) || !record(sound) || sound.kind === 'builtin')) return fail('Invalid shared sound library')
  if (raw.legacyRuntimeMetadata !== undefined && (!record(raw.legacyRuntimeMetadata) || !boolean(raw.legacyRuntimeMetadata.alarmModeEnabled))) return fail('Invalid legacy runtime metadata')
  return {
    ok: true,
    value: {
      ...clone(raw),
      schemaVersion: UNIFIED_CONFIG_STATE_SCHEMA_VERSION,
      selectedConfigId: raw.selectedConfigId as string | null,
      configs, drafts, legacyRecoveries, soundLibrary: clone(raw.soundLibrary) as SoundRef[],
    } as UnifiedConfigState,
  }
}

function result(state: UnifiedConfigState, status: 'applied' | 'blocked', reason?: ConfigCommandResult['reason'], createdConfigId?: string): ConfigCommandResult {
  return { state, status, ...(reason ? { reason } : {}), ...(createdConfigId ? { createdConfigId } : {}) }
}

export function reduceUnifiedConfigCommand(
  input: UnifiedConfigState,
  command: ConfigStateCommand,
  deps: ConfigStateDependencies = {},
): ConfigCommandResult {
  const now = command.type === 'setSoundLibrary' ? deps.now?.() ?? Date.now() : command.now ?? deps.now?.() ?? Date.now()
  const state = clone(input)
  const currentConfig = state.configs.find(config => config.id === state.selectedConfigId)
  const currentKey = draftKey(state.selectedConfigId ?? undefined)
  let draft = getDraft(state.drafts, currentKey)
  if (!draft && command.type !== 'setSoundLibrary') {
    if (command.type === 'switch' && command.configId === null) {
      const defaults = createDefaultUnifiedConfigState({ now: () => now, createId: deps.createId })
      const unnamed = copyConfigAsDraft(defaults.configs[0], now)
      delete unnamed.baseConfigId
      setDraft(state.drafts, UNNAMED_DRAFT_KEY, { ...unnamed, dirty: true })
      draft = getDraft(state.drafts, UNNAMED_DRAFT_KEY)
    } else return result(input, 'blocked', 'missing-config')
  }
  if (command.type === 'setSoundLibrary') {
    if (command.sounds.some(sound => !isSupportedSoundRef(sound, false) || sound.kind === 'builtin')) return result(input, 'blocked', 'invalid-sounds')
    const all = [...state.soundLibrary, ...command.sounds]
    const seen = new Set<string>()
    const unique = all.filter(sound => isSupportedSoundRef(sound, false) && sound.kind !== 'builtin' && !seen.has(sound.kind + ':' + sound.uri) && !!seen.add(sound.kind + ':' + sound.uri))
    state.soundLibrary = clone(unique)
    return result(state, 'applied')
  }
  if (command.type === 'edit') {
    const updated: UnifiedTimerDraft = { ...draft!, ...clone(command.changes), updatedAt: now }
    const parse = parseUnifiedTimerProgram(updated.program)
    const settings = parseUnifiedTimerSettings(updated.settings)
    if (!parse.ok || !settings || !configName(updated.name) || !validEditorOptions(updated.editorOptions)) return result(input, 'blocked', 'invalid-name')
    updated.program = parse.value
    updated.settings = settings
    setDraft(state.drafts, currentKey, recomputeDraft(updated, currentConfig))
    return result(state, 'applied')
  }
  if (command.type === 'save') {
    if (!currentConfig || !draft?.baseConfigId) return result(input, 'blocked', 'unnamed-needs-save-as')
    const index = state.configs.findIndex(config => config.id === currentConfig.id)
    const saved: UnifiedTimerConfig = { ...currentConfig, ...snapshotOf(draft), updatedAt: now }
    state.configs[index] = clone(saved)
    setDraft(state.drafts, currentKey, { ...copyDraft(draft), baseConfigId: saved.id, updatedAt: now, dirty: false })
    return result(state, 'applied')
  }
  if (command.type === 'saveAs') {
    const name = configName(command.name)
    if (!name) return result(input, 'blocked', 'invalid-name')
    const id = command.id ?? deps.createId?.()
    if (!configIdValid(id)) return result(input, 'blocked', 'duplicate-id')
    if (state.configs.some(config => config.id === id)) return result(input, 'blocked', 'duplicate-id')
    const saved: UnifiedTimerConfig = {
      id, name, createdAt: now, updatedAt: now,
      program: clone(draft!.program), settings: clone(draft!.settings), editorOptions: clone(draft!.editorOptions),
      showInRunningSelector: true,
    }
    state.configs.push(saved)
    setDraft(state.drafts, id, { ...copyConfigAsDraft(saved, now), dirty: false })
    state.selectedConfigId = id
    return result(state, 'applied', undefined, id)
  }
  if (command.type === 'rename') {
    const name = configName(command.name)
    const target = state.configs.find(config => config.id === command.id)
    if (!target) return result(input, 'blocked', 'missing-config')
    if (!name) return result(input, 'blocked', 'invalid-name')
    target.name = name
    target.updatedAt = now
    const targetDraft = getDraft(state.drafts, target.id)
    if (targetDraft && !targetDraft.dirty) setDraft(state.drafts, target.id, { ...targetDraft, name, updatedAt: now, dirty: false })
    return result(state, 'applied')
  }
  if (command.type === 'setVisibility') {
    const target = state.configs.find(config => config.id === command.id)
    if (!target) return result(input, 'blocked', 'missing-config')
    target.showInRunningSelector = command.showInRunningSelector
    target.updatedAt = now
    return result(state, 'applied')
  }
  if (command.type === 'importConfig') {
    const config = command.config
    const parsedProgram = parseUnifiedTimerProgram(config.program)
    const parsedSettings = parseUnifiedTimerSettings(config.settings)
    if (!configIdValid(config.id) || state.configs.some(item => item.id === config.id)) return result(input, 'blocked', 'duplicate-id')
    if (!configName(config.name) || !finite(config.createdAt) || !finite(config.updatedAt)
      || typeof config.showInRunningSelector !== 'boolean' || !validEditorOptions(config.editorOptions)
      || !parsedProgram.ok || !parsedSettings) return result(input, 'blocked', 'invalid-name')
    const imported = { ...clone(config), name: configName(config.name)!, program: parsedProgram.value, settings: parsedSettings }
    state.configs.push(imported)
    setDraft(state.drafts, imported.id, copyConfigAsDraft(imported, now))
    const importedSounds: SoundRef[] = []
    imported.program.steps.forEach(step => {
      importedSounds.push(...cueSounds(step.endCue))
      step.subBellTracks.forEach(track => importedSounds.push(...cueSounds(track)))
    })
    if (imported.program.completionCue) importedSounds.push(...cueSounds(imported.program.completionCue))
    importedSounds.push(clone(imported.settings.alarmSound))
    const library = [...state.soundLibrary]
    const keys = new Set(library.map(soundRefKey))
    importedSounds.forEach(sound => {
      if ((sound.kind === 'android' || sound.kind === 'document') && !keys.has(soundRefKey(sound))) {
        keys.add(soundRefKey(sound))
        library.push(clone(sound))
      }
    })
    state.soundLibrary = library
    if (command.select === true) state.selectedConfigId = imported.id
    return result(state, 'applied', undefined, imported.id)
  }
  if (command.type === 'duplicate') {
    const source = state.configs.find(config => config.id === command.id)
    if (!source) return result(input, 'blocked', 'missing-config')
    const id = command.newId ?? deps.createId?.()
    if (!configIdValid(id) || state.configs.some(config => config.id === id)) return result(input, 'blocked', 'duplicate-id')
    const copyName = [...`${source.name} copy`].slice(0, 80).join('')
    const copyConfig: UnifiedTimerConfig = { ...clone(source), id, name: copyName, createdAt: now, updatedAt: now }
    state.configs.push(copyConfig)
    setDraft(state.drafts, id, { ...copyConfigAsDraft(copyConfig, now), dirty: false })
    return result(state, 'applied', undefined, id)
  }
  if (command.type === 'delete') {
    const target = state.configs.find(config => config.id === command.id)
    if (!target) return result(input, 'blocked', 'missing-config')
    const targetDraft = getDraft(state.drafts, target.id)
    if (targetDraft?.dirty) return result(input, 'blocked', 'dirty-draft')
    state.configs = state.configs.filter(config => config.id !== target.id)
    delete state.drafts[target.id]
    if (state.selectedConfigId === target.id) {
      state.selectedConfigId = null
      if (!getDraft(state.drafts, UNNAMED_DRAFT_KEY)) {
        const unnamed = copyConfigAsDraft(target, now)
        delete unnamed.baseConfigId
        setDraft(state.drafts, UNNAMED_DRAFT_KEY, { ...unnamed, dirty: true })
      }
    }
    return result(state, 'applied')
  }
  if (command.type === 'switch') {
    if (command.configId !== null && !state.configs.some(config => config.id === command.configId)) return result(input, 'blocked', 'missing-config')
    if (command.configId === state.selectedConfigId || command.choice === 'cancel') return result(input, 'applied')
    if (draft?.dirty) {
      if (command.choice === 'save') {
        if (!currentConfig || !draft.baseConfigId) return result(input, 'blocked', 'unnamed-needs-save-as')
        const saved: UnifiedTimerConfig = { ...currentConfig, ...snapshotOf(draft), updatedAt: now }
        state.configs = state.configs.map(config => config.id === currentConfig.id ? clone(saved) : config)
        setDraft(state.drafts, currentKey, { ...copyDraft(draft), updatedAt: now, dirty: false })
      } else if (command.choice === 'discard') {
        if (currentConfig) setDraft(state.drafts, currentKey, copyConfigAsDraft(currentConfig, now))
        else delete state.drafts[UNNAMED_DRAFT_KEY]
      } else if (command.choice === 'keep') {
        setDraft(state.drafts, currentKey, { ...copyDraft(draft), updatedAt: now, dirty: true })
      }
    }
    state.selectedConfigId = command.configId
    if (command.configId && !getDraft(state.drafts, command.configId)) {
      const target = state.configs.find(config => config.id === command.configId)!
      setDraft(state.drafts, command.configId, copyConfigAsDraft(target, now))
    }
    if (command.configId === null && !getDraft(state.drafts, UNNAMED_DRAFT_KEY)) {
      const defaults = createDefaultUnifiedConfigState({ now: () => now, createId: deps.createId })
      const unnamed = copyConfigAsDraft(defaults.configs[0], now)
      delete unnamed.baseConfigId
      setDraft(state.drafts, UNNAMED_DRAFT_KEY, { ...unnamed, name: 'New timer', dirty: true })
    }
    return result(state, 'applied')
  }
  return result(input, 'blocked', 'missing-config')
}

export function makeLegacyRecoveryDraft(recovery: LegacyWorkingRecovery, settings: AppTimerSettings, now: number): UnifiedLegacyRecovery {
  const name = recovery.program.steps[0]?.label || `Recovered ${recovery.sourceMode}`
  return {
    id: `legacy-working-${recovery.sourceMode}`,
    sourceMode: recovery.sourceMode,
    draft: {
      name, program: clone(recovery.program), settings: clone(settings), editorOptions: { enabledActionIds: [] },
      updatedAt: now, dirty: true,
    },
  }
}

export function importedSoundsFromTimerV2State(state: TimerV2State): SoundRef[] {
  return clone(state.soundLibrary)
}

export type { LegacyWorkingRecovery }
