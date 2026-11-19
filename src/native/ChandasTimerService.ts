// Typed JS wrapper around the native "ChandasTimerService" Expo module
// (modules/chandas-timer-service - Kotlin, Android exact-alarm scheduler).
//
// AlarmManager owns tick scheduling; foreground services are presentation-only:
// one while a continuous alarm rings and an optional one for the live status chip.
// When the native module isn't present,
// callers fall back to
// the JS-only foreground timer (see useTimer.ts).
import { AppState, Platform } from 'react-native'
import { requireOptionalNativeModule } from 'expo-modules-core'
import { createAudioPlayer, type AudioPlayer } from 'expo-audio'
import { Asset } from 'expo-asset'
import { stopAndVerifyNativeTimer } from '../lib/verifiedTimerStop'
import type { BuiltInSoundId, HapticPattern, HapticProfile, HapticStrength, SoundRef } from '../types'
import { BUILT_IN_SOUNDS, sourceForSound } from '../lib/soundLibrary'
import { normalizeNativeFocusState } from '../lib/focusState'
import * as DocumentPicker from 'expo-document-picker'
import * as FileSystem from 'expo-file-system/legacy'

export type TimerAudioOutput = 'phone' | 'external' | 'headphones'
export type TimerAudioMixMode = 'default' | 'mix' | 'duck' | 'pause'

export interface NativeTimerConfig {
  mainMs: number
  subMs: number
  phase: number
  subEnabled: boolean
  volume: number       // 0–1, gong/bell volume
  /** Built-in ID or persisted content URI for the looping alarm. */
  alarmSoundId?: string
  /** Per-alarm multiplier; older native engines safely ignore this field. */
  alarmVolume?: number
  hapticsEnabled?: boolean
  mainHapticPattern?: HapticPattern
  mainHapticStrength?: HapticStrength
  subHapticPattern?: HapticPattern
  subHapticStrength?: HapticStrength
  alarmHapticPattern?: HapticPattern
  alarmHapticStrength?: HapticStrength
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
  /** Accepted Start time, distinct from a snapped program's phase anchor. */
  timerV2StartedAt?: number
  timerV2EndsAt?: number
  timerV2RandomSeed?: number
  timerV2PausedAt?: number
  alarmOnceArmed?: boolean
  mutedUntil?: number
  mutedIterationEndId?: string
  mutedIterationEndAt?: number
  mutedIterationCount?: number
}

interface AlarmStateEvent {
  runId?: string | null
  ringing: boolean
}

export interface NativeControlState {
  runId?: string | null
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
  alarmVolume?: number
  hapticsEnabled?: boolean
  mainHapticPattern?: HapticPattern
  mainHapticStrength?: HapticStrength
  subHapticPattern?: HapticPattern
  subHapticStrength?: HapticStrength
  alarmHapticPattern?: HapticPattern
  alarmHapticStrength?: HapticStrength
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
  timerV2RandomSeed?: number
  timerV2PausedAt?: number
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
  runId?: string | null
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
  runId?: string | null
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
  maxCueDurationSeconds?: number
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
  supportsAlarmVolume?: boolean
  supportsHapticProfiles?: boolean
  supportsSecondPrecision?: boolean
  supportsSubBellSecondPrecision?: boolean
  supportsUntilRunLength?: boolean
  supportsNoMainInterval?: boolean
  supportsBellPoints?: boolean
  supportsMuteSecondPrecision?: boolean
  supportsDualLiveCountdown?: boolean
  supportsProgramClockAlignment?: boolean
  supportsProgramSchema3?: boolean
  supportsFloatingOverlay?: boolean
  supportsRandomRepeat?: boolean
  supportsStepAlarms?: boolean
  supportsUnifiedSteps?: boolean
  supportsStepSubBells?: boolean
  supportsTransportControls?: boolean
  supportsUnlimitedSounds?: boolean
}

export interface NativeFloatingOverlayState {
  supported: boolean
  requested: boolean
  permissionGranted: boolean
  visible: boolean
  expanded: boolean
  appearance?: 'system' | 'dark' | 'light'
  edge?: 'left' | 'right'
  verticalFraction?: number
}

