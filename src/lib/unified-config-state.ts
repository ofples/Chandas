import type {
  AppTimerSettings, AvailabilityOverride, AvailabilityPolicy,
  SoundRef, TimerHapticsSettings, TimerMode, TimerV2State, UnifiedTimerProgram, WeeklyAvailabilityWindow,
  WorkingProgramState, RunningControlId,
} from '../types'
import {
  MAX_AVAILABILITY_OVERRIDES, MAX_WEEKLY_WINDOWS, defaultAppTimerSettings, defaultPatternProgram,
  createProgramId, defaultTimerV2State, isSupportedSoundRef, normalizeSoundRef,
  cueSounds, soundRefKey,
} from './timerV2'
import { normalizeTimerHapticsSettings } from './haptic-profiles'
import { enabledRunningControls, RUNNING_CONTROL_DEFINITIONS } from './running-controls'
import { defaultUnifiedStepLabel, parseUnifiedTimerProgram, type LegacyWorkingRecovery } from './unified-timer'

export const UNIFIED_CONFIG_STATE_SCHEMA_VERSION = 3 as const
export const UNNAMED_DRAFT_KEY = 'draft:unnamed'

export interface UnifiedEditorOptions {
  enabledActionIds: string[]
  configurationNameIsCustom?: boolean
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

export interface AlarmDefaults { sound: SoundRef; durationSeconds: number }

export function effectiveAlarmSettings(program: UnifiedTimerProgram, settings: AppTimerSettings, defaults?: AlarmDefaults) {
  const factory = defaultAppTimerSettings()
  const alarmSound = program.alarmOverrides?.sound
  const alarmDuration = program.alarmOverrides?.durationSeconds
  return {
    alarmSound: alarmSound ?? (alarmSound === undefined && soundRefKey(settings.alarmSound) !== soundRefKey(factory.alarmSound) ? settings.alarmSound : defaults?.sound ?? settings.alarmSound),
    alarmDurationSeconds: alarmDuration ?? (alarmDuration === undefined && settings.alarmDurationSeconds !== factory.alarmDurationSeconds ? settings.alarmDurationSeconds : defaults?.durationSeconds ?? settings.alarmDurationSeconds),
  }
}

export interface UnifiedConfigState {
  schemaVersion: 3
  /** Absent on existing installations; the automatic tour is only for fresh installs. */
  onboardingStatus?: 'pending' | 'dismissed' | 'completed'
  selectedConfigId: string | null
  configs: UnifiedTimerConfig[]
  drafts: Record<string, UnifiedTimerDraft>
  legacyRecoveries: UnifiedLegacyRecovery[]
  legacyRecoveryNoticeDismissed?: boolean
  soundLibrary: SoundRef[]
  /** Device-wide schedule shared by every timer and runtime session. */
  globalAvailability: AvailabilityPolicy
  globalRunningControlIds?: RunningControlId[]
  globalScrubbingEnabled?: boolean
  globalSecondPrecision?: boolean
  alarmDefaults?: AlarmDefaults
  legacyRuntimeMetadata?: { alarmModeEnabled: boolean }
}

export interface ConfigStateDependencies {
  now?: () => number
  createId?: () => string
}

export type ConfigStateCommand =
  | { type: 'finishOnboarding'; completed: boolean }
  | { type: 'edit'; configId?: string | null; changes: Partial<Pick<UnifiedTimerDraft, 'name' | 'program' | 'settings' | 'editorOptions'>>; now?: number }
  | { type: 'save'; now?: number }
  | { type: 'saveAs'; name: string; id?: string; now?: number }
  | { type: 'discardDraft'; configId: string | null; now?: number }
  | { type: 'rename'; id: string; name: string; now?: number }
  | { type: 'duplicate'; id: string; newId?: string; now?: number }
  | { type: 'moveConfig'; id: string; targetId: string }
  | { type: 'delete'; id: string; discardDraft?: boolean; now?: number }
  | { type: 'setVisibility'; id: string; showInRunningSelector: boolean; now?: number }
  | { type: 'importConfig'; config: UnifiedTimerConfig; select?: boolean; now?: number }
  | { type: 'switch'; configId: string | null; choice: 'save' | 'save-as' | 'keep' | 'discard' | 'cancel'; fresh?: boolean; saveAsName?: string; saveAsId?: string; now?: number }
  | { type: 'setSoundLibrary'; sounds: SoundRef[] }
  | { type: 'setAlarmDefaults'; changes: Partial<AlarmDefaults> }
  | { type: 'setGlobalAvailability'; availability: AvailabilityPolicy }
  | { type: 'setGlobalRunningControl'; id: RunningControlId; enabled: boolean }
  | { type: 'setGlobalSecondPrecision'; enabled: boolean }
  | { type: 'dismissLegacyRecoveryNotice' }
  | { type: 'discardLegacyRecovery'; id: string }

export interface ConfigCommandResult {
  state: UnifiedConfigState
  status: 'applied' | 'blocked'
  reason?: 'missing-config' | 'duplicate-id' | 'dirty-draft' | 'unnamed-needs-save-as' | 'invalid-name' | 'invalid-sounds' | 'invalid-availability'
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

export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(item => item === undefined ? 'null' : stableJson(item)).join(',')}]`
  if (record(value)) return `{${Object.keys(value).filter(key => value[key] !== undefined).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`
  return JSON.stringify(value)
}

function soundsUsedByDraft(draft: UnifiedTimerDraft): SoundRef[] {
  const sounds: SoundRef[] = []
  draft.program.steps.forEach(step => {
    sounds.push(...cueSounds(step.endCue))
    step.subBellTracks.forEach(track => sounds.push(...cueSounds(track)))
  })
  if (draft.program.completionCue) sounds.push(...cueSounds(draft.program.completionCue))
  sounds.push(draft.settings.alarmSound)
  if (draft.program.alarmOverrides?.sound) sounds.push(draft.program.alarmOverrides.sound)
  return sounds.filter(sound => sound.kind !== 'builtin')
}

function mergeSharedSounds(current: SoundRef[], added: SoundRef[]): SoundRef[] {
  const merged = clone(current)
  const seen = new Set(merged.map(soundRefKey))
  for (const sound of added) {
    const key = soundRefKey(sound)
    if (!seen.has(key)) {
      seen.add(key)
      merged.push(clone(sound))
    }
  }
  return merged
}

function snapshotOf(value: Pick<UnifiedTimerConfig | UnifiedTimerDraft, 'name' | 'program' | 'settings' | 'editorOptions'>) {
  return { name: value.name, program: value.program, settings: timerSettingsWithoutGlobalSchedule(value.settings), editorOptions: value.editorOptions }
}

function timerSettingsWithoutGlobalSchedule(settings: AppTimerSettings): AppTimerSettings {
  return { ...clone(settings), availability: { enabled: false, weeklyWindows: [], overrides: [] } }
}

export function isUnifiedDraftDirty(draft: UnifiedTimerDraft, config: UnifiedTimerConfig | undefined): boolean {
  if (!config) return true
  const comparable = (value: UnifiedTimerConfig | UnifiedTimerDraft) => {
    const snapshot = snapshotOf(value)
    const { availability: _globalSchedule, ...settings } = snapshot.settings
    return { ...snapshot, settings }
  }
  return stableJson(comparable(draft)) !== stableJson(comparable(config))
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

function nameSingleStep(program: UnifiedTimerProgram, name: string, isCustom = true): UnifiedTimerProgram {
  if (program.steps.length !== 1) return program
  return { ...program, steps: [{ ...program.steps[0], label: [...name].slice(0, 60).join(''), labelIsCustom: isCustom }] }
}

function copyDraft(draft: UnifiedTimerDraft): UnifiedTimerDraft {
  return clone(draft)
}

function copyConfigAsDraft(config: UnifiedTimerConfig, now: number): UnifiedTimerDraft {
  return {
    baseConfigId: config.id,
    name: config.name,
    program: clone(config.program),
    settings: timerSettingsWithoutGlobalSchedule(config.settings),
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
      label: defaultUnifiedStepLabel(legacy.mainDurationSeconds ?? legacy.mainMinutes * 60),
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
    globalAvailability: clone(settings.availability),
  }
}

/** A new installation opens a working timer; saving is an explicit library action. */
export function createUnsavedUnifiedConfigState(deps: ConfigStateDependencies = {}): UnifiedConfigState {
  const state = createDefaultUnifiedConfigState(deps)
  const initial = copyConfigAsDraft(state.configs[0], deps.now?.() ?? Date.now())
  delete initial.baseConfigId
  initial.name = defaultUnifiedTimerName(initial.program.steps[0].durationSeconds)
  initial.program.steps[0].label = initial.name
  initial.editorOptions.configurationNameIsCustom = false
  initial.dirty = true
  state.configs = []
  state.selectedConfigId = null
  state.drafts = { [UNNAMED_DRAFT_KEY]: initial }
  return state
}

/** An unnamed working copy can be saved even when its setup is still pristine. */
export function hasUnifiedDraftChanges(draft: UnifiedTimerDraft): boolean {
  if (draft.baseConfigId) return draft.dirty
  let nextId = 0
  const defaults = createUnsavedUnifiedConfigState({ now: () => 0, createId: () => `baseline-${++nextId}` }).drafts[UNNAMED_DRAFT_KEY]!
  const comparable = (value: UnifiedTimerDraft) => ({
    ...snapshotOf(value),
    program: {
      ...value.program,
      steps: value.program.steps.map(({ id: _stepId, subBellTracks, ...step }) => ({
        ...step,
        subBellTracks: subBellTracks.map(({ id: _trackId, ...track }) => track),
      })),
    },
  })
  return stableJson(comparable(draft)) !== stableJson(comparable(defaults))
}

export function defaultUnifiedTimerName(durationSeconds: number): string {
  return defaultUnifiedStepLabel(durationSeconds).replace(/ step$/, ' timer')
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
    || (input.runningControlIds !== undefined && (!Array.isArray(input.runningControlIds) || input.runningControlIds.some(id => !['restart', 'clock', 'alarm', 'stepAlarm', 'focus', 'sound'].includes(String(id))) || new Set(input.runningControlIds).size !== input.runningControlIds.length))
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
  if (input.runningControlIds !== undefined && (!Array.isArray(input.runningControlIds) || input.runningControlIds.some(id => !['restart', 'clock', 'alarm', 'stepAlarm', 'focus', 'sound'].includes(String(id))) || new Set(input.runningControlIds).size !== input.runningControlIds.length)) return null
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
    ...(Array.isArray(input.runningControlIds) && input.runningControlIds.every(id => ['restart', 'clock', 'alarm', 'stepAlarm', 'focus', 'sound'].includes(String(id))) ? { runningControlIds: [...new Set(input.runningControlIds)] as AppTimerSettings['runningControlIds'] } : {}),
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
    && (value.configurationNameIsCustom === undefined || typeof value.configurationNameIsCustom === 'boolean')
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
  const legacySchedule = raw.selectedConfigId !== null
    ? getDraft(drafts, raw.selectedConfigId)?.settings.availability
    : getDraft(drafts, UNNAMED_DRAFT_KEY)?.settings.availability ?? configs[0]?.settings.availability
  const globalAvailability = raw.globalAvailability === undefined
    ? clone(legacySchedule ?? defaultAppTimerSettings().availability)
    : parseAvailability(raw.globalAvailability, () => '', false)
  if (!globalAvailability) return fail('Invalid global availability policy')
  const legacyControls = getDraft(drafts, draftKey(raw.selectedConfigId ?? undefined))?.settings ?? defaultAppTimerSettings()
  if (raw.globalRunningControlIds !== undefined && !validGlobalRunningControls(raw.globalRunningControlIds)) return fail('Invalid global running controls')
  if (raw.globalScrubbingEnabled !== undefined && !boolean(raw.globalScrubbingEnabled)) return fail('Invalid global scrubbing preference')
  const globalRunningControlIds = (raw.globalRunningControlIds ?? [...enabledRunningControls(legacyControls)]).filter(id => id !== 'scrub')
  if (raw.globalSecondPrecision !== undefined && !boolean(raw.globalSecondPrecision)) return fail('Invalid global seconds preference')
  const globalSecondPrecision = raw.globalSecondPrecision ?? legacyControls.secondPrecisionEnabled
  if (raw.legacyRecoveryNoticeDismissed !== undefined && !boolean(raw.legacyRecoveryNoticeDismissed)) return fail('Invalid legacy recovery notice preference')
  if (raw.onboardingStatus !== undefined && (typeof raw.onboardingStatus !== 'string' || !['pending', 'dismissed', 'completed'].includes(raw.onboardingStatus))) return fail('Invalid onboarding status')
  const legacyRecoveries: UnifiedLegacyRecovery[] = []
  for (const value of raw.legacyRecoveries) {
    if (!record(value) || !idValid(value.id) || (value.sourceMode !== 'pattern' && value.sourceMode !== 'sequence')) return fail('Invalid legacy recovery')
    const draft = parseDraft(value.draft)
    if (!draft) return fail('Invalid legacy recovery draft')
    legacyRecoveries.push({ id: value.id, sourceMode: value.sourceMode, draft })
  }
  for (const config of configs) config.settings = timerSettingsWithoutGlobalSchedule(config.settings)
  for (const draft of Object.values(drafts)) draft.settings = timerSettingsWithoutGlobalSchedule(draft.settings)
  for (const recovery of legacyRecoveries) recovery.draft.settings = timerSettingsWithoutGlobalSchedule(recovery.draft.settings)
  if (raw.soundLibrary.some(sound => !isSupportedSoundRef(sound, false) || !record(sound) || sound.kind === 'builtin')) return fail('Invalid shared sound library')
  if (raw.alarmDefaults !== undefined && (!record(raw.alarmDefaults) || !isSupportedSoundRef(raw.alarmDefaults.sound, false) || !integer(raw.alarmDefaults.durationSeconds, 5, 3600))) return fail('Invalid alarm defaults')
  if (raw.legacyRuntimeMetadata !== undefined && (!record(raw.legacyRuntimeMetadata) || !boolean(raw.legacyRuntimeMetadata.alarmModeEnabled))) return fail('Invalid legacy runtime metadata')
  return {
    ok: true,
    value: {
      ...clone(raw),
      schemaVersion: UNIFIED_CONFIG_STATE_SCHEMA_VERSION,
      selectedConfigId: raw.selectedConfigId as string | null,
      configs, drafts, legacyRecoveries, soundLibrary: clone(raw.soundLibrary) as SoundRef[], globalAvailability, globalRunningControlIds, globalSecondPrecision,
    } as UnifiedConfigState,
  }
}

function validGlobalRunningControls(ids: unknown): ids is RunningControlId[] {
  return Array.isArray(ids) && new Set(ids).size === ids.length
    && ids.every(id => RUNNING_CONTROL_DEFINITIONS.some(control => control.id === id))
}

function result(state: UnifiedConfigState, status: 'applied' | 'blocked', reason?: ConfigCommandResult['reason'], createdConfigId?: string): ConfigCommandResult {
  return { state, status, ...(reason ? { reason } : {}), ...(createdConfigId ? { createdConfigId } : {}) }
}

export function reduceUnifiedConfigCommand(
  input: UnifiedConfigState,
  command: ConfigStateCommand,
  deps: ConfigStateDependencies = {},
): ConfigCommandResult {
  const now = 'now' in command ? command.now ?? deps.now?.() ?? Date.now() : deps.now?.() ?? Date.now()
  const state = clone(input)
  if (command.type === 'finishOnboarding') {
    if (state.onboardingStatus !== 'completed') state.onboardingStatus = command.completed ? 'completed' : 'dismissed'
    return result(state, 'applied')
  }
  if (command.type === 'dismissLegacyRecoveryNotice') {
    state.legacyRecoveryNoticeDismissed = true
    return result(state, 'applied')
  }
  if (command.type === 'discardLegacyRecovery') {
    state.legacyRecoveries = state.legacyRecoveries.filter(recovery => recovery.id !== command.id)
    return result(state, 'applied')
  }
  if (command.type === 'setGlobalSecondPrecision') {
    state.globalSecondPrecision = command.enabled
    return result(state, 'applied')
  }
  if (command.type === 'setGlobalRunningControl') {
    if (!RUNNING_CONTROL_DEFINITIONS.some(control => control.id === command.id)) return result(input, 'blocked', 'invalid-name')
    if (command.id === 'scrub') {
      state.globalScrubbingEnabled = command.enabled
      return result(state, 'applied')
    }
    const controls = new Set(state.globalRunningControlIds ?? enabledRunningControls(defaultAppTimerSettings()))
    if (command.enabled) controls.add(command.id)
    else controls.delete(command.id)
    state.globalRunningControlIds = [...controls]
    return result(state, 'applied')
  }
  if (command.type === 'setAlarmDefaults') {
    const factory = defaultAppTimerSettings()
    const defaults = { ...(state.alarmDefaults ?? { sound: factory.alarmSound, durationSeconds: factory.alarmDurationSeconds }), ...command.changes }
    if (!isSupportedSoundRef(defaults.sound, false) || !integer(defaults.durationSeconds, 5, 3600)) return result(input, 'blocked', 'invalid-sounds')
    state.alarmDefaults = clone(defaults)
    state.soundLibrary = mergeSharedSounds(state.soundLibrary, defaults.sound.kind === 'builtin' ? [] : [defaults.sound])
    return result(state, 'applied')
  }
  if (command.type === 'setGlobalAvailability') {
    const availability = parseAvailability(command.availability, () => '', false)
    if (!availability) return result(input, 'blocked', 'invalid-availability')
    state.globalAvailability = clone(availability)
    return result(state, 'applied')
  }
  const editorConfigId = command.type === 'discardDraft' || (command.type === 'edit' && command.configId !== undefined)
    ? command.configId : state.selectedConfigId
  const currentConfig = state.configs.find(config => config.id === editorConfigId)
  const currentKey = draftKey(editorConfigId ?? undefined)
  let draft = getDraft(state.drafts, currentKey)
  if (!draft && currentConfig && command.type === 'edit') draft = copyConfigAsDraft(currentConfig, now)
  if (!draft && command.type !== 'setSoundLibrary') {
    if (command.type === 'switch' && command.configId === null) {
      const defaults = createUnsavedUnifiedConfigState({ now: () => now, createId: deps.createId })
      const unnamed = defaults.drafts[UNNAMED_DRAFT_KEY]!
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
    updated.settings = timerSettingsWithoutGlobalSchedule(settings)
    setDraft(state.drafts, currentKey, recomputeDraft(updated, currentConfig))
    state.soundLibrary = mergeSharedSounds(state.soundLibrary, soundsUsedByDraft(updated))
    return result(state, 'applied')
  }
  if (command.type === 'discardDraft') {
    if (!draft || !hasUnifiedDraftChanges(draft)) return result(input, 'applied')
    const restored = currentConfig
      ? copyConfigAsDraft(currentConfig, now)
      : createUnsavedUnifiedConfigState({ now: () => now, createId: deps.createId }).drafts[UNNAMED_DRAFT_KEY]!
    setDraft(state.drafts, currentKey, restored)
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
      program: clone(draft!.program), settings: timerSettingsWithoutGlobalSchedule(draft!.settings), editorOptions: { ...clone(draft!.editorOptions), configurationNameIsCustom: draft!.editorOptions.configurationNameIsCustom === false && name === draft!.name ? false : true },
      showInRunningSelector: true,
    }
    if (draft!.editorOptions.configurationNameIsCustom !== undefined) saved.program = nameSingleStep(saved.program, saved.name, saved.editorOptions.configurationNameIsCustom !== false)
    state.configs.push(saved)
    if (!draft!.baseConfigId) delete state.drafts[UNNAMED_DRAFT_KEY]
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
    target.editorOptions.configurationNameIsCustom = true
    target.program = nameSingleStep(target.program, name)
    target.updatedAt = now
    const targetDraft = getDraft(state.drafts, target.id)
    if (targetDraft && !targetDraft.dirty) setDraft(state.drafts, target.id, { ...targetDraft, name, program: clone(target.program), editorOptions: { ...targetDraft.editorOptions, configurationNameIsCustom: true }, updatedAt: now, dirty: false })
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
    const imported = { ...clone(config), name: configName(config.name)!, program: parsedProgram.value, settings: timerSettingsWithoutGlobalSchedule(parsedSettings) }
    state.configs.push(imported)
    setDraft(state.drafts, imported.id, copyConfigAsDraft(imported, now))
    const importedSounds: SoundRef[] = []
    imported.program.steps.forEach(step => {
      importedSounds.push(...cueSounds(step.endCue))
      step.subBellTracks.forEach(track => importedSounds.push(...cueSounds(track)))
    })
    if (imported.program.completionCue) importedSounds.push(...cueSounds(imported.program.completionCue))
    importedSounds.push(clone(imported.settings.alarmSound))
    if (imported.program.alarmOverrides?.sound) importedSounds.push(clone(imported.program.alarmOverrides.sound))
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
    const copyConfig: UnifiedTimerConfig = { ...clone(source), id, name: copyName, editorOptions: { ...clone(source.editorOptions), configurationNameIsCustom: true }, createdAt: now, updatedAt: now }
    if (source.editorOptions.configurationNameIsCustom !== undefined) copyConfig.program = nameSingleStep(copyConfig.program, copyName)
    state.configs.push(copyConfig)
    setDraft(state.drafts, id, { ...copyConfigAsDraft(copyConfig, now), dirty: false })
    return result(state, 'applied', undefined, id)
  }
  if (command.type === 'moveConfig') {
    const from = state.configs.findIndex(config => config.id === command.id)
    const to = state.configs.findIndex(config => config.id === command.targetId)
    if (from < 0 || to < 0) return result(input, 'blocked', 'missing-config')
    const [moved] = state.configs.splice(from, 1)
    state.configs.splice(to, 0, moved)
    return result(state, 'applied')
  }
  if (command.type === 'delete') {
    const target = state.configs.find(config => config.id === command.id)
    if (!target) return result(input, 'blocked', 'missing-config')
    const targetDraft = getDraft(state.drafts, target.id)
    if (targetDraft?.dirty && !command.discardDraft) return result(input, 'blocked', 'dirty-draft')
    state.configs = state.configs.filter(config => config.id !== target.id)
    delete state.drafts[target.id]
    if (state.selectedConfigId === target.id) {
      state.selectedConfigId = null
      if (!getDraft(state.drafts, UNNAMED_DRAFT_KEY)) {
        if (command.discardDraft) {
          const defaults = createUnsavedUnifiedConfigState({ now: () => now, createId: deps.createId })
          setDraft(state.drafts, UNNAMED_DRAFT_KEY, defaults.drafts[UNNAMED_DRAFT_KEY]!)
        } else {
          const { baseConfigId, ...unnamed } = targetDraft ?? copyConfigAsDraft(target, now)
          setDraft(state.drafts, UNNAMED_DRAFT_KEY, { ...unnamed, dirty: true, updatedAt: now })
        }
      }
    }
    return result(state, 'applied')
  }
  if (command.type === 'switch') {
    const fresh = command.fresh === true && command.configId === null
    if (command.configId !== null && !state.configs.some(config => config.id === command.configId)) return result(input, 'blocked', 'missing-config')
    if ((!fresh && command.configId === state.selectedConfigId) || command.choice === 'cancel') return result(input, 'applied')
    if (fresh && state.selectedConfigId === null && draft?.dirty && command.choice === 'keep') return result(input, 'blocked', 'dirty-draft')
    if (draft?.dirty) {
      if (command.choice === 'save') {
        if (!currentConfig || !draft.baseConfigId) return result(input, 'blocked', 'unnamed-needs-save-as')
        const saved: UnifiedTimerConfig = { ...currentConfig, ...snapshotOf(draft), updatedAt: now }
        state.configs = state.configs.map(config => config.id === currentConfig.id ? clone(saved) : config)
        setDraft(state.drafts, currentKey, { ...copyDraft(draft), updatedAt: now, dirty: false })
      } else if (command.choice === 'save-as') {
        const name = configName(command.saveAsName)
        const id = command.saveAsId ?? deps.createId?.()
        if (!name) return result(input, 'blocked', 'invalid-name')
        if (!configIdValid(id) || state.configs.some(config => config.id === id)) return result(input, 'blocked', 'duplicate-id')
        const saved: UnifiedTimerConfig = {
          id, name, createdAt: now, updatedAt: now,
          program: clone(draft.program), settings: timerSettingsWithoutGlobalSchedule(draft.settings), editorOptions: { ...clone(draft.editorOptions), configurationNameIsCustom: draft.editorOptions.configurationNameIsCustom === false && name === draft.name ? false : true }, showInRunningSelector: true,
        }
        if (draft.editorOptions.configurationNameIsCustom !== undefined) saved.program = nameSingleStep(saved.program, name, saved.editorOptions.configurationNameIsCustom !== false)
        state.configs.push(saved)
        setDraft(state.drafts, id, { ...copyConfigAsDraft(saved, now), dirty: false })
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
    if (command.configId === null && (fresh || !getDraft(state.drafts, UNNAMED_DRAFT_KEY))) {
      const defaults = createUnsavedUnifiedConfigState({ now: () => now, createId: deps.createId })
      const unnamed = defaults.drafts[UNNAMED_DRAFT_KEY]!
      setDraft(state.drafts, UNNAMED_DRAFT_KEY, { ...unnamed, dirty: true })
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
