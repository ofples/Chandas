import { useCallback, useEffect, useRef, useState } from 'react'
import { StatusBar } from 'expo-status-bar'
import { Alert, AppState as NativeAppState, Linking, PermissionsAndroid, Platform, View } from 'react-native'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { useFonts, JetBrainsMono_300Light, JetBrainsMono_400Regular } from '@expo-google-fonts/jetbrains-mono'
import { ThemeProvider, useTheme } from './src/theme/ThemeContext'
import type { AppState, AppTimerSettings, TimerV2State } from './src/types'
import { useTimerV2 } from './src/hooks/useTimerV2'
import { clearTimerV2Session, loadTimerV2Session, loadTimerV2State, saveTimerV2Session, saveTimerV2State, type TimerV2Session } from './src/lib/storage'
import { parseTimerProgram, replaceWorkingProgram, selectedProgram } from './src/lib/timerV2'
import { patchPatternTrack, patchSequenceStep, updatePattern } from './src/lib/programActions'
import { TimerV2ConfigScreen } from './src/screens/TimerV2ConfigScreen'
import { TimerV2RunningScreen } from './src/screens/TimerV2RunningScreen'
import { AlarmRingingScreen } from './src/screens/AlarmRingingScreen'
import { ChandasTimerService, isNativeServiceAvailable, type NativeFocusState } from './src/native/ChandasTimerService'

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
  const [timerState, setTimerState] = useState<TimerV2State | null>(null)
  const [appState, setAppState] = useState<AppState>('config')
  const [ready, setReady] = useState(false)
  const [focusState, setFocusState] = useState<NativeFocusState>(DEFAULT_FOCUS_STATE)
  const [restoreSession, setRestoreSession] = useState<PendingRestore | null>(null)
  const [androidAccess, setAndroidAccess] = useState<AndroidAccessState>({ exactAlarms: true, callMute: true, notifications: true })
  const [starting, setStarting] = useState(false)
  const startingRef = useRef(false)
  const fullScreenGuidanceShown = useRef(false)
  const program = timerState ? selectedProgram(timerState) : null
  const timer = useTimerV2(program ?? FALLBACK_PROGRAM, timerState?.settings ?? FALLBACK_SETTINGS)

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
    const [callMute, notificationPermission] = await Promise.all([
      PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.READ_PHONE_STATE),
      Platform.Version >= 33 ? PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS) : Promise.resolve(true),
    ])
    setAndroidAccess({ exactAlarms: !isNativeServiceAvailable || ChandasTimerService.canScheduleExactAlarms(), callMute, notifications: notificationPermission && ChandasTimerService.areNotificationsEnabled() })
  }, [])

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
      Alert.alert('Timer stopped', 'Android removed exact-alarm access, so Chandas stopped instead of continuing with unreliable timing.', [
        { text: 'Later', style: 'cancel' },
        { text: 'Open settings', onPress: ChandasTimerService.openExactAlarmSettings },
      ])
    })
    return () => subscription.remove()
  }, [appState, timer.stop])

  useEffect(() => {
    void (async () => {
      const [stored, session] = await Promise.all([loadTimerV2State(), loadTimerV2Session()])
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
    })()
    // The hook is intentionally stable during the one-time async restore.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!restoreSession || !timerState) return
    if (restoreSession.attachNative) {
      setAppState('running')
      void timer.attachNativeSession(restoreSession.session)
    } else {
      void timer.start(restoreSession.session).then(started => setAppState(started ? 'running' : 'config'))
    }
    setRestoreSession(null)
  }, [restoreSession, timer, timerState])

  useEffect(() => {
    if (ready && appState === 'running' && !restoreSession && !timer.isRunning) setAppState('config')
  }, [appState, ready, restoreSession, timer.isRunning])

  useEffect(() => {
    if (timer.runtimeInterruption !== 'exact-alarm-access') return
    timer.clearRuntimeInterruption()
    setAppState('config')
    Alert.alert('Timer stopped', 'Android removed exact-alarm access, so Chandas stopped instead of continuing with unreliable timing.', [
      { text: 'Later', style: 'cancel' },
      { text: 'Open settings', onPress: ChandasTimerService.openExactAlarmSettings },
    ])
  }, [timer.runtimeInterruption, timer.clearRuntimeInterruption])

  const changeTimerState = (next: TimerV2State) => {
    setTimerState(next)
    void saveTimerV2State(next)
  }

  const setFocusAutomation = (enabled: boolean) => {
    if (!timerState) return
    changeTimerState({ ...timerState, settings: { ...timerState.settings, focusAutomationEnabled: enabled } })
    if (enabled && Platform.OS === 'android' && isNativeServiceAvailable && !focusState.policyAccess) ChandasTimerService.openNotificationPolicySettings()
    if (isNativeServiceAvailable) ChandasTimerService.setFocusModeEnabled(enabled)
    setTimeout(refreshFocusState, 100)
  }

  const resumeFocusAutomation = () => {
    setFocusAutomation(false)
    setFocusAutomation(true)
  }

  const requestCallMuteAccess = async () => {
    if (Platform.OS !== 'android') return
    const result = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.READ_PHONE_STATE, {
      title: 'Mute bells during calls',
      message: 'Allow phone-state access so Chandas can stay quiet during calls. Chandas never reads phone numbers or call history.',
      buttonPositive: 'Allow', buttonNegative: 'Not now',
    })
    if (result === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN) await Linking.openSettings()
    await refreshAndroidAccess()
  }

  const requestNotificationAccess = async () => {
    if (Platform.OS !== 'android') return
    if (Platform.Version < 33) {
      ChandasTimerService.openNotificationSettings()
      return
    }
    const result = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS, {
      title: 'Show timer notifications',
      message: 'Allow notifications so Android can show the running timer and alarm controls.',
      buttonPositive: 'Allow', buttonNegative: 'Not now',
    })
    if (result === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN) ChandasTimerService.openNotificationSettings()
    await refreshAndroidAccess()
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
        return
      }
      Alert.alert(
        'Allow exact alarms',
        'Chandas needs exact-alarm access to keep bells precisely on time, including while the screen is off.',
        [
          { text: 'Not now', style: 'cancel' },
          { text: 'Open settings', onPress: ChandasTimerService.openExactAlarmSettings },
        ],
      )
    }).catch(() => Alert.alert('Could not start timer', 'Chandas could not prepare audio or exact scheduling. Check Android permissions and try again.'))
      .finally(() => {
        startingRef.current = false
        setStarting(false)
        void refreshAndroidAccess()
      })
  }

  const reanchor = (alignToClock: boolean, offsetMinutes = 0) => {
    if (!timerState || !program) return
    const nextState = program.mode === 'pattern'
      ? updatePattern(timerState, value => ({ ...value, alignment: alignToClock ? { kind: 'local-clock', offsetMinutes } : { kind: 'elapsed' } }))
      : timerState
    const nextProgram = selectedProgram(nextState)
    void timer.reanchor(nextProgram, alignToClock).then(started => {
      if (started) changeTimerState(nextState)
      else Alert.alert('Could not realign timer', 'Exact-alarm access is required to keep the live timer precise.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Open settings', onPress: ChandasTimerService.openExactAlarmSettings }])
    }).catch(() => Alert.alert('Could not realign timer', 'The timer remains on its previous schedule. Please try again.'))
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
        Alert.alert('Alarm armed', 'Sound will still play. Allow full-screen alarms if you also want the dismiss screen to appear over the lock screen.', [
          { text: 'Later', style: 'cancel' },
          { text: 'Open settings', onPress: ChandasTimerService.openFullScreenIntentSettings },
        ])
      }, 550)
    }
  }

  const stop = () => {
    timer.stop()
    setAppState('config')
    refreshFocusState()
  }

  if (!ready || !timerState || !program) return <View style={{ flex: 1, backgroundColor: tokens.bg }} />

  return <View style={{ flex: 1, backgroundColor: tokens.bg }}>
    <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />
    <View
      style={{ flex: 1 }}
      pointerEvents={timer.isAlarmRinging ? 'none' : 'auto'}
      importantForAccessibility={timer.isAlarmRinging ? 'no-hide-descendants' : 'auto'}
      accessibilityElementsHidden={timer.isAlarmRinging}
    >
      {appState === 'config' ? <TimerV2ConfigScreen state={timerState} onChange={changeTimerState} onStart={start} starting={starting} focusState={focusState} onFocusAutomationChange={setFocusAutomation} onOpenFocusSettings={ChandasTimerService.openNotificationPolicySettings} onOpenFocusRuleSettings={ChandasTimerService.openFocusRuleSettings} androidAccess={androidAccess} onOpenExactAlarmSettings={ChandasTimerService.openExactAlarmSettings} onRequestCallMuteAccess={() => void requestCallMuteAccess()} onRequestNotificationAccess={() => void requestNotificationAccess()} /> : <TimerV2RunningScreen program={program} mainCountdown={timer.mainCountdown} nextCueCountdown={timer.nextCueCountdown} nextCueLabel={timer.nextCueLabel} progress={timer.progress} position={timer.position} eventPulse={timer.eventPulse} activeHoursPaused={timer.activeHoursPaused} activeHoursResumeAt={timer.activeHoursResumeAt} mute={timer.mute} alarmBehavior={timer.alarmBehavior} onStop={stop} onRestartUnsynced={() => reanchor(false)} onSnapToClock={offset => reanchor(true, offset)} onPressAlarm={pressAlarm} onMuteForIterations={timer.muteForIterations} onMuteForMinutes={timer.muteForMinutes} onClearMute={timer.clearMute} masterVolume={timerState.settings.masterVolume} onMasterVolumeChange={masterVolume => changeTimerState({ ...timerState, settings: { ...timerState.settings, masterVolume } })} onCueVolumeChange={changeCueVolume} focusEnabled={timerState.settings.focusAutomationEnabled} focusActive={focusState.actual === 'active' && !timer.activeHoursPaused} focusPolicyAccess={focusState.policyAccess} focusReason={focusState.reason} onToggleFocus={focusState.reason === 'paused-by-android' ? resumeFocusAutomation : () => setFocusAutomation(!timerState.settings.focusAutomationEnabled)} onOpenFocusSettings={focusState.reason === 'rule-disabled' ? ChandasTimerService.openFocusRuleSettings : ChandasTimerService.openNotificationPolicySettings} />}
    </View>
    {timer.isAlarmRinging && <AlarmRingingScreen onDismiss={timer.dismissAlarm} />}
  </View>
}

export default function App() {
  const [fontsLoaded] = useFonts({ 'JetBrainsMono-Light': JetBrainsMono_300Light, 'JetBrainsMono-Regular': JetBrainsMono_400Regular })
  if (!fontsLoaded) return null
  return <SafeAreaProvider><ThemeProvider><Root /></ThemeProvider></SafeAreaProvider>
}