export interface NativeFloatingOverlaySnapshot extends NativeTimerState {
  runId?: string
  runName?: string
  activeCount?: number
  now: number
  screenInteractive?: boolean
  expanded?: boolean
  preview?: boolean
  cueAttention?: boolean
  cuePulse?: number
}

export interface NativeFloatingOverlayActionResult {
  success: boolean
  error?: string
  snapshot?: NativeFloatingOverlaySnapshot
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
  prepareForStart?(config: NativeTimerConfig): Promise<boolean>
  getIOSSystemStatus?(): IOSSystemStatus
  getCapabilities?(): NativeTimerCapabilities
  getRunIds?(): string[]
  consumeRunDestination?(): { id: string; panel?: 'clock' | 'sound' } | null
  focusRun?(id: string): void
  startRun?(id: string, name: string, config: NativeTimerConfig): boolean
  updateRun?(id: string, config: Partial<NativeTimerConfig>): void
  getRunState?(id: string): NativeTimerState
  runAction?(id: string, action: string, amount: number): NativeFloatingOverlayActionResult
  start(config: NativeTimerConfig): boolean
  update(config: Partial<NativeTimerConfig>): void
  stop(): void
  stopAlarm(): boolean | void
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
  muteForSeconds?(seconds: number): void
  setMuteUntil?(id: string | null, deadline: number): void
  clearMute(): void
  getFloatingOverlayState?(): NativeFloatingOverlayState
  getFloatingOverlaySnapshot?(): NativeFloatingOverlaySnapshot
  setFloatingOverlayRequested?(enabled: boolean): void
  setFloatingOverlayAppearance?(appearance: 'system' | 'dark' | 'light'): void
  openFloatingOverlaySettings?(): void
  consumeFloatingOverlayDestination?(): 'clock' | 'sound' | null
  previewFloatingOverlay?(): boolean
  setFloatingOverlayPosition?(edge: 'left' | 'right', verticalFraction: number): void
  floatingOverlayAction?(action: string): NativeFloatingOverlayActionResult
  pickDeviceSound(kind: 'alarm' | 'notification' | 'unknown'): Promise<{ uri: string; title: string } | null>
  pickAudioDocument(): Promise<{ uri: string; title: string; mimeType?: string } | null>
  previewSound(soundId: string, fallbackSoundId: BuiltInSoundId, volume: number): Promise<boolean>
  previewSoundForUse?(soundId: string, fallbackSoundId: BuiltInSoundId, volume: number, alarm: boolean, request: number): Promise<boolean>
  getAudioOutputs?(): TimerAudioOutput[] | null
  setAudioOutputs?(outputs: TimerAudioOutput[]): boolean
  getAudioMixMode?(): TimerAudioMixMode | null
  setAudioMixMode?(mode: TimerAudioMixMode): boolean
  previewHaptic?(pattern: HapticPattern, strength: HapticStrength): boolean
  cacheBuiltInSound?(id: string, sourceUri: string, revision: string): Promise<boolean>
  stopSoundPreview(): void
  isSoundAvailable(soundId: string): boolean
  addListener(eventName: 'onAlarmStateChanged', listener: (event: AlarmStateEvent) => void): EventSubscription
  addListener(eventName: 'onControlStateChanged', listener: (event: NativeControlState) => void): EventSubscription
  addListener(eventName: 'onTimerEventFired', listener: (event: NativeTimerEvent) => void): EventSubscription
  addListener(eventName: 'onFocusStateChanged', listener: (event: NativeFocusState) => void): EventSubscription
  addListener(eventName: 'onTimerStateChanged', listener: (event: NativeScheduleState) => void): EventSubscription
  addListener(eventName: 'onFloatingOverlayStateChanged', listener: (event: NativeFloatingOverlayState) => void): EventSubscription
  addListener(eventName: 'onFloatingOverlaySnapshot', listener: (event: NativeFloatingOverlaySnapshot) => void): EventSubscription
  addListener(eventName: 'onSoundPreviewFinished', listener: (event: { request: number }) => void): EventSubscription
  addListener(eventName: 'onIOSSystemStatus', listener: (event: IOSSystemStatus) => void): EventSubscription
}

