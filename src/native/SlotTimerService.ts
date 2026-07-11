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
}

interface SlotTimerServiceModule {
  start(config: NativeTimerConfig): void
  update(config: Partial<NativeTimerConfig>): void
  stop(): void
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
}
