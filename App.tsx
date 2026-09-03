import { useCallback, useEffect, useState } from 'react'
import { StatusBar } from 'expo-status-bar'
import { AppState as NativeAppState, Platform, View } from 'react-native'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { useFonts, JetBrainsMono_300Light, JetBrainsMono_400Regular } from '@expo-google-fonts/jetbrains-mono'
import { ThemeProvider, useTheme } from './src/theme/ThemeContext'
import type { AppState, TimerV2State } from './src/types'
import { useTimerV2 } from './src/hooks/useTimerV2'
import { loadTimerV2Session, loadTimerV2State, saveTimerV2State, type TimerV2Session } from './src/lib/storage'
import { selectedProgram } from './src/lib/timerV2'
import { TimerV2ConfigScreen } from './src/screens/TimerV2ConfigScreen'
import { TimerV2RunningScreen } from './src/screens/TimerV2RunningScreen'
import { AlarmRingingScreen } from './src/screens/AlarmRingingScreen'
import { ChandasTimerService, isNativeServiceAvailable } from './src/native/ChandasTimerService'

const FALLBACK_PROGRAM = {
  schemaVersion: 2 as const, mode: 'pattern' as const, mainMinutes: 30,
  mainCue: { sound: { kind: 'builtin' as const, id: 'temple-gong' as const }, volume: 1 }, tracks: [], alignment: { kind: 'elapsed' as const },
}
const FALLBACK_SETTINGS = { masterVolume: 0.8, notificationsEnabled: true, activeHoursEnabled: false, activeHoursStart: 480, activeHoursEnd: 1320, activeHoursDays: 127, focusAutomationEnabled: false, alarmDurationSeconds: 60 }

function Root() {
  const { tokens, theme } = useTheme()
  const [timerState, setTimerState] = useState<TimerV2State | null>(null)
  const [appState, setAppState] = useState<AppState>('config')
  const [ready, setReady] = useState(false)
  const [focusPolicyAccess, setFocusPolicyAccess] = useState(false)
  const [focusModeActive, setFocusModeActive] = useState(false)
  const [restoreSession, setRestoreSession] = useState<TimerV2Session | null>(null)
  const program = timerState ? selectedProgram(timerState) : null
  const timer = useTimerV2(program ?? FALLBACK_PROGRAM, timerState?.settings ?? FALLBACK_SETTINGS)

  const refreshFocusState = useCallback(() => {
    if (Platform.OS !== 'android' || !isNativeServiceAvailable) return
    ChandasTimerService.refreshFocusMode()
    setFocusPolicyAccess(ChandasTimerService.hasNotificationPolicyAccess())
    setFocusModeActive(ChandasTimerService.isFocusModeActive())
  }, [])

  useEffect(() => {
    refreshFocusState()
    const subscription = NativeAppState.addEventListener('change', state => { if (state === 'active') refreshFocusState() })
    return () => subscription.remove()
  }, [refreshFocusState])

  useEffect(() => {
    void (async () => {
      const [stored, session] = await Promise.all([loadTimerV2State(), loadTimerV2Session()])
      setTimerState(stored)
      if (session) {
        setAppState('running')
        setRestoreSession(session)
      }
      setReady(true)
    })()
    // The hook is intentionally stable during the one-time async restore.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!restoreSession || !timerState) return
    void timer.start(restoreSession)
    setRestoreSession(null)
  }, [restoreSession, timer, timerState])

  const changeTimerState = (next: TimerV2State) => {
    setTimerState(next)
    void saveTimerV2State(next)
  }

  const setFocusAutomation = (enabled: boolean) => {
    if (!timerState) return
    changeTimerState({ ...timerState, settings: { ...timerState.settings, focusAutomationEnabled: enabled } })
    if (enabled && Platform.OS === 'android' && isNativeServiceAvailable && !focusPolicyAccess) ChandasTimerService.openNotificationPolicySettings()
    if (isNativeServiceAvailable) ChandasTimerService.setFocusModeEnabled(enabled)
    setTimeout(refreshFocusState, 100)
  }

  const start = () => {
    setAppState('running')
    void timer.start().then(refreshFocusState)
  }

  const stop = () => {
    timer.stop()
    setAppState('config')
    setFocusModeActive(false)
  }

  if (!ready || !timerState || !program) return <View style={{ flex: 1, backgroundColor: tokens.bg }} />

  return <View style={{ flex: 1, backgroundColor: tokens.bg }}>
    <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />
    {appState === 'config' ? <TimerV2ConfigScreen state={timerState} onChange={changeTimerState} onStart={start} focusPolicyAccess={focusPolicyAccess} onFocusAutomationChange={setFocusAutomation} onOpenFocusSettings={ChandasTimerService.openNotificationPolicySettings} /> : <TimerV2RunningScreen program={program} mainCountdown={timer.mainCountdown} nextCueCountdown={timer.nextCueCountdown} nextCueLabel={timer.nextCueLabel} progress={timer.progress} activeHoursPaused={timer.activeHoursPaused} activeHoursResumeAt={timer.activeHoursResumeAt} mute={timer.mute} alarmBehavior={timer.alarmBehavior} onStop={stop} onPressAlarm={timer.pressAlarm} onMuteForIterations={timer.muteForIterations} onMuteForMinutes={timer.muteForMinutes} onClearMute={timer.clearMute} masterVolume={timerState.settings.masterVolume} onMasterVolumeChange={masterVolume => changeTimerState({ ...timerState, settings: { ...timerState.settings, masterVolume } })} focusEnabled={timerState.settings.focusAutomationEnabled} focusActive={focusModeActive && !timer.activeHoursPaused} focusPolicyAccess={focusPolicyAccess} onToggleFocus={() => setFocusAutomation(!timerState.settings.focusAutomationEnabled)} />}
    {timer.isAlarmRinging && <AlarmRingingScreen onDismiss={timer.dismissAlarm} />}
  </View>
}

export default function App() {
  const [fontsLoaded] = useFonts({ 'JetBrainsMono-Light': JetBrainsMono_300Light, 'JetBrainsMono-Regular': JetBrainsMono_400Regular })
  if (!fontsLoaded) return null
  return <SafeAreaProvider><ThemeProvider><Root /></ThemeProvider></SafeAreaProvider>
}
