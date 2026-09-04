// Typed JS wrapper around the native "ChandasTimerService" Expo module
// (modules/chandas-timer-service - Kotlin, Android exact-alarm scheduler).
//
// AlarmManager owns tick scheduling; a foreground service is used only while a
// continuous alarm is actively ringing. When the native module isn't present,
// callers fall back to
// the JS-only foreground timer (see useTimer.ts).
import { AppState, Platform } from 'react-native'
import { requireOptionalNativeModule } from 'expo-modules-core'
import { createAudioPlayer, type AudioPlayer } from 'expo-audio'
import type { BuiltInSoundId, SoundRef } from '../types'
import { sourceForSound } from '../lib/soundLibrary'

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
  /** Serialized availability policy; legacy active-hours fields remain as fallback. */
  availabilityPolicy?: string
  alarmDurationSeconds: number
  /** Serialized V2 Pattern/Sequence program. Native keeps this opaque until scheduling. */
  timerV2Program?: string
  /** Absolute V2 timeline anchor in epoch milliseconds. */
  timerV2Anchor?: number
  /** Accepted Start time, distinct from a snapped Pattern's phase anchor. */
  timerV2StartedAt?: number
  timerV2EndsAt?: number
  alarmOnceArmed?: boolean
  mutedUntil?: number
  mutedIterationEndId?: string
  mutedIterationEndAt?: number
  mutedIterationCount?: number
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
  availabilityPolicy?: string
  alarmDurationSeconds?: number
  timerV2Program?: string
  timerV2Anchor?: number
  timerV2StartedAt?: number
  timerV2EndsAt?: number
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
  firedAt?: number
  logicalId: string
  boundary: 'pattern-main' | 'pattern-offset' | 'sequence-step' | 'sequence-cycle' | 'run-complete'
  winnerCueId: string
  collision: boolean
  suppressed: boolean
  completesRun?: boolean
  suppressionReason: 'none' | 'call-active' | 'master-muted' | 'user-mute' | 'outside-active-hours'
}

export interface NativeScheduleState {
  active: boolean
  timerV2Anchor: number
  nextEventAt: number
  nextLogicalId?: string
  exactTimingAvailable: boolean
}

export interface NativeFocusState {
  policyAccess: boolean
  automationEnabled: boolean
  ruleExists: boolean
  ruleEnabled: boolean
  actual: 'inactive' | 'active' | 'unknown'
  reason: 'off' | 'timer-stopped' | 'outside-active-hours' | 'active' | 'paused-by-android' | 'rule-disabled' | 'access-required' | 'unknown'
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
  areNotificationsEnabled(): boolean
  openNotificationSettings(): void
  openFullScreenIntentSettings(): void
  hasNotificationPolicyAccess(): boolean
  isFocusModeActive(): boolean
  getFocusState(): NativeFocusState
  openNotificationPolicySettings(): void
  openFocusRuleSettings(): void
  refreshFocusMode(): void
  setFocusModeEnabled(enabled: boolean): void
  toggleAlarmOnce(): void
  muteForIterations(count: number): void
  muteForMinutes(minutes: number): void
  clearMute(): void
  pickDeviceSound(kind: 'alarm' | 'notification' | 'unknown'): Promise<{ uri: string; title: string } | null>
  pickAudioDocument(): Promise<{ uri: string; title: string; mimeType?: string } | null>
  previewSound(soundId: string, fallbackSoundId: BuiltInSoundId, volume: number): Promise<boolean>
  stopSoundPreview(): void
  isSoundAvailable(soundId: string): boolean
  addListener(eventName: 'onAlarmStateChanged', listener: (event: AlarmStateEvent) => void): EventSubscription
  addListener(eventName: 'onControlStateChanged', listener: (event: NativeControlState) => void): EventSubscription
  addListener(eventName: 'onTimerEventFired', listener: (event: NativeTimerEvent) => void): EventSubscription
  addListener(eventName: 'onFocusStateChanged', listener: (event: NativeFocusState) => void): EventSubscription
  addListener(eventName: 'onTimerStateChanged', listener: (event: NativeScheduleState) => void): EventSubscription
}

const native = Platform.OS === 'android'
  ? requireOptionalNativeModule<ChandasTimerServiceModule>('ChandasTimerService')
  : null

export const isNativeServiceAvailable = native !== null
let fallbackPreview: AudioPlayer | null = null
AppState.addEventListener('change', state => {
  if (state === 'active') return
  native?.stopSoundPreview()
  fallbackPreview?.remove()
  fallbackPreview = null
})

export const ChandasTimerService = {
  start(config: NativeTimerConfig) {
    return native?.start(config) ?? false
  },
  update(config: Partial<NativeTimerConfig>) {
    native?.update(config)
  },
  stop() {
    try {
      native?.stop()
      return true
    } catch (error) {
      // Older Android builds clear alarm-window flags synchronously after the
      // persisted timer has already been stopped. Keep that UI cleanup error
      // from taking down the React tree or trapping the running screen.
      if (__DEV__) console.warn('Native timer stop cleanup failed', error)
      return false
    }
  },
  // Dismisses an in-progress alarm-mode ring without stopping the whole timer —
  // normal tick scheduling resumes for the next interval.
  stopAlarm() {
    try {
      native?.stopAlarm()
      return true
    } catch (error) {
      if (__DEV__) console.warn('Native alarm cleanup failed', error)
      return false
    }
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
  areNotificationsEnabled(): boolean {
    return native?.areNotificationsEnabled() ?? true
  },
  openNotificationSettings() {
    native?.openNotificationSettings()
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
  getFocusState(): NativeFocusState {
    return native?.getFocusState() ?? { policyAccess: false, automationEnabled: false, ruleExists: false, ruleEnabled: false, actual: 'unknown', reason: 'unknown' }
  },
  openNotificationPolicySettings() {
    native?.openNotificationPolicySettings()
  },
  openFocusRuleSettings() {
    native?.openFocusRuleSettings()
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
  async pickAudioDocument(): Promise<{ uri: string; title: string; mimeType?: string } | null> {
    return native?.pickAudioDocument() ?? null
  },
  async previewSound(sound: SoundRef, volume: number, fallbackSoundId: BuiltInSoundId = 'clear-bell'): Promise<boolean> {
    const soundId = sound.kind === 'builtin' ? sound.id : sound.uri
    if (native) return native.previewSound(soundId, fallbackSoundId, volume)
    fallbackPreview?.remove()
    fallbackPreview = null
    const source = sourceForSound(sound)
    if (!source) return false
    const player = createAudioPlayer(source)
    player.volume = Math.max(0, Math.min(1, volume))
    player.play()
    fallbackPreview = player
    return true
  },
  stopSoundPreview() {
    native?.stopSoundPreview()
    fallbackPreview?.remove()
    fallbackPreview = null
  },
  isSoundAvailable(sound: SoundRef): boolean {
    if (sound.kind === 'builtin') return true
    return native?.isSoundAvailable(sound.uri) ?? false
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
  addFocusListener(listener: (state: NativeFocusState) => void): EventSubscription | null {
    return native?.addListener('onFocusStateChanged', listener) ?? null
  },
  addTimerStateListener(listener: (state: NativeScheduleState) => void): EventSubscription | null {
    return native?.addListener('onTimerStateChanged', listener) ?? null
  },
}
