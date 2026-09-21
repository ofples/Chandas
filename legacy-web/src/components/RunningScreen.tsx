import { useEffect, useRef, useState } from 'react'

interface Props {
  mainCountdown: string
  subCountdown: string
  progress: number      // 0–1
  onStop: () => void
  visible: boolean
  isPipSupported: boolean
  isPip: boolean
  onPipToggle: () => void
  volume: number
  onVolumeChange: (v: number) => void
  bgTrack: 1 | 2 | 3
  bgVolume: number
  onBgTrackChange: (t: 1 | 2 | 3) => void
  onBgVolumeChange: (v: number) => void
  onResumeBgAudio: () => void
}

// Fixed SVG coordinate space; scales via CSS width/height
const VIEW = 300
const CX = VIEW / 2
const CY = VIEW / 2
const R = 130
const CIRC = 2 * Math.PI * R

const BG_TRACKS: { id: 1 | 2 | 3; name: string }[] = [
  { id: 1, name: 'Ocean' },
  { id: 2, name: '432hz' },
  { id: 3, name: 'Lofi'  },
]

export function RunningScreen({
  mainCountdown, subCountdown, progress, onStop, visible,
  isPipSupported, isPip, onPipToggle,
  volume, onVolumeChange,
  bgTrack, bgVolume, onBgTrackChange, onBgVolumeChange,
  onResumeBgAudio,
}: Props) {
  const [pulse, setPulse] = useState(false)
  const [openPanel, setOpenPanel] = useState<'track' | 'volume' | 'bell' | null>(null)
  const prevCountdownRef = useRef(mainCountdown)

  // Detect when main countdown resets (gong fired) → pulse animation
  useEffect(() => {
    const prev = prevCountdownRef.current
    prevCountdownRef.current = mainCountdown
    if (prev === '--:--' || mainCountdown === '--:--') return
    const prevSecs = timeToSecs(prev)
    const currSecs = timeToSecs(mainCountdown)
    if (currSecs > prevSecs + 5) {
      setPulse(true)
      const t = setTimeout(() => setPulse(false), 700)
      return () => clearTimeout(t)
    }
  }, [mainCountdown])

  const dashOffset = CIRC * (1 - progress)

  const togglePanel = (panel: 'track' | 'volume' | 'bell') =>
    setOpenPanel(p => p === panel ? null : panel)

  return (
    <div
      className={`screen running-screen${visible ? '' : ' screen-exit-active'}`}
      aria-hidden={!visible}
      onPointerDown={onResumeBgAudio}
    >
      {isPipSupported && (
        <button
          className={`pip-btn${isPip ? ' active' : ''}`}
          onClick={onPipToggle}
          title={isPip ? 'Close mini player' : 'Open mini player'}
          aria-label={isPip ? 'Close mini player' : 'Open mini player'}
        >
          <PipIcon active={isPip} />
        </button>
      )}

      <div className="running-inner">
        <div className="ring-wrap">
          <svg
            className="ring-svg"
            viewBox={`0 0 ${VIEW} ${VIEW}`}
            style={{ width: 'min(78vw, 320px)', height: 'min(78vw, 320px)' }}
          >
            <circle className="ring-track" cx={CX} cy={CY} r={R} />
            <circle
              className={`ring-progress${pulse ? ' ring-pulse' : ''}`}
              cx={CX}
              cy={CY}
              r={R}
              strokeDasharray={CIRC}
              strokeDashoffset={dashOffset}
            />
          </svg>

          <div className="countdown-wrap">
            <span className="countdown-main">{mainCountdown}</span>
            <div className="countdown-sub">
              <span className="bell-icon">♪</span>
              <span className="sub-time">{subCountdown}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="running-bottom">
        {/* click-outside overlay */}
        {openPanel && (
          <div className="media-overlay" onClick={() => setOpenPanel(null)} />
        )}

        <div className="media-row">
          {/* Bell/gong volume — left */}
          <div className="media-btn-wrap">
            <button
              className={`media-btn${openPanel === 'bell' ? ' active' : ''}`}
              onClick={() => togglePanel('bell')}
              aria-label="Gong & bell volume"
            >
              <BellIcon muted={volume === 0} />
            </button>
            {openPanel === 'bell' && (
              <div className="media-popup popup-left volume-popup">
                <div className="volume-slider-wrap">
                  <input
                    type="range"
                    className="bg-volume-slider"
                    min={0}
                    max={1}
                    step={0.01}
                    value={volume}
                    onChange={e => onVolumeChange(Number(e.target.value))}
                    aria-label="Gong & bell volume"
                  />
                </div>
              </div>
            )}
          </div>

          <div className="media-row-right">
          {/* Track picker */}
          <div className="media-btn-wrap">
            <button
              className={`media-btn${openPanel === 'track' ? ' active' : ''}`}
              onClick={() => togglePanel('track')}
              aria-label="Select background track"
            >
              <NoteIcon />
            </button>
            {openPanel === 'track' && (
              <div className="media-popup track-popup">
                {BG_TRACKS.map(t => (
                  <button
                    key={t.id}
                    className={`media-chip${bgTrack === t.id ? ' active' : ''}`}
                    onClick={() => { onBgTrackChange(t.id); setOpenPanel(null) }}
                  >
                    {t.name}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Volume slider */}
          <div className="media-btn-wrap">
            <button
              className={`media-btn${openPanel === 'volume' ? ' active' : ''}`}
              onClick={() => togglePanel('volume')}
              aria-label="Background volume"
            >
              <VolumeIcon muted={bgVolume === 0} />
            </button>
            {openPanel === 'volume' && (
              <div className="media-popup volume-popup">
                <div className="volume-slider-wrap">
                  <input
                    type="range"
                    className="bg-volume-slider"
                    min={0}
                    max={1}
                    step={0.01}
                    value={bgVolume}
                    onChange={e => onBgVolumeChange(Number(e.target.value))}
                    aria-label="Background volume"
                  />
                </div>
              </div>
            )}
          </div>
          </div>{/* end media-row-right */}
        </div>

        <button className="main-btn stop" onClick={onStop}>
          Stop
        </button>
      </div>
    </div>
  )
}

function PipIcon({ active }: { active: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
      <rect x="1" y="3" width="16" height="12" rx="2"
        stroke="currentColor" strokeWidth="1.5" fill="none"
        opacity={active ? 0.4 : 1}
      />
      <rect x="9" y="8" width="7" height="5" rx="1"
        fill="currentColor"
      />
    </svg>
  )
}

function BellIcon({ muted }: { muted: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"
        stroke="currentColor" strokeWidth="2"
        strokeLinecap="round" strokeLinejoin="round" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0"
        stroke="currentColor" strokeWidth="2"
        strokeLinecap="round" strokeLinejoin="round" />
      {muted && (
        <path d="M2 2l20 20" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      )}
    </svg>
  )
}

function NoteIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M9 18V5l12-2v13" stroke="currentColor" strokeWidth="2"
        strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="6" cy="18" r="3" stroke="currentColor" strokeWidth="2" />
      <circle cx="18" cy="16" r="3" stroke="currentColor" strokeWidth="2" />
    </svg>
  )
}

function VolumeIcon({ muted }: { muted: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M11 5L6 9H2v6h4l5 4V5z"
        stroke="currentColor" strokeWidth="2"
        strokeLinecap="round" strokeLinejoin="round" />
      {muted ? (
        <path d="M23 9l-6 6M17 9l6 6"
          stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      ) : (
        <>
          <path d="M15.54 8.46a5 5 0 0 1 0 7.07"
            stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          <path d="M19.07 4.93a10 10 0 0 1 0 14.14"
            stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </>
      )}
    </svg>
  )
}

function timeToSecs(s: string): number {
  const [m, sec] = s.split(':').map(Number)
  return (m || 0) * 60 + (sec || 0)
}
