import { useAppReducedMotion } from './src/theme/ThemeContext'
import { useCallback, useEffect, useRef, useState } from 'react'
import { StatusBar } from 'expo-status-bar'
import * as Updates from 'expo-updates'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { AppState as NativeAppState, Linking, PermissionsAndroid, Platform, Pressable, Text, View } from 'react-native'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { useFonts, JetBrainsMono_300Light, JetBrainsMono_400Regular } from '@expo-google-fonts/jetbrains-mono'
import Reanimated, { FadeIn, FadeOut } from 'react-native-reanimated'
import { ThemeProvider, useTheme } from './src/theme/ThemeContext'
import type { AppState, AppTimerSettings, CueSettings, RuntimeTimerProgram, WorkingProgramState } from './src/types'
import { useTimerV2 } from './src/hooks/useTimerV2'
import { loadTimerV2Session, type TimerV2Session } from './src/lib/storage'
import { normalizeAvailabilityPolicy } from './src/lib/timerV2'
import { legacySessionProgram } from './src/lib/legacy-session-program'
import { defaultTimerHapticsSettings, normalizeTimerHapticsSettings } from './src/lib/haptic-profiles'
import { setAppHapticsEnabled, successHaptic, tapHaptic } from './src/lib/haptics'
import { UnifiedTimerConfigScreen } from './src/screens/UnifiedTimerConfigScreen'
import { TimerV2RunningScreen } from './src/screens/TimerV2RunningScreen'
import { AlarmRingingScreen } from './src/screens/AlarmRingingScreen'
import { ChandasTimerService, isNativeServiceAvailable, type NativeFocusState } from './src/native/ChandasTimerService'
import { AppLoadingScreen, type AppNotice } from './src/components/timer-v2/experience-feedback'
import { FeedbackLayerProvider, RootFeedbackOverlay } from './src/components/timer-v2/feedback-layer'
import { AppErrorBoundary } from './src/components/timer-v2/app-error-boundary'
import { ConfirmationProvider } from './src/components/timer-v2/ConfirmationDialog'
import { clockOffsetLabel } from './src/lib/clockAlignment'
import { unifiedCueIdentity } from './src/lib/unified-timeline'
import { bootstrapUnifiedConfigState, saveUnifiedConfigState } from './src/lib/unified-storage'
import { reduceUnifiedConfigCommand, UNNAMED_DRAFT_KEY, type ConfigStateCommand, type UnifiedConfigState, type UnifiedTimerConfig, type UnifiedTimerDraft } from './src/lib/unified-config-state'
import { clearUnifiedTimerSession, loadUnifiedTimerSession } from './src/lib/unified-session'
import { parseUnifiedTimerProgram } from './src/lib/unified-timer'
import type { TimerRestore } from './src/hooks/useTimerV2'

const FALLBACK_PROGRAM = {
  schemaVersion: 3 as const, mode: 'pattern' as const, mainMinutes: 30,
  label: '30-minute cycle', labelIsCustom: false,
  mainCue: { sound: { kind: 'builtin' as const, id: 'temple-gong' as const }, volume: 1 }, completionCue: null, subBellsEnabled: false, tracks: [], alignment: { kind: 'elapsed' as const },
  runPolicy: { kind: 'continuous' as const, cycleCount: 1, durationSeconds: 30 * 60 },
}
const FALLBACK_SETTINGS = { masterVolume: 0.8, advancedModeEnabled: false, secondPrecisionEnabled: false, alarmSound: { kind: 'builtin' as const, id: 'alarm-tone' as const }, alarmVolume: 1, haptics: defaultTimerHapticsSettings(), notificationsEnabled: true, liveCountdownEnabled: false, muteDuringCallsEnabled: true, availability: { enabled: false, weeklyWindows: [], overrides: [] }, focusAutomationEnabled: false, alarmDurationSeconds: 60 }
const DEFAULT_FOCUS_STATE: NativeFocusState = { policyAccess: false, automationEnabled: false, ruleExists: false, ruleEnabled: false, actual: 'unknown', reason: 'off' }

interface PendingRestore {
  program: RuntimeTimerProgram
  settings: AppTimerSettings
  sourcePreset?: WorkingProgramState['sourcePreset']
  restore: TimerRestore
  attachNative: boolean
}

interface ActiveRunSnapshot {
  program: RuntimeTimerProgram
  settings: AppTimerSettings
  sourcePreset?: WorkingProgramState['sourcePreset']
  sessionId?: string
  nativeGeneration?: string
}

interface AndroidAccessState {
  exactAlarms: boolean
  fullScreenAlarms: boolean
  callMute: boolean
  notifications: boolean
  checking: boolean
  pending: 'call-mute' | 'notifications' | null
}

function settingsFromNative(current: AppTimerSettings, native: ReturnType<typeof ChandasTimerService.getState>): AppTimerSettings {
  let availability = current.availability
  if (native.availabilityPolicy) {
    try { availability = normalizeAvailabilityPolicy(JSON.parse(native.availabilityPolicy) as AppTimerSettings['availability']) } catch { /* retain the safely loaded app policy */ }
  } else if (native.activeHoursEnabled !== undefined) {
    availability = normalizeAvailabilityPolicy({
      enabled: native.activeHoursEnabled,
      weeklyWindows: [{ id: 'native-legacy-active-hours', enabled: true, startMinutes: native.activeHoursStart ?? 480, endMinutes: native.activeHoursEnd ?? 1_320, days: native.activeHoursDays ?? 0x7f }],
      overrides: [],
    })
  }
  return {
    masterVolume: native.volume ?? current.masterVolume,
    advancedModeEnabled: current.advancedModeEnabled,
    secondPrecisionEnabled: current.secondPrecisionEnabled,
    alarmSound: current.alarmSound,
    alarmVolume: native.alarmVolume ?? current.alarmVolume,
    haptics: native.hapticsEnabled === undefined ? current.haptics : normalizeTimerHapticsSettings({
      enabled: native.hapticsEnabled,
      main: { pattern: native.mainHapticPattern, strength: native.mainHapticStrength },
      subBell: { pattern: native.subHapticPattern, strength: native.subHapticStrength },
      alarm: { pattern: native.alarmHapticPattern, strength: native.alarmHapticStrength },
    }),
    notificationsEnabled: native.notificationsEnabled ?? current.notificationsEnabled,
    liveCountdownEnabled: native.liveCountdownEnabled ?? current.liveCountdownEnabled,
    muteDuringCallsEnabled: native.muteDuringCallsEnabled ?? current.muteDuringCallsEnabled,
    availability,
    focusAutomationEnabled: native.focusModeEnabled ?? current.focusAutomationEnabled,
    alarmDurationSeconds: native.alarmDurationSeconds ?? current.alarmDurationSeconds,
  }
}

function parseRuntimeProgram(value: unknown): RuntimeTimerProgram | null {
  let parsed = value
  if (typeof parsed === 'string') {
    try { parsed = JSON.parse(parsed) as unknown } catch { return null }
  }
  if (parsed && typeof parsed === 'object' && 'schemaVersion' in parsed && parsed.schemaVersion === 4) {
    const canonical = parseUnifiedTimerProgram(parsed)
    return canonical.ok ? canonical.value : null
  }
  return legacySessionProgram(parsed)
}

