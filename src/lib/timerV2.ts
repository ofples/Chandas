import type {
  AppTimerSettings,
  AvailabilityOverride,
  AvailabilityPolicy,
  BuiltInSoundId,
  CueSettings,
  PatternProgram,
  PatternTrack,
  ProgramPreset,
  RunPolicy,
  SequenceProgram,
  SequenceStep,
  SoundRef,
  TimerConfig,
  TimerMode,
  TimerProgram,
  TimerV2State,
  WorkingProgramState,
  WeeklyAvailabilityWindow,
} from '../types'

export const TIMER_V2_SCHEMA_VERSION = 2 as const
export const MAX_PATTERN_TRACKS = 5
export const MAX_SEQUENCE_STEPS = 20
export const MIN_DURATION_MINUTES = 1
export const MAX_DURATION_MINUTES = 240
export const MAX_RUN_CYCLES = 999
export const MAX_RUN_DURATION_SECONDS = 359 * 3_600 + 59 * 60 + 59
export const MAX_WEEKLY_WINDOWS = 16
export const MAX_AVAILABILITY_OVERRIDES = 256

const builtIn = (id: BuiltInSoundId): SoundRef => ({ kind: 'builtin', id })
const defaultCue = (id: BuiltInSoundId): CueSettings => ({ sound: builtIn(id), volume: 1 })
const BUILT_IN_SOUND_IDS = new Set<BuiltInSoundId>(['temple-gong', 'clear-bell', 'soft-bowl', 'wood-block', 'bright-chime'])
const MAX_ID_CHARACTERS = 200
const MAX_URI_CHARACTERS = 8_192

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
const whole = (value: unknown, fallback: number) => {
  const parsed = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : fallback
  return parsed
}

export function clampVolume(value: unknown, fallback = 1): number {
  return clamp(typeof value === 'number' && Number.isFinite(value) ? value : fallback, 0, 1)
}

export function clampDuration(value: unknown, fallback: number): number {
  return clamp(whole(value, fallback), MIN_DURATION_MINUTES, MAX_DURATION_MINUTES)
}

export function clampSnapOffset(value: unknown, fallback = 0): number {
  return clamp(whole(value, fallback), 0, 59)
}

export function normalizeRunPolicy(value: Partial<RunPolicy> | undefined): RunPolicy {
  return {
    kind: value?.kind === 'cycles' || value?.kind === 'duration' ? value.kind : 'continuous',
    cycleCount: clamp(whole(value?.cycleCount, 1), 1, MAX_RUN_CYCLES),
    durationSeconds: clamp(whole(value?.durationSeconds, 30 * 60), 1, MAX_RUN_DURATION_SECONDS),
  }
}

