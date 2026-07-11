import { useEffect, useState } from 'react'
import { StatusBar } from 'expo-status-bar'
import { View } from 'react-native'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { useFonts, JetBrainsMono_300Light, JetBrainsMono_400Regular } from '@expo-google-fonts/jetbrains-mono'
import { ThemeProvider, useTheme } from './src/theme/ThemeContext'
import { TimerConfig, AppState } from './src/types'
import { useTimer } from './src/hooks/useTimer'
import { loadConfig, saveConfig, hasTimerSession, DEFAULT_CONFIG } from './src/lib/storage'
import { ConfigScreen } from './src/screens/ConfigScreen'
import { RunningScreen } from './src/screens/RunningScreen'
import { AlarmRingingScreen } from './src/screens/AlarmRingingScreen'

function Root() {
  const { tokens, theme } = useTheme()
  const [config, setConfig] = useState<TimerConfig | null>(null)
  const [appState, setAppState] = useState<AppState>('config')
  const [ready, setReady] = useState(false)

  const {
    mainCountdown, subCountdown, progress, start, stop, resyncPhase,
    isAlarmRinging, dismissAlarm,
  } = useTimer(config ?? DEFAULT_CONFIG)

  useEffect(() => {
    (async () => {
      const [loadedConfig, resuming] = await Promise.all([loadConfig(), hasTimerSession()])
      setConfig(loadedConfig)
      if (resuming) {
        setAppState('running')
        start()
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

  const handleStart = () => {
    start()
    setAppState('running')
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
        />
      ) : (
        <RunningScreen
          mainCountdown={mainCountdown}
          subCountdown={subCountdown}
          progress={progress}
          onStop={handleStop}
          volume={config.volume}
          onVolumeChange={v => handleConfigChange({ ...config, volume: v })}
          bgTrack={config.bgTrack}
          bgVolume={config.bgVolume}
          onBgTrackChange={t => handleConfigChange({ ...config, bgTrack: t })}
          onBgVolumeChange={v => handleConfigChange({ ...config, bgVolume: v })}
          snapEnabled={config.snapEnabled}
          onRestartUnsynced={handleRestartUnsynced}
          onSnapToClock={handleSnapToClock}
          alarmModeEnabled={config.alarmModeEnabled}
          onToggleAlarmMode={() => handleConfigChange({ ...config, alarmModeEnabled: !config.alarmModeEnabled })}
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
