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
  soundMuted?: boolean
  /** Additive v2.1 list; legacy sound remains the first/fallback selection. */
  sounds?: SoundRef[]
  soundMode?: 'single' | 'sequence' | 'random'
  /** Undefined inherits the appropriate global profile. */
  hapticOverride?: 'off' | { pattern: HapticPattern; strength: HapticStrength }
}

export interface RunPolicy {
  kind: 'continuous' | 'cycles' | 'duration' | 'until'
  /** Local time of day. A run resolves this to its next occurrence at Start. */
  untilMinutes?: number
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
  /** False omits this cue from watchface markers and display countdowns; it still sounds. */
  showOnWatchFace?: boolean
  enabled: boolean
  cadenceMinutes: number
  /** Exact repeat interval; absent legacy values use cadenceMinutes. */
  cadenceSeconds?: number
  /** A track may be one-off only while retaining its cadence settings. */
  repeatEnabled?: boolean
  /** Explicit interior cue, independent of selected repeating occurrences. */
  afterStartSeconds?: number
  /** Explicit interior cue counted backward from the main boundary. */
  beforeEndSeconds?: number
  /** Advanced cadence: deterministic random gaps between interior cues. */
  randomRepeat?: { minSeconds: number; maxSeconds: number }
  selectedOffsetsMinutes: number[]
  /** Exact cue positions; absent legacy values use selectedOffsetsMinutes. */
  selectedOffsetsSeconds?: number[]
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
  schemaVersion: 3
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
  /** Ring a dismissible alarm at this step's end instead of a one-shot cue. */
  alarmEnabled?: boolean
  durationMinutes: number
  /** Exact duration used by second-precision runtimes; absent legacy values use durationMinutes. */
  durationSeconds?: number
  label: string
}

export interface SequenceProgram {
  schemaVersion: 3
  mode: 'sequence'
  steps: SequenceStep[]
  /** Aligns the complete repeating round, rather than any individual step. */
  alignment: TimerAlignment
  /** Optional distinct cue used only when a bounded run reaches its terminal instant. */
  completionCue: CueSettings | null
  runPolicy: RunPolicy
}

export type TimerProgram = PatternProgram | SequenceProgram

/** Schema 4: the single authored timer shape used by the unified editor/runtime. */
export interface BellPoint {
  id: string
  kind: 'percent' | 'start' | 'end'
  /** Percentage (0.1 to 99.9), or an exact number of seconds. */
  value: number
}

export interface UnifiedSubBellTrack extends CueSettings {
  id: string
  label: string
  enabled: boolean
  color?: SubBellColorId
  showOnWatchFace: boolean
  cadenceSeconds: number
  repeatEnabled: boolean
  selectedOffsetsSeconds: number[]
  randomRepeat?: { minSeconds: number; maxSeconds: number }
  afterStartSeconds?: number
  beforeEndSeconds?: number
  points?: BellPoint[]
}

export interface UnifiedTimerStep {
  id: string
  label: string
  color?: SubBellColorId
  /** Retains the Pattern label's automatic/custom intent through migration. */
  labelIsCustom?: boolean
  durationSeconds: number
  endCue: CueSettings
  /** Authored step-end alarm preference; Alarm Once/Locked remain session state. */
  endAlarmEnabled: boolean
  subBellsEnabled: boolean
  subBellTracks: UnifiedSubBellTrack[]
}

export interface UnifiedTimerProgram {
  schemaVersion: 4
  mode: 'unified'
  /** A single step whose bells run from the timer anchor without main boundaries. */
  noMainInterval?: boolean
  steps: UnifiedTimerStep[]
  alignment: TimerAlignment
  completionCue: CueSettings | null
  runPolicy: RunPolicy
  /** Alarm mode selected for each new run of this saved timer. */
  alarmBehavior: 'off' | 'once' | 'locked'
  alarmOverrides?: { sound?: SoundRef | null; durationSeconds?: number | null }
}

/** Legacy snapshots remain runnable until explicitly stopped or safely upgraded. */
export type RuntimeTimerProgram = TimerProgram | UnifiedTimerProgram

export interface ProgramPreset {
  id: string
  name: string
  createdAt: number
  program: TimerProgram
  /** Timer preferences captured with this program, including its schedule and advanced controls. */
  settings?: AppTimerSettings
  /** Library metadata, deliberately outside the immutable saved program. */
  showInRunningSelector?: boolean
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
  /** Missing legacy values are active. Quiet subtracts from active windows. */
  behavior?: 'active' | 'mute'
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
  /** Individually enabled controls on the running timer. Missing means legacy advancedModeEnabled behavior. */
  runningControlIds?: RunningControlId[]
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

export type RunningControlId = 'restart' | 'clock' | 'alarm' | 'stepAlarm' | 'focus' | 'sound' | 'scrub'

export type AlarmBehavior = 'off' | 'once' | 'locked'

export interface TimerV2State {
  schemaVersion: 2
  workingPrograms: WorkingProgramState
  settings: AppTimerSettings
  presets: ProgramPreset[]
  /** Device-local imported sounds, available to every cue independently of its selections. */
  soundLibrary: SoundRef[]
}