export interface IOSSystemStatus {
  platform: 'ios'
  notifications: boolean
  alarmKit: boolean
  alarmsAuthorized: boolean
  backgroundScheduledThrough: number
  activeCount: number
  recoveryRequired: boolean
  error: string | null
}

const native = Platform.OS === 'android' || Platform.OS === 'ios'
  ? requireOptionalNativeModule<ChandasTimerServiceModule>('ChandasTimerService')
  : null

export const isNativeServiceAvailable = native !== null
export const supportsNativeTimerRuns = Boolean(native?.startRun)
let fallbackPreview: AudioPlayer | null = null
let soundPreviewGeneration = 0
const nativeResourceSounds = new Set<BuiltInSoundId>(['alarm-tone', 'temple-gong', 'clear-bell'])
const soundCacheRequests = new Map<BuiltInSoundId, { revision: string; promise: Promise<boolean> }>()

async function cacheBuiltInSound(id: BuiltInSoundId): Promise<boolean> {
  if (!native || Platform.OS === 'android' && nativeResourceSounds.has(id)) return true
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
  soundPreviewGeneration += 1
  native?.stopSoundPreview()
  fallbackPreview?.remove()
  fallbackPreview = null
})

export const ChandasTimerService = {
  async prepareForStart(config: NativeTimerConfig): Promise<boolean> {
    return native?.prepareForStart ? native.prepareForStart(config) : true
  },
  getIOSSystemStatus(): IOSSystemStatus | null { return native?.getIOSSystemStatus?.() ?? null },
  addIOSSystemStatusListener(listener: (status: IOSSystemStatus) => void): EventSubscription | null {
    return Platform.OS === 'ios' ? native?.addListener('onIOSSystemStatus', listener) ?? null : null
  },
  getAudioOutputs(): TimerAudioOutput[] | null {
    return native?.getAudioOutputs?.() ?? null
  },
  setAudioOutputs(outputs: TimerAudioOutput[]): boolean {
    return native?.setAudioOutputs?.(outputs) ?? false
  },
  getAudioMixMode(): TimerAudioMixMode | null {
    return native?.getAudioMixMode?.() ?? null
  },
  setAudioMixMode(mode: TimerAudioMixMode): boolean {
    return native?.setAudioMixMode?.(mode) ?? false
  },
  getCapabilities(): NativeTimerCapabilities | null {
    try {
      return native?.getCapabilities?.() ?? null
    } catch {
      return null
    }
  },
  start(config: NativeTimerConfig) {
    soundPreviewGeneration += 1
    native?.stopSoundPreview()
    fallbackPreview?.remove()
    fallbackPreview = null
    return native?.start(config) ?? false
  },
  update(config: Partial<NativeTimerConfig>) {
    native?.update(config)
  },
  stop() {
    if (!native) return true
    return stopAndVerifyNativeTimer(native)
  },
  // Dismisses an in-progress alarm-mode ring without stopping the whole timer —
  // normal tick scheduling resumes for the next interval.
  stopAlarm() {
    try {
      return native?.stopAlarm() !== false
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
  muteForSeconds(seconds: number) {
    const normalized = Math.max(1, Math.min(86_400, Math.round(seconds)))
    if (native?.muteForSeconds) native.muteForSeconds(normalized)
    else native?.muteForMinutes(Math.ceil(normalized / 60))
  },
  muteUntil(deadline: number) {
    if (native?.setMuteUntil) native.setMuteUntil(null, deadline)
    else this.muteForSeconds(Math.ceil((deadline - Date.now()) / 1_000))
  },
  clearMute() {
    native?.clearMute()
  },
  getFloatingOverlayState(): NativeFloatingOverlayState {
    return native?.getFloatingOverlayState?.() ?? { supported: false, requested: false, permissionGranted: false, visible: false, expanded: false }
  },
  getFloatingOverlaySnapshot(): NativeFloatingOverlaySnapshot {
    return native?.getFloatingOverlaySnapshot?.() ?? { ...this.getState(), now: Date.now() }
  },
  setFloatingOverlayRequested(enabled: boolean) {
    native?.setFloatingOverlayRequested?.(enabled)
  },
  setFloatingOverlayAppearance(appearance: 'system' | 'dark' | 'light') {
    native?.setFloatingOverlayAppearance?.(appearance)
  },
  openFloatingOverlaySettings() {
    native?.openFloatingOverlaySettings?.()
  },
  consumeFloatingOverlayDestination(): 'clock' | 'sound' | null {
    return native?.consumeFloatingOverlayDestination?.() ?? null
  },
  previewFloatingOverlay(): boolean {
    return native?.previewFloatingOverlay?.() ?? false
  },
  floatingOverlayAction(action: string): NativeFloatingOverlayActionResult {
    return native?.floatingOverlayAction?.(action) ?? { success: false, error: 'unsupported' }
  },
  async pickDeviceSound(kind: 'alarm' | 'notification' | 'unknown'): Promise<{ uri: string; title: string } | null> {
    return native?.pickDeviceSound(kind) ?? null
  },
  async pickAudioDocument(): Promise<{ uri: string; title: string; mimeType?: string } | null> {
    if (Platform.OS === 'ios') {
      const result = await DocumentPicker.getDocumentAsync({ type: 'audio/*', copyToCacheDirectory: true, multiple: false })
      if (result.canceled) return null
      const picked = result.assets[0]
      if (!FileSystem.documentDirectory) return null
      const directory = `${FileSystem.documentDirectory}sounds/`
      await FileSystem.makeDirectoryAsync(directory, { intermediates: true })
      const extension = picked.name.match(/\.[a-zA-Z0-9]{1,8}$/)?.[0] ?? '.audio'
      const uri = `${directory}${Date.now()}-${Math.random().toString(36).slice(2)}${extension}`
      await FileSystem.copyAsync({ from: picked.uri, to: uri })
      if (native?.cacheBuiltInSound && !await native.cacheBuiltInSound(uri, uri, 'import')) throw new Error('This audio file cannot be used on iPhone')
      return { uri, title: picked.name, mimeType: picked.mimeType }
    }
    return native?.pickAudioDocument() ?? null
  },
  async previewSound(sound: SoundRef, volume: number, { alarm = false, onFinished }: { alarm?: boolean; onFinished?: () => void } = {}): Promise<boolean> {
    const request = ++soundPreviewGeneration
    native?.stopSoundPreview()
    fallbackPreview?.remove()
    fallbackPreview = null
    const soundId = sound.kind === 'builtin' ? sound.id : sound.uri
    if (native) {
      if (sound.kind === 'builtin') await cacheBuiltInSound(sound.id)
      else if (Platform.OS === 'ios' && sound.kind === 'document') await native.cacheBuiltInSound?.(sound.uri, sound.uri, 'document')
      if (request !== soundPreviewGeneration || AppState.currentState !== 'active') return false
      const subscription = native.previewSoundForUse && onFinished ? native.addListener('onSoundPreviewFinished', event => {
        if (event.request !== request) return
        subscription?.remove()
        onFinished()
      }) : undefined
      let started = false
      try {
        started = native.previewSoundForUse
          ? await native.previewSoundForUse(soundId, 'clear-bell', volume, alarm, request)
          : await native.previewSound(soundId, 'clear-bell', volume)
      } finally {
        if (!started) subscription?.remove()
      }
      if (request === soundPreviewGeneration && AppState.currentState === 'active') return started
      native.stopSoundPreview()
      return false
    }
    if (request !== soundPreviewGeneration || AppState.currentState !== 'active') return false
    const source = sourceForSound(sound)
    if (!source) return false
    const player = createAudioPlayer(source)
    player.volume = Math.max(0, Math.min(1, volume))
    player.play()
    fallbackPreview = player
    return true
  },
  previewHaptic(profile: HapticProfile): boolean {
    try {
      return native?.previewHaptic?.(profile.pattern, profile.strength) ?? false
    } catch {
      return false
    }
  },
  stopSoundPreview() {
    soundPreviewGeneration += 1
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
    return native?.addListener('onAlarmStateChanged', e => { if (!e.runId) listener(e.ringing) }) ?? null
  },
  addControlListener(listener: (state: NativeControlState) => void): EventSubscription | null {
    return native?.addListener('onControlStateChanged', e => { if (!e.runId) listener(e) }) ?? null
  },
  addTimerEventListener(listener: (event: NativeTimerEvent) => void): EventSubscription | null {
    return native?.addListener('onTimerEventFired', e => { if (!e.runId) listener(e) }) ?? null
  },
  addFocusListener(listener: (state: NativeFocusState) => void): EventSubscription | null {
    return native?.addListener('onFocusStateChanged', state => listener(normalizeNativeFocusState(state))) ?? null
  },
  addTimerStateListener(listener: (state: NativeScheduleState) => void): EventSubscription | null {
    return native?.addListener('onTimerStateChanged', e => { if (!e.runId) listener(e) }) ?? null
  },
  addFloatingOverlayStateListener(listener: (state: NativeFloatingOverlayState) => void): EventSubscription | null {
    return native?.addListener('onFloatingOverlayStateChanged', listener) ?? null
  },
  addFloatingOverlaySnapshotListener(listener: (state: NativeFloatingOverlaySnapshot) => void): EventSubscription | null {
    return native?.addListener('onFloatingOverlaySnapshot', listener) ?? null
  },
}


export function nativeTimerRunIds(): string[] {
  return native?.getRunIds?.() ?? []
}

export function consumeNativeRunDestination() {
  return native?.consumeRunDestination?.() ?? null
}

export function focusNativeTimerRun(id: string) {
  native?.focusRun?.(id)
}

export function nativeTimerRun(id: string, name = 'Current timer'): typeof ChandasTimerService | null {
  if (!supportsNativeTimerRuns || !native) return null
  const getState = () => native.getRunState?.(id) ?? { active: false, ringing: false }
  const action = (name: string, amount = 0) => native.runAction?.(id, name, amount) ?? { success: false }
  return {
    ...ChandasTimerService,
    start(config) {
      ChandasTimerService.stopSoundPreview()
      return native.startRun?.(id, name, config) ?? false
    },
    update(config) { native.updateRun?.(id, config) },
    stop() { return stopAndVerifyNativeTimer({ stop: () => { if (getState().active) action('stop') }, getState }) },
    getState,
    isRinging() { return getState().ringing },
    stopAlarm() {
      try { return action('dismiss').success } catch { return false }
    },
    toggleAlarmOnce() { action('alarm-once') },
    muteForIterations(count) { action('mute-iterations', count) },
    muteForMinutes(minutes) { action('mute-seconds', Math.round(minutes * 60)) },
    muteForSeconds(seconds) { action('mute-seconds', Math.max(1, Math.min(86_400, Math.round(seconds)))) },
    muteUntil(deadline) {
      if (native.setMuteUntil) native.setMuteUntil(id, deadline)
      else this.muteForSeconds(Math.ceil((deadline - Date.now()) / 1_000))
    },
    clearMute() { action('clear-mute') },
    floatingOverlayAction(name) { return action(name) },
    addAlarmListener(listener) { return native.addListener('onAlarmStateChanged', event => { if (event.runId === id) listener(event.ringing) }) },
    addControlListener(listener) { return native.addListener('onControlStateChanged', event => { if (event.runId === id) listener(event) }) },
    addTimerEventListener(listener) { return native.addListener('onTimerEventFired', event => { if (event.runId === id) listener(event) }) },
    addTimerStateListener(listener) { return native.addListener('onTimerStateChanged', event => { if (event.runId === id) listener(event) }) },
  }
}
