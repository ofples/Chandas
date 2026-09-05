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
import { Asset } from 'expo-asset'
import type { BuiltInSoundId, SoundRef } from '../types'
import { BUILT_IN_SOUNDS, sourceForSound } from '../lib/soundLibrary'
import { normalizeNativeFocusState } from '../lib/focusState'

export interface NativeTimerConfig {
  mainMs: number
  subMs: number
  phase: number
  subEnabled: boolean
  volume: number       // 0–1, gong/bell volume
  /** Built-in ID or persisted content URI for the looping alarm. */
  alarmSoundId?: string
  notificationsEnabled: boolean
  liveCountdownEnabled?: boolean
  /** Serialized user-facing notification copy for the stable native engine. */
  notificationPresentation?: string
  muteDuringCallsEnabled?: boolean
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
  alarmSoundId?: string
  notificationsEnabled?: boolean
  liveCountdownEnabled?: boolean
  notificationPresentation?: string
  muteDuringCallsEnabled?: boolean
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

export interface NativeTimerCapabilities {
  contractVersion: number
  programSchemaMin: number
  programSchemaMax: number
  maxPatternTracks: number
  maxSequenceSteps: number
  maxCueDurationMinutes: number
  maxRunCycles: number
  maxRunDurationSeconds: number
  maxMuteIterations: number
  maxMuteMinutes: number
  maxNotificationPresentationCharacters: number
  supportsCachedBuiltInSounds: boolean
  supportsRawFocusState: boolean
  supportsNotificationPresentation: boolean
  supportsLiveCountdown?: boolean
  supportsAlarmSound?: boolean
}

export interface NativeFocusState {
  policyAccess: boolean
  automationEnabled: boolean
  ruleExists: boolean
  ruleEnabled: boolean
  actual: 'inactive' | 'active' | 'unknown'
  reason: 'off' | 'timer-stopped' | 'outside-active-hours' | 'active' | 'paused-by-android' | 'rule-disabled' | 'access-required' | 'unknown'
  /** Optional for compatibility with binaries predating native contract v2. */
  timerRunning?: boolean
  requestedActive?: boolean
  pausedByAndroid?: boolean
  ruleWasRemoved?: boolean
  withinActiveHours?: boolean
}

interface EventSubscription {
  remove(): void
}

interface ChandasTimerServiceModule {
  getCapabilities?(): NativeTimerCapabilities
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
  cacheBuiltInSound?(id: string, sourceUri: string, revision: string): Promise<boolean>
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
const nativeResourceSounds = new Set<BuiltInSoundId>(['alarm-tone', 'temple-gong', 'clear-bell'])
const soundCacheRequests = new Map<BuiltInSoundId, { revision: string; promise: Promise<boolean> }>()

async function cacheBuiltInSound(id: BuiltInSoundId): Promise<boolean> {
  if (!native || nativeResourceSounds.has(id)) return true
  if (typeof native.cacheBuiltInSound !== 'function') return false
  const definition = BUILT_IN_SOUNDS.find(sound => sound.id === id)
  if (!definition) return false

  try {
    const asset = Asset.fromModule(definition.source)
    await asset.downloadAsync()
    if (!asset.localUri) return false
    const revision = asset.hash ?? ''
    const previous = soundCacheRequests.get(id)
    if (previous?.revision === revision) return previous.promise
    // Serializing replacements for one ID prevents an older in-flight copy
    // from winning after a newer revision has already been requested.
    if (previous) await previous.promise
    const current = soundCacheRequests.get(id)
    if (current?.revision === revision) return current.promise
    let promise: Promise<boolean>
    promise = native.cacheBuiltInSound(id, asset.localUri, revision)
      .then(installed => {
        if (!installed && soundCacheRequests.get(id)?.promise === promise) soundCacheRequests.delete(id)
        return installed
      })
      .catch(() => {
        if (soundCacheRequests.get(id)?.promise === promise) soundCacheRequests.delete(id)
        return false
      })
    soundCacheRequests.set(id, { revision, promise })
    return promise
  } catch {
    soundCacheRequests.delete(id)
    return false
  }
}

AppState.addEventListener('change', state => {
  if (state === 'active') return
  native?.stopSoundPreview()
  fallbackPreview?.remove()
  fallbackPreview = null
})

export const ChandasTimerService = {
  getCapabilities(): NativeTimerCapabilities | null {
    try {
      return native?.getCapabilities?.() ?? null
    } catch {
      return null
    }
  },
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
    const state = native?.getFocusState() ?? { policyAccess: false, automationEnabled: false, ruleExists: false, ruleEnabled: false, actual: 'unknown', reason: 'unknown' }
    return normalizeNativeFocusState(state)
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
    if (native) {
      if (sound.kind === 'builtin') await cacheBuiltInSound(sound.id)
      return native.previewSound(soundId, fallbackSoundId, volume)
    }
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
  async prepareBuiltInSounds(ids: Iterable<BuiltInSoundId>): Promise<boolean> {
    if (!native) return true
    const unique = [...new Set(ids)]
    const results = await Promise.all(unique.map(cacheBuiltInSound))
    return results.every(Boolean)
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
    return native?.addListener('onFocusStateChanged', state => listener(normalizeNativeFocusState(state))) ?? null
  },
  addTimerStateListener(listener: (state: NativeScheduleState) => void): EventSubscription | null {
    return native?.addListener('onTimerStateChanged', listener) ?? null
  },
}
