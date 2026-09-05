import AsyncStorage from '@react-native-async-storage/async-storage'
import type { AlarmBehavior, AppTimerSettings, ProgramPreset, TimerConfig, TimerProgram, TimerV2State, WorkingProgramState } from '../types'
import type { RuntimeMuteState } from './runtimeV2'
import {
  createProgramId,
  defaultTimerV2State,
  migrateLegacyConfig,
  normalizeAvailabilityPolicy,
  normalizePatternProgram,
  normalizePreset,
  normalizeSequenceProgram,
} from './timerV2'

const CONFIG_KEY = 'chandas-config'
const SESSION_KEY = 'chandas-session'
const ADVANCED_SETTINGS_KEY = 'chandas-advanced-settings-expanded'
const WORKING_PROGRAMS_V2_KEY = 'chandas-working-programs-v2'
const PROGRAM_PRESETS_V2_KEY = 'chandas-program-presets-v1'
const APP_TIMER_SETTINGS_V2_KEY = 'chandas-app-timer-settings-v2'
const TIMER_V2_MIGRATION_KEY = 'chandas-timer-v2-migrated'
const TIMER_V2_SESSION_KEY = 'chandas-timer-v2-session'

// AsyncStorage calls can complete out of order under rapid slider/gesture input.
// Keeping independent state and session queues makes the newest user action the
// final durable value, including Stop racing an earlier session save.
let stateWriteQueue: Promise<boolean> = Promise.resolve(true)
let sessionWriteQueue: Promise<void> = Promise.resolve()

export interface TimerV2StateLoadResult {
  state: TimerV2State
  recovered: boolean
  reason?: 'invalid-records' | 'storage-unavailable'
}

export const DEFAULT_CONFIG: TimerConfig = {
  mainInterval: 30,
  subInterval: 5,
  snapEnabled: false,
  snapOffset: 0,
  subEnabled: true,
  notificationsEnabled: true,
  focusModeEnabled: false,
  volume: 0.8,
  alarmModeEnabled: false,
  activeHoursEnabled: false,
  activeHoursStart: 8 * 60,
  activeHoursEnd: 22 * 60,
  activeHoursDays: 0b1111111,
  alarmDurationSeconds: 60,
}

export async function loadConfig(): Promise<TimerConfig> {
  try {
    const raw = await AsyncStorage.getItem(CONFIG_KEY)
    if (!raw) return DEFAULT_CONFIG
    // Notification delivery is now managed by the app and Android settings, not an in-app toggle.
    return { ...DEFAULT_CONFIG, ...JSON.parse(raw), notificationsEnabled: true }
  } catch {
    return DEFAULT_CONFIG
  }
}

export async function saveConfig(config: TimerConfig): Promise<void> {
  try {
    await AsyncStorage.setItem(CONFIG_KEY, JSON.stringify(config))
  } catch { /* storage unavailable */ }
}

export async function loadAdvancedSettingsExpanded(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(ADVANCED_SETTINGS_KEY)) === 'true'
  } catch {
    return false
  }
}

export async function saveAdvancedSettingsExpanded(expanded: boolean): Promise<void> {
  try {
    await AsyncStorage.setItem(ADVANCED_SETTINGS_KEY, String(expanded))
  } catch { /* storage unavailable */ }
}

export interface TimerSession {
  phase: number
  mainMs: number
  subMs: number
}

export interface TimerV2Session {
  schemaVersion: 2
  anchor: number
  startedAt: number
  /** Fixed when Start is accepted so timezone realignment cannot change the promised length. */
  endsAt?: number
  program: TimerProgram
  mute: RuntimeMuteState
  alarmBehavior: AlarmBehavior
}

export async function saveSession(s: TimerSession): Promise<void> {
  try { await AsyncStorage.setItem(SESSION_KEY, JSON.stringify(s)) } catch { /* ignore */ }
}

export async function loadSession(): Promise<TimerSession | null> {
  try {
    const raw = await AsyncStorage.getItem(SESSION_KEY)
    return raw ? (JSON.parse(raw) as TimerSession) : null
  } catch { return null }
}

export async function clearSession(): Promise<void> {
  try { await AsyncStorage.removeItem(SESSION_KEY) } catch { /* ignore */ }
}

export async function hasTimerSession(): Promise<boolean> {
  try { return (await AsyncStorage.getItem(SESSION_KEY)) !== null } catch { return false }
}

function parseJson<T>(raw: string | null): T | null {
  if (!raw) return null
  try { return JSON.parse(raw) as T } catch { return null }
}

