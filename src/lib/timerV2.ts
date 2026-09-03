import type {
  AppTimerSettings,
  BuiltInSoundId,
  CueSettings,
  PatternProgram,
  PatternTrack,
  ProgramPreset,
  SequenceProgram,
  SequenceStep,
  SoundRef,
  TimerConfig,
  TimerMode,
  TimerProgram,
  TimerV2State,
  WorkingProgramState,
} from '../types'

export const TIMER_V2_SCHEMA_VERSION = 2 as const
export const MAX_PATTERN_TRACKS = 5
export const MAX_SEQUENCE_STEPS = 20
export const MIN_DURATION_MINUTES = 1
export const MAX_DURATION_MINUTES = 240

const builtIn = (id: BuiltInSoundId): SoundRef => ({ kind: 'builtin', id })
const defaultCue = (id: BuiltInSoundId): CueSettings => ({ sound: builtIn(id), volume: 1 })

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
  const cadence = clamp(whole(cadenceMinutes, 1), 1, Math.max(1, main - 1))
  const offsets: number[] = []
  for (let offset = cadence; offset < main; offset += cadence) offsets.push(offset)
  return offsets
}

export function defaultPatternProgram(): PatternProgram {
  return {
    schemaVersion: TIMER_V2_SCHEMA_VERSION,
    mode: 'pattern',
    mainMinutes: 30,
    mainCue: defaultCue('temple-gong'),
    tracks: [{
      id: createProgramId(),
      enabled: true,
      cadenceMinutes: 5,
      selectedOffsetsMinutes: validOffsets(30, 5),
      ...defaultCue('clear-bell'),
    }],
    alignment: { kind: 'elapsed' },
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
  }
}

export function defaultAppTimerSettings(): AppTimerSettings {
  return {
    masterVolume: 0.8,
    notificationsEnabled: true,
    activeHoursEnabled: false,
    activeHoursStart: 8 * 60,
    activeHoursEnd: 22 * 60,
    activeHoursDays: 0b1111111,
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
  const sound = value?.sound
  const isSoundRef = sound && typeof sound === 'object' && 'kind' in sound
  return { sound: isSoundRef ? sound : fallback.sound, volume: clampVolume(value?.volume, fallback.volume) }
}

export function normalizeTrack(track: Partial<PatternTrack>, mainMinutes: number): PatternTrack {
  const main = clampDuration(mainMinutes, 30)
  const cadence = clamp(whole(track.cadenceMinutes, 1), 1, Math.max(1, main - 1))
  const selected = Array.isArray(track.selectedOffsetsMinutes) ? track.selectedOffsetsMinutes : []
  const selectedOffsetsMinutes = [...new Set(selected
    .map(value => whole(value, -1))
    .filter(value => value > 0 && value < main && value % cadence === 0))]
    .sort((a, b) => a - b)
  return {
    id: typeof track.id === 'string' && track.id.length > 0 ? track.id : createProgramId(),
    enabled: track.enabled !== false,
    cadenceMinutes: cadence,
    selectedOffsetsMinutes,
    ...normalizeCue(track, defaultCue('clear-bell')),
  }
}

export function normalizePatternProgram(value: Partial<PatternProgram> | undefined): PatternProgram {
  const mainMinutes = clampDuration(value?.mainMinutes, 30)
  const rawTracks = Array.isArray(value?.tracks) ? value.tracks : []
  const tracks = rawTracks.slice(0, MAX_PATTERN_TRACKS).map(track => normalizeTrack(track, mainMinutes))
  const offset = value?.alignment?.kind === 'local-clock' ? clampSnapOffset(value.alignment.offsetMinutes) : undefined
  return {
    schemaVersion: TIMER_V2_SCHEMA_VERSION,
    mode: 'pattern',
    mainMinutes,
    mainCue: normalizeCue(value?.mainCue, defaultCue('temple-gong')),
    tracks,
    alignment: offset === undefined ? { kind: 'elapsed' } : { kind: 'local-clock', offsetMinutes: offset },
  }
}

export function normalizeSequenceProgram(value: Partial<SequenceProgram> | undefined): SequenceProgram {
  const rawSteps = Array.isArray(value?.steps) ? value.steps : []
  const steps = rawSteps.slice(0, MAX_SEQUENCE_STEPS).map((step, index): SequenceStep => ({
    id: typeof step.id === 'string' && step.id.length > 0 ? step.id : createProgramId(),
    durationMinutes: clampDuration(step.durationMinutes, 5),
    label: normalizeLabel(step.label, `Step ${index + 1}`),
    ...normalizeCue(step, defaultCue('clear-bell')),
  }))
  return { schemaVersion: TIMER_V2_SCHEMA_VERSION, mode: 'sequence', steps: steps.length > 0 ? steps : defaultSequenceProgram().steps }
}

export function normalizeLabel(value: unknown, fallback: string): string {
  const label = typeof value === 'string' ? value.trim() : ''
  return (label || fallback).slice(0, 60)
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
    name: value.name.trim().slice(0, 80),
    createdAt: typeof value.createdAt === 'number' && Number.isFinite(value.createdAt) ? value.createdAt : Date.now(),
    program,
  }
}

/** Converts the old flat config exactly once, without mutating or deleting it. */
export function migrateLegacyConfig(legacy: Partial<TimerConfig>): TimerV2State {
  const mainMinutes = clampDuration(legacy.mainInterval, 30)
  const cadence = clamp(whole(legacy.subInterval, 5), 1, Math.max(1, mainMinutes - 1))
  const pattern: PatternProgram = {
    schemaVersion: TIMER_V2_SCHEMA_VERSION,
    mode: 'pattern',
    mainMinutes,
    mainCue: defaultCue('temple-gong'),
    tracks: [{
      id: createProgramId(),
      enabled: legacy.subEnabled !== false,
      cadenceMinutes: cadence,
      selectedOffsetsMinutes: validOffsets(mainMinutes, cadence),
      ...defaultCue('clear-bell'),
    }],
    alignment: legacy.snapEnabled ? { kind: 'local-clock', offsetMinutes: clampSnapOffset(legacy.snapOffset) } : { kind: 'elapsed' },
  }
  const defaults = defaultAppTimerSettings()
  return {
    schemaVersion: TIMER_V2_SCHEMA_VERSION,
    workingPrograms: { pattern, sequence: defaultSequenceProgram(), selectedMode: 'pattern' },
    settings: {
      masterVolume: clampVolume(legacy.volume, defaults.masterVolume),
      notificationsEnabled: legacy.notificationsEnabled !== false,
      activeHoursEnabled: legacy.activeHoursEnabled === true,
      activeHoursStart: clamp(whole(legacy.activeHoursStart, defaults.activeHoursStart), 0, 1439),
      activeHoursEnd: clamp(whole(legacy.activeHoursEnd, defaults.activeHoursEnd), 0, 1439),
      activeHoursDays: clamp(whole(legacy.activeHoursDays, defaults.activeHoursDays), 0, 0b1111111),
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
