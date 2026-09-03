import { useCallback, useEffect, useRef, useState } from 'react'
import { StatusBar } from 'expo-status-bar'
import { AppState as NativeAppState, Linking, PermissionsAndroid, Platform, View } from 'react-native'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { useFonts, JetBrainsMono_300Light, JetBrainsMono_400Regular } from '@expo-google-fonts/jetbrains-mono'
import Reanimated, { FadeIn, FadeOut, useReducedMotion } from 'react-native-reanimated'
import { ThemeProvider, useTheme } from './src/theme/ThemeContext'
import type { AppState, AppTimerSettings, TimerV2State } from './src/types'
import { useTimerV2 } from './src/hooks/useTimerV2'
import { clearTimerV2Session, loadTimerV2Session, loadTimerV2StateResult, saveTimerV2Session, saveTimerV2State, type TimerV2Session } from './src/lib/storage'
import { defaultTimerV2State, parseTimerProgram, replaceWorkingProgram, selectedProgram } from './src/lib/timerV2'
import { patchPatternTrack, patchSequenceStep, updatePattern } from './src/lib/programActions'
import { TimerV2ConfigScreen } from './src/screens/TimerV2ConfigScreen'
import { TimerV2RunningScreen } from './src/screens/TimerV2RunningScreen'
import { AlarmRingingScreen } from './src/screens/AlarmRingingScreen'
import { ChandasTimerService, isNativeServiceAvailable, type NativeFocusState } from './src/native/ChandasTimerService'
import { AppLoadingScreen, FeedbackBanner, type AppNotice } from './src/components/timer-v2/experience-feedback'
import { AppErrorBoundary } from './src/components/timer-v2/app-error-boundary'

const FALLBACK_PROGRAM = {
  schemaVersion: 2 as const, mode: 'pattern' as const, mainMinutes: 30,
  mainCue: { sound: { kind: 'builtin' as const, id: 'temple-gong' as const }, volume: 1 }, tracks: [], alignment: { kind: 'elapsed' as const },
}
const FALLBACK_SETTINGS = { masterVolume: 0.8, notificationsEnabled: true, activeHoursEnabled: false, activeHoursStart: 480, activeHoursEnd: 1320, activeHoursDays: 127, focusAutomationEnabled: false, alarmDurationSeconds: 60 }
const DEFAULT_FOCUS_STATE: NativeFocusState = { policyAccess: false, automationEnabled: false, ruleExists: false, ruleEnabled: false, actual: 'unknown', reason: 'off' }

interface PendingRestore {
  session: TimerV2Session
  attachNative: boolean
}

interface AndroidAccessState {
  exactAlarms: boolean
  callMute: boolean
  notifications: boolean
  checking: boolean
  pending: 'call-mute' | 'notifications' | null
}

function settingsFromNative(current: AppTimerSettings, native: ReturnType<typeof ChandasTimerService.getState>): AppTimerSettings {
  return {
    masterVolume: native.volume ?? current.masterVolume,
    notificationsEnabled: native.notificationsEnabled ?? current.notificationsEnabled,
    activeHoursEnabled: native.activeHoursEnabled ?? current.activeHoursEnabled,
    activeHoursStart: native.activeHoursStart ?? current.activeHoursStart,
    activeHoursEnd: native.activeHoursEnd ?? current.activeHoursEnd,
    activeHoursDays: native.activeHoursDays ?? current.activeHoursDays,
    focusAutomationEnabled: native.focusModeEnabled ?? current.focusAutomationEnabled,
    alarmDurationSeconds: native.alarmDurationSeconds ?? current.alarmDurationSeconds,
  }
}

