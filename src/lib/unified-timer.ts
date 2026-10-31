import type {
  AppTimerSettings, CueSettings, PatternProgram, PatternTrack, RunPolicy, SequenceProgram,
  SoundRef, TimerConfig, TimerMode, TimerV2State, UnifiedSubBellTrack, UnifiedTimerProgram,
  WorkingProgramState,
} from '../types'
import {
  MAX_CUE_DURATION_SECONDS, MAX_RUN_CYCLES, MAX_RUN_DURATION_SECONDS, MAX_SEQUENCE_STEPS,
  MAX_PATTERN_TRACKS, isSupportedSoundRef, normalizePatternProgram, normalizeSequenceProgram, migrateLegacyConfig,
} from './timerV2'

export const UNIFIED_TIMER_SCHEMA_VERSION = 4 as const

/** Automatic name for a new unified step; legacy Cycle labels remain unchanged on import. */
export function defaultUnifiedStepLabel(durationSeconds: number): string {
  const seconds = Math.max(1, Math.round(durationSeconds))
  if (seconds % 60 === 0) return `${seconds / 60}-minute step`
  if (seconds < 60) return `${seconds}-second step`
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s step`
}
export const MAX_UNIFIED_STEPS = MAX_SEQUENCE_STEPS
export const MAX_UNIFIED_TRACKS_PER_STEP = MAX_PATTERN_TRACKS

export type UnifiedProgramParseResult =
  | { ok: true; value: UnifiedTimerProgram }
  | { ok: false; raw: unknown; reason: string }

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const isIntIn = (value: unknown, min: number, max: number): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max
const validId = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 200
const optionalType = (record: Record<string, unknown>, key: string, predicate: (value: unknown) => boolean) => record[key] === undefined || predicate(record[key])
const finiteNumber = (value: unknown) => typeof value === 'number' && Number.isFinite(value)

function uniqueOrMissingIds(values: unknown[], idKey: string): boolean {
  const ids = new Set<string>()
  for (const value of values) {
    const id = (value as Record<string, unknown>)[idKey]
    if (!validId(id)) continue
    if (ids.has(id)) return false
    ids.add(id)
  }
  return true
}

function legacyCueShapeIsValid(value: Record<string, unknown>): boolean {
  const cueSounds = value.sounds
  return optionalType(value, 'sound', candidate => isLegacySound(candidate))
    && optionalType(value, 'volume', finiteNumber)
    && (cueSounds === undefined || (Array.isArray(cueSounds) && cueSounds.every(isLegacySound)))
    && optionalType(value, 'soundMode', candidate => candidate === 'single' || candidate === 'sequence' || candidate === 'random')
    && optionalType(value, 'hapticOverride', candidate => candidate === 'off' || (isRecord(candidate) && ['single', 'double', 'triple'].includes(String(candidate.pattern)) && ['gentle', 'balanced', 'strong'].includes(String(candidate.strength))))
}

function legacyAlignmentIsValid(value: unknown): boolean {
  return value === undefined || (isRecord(value) && (value.kind === 'elapsed' || (value.kind === 'local-clock' && isIntIn(value.offsetMinutes, 0, 59))))
}

function legacyRunPolicyIsValid(value: unknown): boolean {
  return value === undefined || (isRecord(value)
    && optionalType(value, 'kind', candidate => candidate === 'continuous' || candidate === 'cycles' || candidate === 'duration')
    && optionalType(value, 'cycleCount', candidate => isIntIn(candidate, 1, MAX_RUN_CYCLES))
    && optionalType(value, 'durationSeconds', candidate => isIntIn(candidate, 1, MAX_RUN_DURATION_SECONDS)))
}

function legacyCommonFieldsAreValid(record: Record<string, unknown>): boolean {
  return legacyAlignmentIsValid(record.alignment)
    && legacyRunPolicyIsValid(record.runPolicy)
    && (record.completionCue === undefined || record.completionCue === null || (isRecord(record.completionCue) && legacyCueShapeIsValid(record.completionCue)))
}

function isLegacySound(value: unknown): boolean {
  return isSupportedSoundRef(value, true)
}

function validSound(value: unknown): value is SoundRef {
  return isSupportedSoundRef(value)
}

function validCue(value: unknown): value is CueSettings {
  if (!isRecord(value) || !validSound(value.sound) || typeof value.volume !== 'number' || !Number.isFinite(value.volume) || value.volume < 0 || value.volume > 1) return false
  if (value.sounds !== undefined && (!Array.isArray(value.sounds) || value.sounds.length < 1 || !value.sounds.every(validSound))) return false
  if (value.soundMode !== undefined && value.soundMode !== 'single' && value.soundMode !== 'sequence' && value.soundMode !== 'random') return false
  if (value.hapticOverride !== undefined && value.hapticOverride !== 'off' && (!isRecord(value.hapticOverride) || !['single', 'double', 'triple'].includes(String(value.hapticOverride.pattern)) || !['gentle', 'balanced', 'strong'].includes(String(value.hapticOverride.strength)))) return false
  return true
}

function validRunPolicy(value: unknown): value is RunPolicy {
  return isRecord(value) && (value.kind === 'continuous' || value.kind === 'cycles' || value.kind === 'duration') && isIntIn(value.cycleCount, 1, MAX_RUN_CYCLES) && isIntIn(value.durationSeconds, 1, MAX_RUN_DURATION_SECONDS)
}

function validateProgram(value: unknown): string | null {
  if (!isRecord(value)) return 'Program must be an object'
  if (value.schemaVersion !== UNIFIED_TIMER_SCHEMA_VERSION) return `Unsupported program schema version: ${String(value.schemaVersion)}`
  if (value.mode !== 'unified') return 'Program mode must be unified'
  if (!Array.isArray(value.steps) || value.steps.length < 1 || value.steps.length > MAX_UNIFIED_STEPS) return `Program must contain 1 to ${MAX_UNIFIED_STEPS} steps`
  if (!isRecord(value.alignment) || (value.alignment.kind !== 'elapsed' && value.alignment.kind !== 'local-clock')) return 'Invalid alignment'
  if (value.alignment.kind === 'local-clock' && !isIntIn(value.alignment.offsetMinutes, 0, 59)) return 'Invalid clock alignment offset'
  if (value.completionCue !== null && !validCue(value.completionCue)) return 'Invalid completion cue'
  if (!validRunPolicy(value.runPolicy)) return 'Invalid run policy'
  const stepIds = new Set<string>()
  for (const [index, step] of value.steps.entries()) {
    if (!isRecord(step) || !validId(step.id) || stepIds.has(step.id)) return `Invalid or duplicate step id at index ${index}`
    stepIds.add(step.id)
    if (typeof step.label !== 'string' || [...step.label].length > 60) return `Invalid step label at index ${index}`
    if (step.labelIsCustom !== undefined && typeof step.labelIsCustom !== 'boolean') return `Invalid label intent at index ${index}`
    if (!isIntIn(step.durationSeconds, 1, MAX_CUE_DURATION_SECONDS)) return `Invalid step duration at index ${index}`
    if (!validCue(step.endCue)) return `Invalid end cue at index ${index}`
    if (typeof step.endAlarmEnabled !== 'boolean' || typeof step.subBellsEnabled !== 'boolean') return `Invalid step settings at index ${index}`
    if (!Array.isArray(step.subBellTracks) || step.subBellTracks.length > MAX_UNIFIED_TRACKS_PER_STEP) return `Invalid sub-bell tracks at index ${index}`
    const trackIds = new Set<string>()
    for (const [trackIndex, track] of step.subBellTracks.entries()) {
      if (!isRecord(track) || !validId(track.id) || trackIds.has(track.id)) return `Invalid or duplicate track id at ${index}:${trackIndex}`
      trackIds.add(track.id)
      if (typeof track.label !== 'string' || [...track.label].length > 60 || typeof track.enabled !== 'boolean' || typeof track.showOnWatchFace !== 'boolean') return `Invalid track settings at ${index}:${trackIndex}`
      if (track.color !== undefined && !['violet', 'blue', 'cyan', 'teal', 'green', 'lime', 'amber', 'orange', 'coral', 'rose'].includes(String(track.color))) return `Invalid track color at ${index}:${trackIndex}`
      if (!isIntIn(track.cadenceSeconds, 1, MAX_CUE_DURATION_SECONDS) || typeof track.repeatEnabled !== 'boolean') return `Invalid track cadence at ${index}:${trackIndex}`
      if (!Array.isArray(track.selectedOffsetsSeconds) || !track.selectedOffsetsSeconds.every(offset => isIntIn(offset, 1, MAX_CUE_DURATION_SECONDS))) return `Invalid selected offsets at ${index}:${trackIndex}`
      if (track.randomRepeat !== undefined && (!isRecord(track.randomRepeat) || !isIntIn(track.randomRepeat.minSeconds, 5, MAX_CUE_DURATION_SECONDS) || !isIntIn(track.randomRepeat.maxSeconds, track.randomRepeat.minSeconds as number, MAX_CUE_DURATION_SECONDS))) return `Invalid random range at ${index}:${trackIndex}`
      if (track.afterStartSeconds !== undefined && !isIntIn(track.afterStartSeconds, 1, MAX_CUE_DURATION_SECONDS)) return `Invalid after-start offset at ${index}:${trackIndex}`
      if (track.beforeEndSeconds !== undefined && !isIntIn(track.beforeEndSeconds, 1, MAX_CUE_DURATION_SECONDS)) return `Invalid before-end offset at ${index}:${trackIndex}`
      if (!validCue(track)) return `Invalid track cue at ${index}:${trackIndex}`
    }
  }
  return null
}

/** Strict schema-4 parser. Failures include the original input for recovery/export. */
export function parseUnifiedTimerProgram(input: unknown): UnifiedProgramParseResult {
  let raw = input
  if (typeof input === 'string') {
    try { raw = JSON.parse(input) as unknown } catch { return { ok: false, raw: input, reason: 'Program is not valid JSON' } }
  }
  const reason = validateProgram(raw)
  if (reason) return { ok: false, raw: input, reason }
  const program = raw as UnifiedTimerProgram
  return {
    ok: true,
    value: {
      ...program,
      steps: program.steps.map(step => ({ ...step, endCue: cloneCue(step.endCue), subBellTracks: step.subBellTracks.map(track => ({ ...track, selectedOffsetsSeconds: [...track.selectedOffsetsSeconds], ...(track.randomRepeat ? { randomRepeat: { ...track.randomRepeat } } : {}), ...cloneCue(track) })) })),
      alignment: { ...program.alignment }, completionCue: program.completionCue ? cloneCue(program.completionCue) : null, runPolicy: { ...program.runPolicy },
    },
  }
}

export function normalizeUnifiedTimerProgram(input: unknown): UnifiedTimerProgram {
  const result = parseUnifiedTimerProgram(input)
  if (!result.ok) throw new Error(result.reason)
  return result.value
}

function cloneCue(cue: CueSettings): CueSettings {
  return { sound: { ...cue.sound }, volume: cue.volume, ...(cue.sounds ? { sounds: cue.sounds.map(sound => ({ ...sound })) } : {}), ...(cue.soundMode ? { soundMode: cue.soundMode } : {}), ...(cue.hapticOverride ? { hapticOverride: cue.hapticOverride === 'off' ? 'off' : { ...cue.hapticOverride } } : {}) }
}

function cueFrom(value: CueSettings): CueSettings {
  return cloneCue({ sound: value.sound, volume: value.volume, ...(value.sounds ? { sounds: value.sounds } : {}), ...(value.soundMode ? { soundMode: value.soundMode } : {}), ...(value.hapticOverride ? { hapticOverride: value.hapticOverride } : {}) })
}

const idFor = (namespace: string, sourceId: string | undefined, role: string) => sourceId && sourceId.length > 0 ? sourceId : `legacy:${namespace}:${role}`
const secondsFrom = (exact: number | undefined, minutes: number, fallbackMinutes: number) => exact ?? (Number.isFinite(minutes) ? Math.round(minutes) * 60 : fallbackMinutes * 60)

function mapTrack(track: PatternTrack, index: number, namespace: string): UnifiedSubBellTrack {
  return {
    ...cueFrom(track), id: idFor(namespace, track.id, `track-${index + 1}`), label: track.label, enabled: track.enabled,
    ...(track.color ? { color: track.color } : {}), showOnWatchFace: track.showOnWatchFace !== false,
    cadenceSeconds: secondsFrom(track.cadenceSeconds, track.cadenceMinutes, 1), repeatEnabled: track.repeatEnabled !== false,
    selectedOffsetsSeconds: [...(track.selectedOffsetsSeconds ?? track.selectedOffsetsMinutes.map(value => value * 60))],
    ...(track.randomRepeat ? { randomRepeat: { ...track.randomRepeat } } : {}),
    ...(track.afterStartSeconds !== undefined ? { afterStartSeconds: track.afterStartSeconds } : {}),
    ...(track.beforeEndSeconds !== undefined ? { beforeEndSeconds: track.beforeEndSeconds } : {}),
  }
}

/** Pure Pattern adapter. Existing IDs, label intent and authored offsets are kept. */
export function convertPatternToUnified(pattern: PatternProgram, sourceKey = 'pattern'): UnifiedTimerProgram {
  return normalizeUnifiedTimerProgram({
    schemaVersion: UNIFIED_TIMER_SCHEMA_VERSION, mode: 'unified',
    steps: [{ id: idFor(sourceKey, undefined, 'step'), label: pattern.label, ...(pattern.labelIsCustom !== undefined ? { labelIsCustom: pattern.labelIsCustom } : {}), durationSeconds: secondsFrom(pattern.mainDurationSeconds, pattern.mainMinutes, 30), endCue: cueFrom(pattern.mainCue), endAlarmEnabled: false, subBellsEnabled: pattern.subBellsEnabled, subBellTracks: pattern.tracks.map((track, index) => mapTrack(track, index, sourceKey)) }],
    alignment: { ...pattern.alignment }, completionCue: pattern.completionCue ? cueFrom(pattern.completionCue) : null, runPolicy: { ...pattern.runPolicy },
  })
}

/** Pure Sequence adapter. Order, IDs, cues, alarms and exact durations survive. */
export function convertSequenceToUnified(sequence: SequenceProgram, sourceKey = 'sequence'): UnifiedTimerProgram {
  return normalizeUnifiedTimerProgram({
    schemaVersion: UNIFIED_TIMER_SCHEMA_VERSION, mode: 'unified',
    steps: sequence.steps.map((step, index) => ({ id: idFor(sourceKey, step.id, `step-${index + 1}`), label: step.label, durationSeconds: secondsFrom(step.durationSeconds, step.durationMinutes, 5), endCue: cueFrom(step), endAlarmEnabled: step.alarmEnabled === true, subBellsEnabled: false, subBellTracks: [] })),
    alignment: { ...sequence.alignment }, completionCue: sequence.completionCue ? cueFrom(sequence.completionCue) : null, runPolicy: { ...sequence.runPolicy },
  })
}

/** Parses V2 Pattern/Sequence records with legacy defaults and deterministic IDs for omissions. */
export function convertLegacyProgramToUnified(input: unknown, sourceKey = 'legacy-import'): UnifiedProgramParseResult {
  let raw = input
  if (typeof input === 'string') {
    try { raw = JSON.parse(input) as unknown } catch { return { ok: false, raw: input, reason: 'Legacy program is not valid JSON' } }
  }
  if (!isRecord(raw) || (raw.schemaVersion !== 2 && raw.schemaVersion !== 3) || (raw.mode !== 'pattern' && raw.mode !== 'sequence')) return { ok: false, raw: input, reason: 'Unsupported legacy program shape or version' }
  try {
    if (raw.mode === 'pattern') {
      if (raw.tracks !== undefined && !Array.isArray(raw.tracks)) return { ok: false, raw: input, reason: 'Pattern tracks must be an array' }
      const rawTracks = (raw.tracks ?? []) as unknown[]
      if (rawTracks.length > MAX_UNIFIED_TRACKS_PER_STEP || rawTracks.some(track => !isRecord(track)) || !uniqueOrMissingIds(rawTracks, 'id')) return { ok: false, raw: input, reason: 'Invalid or duplicate Pattern track list' }
      if (rawTracks.some(entry => { const track = entry as Record<string, unknown>; return track.id !== undefined && !validId(track.id) })) return { ok: false, raw: input, reason: 'Malformed Pattern track id' }
      const patternFieldsValid = optionalType(raw, 'label', value => typeof value === 'string')
        && optionalType(raw, 'labelIsCustom', value => typeof value === 'boolean')
        && optionalType(raw, 'mainMinutes', value => isIntIn(value, 1, 240)) && optionalType(raw, 'mainDurationSeconds', value => isIntIn(value, 1, MAX_CUE_DURATION_SECONDS))
        && optionalType(raw, 'subBellsEnabled', value => typeof value === 'boolean')
        && optionalType(raw, 'mainCue', value => isRecord(value) && legacyCueShapeIsValid(value))
        && legacyCommonFieldsAreValid(raw)
        && rawTracks.every(entry => {
          const track = entry as Record<string, unknown>
          return optionalType(track, 'label', value => typeof value === 'string')
            && optionalType(track, 'enabled', value => typeof value === 'boolean')
            && optionalType(track, 'showOnWatchFace', value => typeof value === 'boolean')
            && optionalType(track, 'color', value => ['violet', 'blue', 'cyan', 'teal', 'green', 'lime', 'amber', 'orange', 'coral', 'rose'].includes(String(value)))
            && optionalType(track, 'cadenceMinutes', value => isIntIn(value, 1, 240)) && optionalType(track, 'cadenceSeconds', value => isIntIn(value, 1, MAX_CUE_DURATION_SECONDS))
            && optionalType(track, 'repeatEnabled', value => typeof value === 'boolean')
            && optionalType(track, 'selectedOffsetsMinutes', value => Array.isArray(value) && value.every(item => isIntIn(item, 1, 240)))
            && optionalType(track, 'selectedOffsetsSeconds', value => Array.isArray(value) && value.every(item => isIntIn(item, 1, MAX_CUE_DURATION_SECONDS)))
            && optionalType(track, 'afterStartSeconds', value => isIntIn(value, 1, MAX_CUE_DURATION_SECONDS)) && optionalType(track, 'beforeEndSeconds', value => isIntIn(value, 1, MAX_CUE_DURATION_SECONDS))
            && optionalType(track, 'randomRepeat', value => isRecord(value) && isIntIn(value.minSeconds, 5, MAX_CUE_DURATION_SECONDS) && isIntIn(value.maxSeconds, value.minSeconds as number, MAX_CUE_DURATION_SECONDS))
            && legacyCueShapeIsValid(track)
        })
      if (!patternFieldsValid) return { ok: false, raw: input, reason: 'Pattern contains malformed field values' }
      const seeded = {
        ...raw,
        tracks: rawTracks.map((entry, index) => { const track = entry as Record<string, unknown>; return { ...track, id: validId(track.id) ? track.id : `legacy:${sourceKey}:track-${index + 1}` } }),
      } as unknown as PatternProgram
      if (!uniqueOrMissingIds(seeded.tracks, 'id')) return { ok: false, raw: input, reason: 'Generated Pattern track id collides with an existing id' }
      const normalized = normalizePatternProgram(seeded)
      // Preserve authored offsets outside the current shortened duration; runtime generation filters them.
      const normalizedById = new Map(normalized.tracks.map(track => [track.id, track]))
      const tracks = rawTracks.map((entry, index) => {
        const source = entry as Record<string, unknown>
        const id = validId(source.id) ? source.id : `legacy:${sourceKey}:track-${index + 1}`
        const track = normalizedById.get(id)
        if (!track) throw new Error('Normalized Pattern track identity was not retained')
        const offsets = Array.isArray(source.selectedOffsetsSeconds)
          ? source.selectedOffsetsSeconds
          : Array.isArray(source.selectedOffsetsMinutes) ? source.selectedOffsetsMinutes.map(value => typeof value === 'number' ? value * 60 : value) : track.selectedOffsetsSeconds ?? track.selectedOffsetsMinutes.map(value => value * 60)
        return { ...track, ...(typeof source.enabled === 'boolean' ? { enabled: source.enabled } : {}), selectedOffsetsMinutes: [], selectedOffsetsSeconds: offsets as number[] }
      })
      return { ok: true, value: convertPatternToUnified({ ...normalized, tracks }, sourceKey) }
    }
    if (raw.steps !== undefined && !Array.isArray(raw.steps)) return { ok: false, raw: input, reason: 'Sequence steps must be an array' }
    const rawSteps = (raw.steps ?? []) as unknown[]
    if (rawSteps.length < 1 || rawSteps.length > MAX_UNIFIED_STEPS || rawSteps.some(step => !isRecord(step)) || !uniqueOrMissingIds(rawSteps, 'id')) return { ok: false, raw: input, reason: 'Invalid or duplicate Sequence step list' }
    if (rawSteps.some(entry => { const step = entry as Record<string, unknown>; return step.id !== undefined && !validId(step.id) })) return { ok: false, raw: input, reason: 'Malformed Sequence step id' }
    const sequenceFieldsValid = rawSteps.every(entry => {
      const step = entry as Record<string, unknown>
      return optionalType(step, 'label', value => typeof value === 'string')
        && optionalType(step, 'durationMinutes', value => isIntIn(value, 1, 240)) && optionalType(step, 'durationSeconds', value => isIntIn(value, 1, MAX_CUE_DURATION_SECONDS))
        && optionalType(step, 'alarmEnabled', value => typeof value === 'boolean')
        && legacyCueShapeIsValid(step)
    })
    if (!sequenceFieldsValid || !legacyCommonFieldsAreValid(raw)) return { ok: false, raw: input, reason: 'Sequence contains malformed field values' }
    const seeded = {
      ...raw,
      steps: rawSteps.map((entry, index) => { const step = entry as Record<string, unknown>; return { ...step, id: validId(step.id) ? step.id : `legacy:${sourceKey}:step-${index + 1}` } }),
    } as unknown as SequenceProgram
    if (!uniqueOrMissingIds(seeded.steps, 'id')) return { ok: false, raw: input, reason: 'Generated Sequence step id collides with an existing id' }
    return { ok: true, value: convertSequenceToUnified(normalizeSequenceProgram(seeded), sourceKey) }
  } catch (error) {
    return { ok: false, raw: input, reason: error instanceof Error ? error.message : 'Legacy program could not be converted' }
  }
}

/** Legacy V1 conversion deliberately replaces the old random migration ID with a stable namespace ID. */
export function convertLegacyConfigStateToUnified(config: Partial<TimerConfig>): {
  program: UnifiedTimerProgram
  settings: AppTimerSettings
  soundLibrary: SoundRef[]
  /** Preserved migration evidence; runtime decides whether this is still active. */
  legacyRuntime: { alarmModeEnabled: boolean }
} {
  if (!isRecord(config)) throw new Error('Legacy config must be an object')
  const numeric = ['mainInterval', 'subInterval', 'snapOffset', 'volume', 'activeHoursStart', 'activeHoursEnd', 'activeHoursDays', 'alarmDurationSeconds']
  const boolean = ['snapEnabled', 'subEnabled', 'notificationsEnabled', 'focusModeEnabled', 'alarmModeEnabled', 'activeHoursEnabled']
  if (numeric.some(key => config[key as keyof TimerConfig] !== undefined && (typeof config[key as keyof TimerConfig] !== 'number' || !Number.isFinite(config[key as keyof TimerConfig] as number)))
    || boolean.some(key => config[key as keyof TimerConfig] !== undefined && typeof config[key as keyof TimerConfig] !== 'boolean')) throw new Error('Legacy config contains invalid field types')
  const migrated = migrateLegacyConfig(config)
  const pattern = { ...migrated.workingPrograms.pattern, tracks: migrated.workingPrograms.pattern.tracks.map((track, index) => ({ ...track, id: `legacy:v1:track-${index + 1}` })) }
  const settings = structuredCloneSafe(migrated.settings)
  settings.availability.weeklyWindows = settings.availability.weeklyWindows.map((window, index) => ({ ...window, id: `legacy:v1:availability-window-${index + 1}` }))
  return {
    program: convertPatternToUnified(pattern, 'v1'),
    settings,
    soundLibrary: [],
    legacyRuntime: { alarmModeEnabled: config.alarmModeEnabled === true },
  }
}

export function convertLegacyConfigToUnified(config: Partial<TimerConfig>): UnifiedTimerProgram {
  return convertLegacyConfigStateToUnified(config).program
}

export interface LegacyWorkingRecovery { sourceMode: TimerMode; program: UnifiedTimerProgram }

/** Converts both working copies; the nonselected program remains explicitly recoverable. */
export function convertLegacyWorkingPrograms(state: WorkingProgramState): { selected: UnifiedTimerProgram; recoveries: LegacyWorkingRecovery[]; sourcePreset?: WorkingProgramState['sourcePreset'] } {
  const selected = state.selectedMode === 'pattern' ? convertPatternToUnified(state.pattern, 'working-pattern') : convertSequenceToUnified(state.sequence, 'working-sequence')
  const other = state.selectedMode === 'pattern'
    ? { sourceMode: 'sequence' as const, program: convertSequenceToUnified(state.sequence, 'working-sequence') }
    : { sourceMode: 'pattern' as const, program: convertPatternToUnified(state.pattern, 'working-pattern') }
  return { selected, recoveries: [other], ...(state.sourcePreset ? { sourcePreset: { ...state.sourcePreset } } : {}) }
}

/** Converts all V2 authored records without changing captured settings or shared sounds. */
export function convertTimerV2State(state: TimerV2State): {
  selected: UnifiedTimerProgram; recoveries: LegacyWorkingRecovery[]; sourcePreset?: WorkingProgramState['sourcePreset']; settings: AppTimerSettings
  presets: Array<{ id: string; name: string; createdAt: number; program: UnifiedTimerProgram; settings?: AppTimerSettings; showInRunningSelector: boolean }>
  soundLibrary: SoundRef[]
} {
  const selected = convertLegacyWorkingPrograms(state.workingPrograms)
  const clone = structuredCloneSafe
  return {
    ...selected, settings: clone(state.settings),
    presets: state.presets.map(preset => ({ id: preset.id, name: preset.name, createdAt: preset.createdAt, program: preset.program.mode === 'pattern' ? convertPatternToUnified(preset.program, `preset-${preset.id}`) : convertSequenceToUnified(preset.program, `preset-${preset.id}`), ...(preset.settings ? { settings: clone(preset.settings) } : {}), showInRunningSelector: preset.showInRunningSelector !== false })),
    soundLibrary: state.soundLibrary.map(sound => ({ ...sound })),
  }
}

function structuredCloneSafe<T>(value: T): T {
  if (typeof structuredClone === 'function') return structuredClone(value)
  return JSON.parse(JSON.stringify(value)) as T
}

