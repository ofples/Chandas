import { useCallback, useEffect, useRef, useState } from 'react'
import { TimerConfig } from '../types'
import { nextTick, nextSubTick, mainProgress, formatCountdown } from '../lib/snapLogic'

// ── Session persistence ────────────────────────────────────────
// Saves enough state to resume the timer after a page refresh.
// The phase is the only value that can't be recomputed from config.

const SESSION_KEY = 'slottimer-session'

interface TimerSession {
  phase: number
  mainMs: number
  subMs: number
}

function saveSession(s: TimerSession) {
  try { localStorage.setItem(SESSION_KEY, JSON.stringify(s)) } catch { /* ignore */ }
}

function loadSession(): TimerSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    return raw ? (JSON.parse(raw) as TimerSession) : null
  } catch { return null }
}

function clearSession() {
  try { localStorage.removeItem(SESSION_KEY) } catch { /* ignore */ }
}

export function hasTimerSession(): boolean {
  return localStorage.getItem(SESSION_KEY) !== null
}

interface TimerState {
  mainCountdown: string   // MM:SS
  subCountdown: string    // MM:SS
  progress: number        // 0–1
}

interface UseTimerReturn extends TimerState {
  isRunning: boolean
  start: () => void
  stop: () => void
  resumeBgAudio: () => void
}

// ── Audio ──────────────────────────────────────────────────────

function loadAudio(src: string): HTMLAudioElement | null {
  try {
    const a = new Audio(src)
    a.preload = 'auto'
    return a
  } catch {
    return null
  }
}

function playSound(audio: HTMLAudioElement | null, volume: number) {
  if (!audio) return
  audio.volume = Math.max(0, Math.min(1, volume))
  audio.currentTime = 0
  audio.play().catch(() => { /* sound file may not exist yet */ })
}

// ── Silent audio keep-alive ────────────────────────────────────
//
// Chrome/Android throttle setTimeout on backgrounded tabs, which causes bells
// to fire late or not at all.  Playing audio via an HTMLAudioElement exempts
// the page from background throttling AND activates the MediaSession API so
// that lock-screen / notification-shade controls appear on Android.
//
// An AudioContext alone does NOT trigger MediaSession on Android — a real
// HTMLAudioElement is required.  keepalive.mp3 is a 440 Hz sine at −60 dB:
// audible frequency so Chrome/Android don't classify it as silent, but
// −60 dB amplitude is imperceptible at any normal listening volume.

// On mobile/Android Chrome a volume of 0 causes the browser to classify the
// element as silent and eventually throttle/kill background tabs, so we clamp
// to 0.01 (imperceptible but non-zero). On desktop this restriction isn't
// needed and the user should be able to fully mute the bg track.
const BG_VOL_MIN = navigator.maxTouchPoints > 0 ? 0.01 : 0

function startBgAudio(
  ref: React.MutableRefObject<HTMLAudioElement | null>,
  track: 1 | 2 | 3,
  volume: number,
) {
  if (ref.current) return
  try {
    const audio  = new Audio(`/sounds/bg${track}.mp3`)
    audio.loop   = true
    audio.volume = Math.max(BG_VOL_MIN, volume)
    audio.play().catch(() => { /* blocked — caller should retry via resumeBgAudio */ })
    ref.current  = audio
  } catch (e) {
    console.warn('[SlotTimer] bg audio setup failed:', e)
  }
}

function stopBgAudio(ref: React.MutableRefObject<HTMLAudioElement | null>) {
  if (ref.current) {
    ref.current.pause()
    ref.current.src = ''
    ref.current     = null
  }
}

// ── Wake Lock ──────────────────────────────────────────────────

async function acquireWakeLock(ref: React.MutableRefObject<WakeLockSentinel | null>) {
  if (!('wakeLock' in navigator)) return
  try {
    ref.current = await navigator.wakeLock.request('screen')
  } catch {
    // Permission denied or not supported — not critical
  }
}

function releaseWakeLock(ref: React.MutableRefObject<WakeLockSentinel | null>) {
  ref.current?.release().catch(() => {})
  ref.current = null
}

// ── Service Worker messaging ───────────────────────────────────

