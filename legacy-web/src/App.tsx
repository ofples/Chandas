import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import './App.css'
import { TimerConfig, AppState } from './types'
import { useTimer, hasTimerSession } from './hooks/useTimer'
import { usePip } from './hooks/usePip'
import { ConfigScreen } from './components/ConfigScreen'
import { RunningScreen } from './components/RunningScreen'
import { PipContent } from './components/PipContent'

const STORAGE_KEY = 'slottimer-config'
const THEME_KEY   = 'slottimer-theme'

const DEFAULT_CONFIG: TimerConfig = {
  mainInterval: 30,
  subInterval: 5,
  snapEnabled: false,
  snapOffset: 0,
  subEnabled: true,
  notificationsEnabled: true,
  volume: 0.8,
  bgTrack: 1,
  bgVolume: 0.5,
}

function loadConfig(): TimerConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_CONFIG
    return { ...DEFAULT_CONFIG, ...JSON.parse(raw) }
  } catch {
    return DEFAULT_CONFIG
  }
}

function saveConfig(config: TimerConfig) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config))
  } catch { /* storage unavailable */ }
}

export function App() {
  const [theme, setTheme] = useState<'dark' | 'light'>(() =>
    (localStorage.getItem(THEME_KEY) as 'dark' | 'light') ?? 'dark'
  )

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem(THEME_KEY, theme)
  }, [theme])

  const toggleTheme = () => setTheme(t => t === 'dark' ? 'light' : 'dark')

  const [config, setConfig] = useState<TimerConfig>(loadConfig)
  const [appState, setAppState] = useState<AppState>(
    () => hasTimerSession() ? 'running' : 'config'
  )
  const [updateReady, setUpdateReady] = useState(false)

  const { mainCountdown, subCountdown, progress, start, stop, resumeBgAudio } = useTimer(config)

  // Auto-resume timer after page refresh
  useEffect(() => {
    if (hasTimerSession()) start()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Periodic SW update check — browser only checks on page load by default
  useEffect(() => {
    const check = async () => {
      const reg = await navigator.serviceWorker?.getRegistration()
      if (!reg) return
      await reg.update()
      if (reg.waiting) setUpdateReady(true)
    }

    check() // check once on mount too (catches updates since last load)
    const id = setInterval(check, 10 * 60 * 1000) // every 10 min
    return () => clearInterval(id)
  }, [])
  const { isSupported: isPipSupported, isPip, pipContainer, open: openPip, close: closePip } = usePip()

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
    closePip()
    setAppState('config')
  }

  const handlePipToggle = () => {
    if (isPip) closePip()
    else openPip()
  }

  const applyUpdate = async () => {
    const reg = await navigator.serviceWorker?.getRegistration()
    const sw = reg?.waiting
    if (sw) {
      sw.postMessage({ type: 'SKIP_WAITING' })
      navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), { once: true })
    } else {
      location.reload()
    }
  }

  return (
    <div className="app">
      {appState === 'config' && (
        <ConfigScreen
          config={config}
          onChange={handleConfigChange}
          onStart={handleStart}
          visible
          theme={theme}
          onThemeToggle={toggleTheme}
        />
      )}
      {appState === 'running' && (
        <RunningScreen
          mainCountdown={mainCountdown}
          subCountdown={subCountdown}
          progress={progress}
          onStop={handleStop}
          visible
          isPipSupported={isPipSupported}
          isPip={isPip}
          onPipToggle={handlePipToggle}
          volume={config.volume}
          onVolumeChange={v => handleConfigChange({ ...config, volume: v })}
          bgTrack={config.bgTrack}
          bgVolume={config.bgVolume}
          onBgTrackChange={t => handleConfigChange({ ...config, bgTrack: t })}
          onBgVolumeChange={v => handleConfigChange({ ...config, bgVolume: v })}
          onResumeBgAudio={resumeBgAudio}
        />
      )}

      {updateReady && (
        <button className="update-banner" onClick={applyUpdate}>
          Update available — tap to reload
        </button>
      )}

      {pipContainer && createPortal(
        <PipContent mainCountdown={mainCountdown} />,
        pipContainer
      )}
    </div>
  )
}