function draftSourcePreset(state: UnifiedConfigState | null, draft: UnifiedTimerDraft | undefined): WorkingProgramState['sourcePreset'] {
  if (!draft) return undefined
  if (draft.sourcePreset) return { ...draft.sourcePreset, name: draft.name }
  if (!draft?.baseConfigId || !state) return undefined
  const config = state.configs.find(value => value.id === draft.baseConfigId)
  return config ? { id: config.id, name: draft.name, createdAt: config.createdAt } : undefined
}

function legacyRestore(session: TimerV2Session, program = session.program): PendingRestore {
  return {
    program,
    settings: session.settings ?? FALLBACK_SETTINGS,
    sourcePreset: session.sourcePreset,
    restore: {
      anchor: session.anchor, startedAt: session.startedAt, endsAt: session.endsAt, pausedAt: session.pausedAt,
      randomSeed: session.randomSeed, mute: session.mute, alarmBehavior: session.alarmBehavior,
      soundState: session.soundState,
    },
    attachNative: false,
  }
}

function Root() {
  const { tokens, theme } = useTheme()
  const reducedMotion = useAppReducedMotion()
  const updateState = Updates.useUpdates()
  const [configState, setConfigState] = useState<UnifiedConfigState | null>(null)
  const [configRecovery, setConfigRecovery] = useState<{ reason: string; raw?: string } | null>(null)
  const [configRetry, setConfigRetry] = useState(0)
  const configStateRef = useRef<UnifiedConfigState | null>(null)
  const configWritableRef = useRef(false)
  const configPersistenceQueue = useRef<Promise<unknown>>(Promise.resolve())
  const configSemanticQueue = useRef<Promise<unknown>>(Promise.resolve())
  const configInlineRevision = useRef(0)
  const [activeRun, setActiveRun] = useState<ActiveRunSnapshot | null>(null)
  const activeRunRef = useRef<ActiveRunSnapshot | null>(null)
  const [appState, setAppState] = useState<AppState>('config')
  const [ready, setReady] = useState(false)
  const [focusState, setFocusState] = useState<NativeFocusState>(DEFAULT_FOCUS_STATE)
  const [restoreSession, setRestoreSession] = useState<PendingRestore | null>(null)
  const [sessionRecovery, setSessionRecovery] = useState<{ reason: string; raw?: string } | null>(null)
  const [androidAccess, setAndroidAccess] = useState<AndroidAccessState>({ exactAlarms: Platform.OS !== 'android', fullScreenAlarms: Platform.OS !== 'android', callMute: Platform.OS !== 'android', notifications: Platform.OS !== 'android', checking: Platform.OS === 'android', pending: null })
  const [starting, setStarting] = useState(false)
  const [realigning, setRealigning] = useState(false)
  const [floatingTimerPanel, setFloatingTimerPanel] = useState<'clock' | 'sound' | null>(null)
  const [notice, setNotice] = useState<AppNotice | null>(null)
  const startingRef = useRef(false)
  const realigningRef = useRef(false)
  const reanchorAttemptGeneration = useRef(0)
  const noticeSequence = useRef(0)
  const sessionWarningShown = useRef<string | null>(null)
  const fullScreenGuidanceShown = useRef(false)
  const handledCompletionPulse = useRef(0)

  const commitActiveRun = useCallback((next: ActiveRunSnapshot | null) => {
    activeRunRef.current = next
    setActiveRun(next)
  }, [])
  const currentDraft = configState
    ? Object.prototype.hasOwnProperty.call(configState.drafts, configState.selectedConfigId ?? UNNAMED_DRAFT_KEY)
      ? configState.drafts[configState.selectedConfigId ?? UNNAMED_DRAFT_KEY]
      : undefined
    : undefined
  const liveSettings = activeRun?.settings ?? currentDraft?.settings ?? FALLBACK_SETTINGS
  const program: RuntimeTimerProgram = activeRun?.program ?? currentDraft?.program ?? FALLBACK_PROGRAM
  const sourcePreset = activeRun ? activeRun.sourcePreset : draftSourcePreset(configState, currentDraft)
  useEffect(() => {
    setAppHapticsEnabled(liveSettings.haptics.enabled)
  }, [liveSettings.haptics.enabled])
  const deferredUpdateAnnounced = useRef(false)
  const readyUpdateAnnounced = useRef(false)
  const emergencyLaunchAnnounced = useRef(false)
  const stopAttemptGeneration = useRef(0)
  const stopRetryTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)
  const stopNeedsAttention = useRef(false)
  const restoreAttempt = useRef<PendingRestore | null>(null)
  const timer = useTimerV2(program, liveSettings, sourcePreset)

  const showNotice = useCallback((next: Omit<AppNotice, 'id'>) => {
    noticeSequence.current += 1
    setNotice({ ...next, id: `notice-${noticeSequence.current}` })
  }, [])
  const dismissNotice = useCallback(() => setNotice(null), [])
  const persistConfigSnapshot = useCallback((snapshot: UnifiedConfigState) => {
    const write = configPersistenceQueue.current.catch(() => undefined).then(() => saveUnifiedConfigState(AsyncStorage, snapshot))
    configPersistenceQueue.current = write.then(() => undefined, () => undefined)
    return write
  }, [])
  const onConfigCommand = useCallback((command: ConfigStateCommand): Promise<boolean> => {
    const persistInlineEdit = async (): Promise<boolean> => {
      const current = configStateRef.current
      if (!current || !configWritableRef.current) {
        showNotice({ title: 'Saved setup needs recovery', message: 'Chandas kept the saved timer record unchanged. Retry loading it before making changes.', tone: 'attention', persistent: true })
        return false
      }
      const reduced = reduceUnifiedConfigCommand(current, command)
      if (reduced.status !== 'applied') {
        showNotice({ title: 'That change was not applied', message: reduced.reason === 'duplicate-id' ? 'A timer with that identity already exists.' : 'Check the timer name and saved setup, then try again.', tone: 'attention' })
        return false
      }
      configInlineRevision.current += 1
      configStateRef.current = reduced.state
      setConfigState(reduced.state)
      const saved = await persistConfigSnapshot(reduced.state)
      if (saved.status === 'saved') return true
      showNotice({ title: 'Changes are kept for this session', message: `${saved.message} Your current draft remains available.`, tone: 'attention', persistent: true })
      return false
    }
    const performSemantic = async (): Promise<boolean> => {
      while (true) {
        const current = configStateRef.current
        if (!current || !configWritableRef.current) {
          showNotice({ title: 'Saved setup needs recovery', message: 'Chandas kept the saved timer record unchanged. Retry loading it before making changes.', tone: 'attention', persistent: true })
          return false
        }
        const revision = configInlineRevision.current
        const reduced = reduceUnifiedConfigCommand(current, command)
        if (reduced.status !== 'applied') {
          showNotice({ title: 'That change was not applied', message: reduced.reason === 'duplicate-id' ? 'A timer with that identity already exists.' : 'Check the timer name and saved setup, then try again.', tone: 'attention' })
          return false
        }
        if (JSON.stringify(reduced.state) === JSON.stringify(current)) return true
        const saved = await persistConfigSnapshot(reduced.state)
        if (saved.status !== 'saved') {
          showNotice({ title: 'That action was not saved', message: `${saved.message} The current configuration selection was left unchanged.`, tone: 'attention', persistent: true })
          return false
        }
        // Inline edits are immediate and may arrive while storage is slow.
        // Reapply this semantic transition to their latest state, then verify
        // the rebased snapshot before changing selection in the UI.
        if (revision !== configInlineRevision.current) continue
        configStateRef.current = reduced.state
        setConfigState(reduced.state)
        return true
      }
    }
    if (command.type === 'edit') return persistInlineEdit()
    const queued = configSemanticQueue.current.catch(() => undefined).then(performSemantic)
    configSemanticQueue.current = queued.then(() => undefined, () => undefined)
    return queued
  }, [persistConfigSnapshot, showNotice])
  const applyDownloadedUpdate = useCallback(() => {
    showNotice({ title: 'Opening the latest Chandas…', message: 'Your timer setup is already saved.', tone: 'info', persistent: true })
    void Updates.reloadAsync().catch(() => {
      readyUpdateAnnounced.current = false
      showNotice({ title: 'The update will wait', message: 'Nothing was lost. Chandas will try the new version again after a normal restart.', tone: 'attention' })
    })
  }, [showNotice])
  const safelyOpenSystemSetting = useCallback((open: () => void | Promise<void>) => {
    try {
      const result = open()
      if (result && typeof result.then === 'function') void result.catch(() => showNotice({ title: 'Android settings did not open', message: 'Nothing changed. Please try again from System access in a moment.', tone: 'attention' }))
    } catch {
      showNotice({ title: 'Android settings did not open', message: 'Nothing changed. Please try again from System access in a moment.', tone: 'attention' })
    }
  }, [showNotice])
  const openExactAlarmSettings = useCallback(() => safelyOpenSystemSetting(ChandasTimerService.openExactAlarmSettings), [safelyOpenSystemSetting])
  const openNotificationPolicySettings = useCallback(() => safelyOpenSystemSetting(ChandasTimerService.openNotificationPolicySettings), [safelyOpenSystemSetting])
  const openFocusRuleSettings = useCallback(() => safelyOpenSystemSetting(ChandasTimerService.openFocusRuleSettings), [safelyOpenSystemSetting])
  const openNotificationSettings = useCallback(() => safelyOpenSystemSetting(ChandasTimerService.openNotificationSettings), [safelyOpenSystemSetting])
  const openFullScreenIntentSettings = useCallback(() => safelyOpenSystemSetting(ChandasTimerService.openFullScreenIntentSettings), [safelyOpenSystemSetting])
  const openAppSettings = useCallback(() => safelyOpenSystemSetting(() => Linking.openSettings()), [safelyOpenSystemSetting])

  const refreshFocusState = useCallback(() => {
    if (Platform.OS !== 'android' || !isNativeServiceAvailable) return
    const nextFocus = ChandasTimerService.getFocusState()
    setFocusState(nextFocus)
    const running = activeRunRef.current
    if (appState === 'running' && running) {
      if (running.settings.focusAutomationEnabled !== nextFocus.automationEnabled) {
        commitActiveRun({ ...running, settings: { ...running.settings, focusAutomationEnabled: nextFocus.automationEnabled } })
      }
      return
    }
  }, [appState, commitActiveRun])

  const refreshAndroidAccess = useCallback(async () => {
    if (Platform.OS !== 'android') return
    setAndroidAccess(current => ({ ...current, checking: true }))
    try {
      const [callMute, notificationPermission] = await Promise.all([
        PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.READ_PHONE_STATE),
        Platform.Version >= 33 ? PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS) : Promise.resolve(true),
      ])
      setAndroidAccess(current => ({
        exactAlarms: !isNativeServiceAvailable || ChandasTimerService.canScheduleExactAlarms(),
        fullScreenAlarms: !isNativeServiceAvailable || ChandasTimerService.canUseFullScreenIntent(),
        callMute,
        notifications: notificationPermission && ChandasTimerService.areNotificationsEnabled(),
        checking: false,
        pending: current.pending,
      }))
    } catch {
      setAndroidAccess(current => ({ ...current, checking: false }))
      showNotice({ title: 'Android settings could not be checked', message: 'Nothing changed. Chandas will check again when you return to the app.', tone: 'attention' })
    }
  }, [showNotice])

  useEffect(() => {
    refreshFocusState()
    void refreshAndroidAccess()
    const subscription = NativeAppState.addEventListener('change', state => { if (state === 'active') { refreshFocusState(); void refreshAndroidAccess() } })
    const focusSubscription = isNativeServiceAvailable ? ChandasTimerService.addFocusListener(nextFocus => {
      setFocusState(nextFocus)
      const running = activeRunRef.current
      if (appState === 'running' && running) {
        if (running.settings.focusAutomationEnabled !== nextFocus.automationEnabled) commitActiveRun({ ...running, settings: { ...running.settings, focusAutomationEnabled: nextFocus.automationEnabled } })
      }
    }) : null
    return () => { subscription.remove(); focusSubscription?.remove() }
  }, [appState, commitActiveRun, refreshAndroidAccess, refreshFocusState])

  useEffect(() => {
    if (!ready || Platform.OS === 'web' || !Updates.isEnabled) return

    if (updateState.currentlyRunning.isEmergencyLaunch && !emergencyLaunchAnnounced.current) {
      emergencyLaunchAnnounced.current = true
      showNotice({ title: 'Chandas opened its safe built-in version', message: 'Your timer is ready. A newer update did not start cleanly, so it will be retried later.', tone: 'attention' })
    }

    if (!updateState.isUpdatePending) return
    if (appState === 'running') {
      if (deferredUpdateAnnounced.current) return
      deferredUpdateAnnounced.current = true
      showNotice({ title: 'A Chandas update is ready for later', message: 'It will wait until you finish—this timer will not be interrupted.', tone: 'info' })
      return
    }
    if (readyUpdateAnnounced.current) return
    readyUpdateAnnounced.current = true
    showNotice({ title: 'A Chandas update is ready', message: 'Restart now to use it, or leave it for your next normal launch.', tone: 'info', actionLabel: 'Restart now', onAction: applyDownloadedUpdate, persistent: true })
  }, [appState, applyDownloadedUpdate, ready, showNotice, updateState.currentlyRunning.isEmergencyLaunch, updateState.isUpdatePending])

  useEffect(() => {
    if (Platform.OS !== 'android' || appState !== 'running') return
    const subscription = NativeAppState.addEventListener('change', state => {
      if (state !== 'active' || !isNativeServiceAvailable || ChandasTimerService.canScheduleExactAlarms()) return
      if (timer.stop()) {
        commitActiveRun(null)
        setAppState('config')
        showNotice({ title: 'Timer stopped safely', message: 'Android’s exact-timing access changed, so Chandas stopped instead of letting bells drift.', tone: 'attention', actionLabel: 'Open settings', onAction: openExactAlarmSettings, persistent: true })
      } else {
        showNotice({ title: 'Timer may still be running', message: 'Android did not confirm a stop. The running timer stays on screen until its status is verified.', tone: 'attention', persistent: true })
      }
    })
    return () => subscription.remove()
  }, [appState, commitActiveRun, openExactAlarmSettings, showNotice, timer.stop])

  useEffect(() => {
    if (Platform.OS !== 'android' || !isNativeServiceAvailable || appState !== 'running') return
    const reconcileOverlayChanges = () => {
      const destination = ChandasTimerService.consumeFloatingOverlayDestination()
      if (destination) setFloatingTimerPanel(destination)
      const native = ChandasTimerService.getState()
      const nativeProgram = native.active ? parseRuntimeProgram(native.timerV2Program) : null
      if (!nativeProgram) return
      const current = activeRunRef.current
      if (!current || JSON.stringify(current.program) === JSON.stringify(nativeProgram)) return
      // The overlay changes the live schedule, never a configuration draft.
      commitActiveRun({ ...current, program: nativeProgram })
    }
    const subscription = NativeAppState.addEventListener('change', state => { if (state === 'active') reconcileOverlayChanges() })
    return () => subscription.remove()
  }, [appState, commitActiveRun])

  useEffect(() => {
    setReady(false)
    configWritableRef.current = false
    void (async () => {
      const [loaded, unifiedSession, legacySession, legacyRaw, v1SessionRaw] = await Promise.all([
        bootstrapUnifiedConfigState(AsyncStorage),
        loadUnifiedTimerSession(AsyncStorage),
        loadTimerV2Session(),
        AsyncStorage.getItem('chandas-timer-v2-session'),
        AsyncStorage.getItem('chandas-session'),
      ])
      if (loaded.status !== 'loaded') {
        configStateRef.current = null
        setConfigState(null)
        setConfigRecovery({ reason: loaded.message, ...(loaded.raw ? { raw: loaded.raw } : {}) })
        setReady(true)
        showNotice({ title: 'Saved timer setup needs recovery', message: loaded.message, tone: 'attention', persistent: true })
        return
      }
      configStateRef.current = loaded.state
      configWritableRef.current = true
      setConfigState(loaded.state)
      setConfigRecovery(null)
      const initialDraft = Object.prototype.hasOwnProperty.call(loaded.state.drafts, loaded.state.selectedConfigId ?? UNNAMED_DRAFT_KEY)
        ? loaded.state.drafts[loaded.state.selectedConfigId ?? UNNAMED_DRAFT_KEY]
        : undefined
      let pending: PendingRestore | null = null
      let recovery: { reason: string; raw?: string } | null = null

      if (Platform.OS === 'android' && isNativeServiceAvailable) {
        const native = ChandasTimerService.getState()
        if (native.active) {
          const nativeProgram = parseRuntimeProgram(native.timerV2Program)
          if (!nativeProgram) {
            recovery = { reason: 'Android has an active timer whose program this version cannot safely read.' }
          } else if (!ChandasTimerService.canScheduleExactAlarms()) {
            recovery = { reason: 'Android still reports an active timer, but exact timing access is unavailable. Its native schedule was left untouched.' }
          } else if (nativeProgram.mode === 'unified') {
            if (unifiedSession.status !== 'loaded') {
              recovery = { reason: unifiedSession.status === 'recovery-required' ? unifiedSession.reason : 'Android has an active unified timer, but its matching session record is missing.' , ...(unifiedSession.status === 'recovery-required' && unifiedSession.raw ? { raw: unifiedSession.raw } : {}) }
            } else {
              const session = unifiedSession.session
              const nativeAnchor = native.timerV2Anchor
              const nativeStartedAt = native.timerV2StartedAt ?? nativeAnchor
              const nativeEndsAt = native.timerV2EndsAt && native.timerV2EndsAt > 0 ? native.timerV2EndsAt : undefined
              const nativeSeed = native.timerV2RandomSeed && native.timerV2RandomSeed > 0 ? native.timerV2RandomSeed : session.randomSeed
              const generationMatches = session.nativeGeneration === native.sessionGeneration
              // Android owns transport and alarm controls while the JS process
              // is away. A matching generation lets us adopt its current
              // anchor/deadline/pause state while keeping durable JS cursors.
              if (!generationMatches || typeof nativeAnchor !== 'number') {
                recovery = { reason: 'Android’s active timer and its saved session do not match. The native timer was left untouched for recovery.' }
              } else {
                const settings = settingsFromNative(session.settings, native)
                const source = session.sourcePreset
                const restore: TimerRestore = {
                  anchor: nativeAnchor, startedAt: nativeStartedAt, endsAt: nativeEndsAt,
                  pausedAt: native.timerV2PausedAt && native.timerV2PausedAt > 0 ? native.timerV2PausedAt : undefined,
                  randomSeed: nativeSeed,
                  mute: native.mutedIterationEndId && native.mutedIterationEndAt
                    ? { mutedUntil: native.mutedUntil ?? 0, iteration: { endsAtLogicalId: native.mutedIterationEndId, endsAt: native.mutedIterationEndAt, iterations: Math.max(1, native.mutedIterationsRemaining ?? 1) } }
                    : { mutedUntil: native.mutedUntil ?? 0 },
                  alarmBehavior: native.alarmModeEnabled ? 'locked' : native.alarmOnceArmed ? 'once' : 'off',
                  soundState: session.soundState, sessionId: session.sessionId, nativeGeneration: native.sessionGeneration,
                }
                const frozen = { program: nativeProgram, settings, sourcePreset: source, sessionId: session.sessionId, nativeGeneration: native.sessionGeneration }
                commitActiveRun(frozen)
                pending = { ...frozen, restore, attachNative: true }
              }
            }
          } else {
            // Existing native schema 2/3 sessions remain on their original timeline.
            const matchingLegacy = legacySession && JSON.stringify(legacySession.program) === JSON.stringify(nativeProgram) ? legacySession : null
            const anchor = native.timerV2Anchor
            if (typeof anchor !== 'number') recovery = { reason: 'Android has an active timer without a readable anchor. Its native schedule was left untouched.' }
            else {
              const settings = settingsFromNative(matchingLegacy?.settings ?? initialDraft?.settings ?? FALLBACK_SETTINGS, native)
              const source = matchingLegacy?.sourcePreset
              const restore: TimerRestore = {
                anchor, startedAt: native.timerV2StartedAt ?? anchor,
                endsAt: native.timerV2EndsAt && native.timerV2EndsAt > 0 ? native.timerV2EndsAt : undefined,
                pausedAt: native.timerV2PausedAt && native.timerV2PausedAt > 0 ? native.timerV2PausedAt : undefined,
                randomSeed: native.timerV2RandomSeed && native.timerV2RandomSeed > 0 ? native.timerV2RandomSeed : anchor,
                mute: native.mutedIterationEndId && native.mutedIterationEndAt
                  ? { mutedUntil: native.mutedUntil ?? 0, iteration: { endsAtLogicalId: native.mutedIterationEndId, endsAt: native.mutedIterationEndAt, iterations: Math.max(1, native.mutedIterationsRemaining ?? 1) } }
                  : { mutedUntil: native.mutedUntil ?? 0 },
                alarmBehavior: native.alarmModeEnabled ? 'locked' : native.alarmOnceArmed ? 'once' : 'off',
                soundState: matchingLegacy?.soundState,
                nativeGeneration: native.sessionGeneration,
              }
              const frozen = { program: nativeProgram, settings, sourcePreset: source, nativeGeneration: native.sessionGeneration }
              commitActiveRun(frozen)
              pending = { ...frozen, restore, attachNative: true }
            }
          }
        } else if (unifiedSession.status === 'loaded') {
          // Native state is authoritative on Android; a stale JS snapshot is cleared only after observing no active native timer.
          const result = await clearUnifiedTimerSession(AsyncStorage, unifiedSession.session.sessionId)
          if (!result.ok) recovery = { reason: result.reason }
        } else if (unifiedSession.status === 'recovery-required') {
          recovery = { reason: unifiedSession.reason, ...(unifiedSession.raw ? { raw: unifiedSession.raw } : {}) }
        }
      } else if (unifiedSession.status === 'loaded') {
        const session = unifiedSession.session
        const frozen = { program: session.program, settings: session.settings, sourcePreset: session.sourcePreset, sessionId: session.sessionId, nativeGeneration: session.nativeGeneration }
        commitActiveRun(frozen)
        pending = { ...frozen, restore: {
          anchor: session.anchor, startedAt: session.startedAt, endsAt: session.endsAt, pausedAt: session.pausedAt,
          randomSeed: session.randomSeed, mute: session.mute, alarmBehavior: session.alarmBehavior,
          soundState: session.soundState, sessionId: session.sessionId, nativeGeneration: session.nativeGeneration,
        }, attachNative: false }
      } else if (unifiedSession.status === 'recovery-required') {
        recovery = { reason: unifiedSession.reason, ...(unifiedSession.raw ? { raw: unifiedSession.raw } : {}) }
      } else if (legacySession) {
        const frozen = { program: legacySession.program, settings: legacySession.settings ?? initialDraft?.settings ?? FALLBACK_SETTINGS, sourcePreset: legacySession.sourcePreset }
        commitActiveRun(frozen)
        pending = legacyRestore(legacySession, frozen.program)
      } else if (legacyRaw !== null) {
        recovery = { reason: 'A legacy running session exists but could not be read safely. Its source record was preserved.' }
      } else if (v1SessionRaw !== null) {
        recovery = { reason: 'An older timer session was found without enough information to resume it safely. Its source record was preserved.', raw: v1SessionRaw }
      }

      setSessionRecovery(recovery)
      if (Platform.OS === 'android' && isNativeServiceAvailable) setFocusState(ChandasTimerService.getFocusState())
      setRestoreSession(pending)
      if (!pending) setReady(true)
      if (loaded.source !== 'unified' && loaded.source !== 'new-install') {
        showNotice({ title: 'Your timer setup was migrated', message: 'Both previous timer drafts and their saved configurations are available in the new setup.', tone: 'info' })
      }
      if (recovery) showNotice({ title: 'Timer session needs recovery', message: recovery.reason, tone: 'attention', persistent: true })
    })().catch(error => {
      configWritableRef.current = false
      configStateRef.current = null
      setConfigState(null)
      setConfigRecovery({ reason: error instanceof Error ? error.message : 'Saved timer data could not be read safely.' })
      setRestoreSession(null)
      setReady(true)
      showNotice({ title: 'Saved timer data needs recovery', message: 'Chandas preserved the source records and did not create replacement data.', tone: 'attention', persistent: true })
    })
  }, [commitActiveRun, configRetry, showNotice])

  useEffect(() => {
    if (!restoreSession || !configState) return
    if (restoreAttempt.current === restoreSession) return
    const restoring = restoreSession
    restoreAttempt.current = restoring
    const settle = (after: () => void) => {
      if (restoreAttempt.current !== restoring) return
      restoreAttempt.current = null
      setRestoreSession(current => current === restoring ? null : current)
      after()
      setReady(true)
    }
    if (restoreSession.attachNative) {
      void timer.attachNativeSession(restoreSession.restore)
        .then(() => settle(() => setAppState('running')))
        .catch(() => settle(() => {
          const nativeStillActive = Platform.OS === 'android' && isNativeServiceAvailable && ChandasTimerService.getState().active
          if (nativeStillActive) setSessionRecovery({ reason: 'The active Android timer could not attach safely. Its native schedule was left running.' })
          else { commitActiveRun(null); setAppState('config') }
          showNotice({ title: 'The saved timer could not reopen', message: nativeStillActive ? 'The Android timer remains active; Chandas did not replace or stop it.' : 'Its configuration is still available, so you can start it again when ready.', tone: 'attention', persistent: nativeStillActive })
        }))
    } else {
      void timer.start(restoreSession.restore)
        .then(started => settle(() => { setAppState(started ? 'running' : 'config'); if (!started) commitActiveRun(null) }))
        .catch(() => settle(() => {
          commitActiveRun(null)
          setAppState('config')
          showNotice({ title: 'The saved timer could not reopen', message: 'Its configuration is still available, so you can start it again when ready.', tone: 'attention' })
        }))
    }
  }, [restoreSession, showNotice, timer.attachNativeSession, timer.start, configState, commitActiveRun])

  const stop = useCallback(() => {
    // Keep the active run visible until the timer runtime confirms it stopped.
    reanchorAttemptGeneration.current += 1
    realigningRef.current = false
    setRealigning(false)
    const generation = ++stopAttemptGeneration.current
    const clearStopWarningOnSuccess = stopNeedsAttention.current
    stopNeedsAttention.current = false
    if (stopRetryTimeout.current) clearTimeout(stopRetryTimeout.current)
    tapHaptic()

    const attempt = (index: number) => {
      if (generation !== stopAttemptGeneration.current) return
      if (timer.stop()) {
        stopRetryTimeout.current = null
        stopNeedsAttention.current = false
        commitActiveRun(null)
        setAppState('config')
        if (clearStopWarningOnSuccess) dismissNotice()
        refreshFocusState()
        return
      }
      const retryDelays = [160, 640]
      const delay = retryDelays[index]
      if (delay != null) {
        stopRetryTimeout.current = setTimeout(() => attempt(index + 1), delay)
        return
      }
      stopRetryTimeout.current = null
      stopNeedsAttention.current = true
      showNotice({
        title: 'The timer may still be running',
        message: 'Android did not confirm the stop after several tries. Your setup is safe; tap Stop again before leaving it unattended.',
        tone: 'attention',
        actionLabel: 'Stop again',
        onAction: stop,
        persistent: true,
      })
    }

    attempt(0)
  }, [commitActiveRun, dismissNotice, refreshFocusState, showNotice, timer.stop])

  useEffect(() => {
    if (!ready || appState !== 'running' || restoreSession || timer.isRunning) return
    if (Platform.OS === 'android' && isNativeServiceAvailable) {
      try {
        if (ChandasTimerService.getState().active) {
          setSessionRecovery({ reason: 'The Android timer remains active but could not be attached. Its schedule was left untouched.' })
          return
        }
      } catch {
        setSessionRecovery({ reason: 'The Android timer status could not be verified, so its schedule was left untouched.' })
        return
      }
    }
    commitActiveRun(null)
    setAppState('config')
  }, [appState, commitActiveRun, ready, restoreSession, timer.isRunning])

  useEffect(() => {
    if (!ready || restoreSession || appState !== 'config' || Platform.OS !== 'android' || !isNativeServiceAvailable) return
    let nativeActive = true
    try { nativeActive = ChandasTimerService.getState().active } catch { /* unreadable state must fail closed */ }
    // Screen state is never permission to stop Android's durable timer. If the
    // local hook is already attached, recover the running surface; explicit
    // Stop owns the only intentional config/native-active transition.
    if (nativeActive && timer.isRunning && stopRetryTimeout.current == null && !stopNeedsAttention.current) setAppState('running')
  }, [appState, ready, restoreSession, timer.isRunning])

  useEffect(() => () => {
    stopAttemptGeneration.current += 1
    if (stopRetryTimeout.current) clearTimeout(stopRetryTimeout.current)
  }, [])

  useEffect(() => {
    if (timer.completionPulse <= handledCompletionPulse.current) return
    handledCompletionPulse.current = timer.completionPulse
    commitActiveRun(null)
    setAppState('config')
    showNotice({ title: 'Session complete', message: 'Your timer finished exactly where you asked. The setup is ready whenever you want another round.', tone: 'success' })
    successHaptic()
  }, [commitActiveRun, showNotice, timer.completionPulse])

  useEffect(() => {
    if (timer.runtimeInterruption !== 'exact-alarm-access') return
    timer.clearRuntimeInterruption()
    if (Platform.OS === 'android' && isNativeServiceAvailable) {
      try {
        if (ChandasTimerService.getState().active) {
          setSessionRecovery({ reason: 'Android still reports an active timer after exact-timing access changed. Its schedule was left untouched.' })
          showNotice({ title: 'Timer status needs attention', message: 'Android still reports the timer as active. Chandas left it running until its status can be verified.', tone: 'attention', actionLabel: 'Open settings', onAction: openExactAlarmSettings, persistent: true })
          return
        }
      } catch {
        setSessionRecovery({ reason: 'The Android timer status could not be verified, so its schedule was left untouched.' })
        return
      }
    }
    commitActiveRun(null)
    setAppState('config')
    showNotice({ title: 'Timer paused safely', message: 'Exact timing is no longer available. Your configuration is still here.', tone: 'attention', actionLabel: 'Open settings', onAction: openExactAlarmSettings, persistent: true })
  }, [commitActiveRun, openExactAlarmSettings, showNotice, timer.runtimeInterruption, timer.clearRuntimeInterruption])

  useEffect(() => {
    const error = timer.sessionPersistenceError
    if (!error || sessionWarningShown.current === error) return
    sessionWarningShown.current = error
    showNotice({ title: 'Timer session needs recovery', message: error, tone: 'attention', persistent: true })
  }, [showNotice, timer.sessionPersistenceError])

  const setFocusAutomation = (enabled: boolean) => {
    const running = activeRunRef.current
    if (appState === 'running' && running) {
      if (running.settings.focusAutomationEnabled !== enabled) commitActiveRun({ ...running, settings: { ...running.settings, focusAutomationEnabled: enabled } })
    } else {
      const current = configStateRef.current
      const key = current?.selectedConfigId ?? UNNAMED_DRAFT_KEY
      const draft = current && Object.prototype.hasOwnProperty.call(current.drafts, key) ? current.drafts[key] : undefined
      if (draft && draft.settings.focusAutomationEnabled !== enabled) void onConfigCommand({ type: 'edit', changes: { settings: { ...draft.settings, focusAutomationEnabled: enabled } } })
    }
    if (enabled && Platform.OS === 'android' && isNativeServiceAvailable && !focusState.policyAccess) {
      showNotice({ title: 'One Android setting is needed', message: 'Allow Do Not Disturb access, then return here. Chandas only manages its own Focus rule.', actionLabel: 'Open settings', onAction: openNotificationPolicySettings, persistent: true })
    }
    try {
      if (isNativeServiceAvailable) ChandasTimerService.setFocusModeEnabled(enabled)
    } catch {
      showNotice({ title: 'Focus stayed as it was', message: 'Android did not accept that change. Your timer and alarm audio are unaffected.', tone: 'attention' })
    }
    setTimeout(refreshFocusState, 100)
  }

  const resumeFocusAutomation = () => {
    setFocusAutomation(false)
    setFocusAutomation(true)
  }

  const requestCallMuteAccess = async () => {
    if (Platform.OS !== 'android') return
    setAndroidAccess(current => ({ ...current, pending: 'call-mute' }))
    try {
      const result = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.READ_PHONE_STATE, {
        title: 'Mute bells during calls',
        message: 'Allow phone-state access so Chandas can stay quiet during calls. Chandas never reads phone numbers or call history.',
        buttonPositive: 'Allow', buttonNegative: 'Not now',
      })
      if (result === PermissionsAndroid.RESULTS.GRANTED) showNotice({ title: 'Call auto-mute is ready', message: 'Scheduled bells will stay quiet while a call is active.', tone: 'success' })
      else if (result === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN) showNotice({ title: 'Call auto-mute remains off', message: 'You can allow it later in Android app settings. The timer works normally without it.', actionLabel: 'Open settings', onAction: openAppSettings, persistent: true })
      else showNotice({ title: 'Call auto-mute remains off', message: 'No problem—the timer works normally, but it cannot detect calls.', tone: 'info' })
    } catch {
      showNotice({ title: 'Permission request did not open', message: 'Nothing changed. You can try again whenever it suits you.', tone: 'attention' })
    } finally {
      setAndroidAccess(current => ({ ...current, pending: null }))
      await refreshAndroidAccess()
    }
  }

  const requestNotificationAccess = async () => {
    if (Platform.OS !== 'android') return
    setAndroidAccess(current => ({ ...current, pending: 'notifications' }))
    try {
      if (Platform.Version < 33) {
        openNotificationSettings()
        showNotice({ title: 'Notification settings opened', message: 'Enable Chandas notifications to keep timer status and dismiss controls easy to reach.', tone: 'info' })
        return
      }
      const result = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS, {
        title: 'Show timer notifications',
        message: 'Allow notifications so Android can show the running timer and alarm controls.',
        buttonPositive: 'Allow', buttonNegative: 'Not now',
      })
      if (result === PermissionsAndroid.RESULTS.GRANTED) showNotice({ title: 'Timer notifications are ready', message: 'Running status and alarm controls can now appear outside the app.', tone: 'success' })
      else if (result === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN) showNotice({ title: 'Notifications remain off', message: 'The timer still works. Android settings can enable its status and controls later.', actionLabel: 'Open settings', onAction: openNotificationSettings, persistent: true })
      else showNotice({ title: 'Notifications remain off', message: 'The timer still works while Chandas is open. You can enable notifications later.', tone: 'info' })
    } catch {
      showNotice({ title: 'Permission request did not open', message: 'Nothing changed. You can try again whenever it suits you.', tone: 'attention' })
    } finally {
      setAndroidAccess(current => ({ ...current, pending: null }))
      await refreshAndroidAccess()
    }
  }

  const start = () => {
    // A fast second tap must not replace the just-created native session with
    // a slightly different anchor or open duplicate permission guidance.
    if (startingRef.current) return
    const state = configStateRef.current
    const key = state?.selectedConfigId ?? UNNAMED_DRAFT_KEY
    const selectedDraft = state && Object.prototype.hasOwnProperty.call(state.drafts, key) ? state.drafts[key] : undefined
    if (!configWritableRef.current || !selectedDraft || configRecovery || sessionRecovery) {
      showNotice({ title: 'Timer setup needs recovery', message: 'Chandas kept the saved records unchanged. Retry recovery before starting a new timer.', tone: 'attention', persistent: true })
      return
    }
    const acceptedSnapshot: ActiveRunSnapshot = {
      program: selectedDraft.program,
      settings: selectedDraft.settings,
      sourcePreset: draftSourcePreset(state, selectedDraft),
    }
    // A new explicit start supersedes any delayed verification from a previous
    // Stop press; otherwise that retry could cancel the new session.
    stopAttemptGeneration.current += 1
    reanchorAttemptGeneration.current += 1
    realigningRef.current = false
    setRealigning(false)
    stopNeedsAttention.current = false
    if (stopRetryTimeout.current) clearTimeout(stopRetryTimeout.current)
    stopRetryTimeout.current = null
    startingRef.current = true
    setStarting(true)
    void timer.start().then(started => {
      if (started) {
        const identity = timer.getSessionIdentity()
        commitActiveRun({ ...acceptedSnapshot, sessionId: identity.sessionId ?? undefined, nativeGeneration: identity.nativeGeneration })
        setAppState('running')
        refreshFocusState()
        return
      }
      if (Platform.OS === 'android' && isNativeServiceAvailable && !ChandasTimerService.canScheduleExactAlarms()) {
        showNotice({ title: 'Exact timing needs one setting', message: 'Allow Alarms & reminders so bells stay precise when the screen is off.', tone: 'attention', actionLabel: 'Open settings', onAction: openExactAlarmSettings, persistent: true })
      } else {
        showNotice({ title: 'The timer did not start yet', message: 'Your saved setup is unchanged. Check the timer settings or try again.', tone: 'attention', actionLabel: 'Try again', onAction: start })
      }
    }).catch(() => showNotice({ title: 'The timer did not start yet', message: 'Your setup is safe. Please check Android access or try once more.', tone: 'attention', actionLabel: 'Try again', onAction: start }))
      .finally(() => {
        startingRef.current = false
        setStarting(false)
        void refreshAndroidAccess()
      })
  }

  const reanchor = async (alignToClock: boolean, offsetMinutes = 0): Promise<boolean> => {
    const current = activeRunRef.current
    if (!current || realigningRef.current) return false
    if (alignToClock && current.program.alignment.kind === 'local-clock' && current.program.alignment.offsetMinutes === offsetMinutes) {
      showNotice({ title: `Already aligned to ${clockOffsetLabel(offsetMinutes)}`, message: 'The running timer is already following that clock rhythm.', tone: 'info' })
      return true
    }
    realigningRef.current = true
    const generation = ++reanchorAttemptGeneration.current
    setRealigning(true)
    const alignment = alignToClock ? { kind: 'local-clock' as const, offsetMinutes } : { kind: 'elapsed' as const }
    const nextProgram: RuntimeTimerProgram = current.program.mode === 'unified'
      ? { ...current.program, alignment }
      : { ...current.program, alignment }
    try {
      const started = await timer.reanchor(nextProgram, alignToClock, current.settings, current.sourcePreset)
      if (generation !== reanchorAttemptGeneration.current) return false
      if (!started) {
        showNotice({ title: 'Alignment stayed unchanged', message: 'Exact timing is needed before Chandas can move this live pattern.', tone: 'attention', actionLabel: 'Open settings', onAction: openExactAlarmSettings })
        return false
      }
      const identity = timer.getSessionIdentity()
      commitActiveRun({ ...current, program: nextProgram, sessionId: identity.sessionId ?? undefined, nativeGeneration: identity.nativeGeneration })
      if (alignToClock) showNotice({ title: `Aligned to ${clockOffsetLabel(offsetMinutes)}`, message: 'The countdown and upcoming bells now follow that clock rhythm.', tone: 'success' })
      return true
    } catch {
      if (generation !== reanchorAttemptGeneration.current) return false
      showNotice({ title: 'Alignment stayed unchanged', message: 'The timer is still running on its previous schedule. You can try again.', tone: 'attention' })
      return false
    } finally {
      if (generation === reanchorAttemptGeneration.current) {
        realigningRef.current = false
        setRealigning(false)
      }
    }
  }

  const switchRunningConfiguration = async (configId: string): Promise<boolean> => {
    const state = configStateRef.current
    const config = state?.configs.find(value => value.id === configId && value.showInRunningSelector)
    if (!config || realigningRef.current) return false
    const source = { id: config.id, name: config.name, createdAt: config.createdAt }
    if (activeRunRef.current?.sourcePreset?.id === config.id && JSON.stringify(activeRunRef.current.program) === JSON.stringify(config.program)) return true
    realigningRef.current = true
    const generation = ++reanchorAttemptGeneration.current
    setRealigning(true)
    try {
      const started = await timer.reanchor(config.program, config.program.alignment.kind === 'local-clock', config.settings, source)
      if (generation !== reanchorAttemptGeneration.current) return false
      if (!started) {
        showNotice({ title: timer.isAlarmRinging ? 'Dismiss the alarm first' : 'Configuration stayed unchanged', message: timer.isAlarmRinging ? 'The ringing alarm must be dismissed before changing configuration.' : 'The timer kept its existing schedule. You can try again.', tone: 'attention' })
        return false
      }
      const identity = timer.getSessionIdentity()
      commitActiveRun({ program: config.program, settings: config.settings, sourcePreset: source, sessionId: identity.sessionId ?? undefined, nativeGeneration: identity.nativeGeneration })
      showNotice({ title: 'Configuration switched', message: `“${config.name}” is now running. Your setup drafts remain saved.`, tone: 'success' })
      return true
    } catch {
      if (generation === reanchorAttemptGeneration.current) showNotice({ title: 'Configuration stayed unchanged', message: 'The timer kept its existing schedule. You can try again.', tone: 'attention' })
      return false
    } finally {
      if (generation === reanchorAttemptGeneration.current) { realigningRef.current = false; setRealigning(false) }
    }
  }

  const changeCueVolume = (cueId: string, volume: number) => {
    const current = activeRunRef.current
    if (!current) return
    const patchCue = (cue: CueSettings): CueSettings => ({ ...cue, volume })
    let nextProgram: RuntimeTimerProgram = current.program
    if (cueId === '__chandas_completion__') {
      nextProgram = { ...current.program, completionCue: current.program.completionCue ? patchCue(current.program.completionCue) : null }
    } else if (current.program.mode === 'unified') {
      nextProgram = { ...current.program, steps: current.program.steps.map(step => {
        if (cueId === unifiedCueIdentity(step.id)) return { ...step, endCue: patchCue(step.endCue) }
        return { ...step, subBellTracks: step.subBellTracks.map(track => cueId === unifiedCueIdentity(step.id, track.id) ? { ...track, ...patchCue(track) } : track) }
      }) }
    } else if (current.program.mode === 'sequence') {
      nextProgram = { ...current.program, steps: current.program.steps.map(step => step.id === cueId ? { ...step, ...patchCue(step) } : step) }
    } else if (cueId === 'main') {
      nextProgram = { ...current.program, mainCue: patchCue(current.program.mainCue) }
    } else {
      nextProgram = { ...current.program, tracks: current.program.tracks.map(track => track.id === cueId ? { ...track, ...patchCue(track) } : track) }
    }
    commitActiveRun({ ...current, program: nextProgram })
  }

  const pressAlarm = () => {
    const wasOff = timer.alarmBehavior === 'off'
    timer.pressAlarm()
    if (wasOff && !fullScreenGuidanceShown.current && Platform.OS === 'android' && isNativeServiceAvailable && !ChandasTimerService.canUseFullScreenIntent()) {
      fullScreenGuidanceShown.current = true
      // Wait beyond the double-tap window so this guidance never interrupts
      // the one-tap-then-lock gesture.
      setTimeout(() => {
        const native = ChandasTimerService.getState()
        if (!native.alarmModeEnabled && !native.alarmOnceArmed) return
        showNotice({ title: 'Alarm sound is armed', message: 'To also show its dismiss screen over the lock screen, allow full-screen alarms.', actionLabel: 'Open settings', onAction: openFullScreenIntentSettings })
      }, 550)
    }
  }

  const toggleCurrentStepAlarm = () => {
    const current = activeRunRef.current
    if (!current || !timer.position) return
    const index = timer.position.currentStepIndex ?? 0
    if (current.program.mode === 'unified') {
      commitActiveRun({ ...current, program: { ...current.program, steps: current.program.steps.map((step, i) => i === index ? { ...step, endAlarmEnabled: !step.endAlarmEnabled } : step) } })
    } else if (current.program.mode === 'sequence') {
      commitActiveRun({ ...current, program: { ...current.program, steps: current.program.steps.map((step, i) => i === index ? { ...step, alarmEnabled: step.alarmEnabled === true ? undefined : true } : step) } })
    }
  }

  const setTimerPaused = (paused: boolean): boolean => {
    const current = activeRunRef.current
    if (!current || !timer.setPaused(paused)) return false
    if (paused && current.program.alignment.kind === 'local-clock') {
      commitActiveRun({ ...current, program: { ...current.program, alignment: { kind: 'elapsed' } } })
    }
    return true
  }

  if (!ready) return <AppLoadingScreen backgroundColor={tokens.bg} accentColor={tokens.accent} textColor={tokens.text} />

  const blockingRecovery = Boolean(configRecovery || (sessionRecovery && Platform.OS === 'android' && isNativeServiceAvailable && ChandasTimerService.getState().active))
  const runningConfigurations = (configState?.configs ?? []).filter(config => config.showInRunningSelector)

  return (
    <FeedbackLayerProvider notice={notice} onDismiss={dismissNotice}>
      <View style={{ flex: 1, backgroundColor: tokens.bg }}>
        <StatusBar style={theme === 'dark' ? 'light' : 'dark'} hidden={appState === 'running'} animated={theme !== 'eink'} />
        <View
          style={{ flex: 1, pointerEvents: timer.isAlarmRinging ? 'none' : 'auto' }}
          importantForAccessibility={timer.isAlarmRinging ? 'no-hide-descendants' : 'auto'}
          accessibilityElementsHidden={timer.isAlarmRinging}
        >
          <Reanimated.View key={appState} style={{ flex: 1 }} entering={reducedMotion ? undefined : FadeIn.duration(220)} exiting={reducedMotion ? undefined : FadeOut.duration(150)}>
            {blockingRecovery ? (
              <View style={{ flex: 1, justifyContent: 'center', paddingHorizontal: 28, gap: 16 }}>
                <Text style={{ color: tokens.text, fontSize: 22, fontWeight: '500' }}>Timer data needs recovery</Text>
                <Text style={{ color: tokens.textMuted, fontSize: 16, lineHeight: 24 }}>{configRecovery?.reason ?? sessionRecovery?.reason ?? 'Chandas could not safely reopen the active timer.'}</Text>
                <Text style={{ color: tokens.textMuted, fontSize: 14, lineHeight: 20 }}>The saved record has been kept unchanged. Retry after the storage or timer status is available.</Text>
                <Pressable accessibilityRole="button" onPress={() => setConfigRetry(value => value + 1)} style={{ alignSelf: 'flex-start', paddingVertical: 12, paddingHorizontal: 16, borderRadius: 12, backgroundColor: tokens.surface, borderColor: tokens.border, borderWidth: 1 }}><Text style={{ color: tokens.text, fontWeight: '500' }}>Retry recovery</Text></Pressable>
              </View>
            ) : appState === 'config' ? (
              configState ? <UnifiedTimerConfigScreen state={configState} onCommand={onConfigCommand} onStart={start} starting={starting} focusState={focusState} onFocusAutomationChange={setFocusAutomation} onOpenFocusSettings={openNotificationPolicySettings} onOpenFocusRuleSettings={openFocusRuleSettings} androidAccess={androidAccess} onOpenExactAlarmSettings={openExactAlarmSettings} onOpenFullScreenIntentSettings={openFullScreenIntentSettings} onRequestCallMuteAccess={() => void requestCallMuteAccess()} onRequestNotificationAccess={() => void requestNotificationAccess()} onFeedback={showNotice} /> : <AppLoadingScreen backgroundColor={tokens.bg} accentColor={tokens.accent} textColor={tokens.text} />
            ) : (
              <TimerV2RunningScreen program={program} configurationName={activeRun?.sourcePreset?.name} mainCountdown={timer.mainCountdown} nextCueCountdown={timer.nextCueCountdown} nextCueLabel={timer.nextCueLabel} progress={timer.progress} position={timer.position} eventPulse={timer.eventPulse} activeHoursPaused={timer.activeHoursPaused} activeHoursResumeAt={timer.activeHoursResumeAt} nextAudibleAt={timer.nextAudibleAt} nextAudibleLabel={timer.nextAudibleLabel} runEndsAt={timer.runEndsAt} runRemainingMs={timer.runRemainingMs} runProgress={timer.runProgress} mute={timer.mute} alarmBehavior={timer.alarmBehavior} realigning={realigning} isPaused={timer.isPaused} isAlarmRinging={timer.isAlarmRinging} onSetPaused={setTimerPaused} onSkipStep={timer.skipSequenceStep} onStop={stop} onRestartUnsynced={() => reanchor(false)} onSnapToClock={offset => reanchor(true, offset)} onPressAlarm={pressAlarm} onToggleCurrentStepAlarm={toggleCurrentStepAlarm} onMuteForIterations={timer.muteForIterations} onMuteForSeconds={timer.muteForSeconds} onClearMute={timer.clearMute} secondPrecision={!isNativeServiceAvailable || ChandasTimerService.getCapabilities()?.supportsSecondPrecision === true} masterVolume={liveSettings.masterVolume} onMasterVolumeChange={masterVolume => { const current = activeRunRef.current; if (current) commitActiveRun({ ...current, settings: { ...current.settings, masterVolume } }) }} onCueVolumeChange={changeCueVolume} showAdvancedControls={liveSettings.advancedModeEnabled} onShowAdvancedControls={() => { const current = activeRunRef.current; if (current) commitActiveRun({ ...current, settings: { ...current.settings, advancedModeEnabled: true } }) }} focusEnabled={liveSettings.focusAutomationEnabled} focusActive={focusState.actual === 'active' && !timer.activeHoursPaused} focusPolicyAccess={focusState.policyAccess} focusReason={focusState.reason} onToggleFocus={focusState.reason === 'paused-by-android' ? resumeFocusAutomation : () => setFocusAutomation(!liveSettings.focusAutomationEnabled)} onOpenFocusSettings={focusState.reason === 'rule-disabled' ? openFocusRuleSettings : openNotificationPolicySettings} configurations={runningConfigurations} activeConfigurationId={activeRun?.sourcePreset?.id} onSelectConfiguration={switchRunningConfiguration} externalPanel={floatingTimerPanel} onExternalPanelConsumed={() => setFloatingTimerPanel(null)} />
            )}
          </Reanimated.View>
        </View>
        {timer.isAlarmRinging && <AlarmRingingScreen onDismiss={timer.dismissAlarm} />}
        <RootFeedbackOverlay hidden={timer.isAlarmRinging} />
      </View>
    </FeedbackLayerProvider>
  )
}

export default function App() {
  const [fontsLoaded] = useFonts({ 'JetBrainsMono-Light': JetBrainsMono_300Light, 'JetBrainsMono-Regular': JetBrainsMono_400Regular })
  return <GestureHandlerRootView style={{ flex: 1 }}><SafeAreaProvider><AppErrorBoundary>{fontsLoaded ? <ThemeProvider><ConfirmationProvider><Root /></ConfirmationProvider></ThemeProvider> : <AppLoadingScreen backgroundColor="#0b0c10" accentColor="#7c6ff7" textColor="#e8e8f0" message="Preparing Chandas…" />}</AppErrorBoundary></SafeAreaProvider></GestureHandlerRootView>
}
