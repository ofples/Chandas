export interface TimerConfig {
  mainInterval: number    // minutes
  subInterval: number     // minutes
  snapEnabled: boolean
  snapOffset: number      // minutes (0–59)
  subEnabled: boolean          // whether sub-interval bell is active
  notificationsEnabled: boolean
  focusModeEnabled: boolean
  volume: number          // 0–1 (gong/bell volume)
  alarmModeEnabled: boolean // main gong becomes a continuous alarm (looping, full-screen) until dismissed
  activeHoursEnabled: boolean
  activeHoursStart: number // local minutes after midnight
  activeHoursEnd: number   // local minutes after midnight
  activeHoursDays: number  // Sunday-first seven-bit mask
  alarmDurationSeconds: number
}

export type AppState = 'config' | 'running'

// Timer v2 keeps program structure separate from the app-wide settings below.
// TimerConfig remains during migration so existing installations can be read
// without losing their v1 data before v2 records are safely persisted.
export type TimerMode = 'pattern' | 'sequence'

export type BuiltInSoundId =
  | 'temple-gong'
  | 'clear-bell'
  | 'soft-bowl'
  | 'wood-block'
  | 'bright-chime'

export type SoundRef =
  | { kind: 'builtin'; id: BuiltInSoundId }
  | { kind: 'android'; uri: string; title: string; ringtoneType: 'alarm' | 'notification' | 'unknown' }
  | { kind: 'document'; uri: string; title: string; mimeType?: string }

export interface CueSettings {
  sound: SoundRef
  volume: number
}

export interface RunPolicy {
  kind: 'continuous' | 'cycles' | 'duration'
  /** Preserved even while another kind is selected. */
  cycleCount: number
  /** Preserved even while another kind is selected. */
  durationSeconds: number
}

export interface PatternTrack extends CueSettings {
  id: string
  label: string
  enabled: boolean
  cadenceMinutes: number
  selectedOffsetsMinutes: number[]
}

export interface PatternProgram {
  schemaVersion: 2
  mode: 'pattern'
  label: string
  mainMinutes: number
  mainCue: CueSettings
  /** Optional one-shot cue played only for a fresh start. */
  startCue?: CueSettings
  /** Optional override for the final cue of a bounded run. */
  endCue?: CueSettings
  tracks: PatternTrack[]
  alignment: { kind: 'elapsed' } | { kind: 'local-clock'; offsetMinutes: number }
  runPolicy: RunPolicy
}

export interface SequenceStep extends CueSettings {
  id: string
  durationMinutes: number
  label: string
}

export interface SequenceProgram {
  schemaVersion: 2
  mode: 'sequence'
  steps: SequenceStep[]
  /** Optional one-shot cue played only for a fresh start. */
  startCue?: CueSettings
  /** Optional override for the final cue of a bounded run. */
  endCue?: CueSettings
  runPolicy: RunPolicy
}

export type TimerProgram = PatternProgram | SequenceProgram

export interface ProgramPreset {
  id: string
  name: string
  createdAt: number
  program: TimerProgram
}

export interface WorkingProgramState {
  pattern: PatternProgram
  sequence: SequenceProgram
  selectedMode: TimerMode
  sourcePreset?: { id: string; name: string; createdAt: number; deleted?: boolean }
}

export interface WeeklyAvailabilityWindow {
  id: string
  enabled: boolean
  startMinutes: number
  endMinutes: number
  days: number
}

/**
 * Calendar integrations resolve external events into these small, native-safe
 * records. The timer scheduler never needs direct calendar access.
 */
export interface AvailabilityOverride {
  id: string
  startAt: number
  endAt: number
  behavior: 'active' | 'mute'
  source: 'calendar'
  sourceId?: string
}

export interface AvailabilityPolicy {
  enabled: boolean
  weeklyWindows: WeeklyAvailabilityWindow[]
  overrides: AvailabilityOverride[]
}

export interface AppTimerSettings {
  masterVolume: number
  notificationsEnabled: boolean
  availability: AvailabilityPolicy
  focusAutomationEnabled: boolean
  alarmDurationSeconds: number
}

export type AlarmBehavior = 'off' | 'once' | 'locked'

export interface TimerV2State {
  schemaVersion: 2
  workingPrograms: WorkingProgramState
  settings: AppTimerSettings
  presets: ProgramPreset[]
}
