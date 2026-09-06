import * as Haptics from 'expo-haptics'
import type { HapticProfile, TimerHapticsSettings } from '../types'
import type { NativeTimerEvent } from '../native/ChandasTimerService'
import { ChandasTimerService, isNativeServiceAvailable } from '../native/ChandasTimerService'

let appHapticsEnabled = true
let repeatingAlarmTimer: ReturnType<typeof setInterval> | null = null

export function setAppHapticsEnabled(enabled: boolean): void {
  appHapticsEnabled = enabled
  if (!enabled) stopRepeatingAlarmHaptic()
}

/** Fire-and-forget haptics. Every call is safe on devices without a vibrator. */
export function tapHaptic(): void {
  if (!appHapticsEnabled) return
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined)
}

export function selectionHaptic(): void {
  if (!appHapticsEnabled) return
  void Haptics.selectionAsync().catch(() => undefined)
}

export function mediumHaptic(): void {
  if (!appHapticsEnabled) return
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined)
}

export function successHaptic(): void {
  if (!appHapticsEnabled) return
  void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined)
}

export function timerCueHaptic(boundary: NativeTimerEvent['boundary'], settings: TimerHapticsSettings): void {
  if (!settings.enabled) return
  void playExpoProfile(boundary === 'pattern-offset' ? settings.subBell : settings.main)
}

/** Explicit previews remain available while the global switch is off. */
export async function previewHapticProfile(profile: HapticProfile): Promise<boolean> {
  if (isNativeServiceAvailable && ChandasTimerService.getCapabilities()?.supportsHapticProfiles === true) {
    return ChandasTimerService.previewHaptic(profile)
  }
  await playExpoProfile(profile)
  return true
}

export function startRepeatingAlarmHaptic(settings: TimerHapticsSettings): void {
  stopRepeatingAlarmHaptic()
  if (!settings.enabled) return
  const play = () => { void playExpoProfile(settings.alarm) }
  play()
  repeatingAlarmTimer = setInterval(play, profileGroupDuration(settings.alarm) + 650)
}

export function stopRepeatingAlarmHaptic(): void {
  if (repeatingAlarmTimer) clearInterval(repeatingAlarmTimer)
  repeatingAlarmTimer = null
}

async function playExpoProfile(profile: HapticProfile): Promise<void> {
  const style = profile.strength === 'gentle'
    ? Haptics.ImpactFeedbackStyle.Light
    : profile.strength === 'balanced'
      ? Haptics.ImpactFeedbackStyle.Medium
      : Haptics.ImpactFeedbackStyle.Heavy
  const count = profile.pattern === 'single' ? 1 : profile.pattern === 'double' ? 2 : 3
  for (let index = 0; index < count; index += 1) {
    await Haptics.impactAsync(style).catch(() => undefined)
    if (index < count - 1) await delay(105)
  }
}

function profileGroupDuration(profile: HapticProfile): number {
  return profile.pattern === 'single' ? 90 : profile.pattern === 'double' ? 265 : 430
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
