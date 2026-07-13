import { useCallback, useEffect, useState } from 'react'
import { StatusBar } from 'expo-status-bar'
import { AppState as NativeAppState, Platform, View } from 'react-native'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { useFonts, JetBrainsMono_300Light, JetBrainsMono_400Regular } from '@expo-google-fonts/jetbrains-mono'
import { ThemeProvider, useTheme } from './src/theme/ThemeContext'
import { TimerConfig, AppState } from './src/types'
import { useTimer } from './src/hooks/useTimer'
import { clearSession, loadConfig, saveConfig, hasTimerSession, DEFAULT_CONFIG } from './src/lib/storage'
import { ConfigScreen } from './src/screens/ConfigScreen'
import { RunningScreen } from './src/screens/RunningScreen'
import { AlarmRingingScreen } from './src/screens/AlarmRingingScreen'
import { isNativeServiceAvailable, SlotTimerService } from './src/native/SlotTimerService'

function Root() {
  const { tokens, theme } = useTheme()
  const [config, setConfig] = useState<TimerConfig | null>(null)
  const [appState, setAppState] = useState<AppState>('config')
  const [ready, setReady] = useState(false)
  const [focusPolicyAccess, setFocusPolicyAccess] = useState(false)
  const [focusModeActive, setFocusModeActive] = useState(false)

  const {
    mainCountdown, subCountdown, progress, activeHoursPaused, activeHoursResumeAt,
    start, stop, resyncPhase,
    isAlarmRinging, dismissAlarm,
    alarmOnceArmed, mutedUntil, mutedIterationsRemaining,
    toggleAlarmOnce, muteForIterations, muteForMinutes, clearTimedMute,
  } = useTimer(config ?? DEFAULT_CONFIG)

  const refreshFocusState = useCallback(() => {
    if (Platform.OS !== 'android' || !isNativeServiceAvailable) return
    SlotTimerService.refreshFocusMode()
    setFocusPolicyAccess(SlotTimerService.hasNotificationPolicyAccess())
    setFocusModeActive(SlotTimerService.isFocusModeActive())
  }, [])

  useEffect(() => {
    refreshFocusState()
    const subscription = NativeAppState.addEventListener('change', state => {
      if (state === 'active') refreshFocusState()
    })
    return () => subscription.remove()
  }, [refreshFocusState])

  useEffect(() => {
    (async () => {
      const [loadedConfig, storedSession] = await Promise.all([loadConfig(), hasTimerSession()])
      const nativeSession = isNativeServiceAvailable && SlotTimerService.getState().active
      const resuming = isNativeServiceAvailable ? nativeSession : storedSession
      if (isNativeServiceAvailable && storedSession && !nativeSession) await clearSession()
      setConfig(loadedConfig)
      if (resuming) {
        setAppState('running')
        void start(loadedConfig).then(refreshFocusState)
      }
      setReady(true)
      // eslint-disable-next-line react-hooks/exhaustive-deps
    })()
  }, [])

  if (!ready || !config) {
    return <View style={{ flex: 1, backgroundColor: tokens.bg }} />
  }

  const handleConfigChange = (c: TimerConfig) => {
    setConfig(c)
    saveConfig(c)
  }

  const handleFocusModeChange = (enabled: boolean) => {
    if (!config) return
    handleConfigChange({ ...config, focusModeEnabled: enabled })
    if (appState === 'running' && isNativeServiceAvailable) {
      SlotTimerService.setFocusModeEnabled(enabled)
    }
    if (enabled && Platform.OS === 'android' && isNativeServiceAvailable && !focusPolicyAccess) {
      SlotTimerService.openNotificationPolicySettings()
    }
    setFocusModeActive(enabled && focusPolicyAccess && appState === 'running')
    setTimeout(refreshFocusState, 100)
  }

  const handleStart = () => {
    if (isNativeServiceAvailable && !SlotTimerService.canScheduleExactAlarms()) {
      SlotTimerService.openExactAlarmSettings()
      return
    }
    setAppState('running')
    void start().then(refreshFocusState)
  }

  const handleStop = () => {
    stop()
    setAppState('config')
  }

  // Unsync from the clock and restart the current interval fresh from now —
  // phase = now % mainMs makes the next gong exactly one full interval away.
  const handleRestartUnsynced = () => {
    const mainMs = config.mainInterval * 60_000
    resyncPhase(Date.now() % mainMs)
    handleConfigChange({ ...config, snapEnabled: false })
  }

  // Snap the running timer to the wall clock immediately, using the
  // configured snap offset.
  const handleSnapToClock = () => {
    resyncPhase(config.snapOffset * 60_000)
    handleConfigChange({ ...config, snapEnabled: true })
  }

  return (
    <View style={{ flex: 1, backgroundColor: tokens.bg }}>
      <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />
      {appState === 'config' ? (
        <ConfigScreen
          config={config}
          onChange={handleConfigChange}
          onStart={handleStart}
          focusPolicyAccess={focusPolicyAccess}
          onFocusModeChange={handleFocusModeChange}
          onOpenFocusSettings={SlotTimerService.openNotificationPolicySettings}
        />
      ) : (
        <RunningScreen
          mainCountdown={mainCountdown}
          subCountdown={subCountdown}
          progress={progress}
          activeHoursPaused={activeHoursPaused}
          activeHoursResumeAt={activeHoursResumeAt}
          onStop={handleStop}
          volume={config.volume}
          onVolumeChange={v => handleConfigChange({ ...config, volume: v })}
          snapEnabled={config.snapEnabled}
          onRestartUnsynced={handleRestartUnsynced}
          onSnapToClock={handleSnapToClock}
          alarmModeEnabled={config.alarmModeEnabled}
          onToggleAlarmMode={() => handleConfigChange({ ...config, alarmModeEnabled: !config.alarmModeEnabled })}
          alarmOnceArmed={alarmOnceArmed}
          onToggleAlarmOnce={toggleAlarmOnce}
          mutedUntil={mutedUntil}
          mutedIterationsRemaining={mutedIterationsRemaining}
          onMuteForIterations={muteForIterations}
          onMuteForMinutes={muteForMinutes}
          onClearTimedMute={clearTimedMute}
          focusModeEnabled={config.focusModeEnabled}
          focusModeActive={focusModeActive && !activeHoursPaused}
          focusPolicyAccess={focusPolicyAccess}
          onToggleFocusMode={() => handleFocusModeChange(!config.focusModeEnabled)}
        />
      )}

      {isAlarmRinging && <AlarmRingingScreen onDismiss={dismissAlarm} />}
    </View>
  )
}

export default function App() {
  const [fontsLoaded] = useFonts({
    'JetBrainsMono-Light': JetBrainsMono_300Light,
    'JetBrainsMono-Regular': JetBrainsMono_400Regular,
  })

  if (!fontsLoaded) return null

  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <Root />
      </ThemeProvider>
    </SafeAreaProvider>
  )
}