export async function saveTimerV2Session(session: TimerV2Session): Promise<void> {
  const snapshot = JSON.stringify(session)
  sessionWriteQueue = sessionWriteQueue.catch(() => undefined).then(() => AsyncStorage.setItem(TIMER_V2_SESSION_KEY, snapshot))
  try { await sessionWriteQueue } catch { /* storage unavailable */ }
}

export async function loadTimerV2Session(): Promise<TimerV2Session | null> {
  try {
    const value = parseJson<Partial<TimerV2Session>>(await AsyncStorage.getItem(TIMER_V2_SESSION_KEY))
    if (!value || value.schemaVersion !== 2 || typeof value.anchor !== 'number' || !Number.isFinite(value.anchor) || value.anchor <= 0 || !value.program) return null
    const program = value.program.mode === 'pattern'
      ? normalizePatternProgram(value.program)
      : value.program.mode === 'sequence'
        ? normalizeSequenceProgram(value.program)
        : null
    if (!program) return null
    return {
      schemaVersion: 2,
      anchor: value.anchor,
      startedAt: typeof value.startedAt === 'number' && Number.isFinite(value.startedAt) && value.startedAt > 0 ? value.startedAt : value.anchor,
      endsAt: typeof value.endsAt === 'number' && Number.isFinite(value.endsAt) && value.endsAt > 0 ? value.endsAt : undefined,
      program,
      mute: {
        mutedUntil: typeof value.mute?.mutedUntil === 'number' ? Math.max(0, value.mute.mutedUntil) : 0,
        iteration: value.mute?.iteration && typeof value.mute.iteration.endsAt === 'number' && typeof value.mute.iteration.endsAtLogicalId === 'string'
          ? { endsAt: value.mute.iteration.endsAt, endsAtLogicalId: value.mute.iteration.endsAtLogicalId, iterations: typeof value.mute.iteration.iterations === 'number' ? Math.max(1, Math.min(99, Math.round(value.mute.iteration.iterations))) : 1 }
          : undefined,
      },
      alarmBehavior: value.alarmBehavior === 'once' || value.alarmBehavior === 'locked' ? value.alarmBehavior : 'off',
    }
  } catch { return null }
}

export async function clearTimerV2Session(): Promise<void> {
  sessionWriteQueue = sessionWriteQueue.catch(() => undefined).then(() => AsyncStorage.removeItem(TIMER_V2_SESSION_KEY))
  try { await sessionWriteQueue } catch { /* storage unavailable */ }
}

export async function hasTimerV2Session(): Promise<boolean> {
  try { return (await AsyncStorage.getItem(TIMER_V2_SESSION_KEY)) !== null } catch { return false }
}

function normalizeWorkingPrograms(value: Partial<WorkingProgramState> | null): WorkingProgramState | null {
  if (!value || !value.pattern || !value.sequence) return null
  return {
    pattern: normalizePatternProgram(value.pattern),
    sequence: normalizeSequenceProgram(value.sequence),
    selectedMode: value.selectedMode === 'sequence' ? 'sequence' : 'pattern',
    sourcePreset: value.sourcePreset && typeof value.sourcePreset.id === 'string' && typeof value.sourcePreset.name === 'string'
      ? {
          id: value.sourcePreset.id,
          name: [...value.sourcePreset.name].slice(0, 80).join(''),
          createdAt: typeof value.sourcePreset.createdAt === 'number' ? value.sourcePreset.createdAt : Date.now(),
          deleted: value.sourcePreset.deleted === true,
        }
      : undefined,
  }
}

function normalizeSettings(value: Partial<AppTimerSettings> | null): AppTimerSettings | null {
  if (!value) return null
  const defaults = defaultTimerV2State().settings
  const legacy = value as Partial<AppTimerSettings> & {
    activeHoursEnabled?: boolean
    activeHoursStart?: number
    activeHoursEnd?: number
    activeHoursDays?: number
  }
  const availability = value.availability
    ? normalizeAvailabilityPolicy(value.availability)
    : normalizeAvailabilityPolicy({
        enabled: legacy.activeHoursEnabled === true,
        weeklyWindows: [{
          id: createProgramId(),
          enabled: true,
          startMinutes: typeof legacy.activeHoursStart === 'number' ? legacy.activeHoursStart : 8 * 60,
          endMinutes: typeof legacy.activeHoursEnd === 'number' ? legacy.activeHoursEnd : 22 * 60,
          days: typeof legacy.activeHoursDays === 'number' ? legacy.activeHoursDays : 0b1111111,
        }],
        overrides: [],
      })
  return {
    masterVolume: typeof value.masterVolume === 'number' && Number.isFinite(value.masterVolume)
      ? Math.max(0, Math.min(1, value.masterVolume))
      : defaults.masterVolume,
    notificationsEnabled: value.notificationsEnabled !== false,
    liveCountdownEnabled: value.liveCountdownEnabled === true,
    muteDuringCallsEnabled: value.muteDuringCallsEnabled !== false,
    availability,
    focusAutomationEnabled: value.focusAutomationEnabled === true,
    alarmDurationSeconds: typeof value.alarmDurationSeconds === 'number'
      ? Math.max(5, Math.min(3_600, Math.round(value.alarmDurationSeconds)))
      : defaults.alarmDurationSeconds,
  }
}