function postToSW(data: object) {
  navigator.serviceWorker?.controller?.postMessage(data)
}

async function ensureNotificationPermission(): Promise<boolean> {
  if (!('Notification' in window)) return false
  if (Notification.permission === 'granted') return true
  if (Notification.permission === 'denied') return false
  const result = await Notification.requestPermission()
  return result === 'granted'
}

// ── Hook ───────────────────────────────────────────────────────

export function useTimer(config: TimerConfig): UseTimerReturn {
  const [isRunning, setIsRunning] = useState(false)
  const [state, setState] = useState<TimerState>({
    mainCountdown: '--:--',
    subCountdown: '--:--',
    progress: 0,
  })

  const phaseRef          = useRef(0)
  const mainIntervalMsRef = useRef(0)
  const subIntervalMsRef  = useRef(0)
  const subEnabledRef     = useRef(true)
  const tickTimerRef      = useRef<ReturnType<typeof setTimeout> | null>(null)
  const rafRef            = useRef<number | null>(null)
  const isRunningRef      = useRef(false)
  const gongRef           = useRef<HTMLAudioElement | null>(null)
  const bellRef           = useRef<HTMLAudioElement | null>(null)
  const wakeLockRef       = useRef<WakeLockSentinel | null>(null)
  const notifGrantedRef   = useRef(false)
  const notifEnabledRef   = useRef(config.notificationsEnabled)
  const silentAudioRef    = useRef<HTMLAudioElement | null>(null)
  // true only when the user explicitly paused via MediaSession lock-screen control,
  // OR when play() was rejected because another app owns audio focus (music player, call).
  // In both cases we stop fighting and let the other app play.
  // Cleared when the user returns to the app (visibilitychange) or taps the screen.
  const userPausedRef = useRef(false)

  // Preload audio on mount
  useEffect(() => {
    gongRef.current = loadAudio('/sounds/gong.mp3')
    bellRef.current = loadAudio('/sounds/bell.mp3')
  }, [])

  // ── Display update (RAF loop) ────────────────────────────────

  const updateDisplay = useCallback(() => {
    const now      = Date.now()
    const mainMs   = mainIntervalMsRef.current
    const subMs    = subIntervalMsRef.current
    const phase    = phaseRef.current
    const nextMain = nextTick(now, mainMs, phase)
    const prog     = mainProgress(now, mainMs, phase)

    setState({
      mainCountdown: formatCountdown(nextMain - now),
      subCountdown:  subEnabledRef.current
        ? formatCountdown(nextSubTick(now, mainMs, subMs, phase) - now)
        : '--:--',
      progress: prog,
    })
  }, [])

  const rafLoop = useCallback(() => {
    if (!isRunningRef.current) return
    updateDisplay()
    rafRef.current = requestAnimationFrame(rafLoop)
  }, [updateDisplay])

  // ── Notification helper ──────────────────────────────────────

  const fireNotification = useCallback(() => {
    if (!notifGrantedRef.current || !notifEnabledRef.current) return
    // Only notify when hidden — the renderer already plays the gong when visible,
    // so firing a notification too would double up the sound.
    if (!document.hidden) return
    // Pass current timer state so the SW can self-heal if it was terminated
    // and lost its module-level timerMainMs/timerPhase.
    postToSW({
      type:   'FIRE_NOTIFICATION',
      mainMs: mainIntervalMsRef.current,
      phase:  phaseRef.current,
    })
  }, [])

  // ── Tick scheduler ───────────────────────────────────────────

  const scheduleNextTick = useCallback(() => {
    if (!isRunningRef.current) return
    const now    = Date.now()
    const mainMs = mainIntervalMsRef.current
    const subMs  = subIntervalMsRef.current
    const phase  = phaseRef.current

    const nextMain = nextTick(now, mainMs, phase)
    const nextSub  = subEnabledRef.current ? nextSubTick(now, mainMs, subMs, phase) : Infinity
    const nextFire = Math.min(nextMain, nextSub)
    const delay    = Math.max(0, nextFire - Date.now())

    tickTimerRef.current = setTimeout(() => {
      if (!isRunningRef.current) return
      const fireTime = Date.now()

      // Determine what fired (within 1s tolerance)
      const firedMain = Math.abs(fireTime - nextMain) < 1000
      const firedSub  = !firedMain && nextSub !== Infinity && Math.abs(fireTime - nextSub) < 1000

      if (firedMain) {
        playSound(gongRef.current, config.volume)
        fireNotification()
      } else if (firedSub) {
        playSound(bellRef.current, config.volume)
      }

      scheduleNextTick()
    }, delay)
  }, [fireNotification])

  // ── Visibility re-sync ───────────────────────────────────────

  useEffect(() => {
    const handleVisibility = async () => {
      if (document.visibilityState === 'visible' && isRunningRef.current) {
        // Restart RAF loop — browser suspends requestAnimationFrame in backgrounded tabs
        if (rafRef.current) cancelAnimationFrame(rafRef.current)
        rafRef.current = requestAnimationFrame(rafLoop)

        if (tickTimerRef.current) clearTimeout(tickTimerRef.current)
        scheduleNextTick()
        updateDisplay()
        // Re-acquire wake lock (it auto-releases when backgrounded)
        await acquireWakeLock(wakeLockRef)
        // Re-sync SW in case it was terminated while the page was backgrounded
        if (notifGrantedRef.current) {
          postToSW({
            type:   'START_TIMER',
            mainMs: mainIntervalMsRef.current,
            phase:  phaseRef.current,
          })
        }
        // Resume bg audio when returning to the app — clear any yielded state first
        // so that even if we yielded to a music app, coming back to SlotTimer reclaims audio.
        userPausedRef.current = false
        const bgAudio = silentAudioRef.current
        if (bgAudio?.paused) bgAudio.play().catch(() => {})
      }
    }
    document.addEventListener('visibilitychange', handleVisibility)
    return () => document.removeEventListener('visibilitychange', handleVisibility)
  }, [scheduleNextTick, updateDisplay])

  // ── Start / Stop ─────────────────────────────────────────────

  const start = useCallback(async () => {
    const now    = Date.now()
    const mainMs = config.mainInterval * 60_000
    const subMs  = config.subInterval  * 60_000

    mainIntervalMsRef.current = mainMs
    subIntervalMsRef.current  = subMs
    subEnabledRef.current     = config.subEnabled

    // Restore saved phase if the interval settings match; otherwise compute fresh.
    const session = loadSession()
    phaseRef.current = (session?.mainMs === mainMs && session?.subMs === subMs)
      ? session.phase
      : config.snapEnabled
        ? config.snapOffset * 60_000
        : now % mainMs

    saveSession({ phase: phaseRef.current, mainMs, subMs })

    isRunningRef.current = true
    setIsRunning(true)
    updateDisplay()
    scheduleNextTick()
    rafRef.current = requestAnimationFrame(rafLoop)

    // Background audio — prevents throttling and activates MediaSession
    const bgWasNull = silentAudioRef.current === null
    startBgAudio(silentAudioRef, config.bgTrack, config.bgVolume)

    // Attach auto-resume logic to the freshly created audio element.
    // We only add listeners when the element is newly created (bgWasNull guard)
    // to avoid stacking duplicate listeners across multiple start() calls.
    if (bgWasNull && silentAudioRef.current) {
      const bgAudio = silentAudioRef.current
      bgAudio.addEventListener('pause', () => {
        if (userPausedRef.current || !isRunningRef.current) return
        // Retry up to 3 times (1.5 s apart) to ride out brief interruptions
        // like notification ducks (~500 ms). If all 3 fail it means another app
        // owns audio focus (music player, call) — yield rather than fight it.
        // The SW still fires gong notifications on time regardless of bg audio state.
        // Audio resumes when the user returns to the app or taps the screen.
        let attempt = 0
        const retry = () => {
          if (userPausedRef.current || !isRunningRef.current) return
          if (!silentAudioRef.current?.paused) return // already resumed by other means
          silentAudioRef.current.play().catch(() => {
            if (++attempt < 3) {
              setTimeout(retry, 1500)
            } else {
              userPausedRef.current = true // yield gracefully after 3 failures
            }
          })
        }
        setTimeout(retry, 1500)
      })
    }

    // MediaSession — lock screen / notification shade controls
    if ('mediaSession' in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title:   'SlotTimer',
        artist:  `Every ${config.mainInterval} min`,
        artwork: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
      })
      navigator.mediaSession.playbackState = 'playing'
      navigator.mediaSession.setActionHandler('stop',  stop)
      // pause/play only affect bg audio — not the timer itself.
      // This prevents system audio interruptions (calls, other apps) from
      // stopping the timer via the MediaSession pause action.
      // userPausedRef tracks whether the user explicitly paused from the lock screen
      // so we don't auto-resume against their wishes.
      navigator.mediaSession.setActionHandler('pause', () => {
        userPausedRef.current = true
        silentAudioRef.current?.pause()
        navigator.mediaSession.playbackState = 'paused'
      })
      navigator.mediaSession.setActionHandler('play', () => {
        userPausedRef.current = false
        silentAudioRef.current?.play().catch(() => {})
        navigator.mediaSession.playbackState = 'playing'
      })
    }

    // Wake lock — keep screen on
    await acquireWakeLock(wakeLockRef)

    // Notification permission — delegate all scheduling to the SW
    notifGrantedRef.current = await ensureNotificationPermission()
    if (notifGrantedRef.current && notifEnabledRef.current) {
      postToSW({ type: 'START_TIMER', mainMs, phase: phaseRef.current })
    }
  }, [config, updateDisplay, scheduleNextTick, rafLoop])

  const stop = useCallback(() => {
    isRunningRef.current = false
    setIsRunning(false)
    clearSession()

    if (tickTimerRef.current)  { clearTimeout(tickTimerRef.current);   tickTimerRef.current  = null }
    if (rafRef.current)        { cancelAnimationFrame(rafRef.current); rafRef.current        = null }
    userPausedRef.current = false

    stopBgAudio(silentAudioRef)
    if ('mediaSession' in navigator) {
      navigator.mediaSession.metadata      = null
      navigator.mediaSession.playbackState = 'none'
      navigator.mediaSession.setActionHandler('stop',  null)
      navigator.mediaSession.setActionHandler('pause', null)
      navigator.mediaSession.setActionHandler('play',  null)
    }
    releaseWakeLock(wakeLockRef)
    postToSW({ type: 'CLEAR_NOTIFICATION' })
    setState({ mainCountdown: '--:--', subCountdown: '--:--', progress: 0 })
  }, [])

  // Live-update bg track while running
  useEffect(() => {
    const audio = silentAudioRef.current
    if (!audio) return
    audio.src = `/sounds/bg${config.bgTrack}.mp3`
    audio.load()
    audio.play().catch(() => {})
  }, [config.bgTrack])

  // Live-update bg volume while running
  useEffect(() => {
    if (!silentAudioRef.current) return
    silentAudioRef.current.volume = Math.max(BG_VOL_MIN, config.bgVolume)
  }, [config.bgVolume])

  // Cleanup on unmount
  useEffect(() => () => {
    if (tickTimerRef.current) clearTimeout(tickTimerRef.current)
    if (rafRef.current)       cancelAnimationFrame(rafRef.current)
    releaseWakeLock(wakeLockRef)
    stopBgAudio(silentAudioRef)
  }, [])

  useEffect(() => { notifEnabledRef.current = config.notificationsEnabled }, [config.notificationsEnabled])

  // Keep subEnabledRef in sync; reschedule so the next tick fires correctly.
  useEffect(() => {
    subEnabledRef.current = config.subEnabled
    if (isRunningRef.current) {
      if (tickTimerRef.current) clearTimeout(tickTimerRef.current)
      scheduleNextTick()
      updateDisplay()
    }
  }, [config.subEnabled, scheduleNextTick, updateDisplay])

  // Called from any user interaction on the running screen to unblock autoplay
  // when the timer was auto-restored after a page refresh.
  // Also clears userPausedRef so a tap always resumes audio regardless of lock-screen state.
  const resumeBgAudio = useCallback(() => {
    userPausedRef.current = false
    const audio = silentAudioRef.current
    if (audio?.paused) audio.play().catch(() => {})
  }, [])

  return { ...state, isRunning, start, stop, resumeBgAudio }
}