/** RFC-4122-shaped ID generator without a platform-specific dependency. */
export function createProgramId(): string {
  const values = new Uint8Array(16)
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(values)
  else for (let index = 0; index < values.length; index += 1) values[index] = Math.floor(Math.random() * 256)
  values[6] = (values[6] & 0x0f) | 0x40
  values[8] = (values[8] & 0x3f) | 0x80
  const hex = [...values].map(value => value.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export function validOffsets(mainMinutes: number, cadenceMinutes: number): number[] {
  const main = clampDuration(mainMinutes, 30)
  const cadence = clampDuration(cadenceMinutes, 1)
  const offsets: number[] = []
  for (let offset = cadence; offset < main; offset += cadence) offsets.push(offset)
  return offsets
}

export function defaultPatternProgram(): PatternProgram {
  return {
    schemaVersion: TIMER_V2_SCHEMA_VERSION,
    mode: 'pattern',
    label: 'Main interval',
    mainMinutes: 30,
    mainCue: defaultCue('temple-gong'),
    tracks: [{
      id: createProgramId(),
      label: 'Sub-bell 1',
      enabled: true,
      cadenceMinutes: 5,
      selectedOffsetsMinutes: validOffsets(30, 5),
      ...defaultCue('clear-bell'),
    }],
    alignment: { kind: 'elapsed' },
    runPolicy: normalizeRunPolicy(undefined),
  }
}

export function defaultSequenceProgram(): SequenceProgram {
  const step = (durationMinutes: number, label: string, sound: BuiltInSoundId, volume: number): SequenceStep => ({
    id: createProgramId(), durationMinutes, label, sound: builtIn(sound), volume,
  })
  return {
    schemaVersion: TIMER_V2_SCHEMA_VERSION,
    mode: 'sequence',
    steps: [
      step(5, 'Prepare', 'bright-chime', 0.6),
      step(25, 'Deep work', 'temple-gong', 0.85),
      step(2, 'Reset', 'soft-bowl', 0.55),
    ],
    runPolicy: normalizeRunPolicy(undefined),
  }
}

export function defaultAvailabilityPolicy(): AvailabilityPolicy {
  return {
    enabled: false,
    weeklyWindows: [{
      id: createProgramId(),
      enabled: true,
      startMinutes: 8 * 60,
      endMinutes: 22 * 60,
      days: 0b1111111,
    }],
    overrides: [],
  }
}

export function defaultAppTimerSettings(): AppTimerSettings {
  return {
    masterVolume: 0.8,
    notificationsEnabled: true,
    availability: defaultAvailabilityPolicy(),
    focusAutomationEnabled: false,
    alarmDurationSeconds: 60,
  }
}

export function defaultWorkingPrograms(): WorkingProgramState {
  return { pattern: defaultPatternProgram(), sequence: defaultSequenceProgram(), selectedMode: 'pattern' }
}

export function defaultTimerV2State(): TimerV2State {
  return {
    schemaVersion: TIMER_V2_SCHEMA_VERSION,
    workingPrograms: defaultWorkingPrograms(),
    settings: defaultAppTimerSettings(),
    presets: [],
  }
}

export function normalizeCue(value: Partial<CueSettings> | undefined, fallback: CueSettings): CueSettings {
  return { sound: normalizeSoundRef(value?.sound, fallback.sound), volume: clampVolume(value?.volume, fallback.volume) }
}

export function normalizeSoundRef(value: unknown, fallback: SoundRef): SoundRef {
  if (!value || typeof value !== 'object') return fallback
  const candidate = value as Record<string, unknown>
  if (candidate.kind === 'builtin' && typeof candidate.id === 'string' && BUILT_IN_SOUND_IDS.has(candidate.id as BuiltInSoundId)) {
    return { kind: 'builtin', id: candidate.id as BuiltInSoundId }
  }
  if (candidate.kind === 'android' && typeof candidate.uri === 'string' && candidate.uri.length > 0 && candidate.uri.length <= MAX_URI_CHARACTERS && typeof candidate.title === 'string') {
    const ringtoneType = candidate.ringtoneType === 'alarm' || candidate.ringtoneType === 'notification' ? candidate.ringtoneType : 'unknown'
    return { kind: 'android', uri: candidate.uri, title: normalizeLabel(candidate.title, 'Android sound'), ringtoneType }
  }
  if (candidate.kind === 'document' && typeof candidate.uri === 'string' && candidate.uri.length > 0 && candidate.uri.length <= MAX_URI_CHARACTERS && typeof candidate.title === 'string') {
    return {
      kind: 'document',
      uri: candidate.uri,
      title: normalizeLabel(candidate.title, 'Audio file'),
      ...(typeof candidate.mimeType === 'string' && candidate.mimeType.length > 0 ? { mimeType: candidate.mimeType } : {}),
    }
  }
  return fallback
}

export function normalizeTrack(track: Partial<PatternTrack>, mainMinutes: number, fallbackLabel = 'Sub-bell'): PatternTrack {
  const main = clampDuration(mainMinutes, 30)
  const cadence = clampDuration(track.cadenceMinutes, 1)
  const selected = Array.isArray(track.selectedOffsetsMinutes) ? track.selectedOffsetsMinutes.slice(0, MAX_DURATION_MINUTES - 1) : []
  const selectedOffsetsMinutes = [...new Set(selected
    .map(value => whole(value, -1))
    .filter(value => value > 0 && value < main && value % cadence === 0))]
    .sort((a, b) => a - b)
  return {
    id: typeof track.id === 'string' && track.id.length > 0 && track.id.length <= MAX_ID_CHARACTERS ? track.id : createProgramId(),
    label: normalizeLabel(track.label, fallbackLabel),
    enabled: track.enabled !== false,
    cadenceMinutes: cadence,
    selectedOffsetsMinutes,
    ...normalizeCue(track, defaultCue('clear-bell')),
  }
}

export function normalizePatternProgram(value: Partial<PatternProgram> | undefined): PatternProgram {
  const mainMinutes = clampDuration(value?.mainMinutes, 30)
  const rawTracks = Array.isArray(value?.tracks) ? value.tracks : []
  const trackIds = new Set<string>()
  const tracks = rawTracks.slice(0, MAX_PATTERN_TRACKS).map((track, index) => {
    const normalized = normalizeTrack(track, mainMinutes, `Sub-bell ${index + 1}`)
    if (trackIds.has(normalized.id)) normalized.id = createProgramId()
    trackIds.add(normalized.id)
    return normalized
  })
  const offset = value?.alignment?.kind === 'local-clock' ? clampSnapOffset(value.alignment.offsetMinutes) : undefined
  return {
    schemaVersion: TIMER_V2_SCHEMA_VERSION,
    mode: 'pattern',
    label: normalizeLabel(value?.label, 'Main interval'),
    mainMinutes,
    mainCue: normalizeCue(value?.mainCue, defaultCue('temple-gong')),
    tracks,
    alignment: offset === undefined ? { kind: 'elapsed' } : { kind: 'local-clock', offsetMinutes: offset },
    runPolicy: normalizeRunPolicy(value?.runPolicy),
  }
}

export function normalizeSequenceProgram(value: Partial<SequenceProgram> | undefined): SequenceProgram {
  const rawSteps = Array.isArray(value?.steps) ? value.steps : []
  const stepIds = new Set<string>()
  const steps = rawSteps.slice(0, MAX_SEQUENCE_STEPS).map((step, index): SequenceStep => {
    let id = typeof step.id === 'string' && step.id.length > 0 && step.id.length <= MAX_ID_CHARACTERS ? step.id : createProgramId()
    if (stepIds.has(id)) id = createProgramId()
    stepIds.add(id)
    return { id, durationMinutes: clampDuration(step.durationMinutes, 5), label: normalizeLabel(step.label, `Step ${index + 1}`), ...normalizeCue(step, defaultCue('clear-bell')) }
  })
  return {
    schemaVersion: TIMER_V2_SCHEMA_VERSION,
    mode: 'sequence',
    steps: steps.length > 0 ? steps : defaultSequenceProgram().steps,
    runPolicy: normalizeRunPolicy(value?.runPolicy),
  }
}

export function normalizeWeeklyWindow(value: Partial<WeeklyAvailabilityWindow>, fallback?: WeeklyAvailabilityWindow): WeeklyAvailabilityWindow {
  const defaults = fallback ?? defaultAvailabilityPolicy().weeklyWindows[0]
  return {
    id: typeof value.id === 'string' && value.id.length > 0 && value.id.length <= MAX_ID_CHARACTERS ? value.id : createProgramId(),
    enabled: value.enabled !== false,
    startMinutes: clamp(whole(value.startMinutes, defaults.startMinutes), 0, 1_439),
    endMinutes: clamp(whole(value.endMinutes, defaults.endMinutes), 0, 1_439),
    days: clamp(whole(value.days, defaults.days), 0, 0b1111111),
  }
}

function normalizeAvailabilityOverride(value: Partial<AvailabilityOverride>, now: number): AvailabilityOverride | null {
  if (value.source !== 'calendar' || (value.behavior !== 'active' && value.behavior !== 'mute')) return null
  if (typeof value.startAt !== 'number' || !Number.isFinite(value.startAt) || typeof value.endAt !== 'number' || !Number.isFinite(value.endAt) || value.endAt <= value.startAt || value.endAt <= now) return null
  return {
    id: typeof value.id === 'string' && value.id.length > 0 && value.id.length <= MAX_ID_CHARACTERS ? value.id : createProgramId(),
    startAt: value.startAt,
    endAt: value.endAt,
    behavior: value.behavior,
    source: 'calendar',
    ...(typeof value.sourceId === 'string' && value.sourceId.length > 0 && value.sourceId.length <= MAX_ID_CHARACTERS ? { sourceId: value.sourceId } : {}),
  }
}

export function normalizeAvailabilityPolicy(value: Partial<AvailabilityPolicy> | undefined, now = Date.now()): AvailabilityPolicy {
  const defaults = defaultAvailabilityPolicy()
  const ids = new Set<string>()
  const weeklyWindows = (Array.isArray(value?.weeklyWindows) ? value.weeklyWindows : defaults.weeklyWindows)
    .slice(0, MAX_WEEKLY_WINDOWS)
    .map(window => {
      const normalized = normalizeWeeklyWindow(window)
      if (ids.has(normalized.id)) normalized.id = createProgramId()
      ids.add(normalized.id)
      return normalized
    })
  const overrideIds = new Set<string>()
  const overrides = (Array.isArray(value?.overrides) ? value.overrides : [])
    .slice(0, MAX_AVAILABILITY_OVERRIDES)
    .map(override => normalizeAvailabilityOverride(override, now))
    .filter((override): override is AvailabilityOverride => override !== null)
    .map(override => {
      const id = overrideIds.has(override.id) ? createProgramId() : override.id
      overrideIds.add(id)
      return id === override.id ? override : { ...override, id }
    })
  return { enabled: value?.enabled === true, weeklyWindows, overrides }
}

export function normalizeLabel(value: unknown, fallback: string): string {
  const label = typeof value === 'string' ? value.trim() : ''
  return [...(label || fallback)].slice(0, 60).join('')
}

export function normalizePreset(value: Partial<ProgramPreset>): ProgramPreset | null {
  if (typeof value.name !== 'string' || value.name.trim().length === 0 || !value.program) return null
  const program = value.program.mode === 'pattern'
    ? normalizePatternProgram(value.program)
    : value.program.mode === 'sequence'
      ? normalizeSequenceProgram(value.program)
      : null
  if (!program) return null
  return {
    id: typeof value.id === 'string' && value.id.length > 0 ? value.id : createProgramId(),
    name: [...value.name.trim()].slice(0, 80).join(''),
    createdAt: typeof value.createdAt === 'number' && Number.isFinite(value.createdAt) ? value.createdAt : Date.now(),
    program,
  }
}

export function parseTimerProgram(value: unknown): TimerProgram | null {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) as unknown : value
    if (!parsed || typeof parsed !== 'object') return null
    const candidate = parsed as Partial<TimerProgram> & { schemaVersion?: unknown; mode?: unknown }
    if (candidate.schemaVersion !== TIMER_V2_SCHEMA_VERSION) return null
    if (candidate.mode === 'pattern') return normalizePatternProgram(candidate as Partial<PatternProgram>)
    if (candidate.mode === 'sequence') return normalizeSequenceProgram(candidate as Partial<SequenceProgram>)
    return null
  } catch {
    return null
  }
}