function normalizePresets(value: unknown): ProgramPreset[] {
  if (!Array.isArray(value)) return []
  const ids = new Set<string>()
  return value.map(preset => normalizePreset(preset as Partial<ProgramPreset>)).filter((preset): preset is ProgramPreset => preset !== null).map(preset => {
    const id = ids.has(preset.id) ? createProgramId() : preset.id
    ids.add(id)
    return id === preset.id ? preset : { ...preset, id }
  })
}

async function saveV2Records(state: TimerV2State, recordMigration: boolean): Promise<void> {
  await AsyncStorage.multiSet([
    [WORKING_PROGRAMS_V2_KEY, JSON.stringify(state.workingPrograms)],
    [PROGRAM_PRESETS_V2_KEY, JSON.stringify(state.presets)],
    [APP_TIMER_SETTINGS_V2_KEY, JSON.stringify(state.settings)],
  ])
  if (recordMigration) await AsyncStorage.setItem(TIMER_V2_MIGRATION_KEY, 'true')
}

/**
 * Returns the v2 source of truth. A valid set of v2 records always wins;
 * otherwise the old flat config is migrated without deleting it.
 */
export async function loadTimerV2StateResult(): Promise<TimerV2StateLoadResult> {
  try {
    const [workingRaw, presetsRaw, settingsRaw] = await AsyncStorage.multiGet([
      WORKING_PROGRAMS_V2_KEY,
      PROGRAM_PRESETS_V2_KEY,
      APP_TIMER_SETTINGS_V2_KEY,
    ])
    const workingPrograms = normalizeWorkingPrograms(parseJson<WorkingProgramState>(workingRaw[1]))
    const settings = normalizeSettings(parseJson<AppTimerSettings>(settingsRaw[1]))
    const parsedPresets = parseJson<unknown>(presetsRaw[1])
    const presets = normalizePresets(parsedPresets)
    if (workingPrograms && settings) {
      const presetsRecovered = presetsRaw[1] !== null && (!Array.isArray(parsedPresets) || presets.length !== parsedPresets.length)
      return { state: { schemaVersion: 2, workingPrograms, settings, presets }, recovered: presetsRecovered, reason: presetsRecovered ? 'invalid-records' : undefined }
    }

    const legacy = parseJson<Partial<TimerConfig>>(await AsyncStorage.getItem(CONFIG_KEY)) ?? {}
    const migrated = migrateLegacyConfig(legacy)
    // New records are written before the marker; the legacy key remains intact.
    await saveV2Records(migrated, true)
    const hadInvalidV2Records = Boolean(workingRaw[1] || presetsRaw[1] || settingsRaw[1])
    return { state: migrated, recovered: hadInvalidV2Records, reason: hadInvalidV2Records ? 'invalid-records' : undefined }
  } catch {
    return { state: defaultTimerV2State(), recovered: true, reason: 'storage-unavailable' }
  }
}

export async function loadTimerV2State(): Promise<TimerV2State> {
  return (await loadTimerV2StateResult()).state
}

export async function saveTimerV2State(state: TimerV2State): Promise<boolean> {
  // Freeze serialization at call time; callers continue producing immutable
  // state while this snapshot waits behind earlier writes.
  const snapshot = JSON.parse(JSON.stringify(state)) as TimerV2State
  stateWriteQueue = stateWriteQueue.catch(() => false).then(async () => {
    try {
      await saveV2Records(snapshot, false)
      return true
    } catch {
      return false
    }
  })
  return stateWriteQueue
}

export async function saveWorkingProgramsV2(workingPrograms: WorkingProgramState): Promise<void> {
  try { await AsyncStorage.setItem(WORKING_PROGRAMS_V2_KEY, JSON.stringify(workingPrograms)) } catch { /* storage unavailable */ }
}

export async function saveProgramPresetsV2(presets: ProgramPreset[]): Promise<void> {
  try { await AsyncStorage.setItem(PROGRAM_PRESETS_V2_KEY, JSON.stringify(presets)) } catch { /* storage unavailable */ }
}

export async function saveAppTimerSettingsV2(settings: AppTimerSettings): Promise<void> {
  try { await AsyncStorage.setItem(APP_TIMER_SETTINGS_V2_KEY, JSON.stringify(settings)) } catch { /* storage unavailable */ }
}
