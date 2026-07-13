// Typed JS wrapper around the native "SlotTimerService" Expo module
// (modules/slot-timer-service — Kotlin, Android exact-alarm scheduler).
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
}

interface AlarmStateEvent {
  ringing: boolean
}

export interface NativeControlState {
  alarmOnceArmed: boolean
  mutedUntil: number
  mutedIterationsRemaining: number
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
  alarmOnceArmed?: boolean
  mutedUntil?: number
  mutedIterationsRemaining?: number
}

interface EventSubscription {
  remove(): void
}

interface SlotTimerServiceModule {
  start(config: NativeTimerConfig): void
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
  addListener(eventName: 'onAlarmStateChanged', listener: (event: AlarmStateEvent) => void): EventSubscription
  addListener(eventName: 'onControlStateChanged', listener: (event: NativeControlState) => void): EventSubscription
}

const native = Platform.OS === 'android'
  ? requireOptionalNativeModule<SlotTimerServiceModule>('SlotTimerService')
  : null

export const isNativeServiceAvailable = native !== null

export const SlotTimerService = {
  start(config: NativeTimerConfig) {
    native?.start(config)
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
  // Live updates while the app is open — the counterpart to isRinging() above.
  addAlarmListener(listener: (ringing: boolean) => void): EventSubscription | null {
    return native?.addListener('onAlarmStateChanged', e => listener(e.ringing)) ?? null
  },
  addControlListener(listener: (state: NativeControlState) => void): EventSubscription | null {
    return native?.addListener('onControlStateChanged', listener) ?? null
  },
}
