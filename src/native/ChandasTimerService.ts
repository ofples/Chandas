// Typed JS wrapper around the native "ChandasTimerService" Expo module
// (modules/chandas-timer-service - Kotlin, Android exact-alarm scheduler).
//
// AlarmManager owns tick scheduling; a foreground service is used only while a
// continuous alarm is actively ringing. When the native module isn't present,
// callers fall back to
// the JS-only foreground timer (see useTimer.ts).
import { Platform } from 'react-native'
import { requireOptionalNativeModule } from 'expo-modules-core'

export interface NativeTimerConfig {
  mainMs: number
  subMs: number
  phase: number
  subEnabled: boolean
  volume: number       // 0–1, gong/bell volume
  notificationsEnabled: boolean
  focusModeEnabled: boolean
  alarmModeEnabled: boolean // main gong becomes a continuous, dismissable alarm
  activeHoursEnabled: boolean
  activeHoursStart: number
  activeHoursEnd: number
  activeHoursDays: number
  alarmDurationSeconds: number
  /** Serialized V2 Pattern/Sequence program. Native keeps this opaque until scheduling. */
  timerV2Program?: string
  /** Absolute V2 timeline anchor in epoch milliseconds. */
  timerV2Anchor?: number
  alarmOnceArmed?: boolean
  mutedUntil?: number
  mutedIterationEndId?: string
  mutedIterationEndAt?: number
}

interface AlarmStateEvent {
  ringing: boolean
}

export interface NativeControlState {
  alarmOnceArmed: boolean
  mutedUntil: number
  mutedIterationsRemaining: number
  mutedIterationEndId?: string
  mutedIterationEndAt?: number
}

export interface NativeTimerState {
  active: boolean
  ringing: boolean
  mainMs?: number
  subMs?: number
  phase?: number
  subEnabled?: boolean
  volume?: number
  notificationsEnabled?: boolean
  focusModeEnabled?: boolean
  alarmModeEnabled?: boolean
  activeHoursEnabled?: boolean
  activeHoursStart?: number
  activeHoursEnd?: number
  activeHoursDays?: number
  alarmDurationSeconds?: number
  timerV2Program?: string
  timerV2Anchor?: number
  alarmOnceArmed?: boolean
  mutedUntil?: number
  mutedIterationsRemaining?: number
  mutedIterationEndId?: string
  mutedIterationEndAt?: number
  nextEventAt?: number
  nextLogicalId?: string
  sessionGeneration?: string
}

export interface NativeTimerEvent {
  at: number
  logicalId: string
  boundary: 'pattern-main' | 'pattern-offset' | 'sequence-step' | 'sequence-cycle'
  winnerCueId: string
  collision: boolean
  suppressed: boolean
  suppressionReason: 'none' | 'call-active' | 'master-muted' | 'user-mute'
}

interface EventSubscription {
  remove(): void
}

interface ChandasTimerServiceModule {
  start(config: NativeTimerConfig): boolean
  update(config: Partial<NativeTimerConfig>): void
  stop(): void
  stopAlarm(): void
  isRinging(): boolean
  getState(): NativeTimerState
  canScheduleExactAlarms(): boolean
  openExactAlarmSettings(): void
  canUseFullScreenIntent(): boolean
  openFullScreenIntentSettings(): void
  hasNotificationPolicyAccess(): boolean
  isFocusModeActive(): boolean
  openNotificationPolicySettings(): void
  refreshFocusMode(): void
  setFocusModeEnabled(enabled: boolean): void
  toggleAlarmOnce(): void
  muteForIterations(count: number): void
  muteForMinutes(minutes: number): void
  clearMute(): void
  pickDeviceSound(kind: 'alarm' | 'notification' | 'unknown'): Promise<{ uri: string; title: string } | null>
  addListener(eventName: 'onAlarmStateChanged', listener: (event: AlarmStateEvent) => void): EventSubscription
  addListener(eventName: 'onControlStateChanged', listener: (event: NativeControlState) => void): EventSubscription
  addListener(eventName: 'onTimerEventFired', listener: (event: NativeTimerEvent) => void): EventSubscription
}

const native = Platform.OS === 'android'
  ? requireOptionalNativeModule<ChandasTimerServiceModule>('ChandasTimerService')
  : null

export const isNativeServiceAvailable = native !== null

export const ChandasTimerService = {
  start(config: NativeTimerConfig) {
    return native?.start(config) ?? false
  },
  update(config: Partial<NativeTimerConfig>) {
    native?.update(config)
  },
  stop() {
    native?.stop()
  },
  // Dismisses an in-progress alarm-mode ring without stopping the whole timer —
  // normal tick scheduling resumes for the next interval.
  stopAlarm() {
    native?.stopAlarm()
  },
  // Synchronous query for cold-start/resume: is the alarm ringing right now?
  // (e.g. the app was relaunched from the alarm's full-screen notification).
  isRinging(): boolean {
    return native?.isRinging() ?? false
  },
  getState(): NativeTimerState {
    return native?.getState() ?? { active: false, ringing: false }
  },
  canScheduleExactAlarms(): boolean {
    return native?.canScheduleExactAlarms() ?? true
  },
  openExactAlarmSettings() {
    native?.openExactAlarmSettings()
  },
  canUseFullScreenIntent(): boolean {
    return native?.canUseFullScreenIntent() ?? true
  },
  openFullScreenIntentSettings() {
    native?.openFullScreenIntentSettings()
  },
  hasNotificationPolicyAccess(): boolean {
    return native?.hasNotificationPolicyAccess() ?? false
  },
  isFocusModeActive(): boolean {
    return native?.isFocusModeActive() ?? false
  },
  openNotificationPolicySettings() {
    native?.openNotificationPolicySettings()
  },
  refreshFocusMode() {
    native?.refreshFocusMode()
  },
  setFocusModeEnabled(enabled: boolean) {
    native?.setFocusModeEnabled(enabled)
  },
  toggleAlarmOnce() {
    native?.toggleAlarmOnce()
  },
  muteForIterations(count: number) {
    native?.muteForIterations(count)
  },
  muteForMinutes(minutes: number) {
    native?.muteForMinutes(minutes)
  },
  clearMute() {
    native?.clearMute()
  },
  async pickDeviceSound(kind: 'alarm' | 'notification' | 'unknown'): Promise<{ uri: string; title: string } | null> {
    return native?.pickDeviceSound(kind) ?? null
  },
  // Live updates while the app is open — the counterpart to isRinging() above.
  addAlarmListener(listener: (ringing: boolean) => void): EventSubscription | null {
    return native?.addListener('onAlarmStateChanged', e => listener(e.ringing)) ?? null
  },
  addControlListener(listener: (state: NativeControlState) => void): EventSubscription | null {
    return native?.addListener('onControlStateChanged', listener) ?? null
  },
  addTimerEventListener(listener: (event: NativeTimerEvent) => void): EventSubscription | null {
    return native?.addListener('onTimerEventFired', listener) ?? null
  },
}
