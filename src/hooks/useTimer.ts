import { useCallback, useEffect, useRef, useState } from 'react'
import { AppState } from 'react-native'
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake'
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio'
import * as Notifications from 'expo-notifications'
import { TimerConfig } from '../types'
import { nextTick, nextSubTick, mainProgress, formatCountdown } from '../lib/snapLogic'
import { loadSession, saveSession, clearSession } from '../lib/storage'
import { isNativeServiceAvailable, SlotTimerService } from '../native/SlotTimerService'

const KEEP_AWAKE_TAG = 'slottimer-running'

const GONG_SOURCE = require('../../assets/sounds/gong.mp3')
const BELL_SOURCE = require('../../assets/sounds/bell.mp3')
const ALARM_SOURCE = require('../../assets/sounds/alarm.wav')

interface TimerState {
  mainCountdown: string
  subCountdown: string
  progress: number
}

interface UseTimerReturn extends TimerState {
  isRunning: boolean
  start: (overrideConfig?: TimerConfig) => void
  stop: () => void
  resyncPhase: (newPhase: number) => void
  isAlarmRinging: boolean
  dismissAlarm: () => void
}

async function ensureNotificationPermission(): Promise<boolean> {
  const current = await Notifications.getPermissionsAsync()
  if (current.granted) return true
  const requested = await Notifications.requestPermissionsAsync()
  return requested.granted
}

