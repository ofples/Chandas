import { TimerConfig } from '../types'
import { IntervalPicker } from './IntervalPicker'
import { SnapConfig } from './SnapConfig'

const VERSION = import.meta.env.VITE_APP_VERSION as string

async function forceUpdate() {
  const reg = await navigator.serviceWorker?.getRegistration()
  if (!reg) { location.reload(); return }
  await reg.update()
  const sw = reg.waiting ?? reg.installing
  if (sw) {
    sw.postMessage({ type: 'SKIP_WAITING' })
    navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), { once: true })
  } else {
    location.reload()
  }
}

const MAIN_PRESETS = [10, 15, 30]
const SUB_PRESETS  = [5, 10, 15]

interface Props {
  config: TimerConfig
  onChange: (c: TimerConfig) => void
  onStart: () => void
  visible: boolean
  theme: 'dark' | 'light'
  onThemeToggle: () => void
}

export function ConfigScreen({ config, onChange, onStart, visible, theme, onThemeToggle }: Props) {
  const set = <K extends keyof TimerConfig>(key: K, val: TimerConfig[K]) =>
    onChange({ ...config, [key]: val })

  const handleMainChange = (v: number) => {
    const newSub = config.subInterval >= v
      ? SUB_PRESETS.filter(p => p < v).at(-1) ?? Math.max(1, v - 1)
      : config.subInterval
    onChange({ ...config, mainInterval: v, subInterval: newSub })
  }

  return (
    <div
      className={`screen config-screen${visible ? '' : ' screen-exit-active'}`}
      aria-hidden={!visible}
    >
      <div className="config-inner">
        <IntervalPicker
          label="Main interval"
          value={config.mainInterval}
          presets={MAIN_PRESETS}
          onChange={handleMainChange}
          pickerTitle="Main interval (minutes)"
          pickerMin={1}
          pickerMax={240}
        />

        <IntervalPicker
          label="Sub interval"
          value={config.subInterval}
          presets={SUB_PRESETS}
          onChange={v => set('subInterval', v)}
          disabledAbove={config.mainInterval}
          pickerTitle="Sub interval (minutes)"
          pickerMin={1}
          pickerMax={config.mainInterval - 1}
          toggle={config.subEnabled}
          onToggle={v => set('subEnabled', v)}
        />

        <SnapConfig
          enabled={config.snapEnabled}
          offset={config.snapOffset}
          onToggle={v => set('snapEnabled', v)}
          onOffsetChange={v => set('snapOffset', v)}
        />

        <div className="config-section">
          <span className="section-label">Volume</span>
          <div className="volume-row">
            <span className="volume-icon">
              <VolumeIcon level={config.volume} />
            </span>
            <input
              className="volume-slider"
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={config.volume}
              onChange={e => set('volume', parseFloat(e.target.value))}
            />
            <button
              className={`notif-btn${config.notificationsEnabled ? ' active' : ''}`}
              onClick={async () => {
                const next = !config.notificationsEnabled
                if (next && 'Notification' in window && Notification.permission === 'default') {
                  await Notification.requestPermission()
                }
                set('notificationsEnabled', next)
              }}
              title={config.notificationsEnabled ? 'Disable notifications' : 'Enable notifications'}
              aria-label={config.notificationsEnabled ? 'Disable notifications' : 'Enable notifications'}
            >
              <BellIcon on={config.notificationsEnabled} />
            </button>
          </div>
        </div>

        <button className="main-btn start" onClick={onStart}>
          Start
        </button>
      </div>

      <button
        className="theme-btn"
        onClick={onThemeToggle}
        title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
      >
        <ThemeIcon dark={theme === 'dark'} />
      </button>

      <span className="version-label" onDoubleClick={forceUpdate}>
        v{VERSION}
      </span>
    </div>
  )
}

function ThemeIcon({ dark }: { dark: boolean }) {
  if (dark) {
    // Sun icon — click to go light
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
        <circle cx="12" cy="12" r="5" stroke="currentColor" strokeWidth="2" />
        <line x1="12" y1="2"  x2="12" y2="4"  stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <line x1="12" y1="20" x2="12" y2="22" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <line x1="2"  y1="12" x2="4"  y2="12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <line x1="20" y1="12" x2="22" y2="12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <line x1="4.22"  y1="4.22"  x2="5.64"  y2="5.64"  stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <line x1="4.22"  y1="19.78" x2="5.64"  y2="18.36" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <line x1="18.36" y1="5.64"  x2="19.78" y2="4.22"  stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
    )
  }
  // Moon icon — click to go dark
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"
        stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function BellIcon({ on }: { on: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"
        stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0"
        stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      {!on && (
        <line x1="2" y1="2" x2="22" y2="22"
          stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      )}
    </svg>
  )
}

function VolumeIcon({ level }: { level: number }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M2 5.5h2.5L8 2.5v11L4.5 10.5H2z"
        fill="currentColor"
        opacity={level === 0 ? 0.3 : 1}
      />
      {level > 0 && (
        <path d="M10 5a4 4 0 0 1 0 6" stroke="currentColor" strokeWidth="1.4"
          strokeLinecap="round" fill="none" />
      )}
      {level > 0.5 && (
        <path d="M11.5 3a7 7 0 0 1 0 10" stroke="currentColor" strokeWidth="1.4"
          strokeLinecap="round" fill="none" opacity="0.5" />
      )}
    </svg>
  )
}