/** Converts the old flat config exactly once, without mutating or deleting it. */
export function migrateLegacyConfig(legacy: Partial<TimerConfig>): TimerV2State {
  const mainMinutes = clampDuration(legacy.mainInterval, 30)
  const cadence = clamp(whole(legacy.subInterval, 5), 1, Math.max(1, mainMinutes - 1))
  const pattern: PatternProgram = {
    schemaVersion: TIMER_V2_SCHEMA_VERSION,
    mode: 'pattern',
    label: 'Main interval',
    mainMinutes,
    mainCue: defaultCue('temple-gong'),
    tracks: [{
      id: createProgramId(),
      label: 'Sub-bell 1',
      enabled: legacy.subEnabled !== false,
      cadenceMinutes: cadence,
      selectedOffsetsMinutes: validOffsets(mainMinutes, cadence),
      ...defaultCue('clear-bell'),
    }],
    alignment: legacy.snapEnabled ? { kind: 'local-clock', offsetMinutes: clampSnapOffset(legacy.snapOffset) } : { kind: 'elapsed' },
    runPolicy: normalizeRunPolicy(undefined),
  }
  const defaults = defaultAppTimerSettings()
  return {
    schemaVersion: TIMER_V2_SCHEMA_VERSION,
    workingPrograms: { pattern, sequence: defaultSequenceProgram(), selectedMode: 'pattern' },
    settings: {
      masterVolume: clampVolume(legacy.volume, defaults.masterVolume),
      notificationsEnabled: legacy.notificationsEnabled !== false,
      availability: {
        enabled: legacy.activeHoursEnabled === true,
        weeklyWindows: [{
          id: createProgramId(),
          enabled: true,
          startMinutes: clamp(whole(legacy.activeHoursStart, 8 * 60), 0, 1439),
          endMinutes: clamp(whole(legacy.activeHoursEnd, 22 * 60), 0, 1439),
          days: clamp(whole(legacy.activeHoursDays, 0b1111111), 0, 0b1111111),
        }],
        overrides: [],
      },
      focusAutomationEnabled: legacy.focusModeEnabled === true,
      alarmDurationSeconds: clamp(whole(legacy.alarmDurationSeconds, defaults.alarmDurationSeconds), 5, 3600),
    },
    presets: [],
  }
}

export function selectedProgram(state: Pick<TimerV2State, 'workingPrograms'>): TimerProgram {
  return state.workingPrograms[state.workingPrograms.selectedMode]
}

export function replaceWorkingProgram(state: TimerV2State, program: TimerProgram, mode: TimerMode = program.mode): TimerV2State {
  const workingPrograms = {
    ...state.workingPrograms,
    [mode]: program,
    selectedMode: mode,
    sourcePreset: undefined,
  } as WorkingProgramState
  return { ...state, workingPrograms }
}
