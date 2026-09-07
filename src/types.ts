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
  | 'alarm-tone'
  | 'temple-gong'
  | 'clear-bell'
  | 'bloom'
  | 'boxing-bell'
  | 'bubble'
  | 'champagne'
  | 'cymbal'
  | 'handpan'
  | 'heartbeat'
  | 'ice'
  | 'instamatic'
  | 'mouse-click'
  | 'page'
  | 'sine-bass'
  | 'sine-high'
  | 'sine-low'
  | 'water-drop'
  | 'wind'

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
  /** Visual identity only; timing and collision precedence remain unchanged. */
  color?: SubBellColorId
  enabled: boolean
  cadenceMinutes: number
  selectedOffsetsMinutes: number[]
}

export type SubBellColorId =
  | 'violet'
  | 'blue'
  | 'cyan'
  | 'teal'
  | 'green'
  | 'lime'
  | 'amber'
  | 'orange'
  | 'coral'
  | 'rose'

export type TimerAlignment = { kind: 'elapsed' } | { kind: 'local-clock'; offsetMinutes: number }

export interface PatternProgram {
  schemaVersion: 2
  mode: 'pattern'
  label: string
  /** False while the duration-derived default label should follow duration changes. */
  labelIsCustom?: boolean
  mainMinutes: number
  /** Exact duration used by second-precision runtimes; absent legacy values use mainMinutes. */
  mainDurationSeconds?: number
  mainCue: CueSettings
  /** Optional distinct cue used only when a bounded run reaches its terminal instant. */
  completionCue: CueSettings | null
  /** Keeps configured tracks intact while the whole sub-bell layer is hidden. */
  subBellsEnabled: boolean
  tracks: PatternTrack[]
  alignment: TimerAlignment
  runPolicy: RunPolicy
}

export interface SequenceStep extends CueSettings {
  id: string
  durationMinutes: number
  /** Exact duration used by second-precision runtimes; absent legacy values use durationMinutes. */
  durationSeconds?: number
  label: string
}

export interface SequenceProgram {
  schemaVersion: 2
  mode: 'sequence'
  steps: SequenceStep[]
  /** Aligns the complete repeating round, rather than any individual step. */
  alignment: TimerAlignment
  /** Optional distinct cue used only when a bounded run reaches its terminal instant. */
  completionCue: CueSettings | null
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

export type HapticPattern = 'single' | 'double' | 'triple'
export type HapticStrength = 'gentle' | 'balanced' | 'strong'

export interface HapticProfile {
  pattern: HapticPattern
  strength: HapticStrength
}

export interface TimerHapticsSettings {
  /** Master haptics switch. App feedback follows this without its own profile. */
  enabled: boolean
  main: HapticProfile
  subBell: HapticProfile
  /** Repeats as a pattern group until a ringing alarm is dismissed. */
  alarm: HapticProfile
}

export interface AppTimerSettings {
  masterVolume: number
  /** Whether optional setup controls are visible on configuration and running screens. */
  advancedModeEnabled: boolean
  /** Reveals seconds in custom interval and bounded-run duration editors. */
  secondPrecisionEnabled: boolean
  /** Global looping sound used by Alarm Once and Alarm Locked. */
  alarmSound: SoundRef
  /** Per-alarm level multiplied by the master and Android Alarm volumes. */
  alarmVolume: number
  haptics: TimerHapticsSettings
  notificationsEnabled: boolean
  /** Shows a native countdown to the next cue in the running notification. */
  liveCountdownEnabled: boolean
  muteDuringCallsEnabled: boolean
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