function Root() {
  const { tokens, theme } = useTheme()
  const reducedMotion = useReducedMotion()
  const [timerState, setTimerState] = useState<TimerV2State | null>(null)
  const [appState, setAppState] = useState<AppState>('config')
  const [ready, setReady] = useState(false)
  const [focusState, setFocusState] = useState<NativeFocusState>(DEFAULT_FOCUS_STATE)
  const [restoreSession, setRestoreSession] = useState<PendingRestore | null>(null)
  const [androidAccess, setAndroidAccess] = useState<AndroidAccessState>({ exactAlarms: Platform.OS !== 'android', callMute: Platform.OS !== 'android', notifications: Platform.OS !== 'android', checking: Platform.OS === 'android', pending: null })
  const [starting, setStarting] = useState(false)
  const [realigning, setRealigning] = useState(false)
  const [notice, setNotice] = useState<AppNotice | null>(null)
  const startingRef = useRef(false)
  const noticeSequence = useRef(0)
  const storageWarningShown = useRef(false)
  const fullScreenGuidanceShown = useRef(false)
  const program = timerState ? selectedProgram(timerState) : null
  const timer = useTimerV2(program ?? FALLBACK_PROGRAM, timerState?.settings ?? FALLBACK_SETTINGS)

  const showNotice = useCallback((next: Omit<AppNotice, 'id'>) => {
    noticeSequence.current += 1
    setNotice({ ...next, id: `notice-${noticeSequence.current}` })
  }, [])

  const refreshFocusState = useCallback(() => {
    if (Platform.OS !== 'android' || !isNativeServiceAvailable) return
    const nextFocus = ChandasTimerService.getFocusState()
    setFocusState(nextFocus)
    setTimerState(current => {
      if (!current) return current
      const shouldMirror = nextFocus.automationEnabled || nextFocus.reason === 'rule-disabled'
      if (!shouldMirror || current.settings.focusAutomationEnabled === nextFocus.automationEnabled) return current
      const next = { ...current, settings: { ...current.settings, focusAutomationEnabled: nextFocus.automationEnabled } }
      void saveTimerV2State(next)
      return next
    })
  }, [])

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
      setTimerState(current => {
        if (!current || current.settings.focusAutomationEnabled === nextFocus.automationEnabled) return current
        const next = { ...current, settings: { ...current.settings, focusAutomationEnabled: nextFocus.automationEnabled } }
        void saveTimerV2State(next)
        return next
      })
    }) : null
    return () => { subscription.remove(); focusSubscription?.remove() }
  }, [refreshAndroidAccess, refreshFocusState])

  useEffect(() => {
    if (Platform.OS !== 'android' || appState !== 'running') return
    const subscription = NativeAppState.addEventListener('change', state => {
      if (state !== 'active' || !isNativeServiceAvailable || ChandasTimerService.canScheduleExactAlarms()) return
      timer.stop()
      setAppState('config')
      showNotice({ title: 'Timer paused safely', message: 'Android’s exact-timing access changed, so Chandas stopped instead of letting bells drift.', tone: 'attention', actionLabel: 'Open settings', onAction: ChandasTimerService.openExactAlarmSettings, persistent: true })
    })
    return () => subscription.remove()
  }, [appState, showNotice, timer.stop])

  useEffect(() => {
    void (async () => {
      const [storedResult, session] = await Promise.all([loadTimerV2StateResult(), loadTimerV2Session()])
      const stored = storedResult.state
      let reconciled = stored
      let pending: PendingRestore | null = null
      if (Platform.OS === 'android' && isNativeServiceAvailable) {
        const exactTimingAvailable = ChandasTimerService.canScheduleExactAlarms()
        const native = ChandasTimerService.getState()
        const nativeProgram = native.active ? parseTimerProgram(native.timerV2Program) : null
        if (exactTimingAvailable && native.active && nativeProgram && native.timerV2Anchor && native.timerV2Anchor > 0) {
          reconciled = {
            ...replaceWorkingProgram(stored, nativeProgram),
            settings: settingsFromNative(stored.settings, native),
          }
          const nativeSession: TimerV2Session = {
            schemaVersion: 2,
            anchor: native.timerV2Anchor,
            program: nativeProgram,
            mute: native.mutedIterationEndId && native.mutedIterationEndAt
              ? { mutedUntil: native.mutedUntil ?? 0, iteration: { endsAtLogicalId: native.mutedIterationEndId, endsAt: native.mutedIterationEndAt, iterations: Math.max(1, native.mutedIterationsRemaining ?? 1) } }
              : { mutedUntil: native.mutedUntil ?? 0 },
            alarmBehavior: native.alarmModeEnabled ? 'locked' : native.alarmOnceArmed ? 'once' : 'off',
          }
          pending = { session: nativeSession, attachNative: true }
          await Promise.all([saveTimerV2State(reconciled), saveTimerV2Session(nativeSession)])
        } else {
          if (native.active) ChandasTimerService.stop()
          await clearTimerV2Session()
        }
      } else if (session) {
        // Without the Android service (web/testing), the persisted running
        // session is the runtime authority just as native state is on Android.
        reconciled = replaceWorkingProgram(stored, session.program)
        pending = { session, attachNative: false }
        await saveTimerV2State(reconciled)
      }
      setTimerState(reconciled)
      if (Platform.OS === 'android' && isNativeServiceAvailable) {
        const currentFocus = ChandasTimerService.getFocusState()
        if (reconciled.settings.focusAutomationEnabled && !currentFocus.automationEnabled && !currentFocus.ruleExists && currentFocus.reason !== 'rule-disabled') {
          ChandasTimerService.setFocusModeEnabled(true)
          setFocusState(ChandasTimerService.getFocusState())
        } else {
          setFocusState(currentFocus)
        }
      }
      setRestoreSession(pending)
      setReady(true)
      if (storedResult.recovered) {
        showNotice({
          title: storedResult.reason === 'storage-unavailable' ? 'Using a fresh setup for now' : 'Saved settings were gently repaired',
          message: storedResult.reason === 'storage-unavailable' ? 'Chandas could not reach device storage. Your timer can still run, but changes may not survive a restart.' : 'One saved record could not be read, so Chandas kept the parts it could safely restore.',
          tone: 'attention',
          persistent: storedResult.reason === 'storage-unavailable',
        })
      }
    })().catch(() => {
      setTimerState(defaultTimerV2State())
      setRestoreSession(null)
      setReady(true)
      showNotice({ title: 'Chandas opened with a fresh setup', message: 'The previous session could not be restored safely. You can configure and start a new timer.', tone: 'attention', persistent: true })
    })
  }, [showNotice])

  useEffect(() => {
    if (!restoreSession || !timerState) return
    if (restoreSession.attachNative) {
      setAppState('running')
      void timer.attachNativeSession(restoreSession.session).catch(() => {
        timer.stop()
        setAppState('config')
        showNotice({ title: 'The saved timer could not reopen', message: 'Its configuration is still available, so you can start it again when ready.', tone: 'attention' })
      })
    } else {
      void timer.start(restoreSession.session)
        .then(started => setAppState(started ? 'running' : 'config'))
        .catch(() => {
          setAppState('config')
          showNotice({ title: 'The saved timer could not reopen', message: 'Its configuration is still available, so you can start it again when ready.', tone: 'attention' })
        })
    }
    setRestoreSession(null)
  }, [restoreSession, showNotice, timer, timerState])

  useEffect(() => {
    if (ready && appState === 'running' && !restoreSession && !timer.isRunning) setAppState('config')
  }, [appState, ready, restoreSession, timer.isRunning])

  useEffect(() => {
    if (timer.runtimeInterruption !== 'exact-alarm-access') return
    timer.clearRuntimeInterruption()
    setAppState('config')
    showNotice({ title: 'Timer paused safely', message: 'Exact timing is no longer available. Your configuration is still here.', tone: 'attention', actionLabel: 'Open settings', onAction: ChandasTimerService.openExactAlarmSettings, persistent: true })
  }, [showNotice, timer.runtimeInterruption, timer.clearRuntimeInterruption])

  const changeTimerState = (next: TimerV2State) => {
    setTimerState(next)
    void saveTimerV2State(next).then(saved => {
      if (saved) {
        storageWarningShown.current = false
        return
      }
      if (storageWarningShown.current) return
      storageWarningShown.current = true
      showNotice({ title: 'Changes are kept for this session', message: 'Device storage is not responding, so this edit may not be available after restarting Chandas.', tone: 'attention', persistent: true })
    })
  }

  const setFocusAutomation = (enabled: boolean) => {
    if (!timerState) return
    changeTimerState({ ...timerState, settings: { ...timerState.settings, focusAutomationEnabled: enabled } })
    if (enabled && Platform.OS === 'android' && isNativeServiceAvailable && !focusState.policyAccess) {
      showNotice({ title: 'One Android setting is needed', message: 'Allow Do Not Disturb access, then return here. Chandas only manages its own Focus rule.', actionLabel: 'Open settings', onAction: ChandasTimerService.openNotificationPolicySettings, persistent: true })
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
      else if (result === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN) showNotice({ title: 'Call auto-mute remains off', message: 'You can allow it later in Android app settings. The timer works normally without it.', actionLabel: 'Open settings', onAction: () => void Linking.openSettings(), persistent: true })
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
        ChandasTimerService.openNotificationSettings()
        showNotice({ title: 'Notification settings opened', message: 'Enable Chandas notifications to keep timer status and dismiss controls easy to reach.', tone: 'info' })
        return
      }
      const result = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS, {
        title: 'Show timer notifications',
        message: 'Allow notifications so Android can show the running timer and alarm controls.',
        buttonPositive: 'Allow', buttonNegative: 'Not now',
      })
      if (result === PermissionsAndroid.RESULTS.GRANTED) showNotice({ title: 'Timer notifications are ready', message: 'Running status and alarm controls can now appear outside the app.', tone: 'success' })
      else if (result === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN) showNotice({ title: 'Notifications remain off', message: 'The timer still works. Android settings can enable its status and controls later.', actionLabel: 'Open settings', onAction: ChandasTimerService.openNotificationSettings, persistent: true })
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
    startingRef.current = true
    setStarting(true)
    void timer.start().then(started => {
      if (started) {
        setAppState('running')
        refreshFocusState()
        showNotice({ title: 'Timer is running', message: program?.mode === 'sequence' ? 'Your sequence will repeat until you stop it.' : 'Your pattern is anchored and ready.', tone: 'success' })
        return
      }
      showNotice({ title: 'Exact timing needs one setting', message: 'Allow Alarms & reminders so bells stay precise when the screen is off.', tone: 'attention', actionLabel: 'Open settings', onAction: ChandasTimerService.openExactAlarmSettings, persistent: true })
    }).catch(() => showNotice({ title: 'The timer did not start yet', message: 'Your setup is safe. Please check Android access or try once more.', tone: 'attention', actionLabel: 'Try again', onAction: start }))
      .finally(() => {
        startingRef.current = false
        setStarting(false)
        void refreshAndroidAccess()
      })
  }

  const reanchor = (alignToClock: boolean, offsetMinutes = 0) => {
    if (!timerState || !program || realigning) return
    setRealigning(true)
    const nextState = program.mode === 'pattern'
      ? updatePattern(timerState, value => ({ ...value, alignment: alignToClock ? { kind: 'local-clock', offsetMinutes } : { kind: 'elapsed' } }))
      : timerState
    const nextProgram = selectedProgram(nextState)
    void timer.reanchor(nextProgram, alignToClock).then(started => {
      if (started) changeTimerState(nextState)
      else showNotice({ title: 'Alignment stayed unchanged', message: 'Exact timing is needed before Chandas can move this live pattern.', tone: 'attention', actionLabel: 'Open settings', onAction: ChandasTimerService.openExactAlarmSettings })
      if (started) showNotice({ title: alignToClock ? `Aligned to :${String(offsetMinutes).padStart(2, '0')}` : 'Restarted from now', message: 'The next bell schedule has been updated.', tone: 'success' })
    }).catch(() => showNotice({ title: 'Alignment stayed unchanged', message: 'The timer is still running on its previous schedule. You can try again.', tone: 'attention' }))
      .finally(() => setRealigning(false))
  }

  const changeCueVolume = (cueId: string, volume: number) => {
    if (!timerState || !program) return
    if (program.mode === 'sequence') changeTimerState(patchSequenceStep(timerState, cueId, { volume }))
    else if (cueId === 'main') changeTimerState(updatePattern(timerState, value => ({ ...value, mainCue: { ...value.mainCue, volume } })))
    else changeTimerState(patchPatternTrack(timerState, cueId, { volume }))
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
        showNotice({ title: 'Alarm sound is armed', message: 'To also show its dismiss screen over the lock screen, allow full-screen alarms.', actionLabel: 'Open settings', onAction: ChandasTimerService.openFullScreenIntentSettings })
      }, 550)
    }
  }

  const stop = () => {
    timer.stop()
    setAppState('config')
    refreshFocusState()
  }

  if (!ready || !timerState || !program) return <AppLoadingScreen backgroundColor={tokens.bg} accentColor={tokens.accent} textColor={tokens.text} />

  return <View style={{ flex: 1, backgroundColor: tokens.bg }}>
    <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />
    <View
      style={{ flex: 1 }}
      pointerEvents={timer.isAlarmRinging ? 'none' : 'auto'}
      importantForAccessibility={timer.isAlarmRinging ? 'no-hide-descendants' : 'auto'}
      accessibilityElementsHidden={timer.isAlarmRinging}
    >
      <Reanimated.View key={appState} style={{ flex: 1 }} entering={FadeIn.duration(reducedMotion ? 80 : 220)} exiting={FadeOut.duration(reducedMotion ? 70 : 150)}>
        {appState === 'config' ? <TimerV2ConfigScreen state={timerState} onChange={changeTimerState} onStart={start} starting={starting} focusState={focusState} onFocusAutomationChange={setFocusAutomation} onOpenFocusSettings={ChandasTimerService.openNotificationPolicySettings} onOpenFocusRuleSettings={ChandasTimerService.openFocusRuleSettings} androidAccess={androidAccess} onOpenExactAlarmSettings={ChandasTimerService.openExactAlarmSettings} onRequestCallMuteAccess={() => void requestCallMuteAccess()} onRequestNotificationAccess={() => void requestNotificationAccess()} onFeedback={showNotice} /> : <TimerV2RunningScreen program={program} mainCountdown={timer.mainCountdown} nextCueCountdown={timer.nextCueCountdown} nextCueLabel={timer.nextCueLabel} progress={timer.progress} position={timer.position} eventPulse={timer.eventPulse} activeHoursPaused={timer.activeHoursPaused} activeHoursResumeAt={timer.activeHoursResumeAt} mute={timer.mute} alarmBehavior={timer.alarmBehavior} realigning={realigning} onStop={stop} onRestartUnsynced={() => reanchor(false)} onSnapToClock={offset => reanchor(true, offset)} onPressAlarm={pressAlarm} onMuteForIterations={timer.muteForIterations} onMuteForMinutes={timer.muteForMinutes} onClearMute={timer.clearMute} masterVolume={timerState.settings.masterVolume} onMasterVolumeChange={masterVolume => changeTimerState({ ...timerState, settings: { ...timerState.settings, masterVolume } })} onCueVolumeChange={changeCueVolume} focusEnabled={timerState.settings.focusAutomationEnabled} focusActive={focusState.actual === 'active' && !timer.activeHoursPaused} focusPolicyAccess={focusState.policyAccess} focusReason={focusState.reason} onToggleFocus={focusState.reason === 'paused-by-android' ? resumeFocusAutomation : () => setFocusAutomation(!timerState.settings.focusAutomationEnabled)} onOpenFocusSettings={focusState.reason === 'rule-disabled' ? ChandasTimerService.openFocusRuleSettings : ChandasTimerService.openNotificationPolicySettings} />}
      </Reanimated.View>
    </View>
    {timer.isAlarmRinging && <AlarmRingingScreen onDismiss={timer.dismissAlarm} />}
    {!timer.isAlarmRinging ? <FeedbackBanner notice={notice} onDismiss={() => setNotice(null)} /> : null}
  </View>
}

export default function App() {
  const [fontsLoaded] = useFonts({ 'JetBrainsMono-Light': JetBrainsMono_300Light, 'JetBrainsMono-Regular': JetBrainsMono_400Regular })
  return <SafeAreaProvider><AppErrorBoundary>{fontsLoaded ? <ThemeProvider><Root /></ThemeProvider> : <AppLoadingScreen backgroundColor="#0b0c10" accentColor="#7c6ff7" textColor="#e8e8f0" message="Preparing Chandas…" />}</AppErrorBoundary></SafeAreaProvider>
}