// ── Hook ───────────────────────────────────────────────────────
//
// The native Android scheduler owns exact alarms, one-shot sounds, persistence,
// and notifications when available. This
// hook always renders the ring/countdown itself (pure function of Date.now()
// and the shared phase, so it can never drift from the service), and only
// falls back to playing gong/bell audio in JS when the native module isn't
// present yet (e.g. mid-development, or a platform without it) — matching the
// legacy web app's foreground behavior minus the keep-alive hacks.
export function useTimer(config: TimerConfig): UseTimerReturn {
  const [isRunning, setIsRunning] = useState(false)
  const [isAlarmRinging, setIsAlarmRinging] = useState(false)
  const [state, setState] = useState<TimerState>({
    mainCountdown: '--:--',
    subCountdown: '--:--',
    progress: 0,
  })

  const phaseRef          = useRef(0)
  const mainMsRef         = useRef(0)
  const subMsRef          = useRef(0)
  const subEnabledRef     = useRef(true)
  const isRunningRef      = useRef(false)
  const rafRef            = useRef<number | null>(null)
  const tickTimeoutRef    = useRef<ReturnType<typeof setTimeout> | null>(null)

  const gongPlayerRef  = useRef<AudioPlayer | null>(null)
  const bellPlayerRef  = useRef<AudioPlayer | null>(null)
  const alarmPlayerRef = useRef<AudioPlayer | null>(null)

  // ── Display update (RAF loop) — always JS-side, always in sync ─

  const updateDisplay = useCallback(() => {
    const now      = Date.now()
    const mainMs   = mainMsRef.current
    const subMs    = subMsRef.current
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

  // ── JS-only fallback sound scheduler (used only when the native
  //    foreground service isn't available) ───────────────────────

  const playOneShot = (player: AudioPlayer | null, volume: number) => {
    if (!player) return
    player.volume = Math.max(0, Math.min(1, volume))
    player.seekTo(0).catch(() => {})
    player.play()
  }

  // Starts a looping alarm sound and pauses tick scheduling until dismissed —
  // the JS-fallback counterpart of the native service's alarm-ringing state.
  const startFallbackAlarm = (volume: number) => {
    alarmPlayerRef.current?.remove()
    const player = createAudioPlayer(ALARM_SOURCE)
    player.loop = true
    player.volume = Math.max(0, Math.min(1, volume))
    player.play()
    alarmPlayerRef.current = player
    setIsAlarmRinging(true)
  }

  const scheduleFallbackTick = useCallback(() => {
    if (isNativeServiceAvailable || !isRunningRef.current) return
    const now    = Date.now()
    const mainMs = mainMsRef.current
    const subMs  = subMsRef.current
    const phase  = phaseRef.current

    const nextMain = nextTick(now, mainMs, phase)
    const nextSub  = subEnabledRef.current ? nextSubTick(now, mainMs, subMs, phase) : Infinity
    const delay    = Math.max(0, Math.min(nextMain, nextSub) - now)

    tickTimeoutRef.current = setTimeout(() => {
      if (!isRunningRef.current) return
      const fireTime  = Date.now()
      const firedMain = Math.abs(fireTime - nextMain) < 1000
      const firedSub  = !firedMain && nextSub !== Infinity && Math.abs(fireTime - nextSub) < 1000

      if (firedMain && config.alarmModeEnabled) {
        // Continuous alarm — pause scheduling; dismissAlarm() resumes it.
        startFallbackAlarm(config.volume)
        return
      }
      if (firedMain) playOneShot(gongPlayerRef.current, config.volume)
      else if (firedSub) playOneShot(bellPlayerRef.current, config.volume)

      scheduleFallbackTick()
    }, delay)
  }, [config.volume, config.alarmModeEnabled])

  // ── Start / Stop ─────────────────────────────────────────────

  const start = useCallback(async (overrideConfig?: TimerConfig) => {
    const startConfig = overrideConfig ?? config
    const now    = Date.now()
    const nativeState = isNativeServiceAvailable ? SlotTimerService.getState() : null
    const mainMs = nativeState?.active && nativeState.mainMs
      ? nativeState.mainMs
      : startConfig.mainInterval * 60_000
    const subMs = nativeState?.active && nativeState.subMs
      ? nativeState.subMs
      : startConfig.subInterval * 60_000

    mainMsRef.current     = mainMs
    subMsRef.current      = subMs
    subEnabledRef.current = nativeState?.active
      ? nativeState.subEnabled ?? startConfig.subEnabled
      : startConfig.subEnabled

    const session = await loadSession()
    phaseRef.current = nativeState?.active && nativeState.phase !== undefined
      ? nativeState.phase
      : (session?.mainMs === mainMs && session?.subMs === subMs)
        ? session.phase
        : startConfig.snapEnabled
          ? startConfig.snapOffset * 60_000
          : now % mainMs

    await saveSession({ phase: phaseRef.current, mainMs, subMs })

    isRunningRef.current = true
    setIsRunning(true)
    setIsAlarmRinging(nativeState?.ringing ?? false)
    updateDisplay()
    rafRef.current = requestAnimationFrame(rafLoop)
    await activateKeepAwakeAsync(KEEP_AWAKE_TAG)

    // Requested unconditionally: on Android, the foreground service must show
    // *some* ongoing notification regardless of the user's "notifications"
    // preference below — that preference only controls how much detail it shows.
    const notifGranted = await ensureNotificationPermission()

    if (isNativeServiceAvailable) {
      const nativeConfig = {
        mainMs,
        subMs,
        phase: phaseRef.current,
        subEnabled: subEnabledRef.current,
        volume: startConfig.volume,
        notificationsEnabled: notifGranted && startConfig.notificationsEnabled,
        alarmModeEnabled: startConfig.alarmModeEnabled,
      }
      if (nativeState?.active) {
        SlotTimerService.update(nativeConfig)
      } else {
        SlotTimerService.start(nativeConfig)
      }
    } else {
      // JS fallback — foreground-only accuracy, mirrors legacy web behavior.
      await setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: false })
      gongPlayerRef.current = createAudioPlayer(GONG_SOURCE)
      bellPlayerRef.current = createAudioPlayer(BELL_SOURCE)
      scheduleFallbackTick()
    }
  }, [config, updateDisplay, rafLoop, scheduleFallbackTick])

  const stop = useCallback(() => {
    isRunningRef.current = false
    setIsRunning(false)
    setIsAlarmRinging(false)
    clearSession()

    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null }
    if (tickTimeoutRef.current) { clearTimeout(tickTimeoutRef.current); tickTimeoutRef.current = null }

    deactivateKeepAwake(KEEP_AWAKE_TAG)

    if (isNativeServiceAvailable) {
      SlotTimerService.stop()
    } else {
      gongPlayerRef.current?.remove()
      bellPlayerRef.current?.remove()
      alarmPlayerRef.current?.remove()
      gongPlayerRef.current = null
      bellPlayerRef.current = null
      alarmPlayerRef.current = null
    }

    setState({ mainCountdown: '--:--', subCountdown: '--:--', progress: 0 })
  }, [])

  // Dismisses an in-progress alarm ring without stopping the whole timer —
  // ticking resumes for the next interval.
  const dismissAlarm = useCallback(() => {
    setIsAlarmRinging(false)
    if (isNativeServiceAvailable) {
      SlotTimerService.stopAlarm()
      return
    }
    alarmPlayerRef.current?.remove()
    alarmPlayerRef.current = null
    if (isRunningRef.current) scheduleFallbackTick()
  }, [scheduleFallbackTick])

  // ── Manual re-sync ────────────────────────────────────────────
  //
  // Re-anchors the running timer to a new phase without a full restart (no
  // re-acquiring keep-awake/permissions, no recreating players) — used by the
  // "restart"/"snap to clock" button on the running screen. mainMs/subMs are
  // unchanged; only the phase offset moves.

  const resyncPhase = useCallback((newPhase: number) => {
    if (!isRunningRef.current) return
    phaseRef.current = newPhase
    saveSession({ phase: newPhase, mainMs: mainMsRef.current, subMs: subMsRef.current })
    updateDisplay()
    if (isNativeServiceAvailable) {
      SlotTimerService.update({ phase: newPhase })
    } else if (tickTimeoutRef.current) {
      clearTimeout(tickTimeoutRef.current)
      scheduleFallbackTick()
    }
  }, [updateDisplay, scheduleFallbackTick])

  // Live-update sub-enabled + reschedule fallback ticking
  useEffect(() => {
    subEnabledRef.current = config.subEnabled
    if (!isRunningRef.current) return
    if (isNativeServiceAvailable) {
      SlotTimerService.update({ subEnabled: config.subEnabled })
    } else if (tickTimeoutRef.current) {
      clearTimeout(tickTimeoutRef.current)
      scheduleFallbackTick()
    }
    updateDisplay()
  }, [config.subEnabled, scheduleFallbackTick, updateDisplay])

  // Live-update volume / notifications / alarm-mode toggle → native service
  useEffect(() => {
    if (isRunningRef.current && isNativeServiceAvailable) {
      SlotTimerService.update({
        volume: config.volume,
        notificationsEnabled: config.notificationsEnabled,
        alarmModeEnabled: config.alarmModeEnabled,
      })
    }
  }, [config.volume, config.notificationsEnabled, config.alarmModeEnabled])

  // Live-update volume/alarm-mode in the JS fallback path — reschedule so the
  // pending timeout (which closed over the previous values) picks up the new
  // ones instead of firing once more at the stale value.
  useEffect(() => {
    if (!isRunningRef.current || isNativeServiceAvailable) return
    if (tickTimeoutRef.current) {
      clearTimeout(tickTimeoutRef.current)
      scheduleFallbackTick()
    }
  }, [config.volume, config.alarmModeEnabled, scheduleFallbackTick])

  // Re-sync the RAF loop and (fallback) tick scheduler when the app returns
  // to the foreground — timestamps are absolute, so this is just a resync,
  // never a recompute.
  useEffect(() => {
    const sub = AppState.addEventListener('change', next => {
      if (next !== 'active' || !isRunningRef.current) return
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      rafRef.current = requestAnimationFrame(rafLoop)
      updateDisplay()
      if (!isNativeServiceAvailable) {
        if (tickTimeoutRef.current) clearTimeout(tickTimeoutRef.current)
        scheduleFallbackTick()
      }
    })
    return () => sub.remove()
  }, [rafLoop, updateDisplay, scheduleFallbackTick])

  // ── Alarm-ringing state sync (native path only) ───────────────
  //
  // The native service can start ringing independently of the JS lifecycle
  // (e.g. the app was killed and is relaunched from the alarm's full-screen
  // notification), so this doesn't gate on isRunningRef — it just asks "is it
  // ringing right now?" on mount and every time the app returns to the
  // foreground, plus subscribes to live updates while mounted.
  useEffect(() => {
    if (!isNativeServiceAvailable) return
    setIsAlarmRinging(SlotTimerService.isRinging())

    const listener = SlotTimerService.addAlarmListener(setIsAlarmRinging)
    const sub = AppState.addEventListener('change', next => {
      if (next === 'active') setIsAlarmRinging(SlotTimerService.isRinging())
    })
    return () => {
      listener?.remove()
      sub.remove()
    }
  }, [])

  // Cleanup on unmount
  useEffect(() => () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    if (tickTimeoutRef.current) clearTimeout(tickTimeoutRef.current)
    deactivateKeepAwake(KEEP_AWAKE_TAG)
  }, [])

  return { ...state, isRunning, start, stop, resyncPhase, isAlarmRinging, dismissAlarm }
}
