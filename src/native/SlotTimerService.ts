// Typed JS wrapper around the native "SlotTimerService" Expo module
// (modules/slot-timer-service — Kotlin, Android foreground service).
//
// The service owns tick scheduling, sound (gong/bell/bg music) playback, and the
// ongoing "Next gong at HH:MM" notification, so it keeps chiming accurately whether
// the app is foregrounded, backgrounded, or the screen is off — no JS keep-alive
// needed. When the native module isn't present (mid-development build, or a
// platform without it), `isAvailable` is false and callers should fall back to
// the JS-only foreground timer (see useTimer.ts).
import { Platform } from 'react-native'
import { requireOptionalNativeModule } from 'expo-modules-core'

export interface NativeTimerConfig {
  mainMs: number
  subMs: number
  phase: number
  subEnabled: boolean
  volume: number       // 0–1, gong/bell volume
  bgTrack: 1 | 2 | 3
  bgVolume: number      // 0–1, 0 = no bg music
  notificationsEnabled: boolean
  alarmModeEnabled: boolean // main gong becomes a continuous, dismissable alarm
}

interface AlarmStateEvent {
  ringing: boolean
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
  addListener(eventName: 'onAlarmStateChanged', listener: (event: AlarmStateEvent) => void): EventSubscription
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
  // Live updates while the app is open — the counterpart to isRinging() above.
  addAlarmListener(listener: (ringing: boolean) => void): EventSubscription | null {
    return native?.addListener('onAlarmStateChanged', e => listener(e.ringing)) ?? null
  },
}
