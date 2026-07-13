import { useCallback, useEffect, useRef, useState } from 'react'
import { AppState } from 'react-native'
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake'
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio'
import * as Notifications from 'expo-notifications'
import { TimerConfig } from '../types'
import { nextTick, nextSubTick, mainProgress, formatCountdown } from '../lib/snapLogic'
import { loadSession, saveSession, clearSession } from '../lib/storage'
import { isNativeServiceAvailable, SlotTimerService } from '../native/SlotTimerService'
import { isWithinActiveHours, nextActiveHoursStart, type ActiveHoursSettings } from '../lib/activeHours'

const KEEP_AWAKE_TAG = 'slottimer-running'

const GONG_SOURCE = require('../../assets/sounds/gong.mp3')
const BELL_SOURCE = require('../../assets/sounds/bell.mp3')
const ALARM_SOURCE = require('../../assets/sounds/alarm.wav')

interface TimerState {
  mainCountdown: string
  subCountdown: string
  progress: number
  activeHoursPaused: boolean
  activeHoursResumeAt: number
}

interface UseTimerReturn extends TimerState {
  isRunning: boolean
  start: (overrideConfig?: TimerConfig) => void
  stop: () => void
  resyncPhase: (newPhase: number) => void
  isAlarmRinging: boolean
  dismissAlarm: () => void
  alarmOnceArmed: boolean
  mutedUntil: number
  mutedIterationsRemaining: number
  toggleAlarmOnce: () => void
  muteForIterations: (count: number) => void
  muteForMinutes: (minutes: number) => void
  clearTimedMute: () => void
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
  const [alarmOnceArmed, setAlarmOnceArmed] = useState(false)
  const [mutedUntil, setMutedUntil] = useState(0)
  const [mutedIterationsRemaining, setMutedIterationsRemaining] = useState(0)
  const [state, setState] = useState<TimerState>({
    mainCountdown: '--:--',
    subCountdown: '--:--',
    progress: 0,
    activeHoursPaused: false,
    activeHoursResumeAt: 0,
  })

  const phaseRef          = useRef(0)
  const mainMsRef         = useRef(0)
  const subMsRef          = useRef(0)
  const subEnabledRef     = useRef(true)
  const isRunningRef      = useRef(false)
  const rafRef            = useRef<number | null>(null)
  const tickTimeoutRef    = useRef<ReturnType<typeof setTimeout> | null>(null)
  const alarmSilenceRef   = useRef<ReturnType<typeof setTimeout> | null>(null)
  const alarmOnceRef      = useRef(false)
  const mutedUntilRef     = useRef(0)
  const mutedIterationsRef = useRef(0)
  const activeHoursRef = useRef<ActiveHoursSettings>({
    activeHoursEnabled: config.activeHoursEnabled,
    activeHoursStart: config.activeHoursStart,
    activeHoursEnd: config.activeHoursEnd,
    activeHoursDays: config.activeHoursDays,
  })

  const gongPlayerRef  = useRef<AudioPlayer | null>(null)
  const bellPlayerRef  = useRef<AudioPlayer | null>(null)
  const alarmPlayerRef = useRef<AudioPlayer | null>(null)

  const applyControlState = useCallback((next: {
    alarmOnceArmed: boolean
    mutedUntil: number
    mutedIterationsRemaining: number
  }) => {
    alarmOnceRef.current = next.alarmOnceArmed
    mutedUntilRef.current = next.mutedUntil
    mutedIterationsRef.current = next.mutedIterationsRemaining
    setAlarmOnceArmed(next.alarmOnceArmed)
    setMutedUntil(next.mutedUntil)
    setMutedIterationsRemaining(next.mutedIterationsRemaining)
  }, [])

  // ── Display update (RAF loop) — always JS-side, always in sync ─

  const updateDisplay = useCallback(() => {
    const now      = Date.now()
    const mainMs   = mainMsRef.current
    const subMs    = subMsRef.current
    const phase    = phaseRef.current
    const activeHours = activeHoursRef.current
    if (!isWithinActiveHours(activeHours, now)) {
      setState({
        mainCountdown: '--:--',
        subCountdown: '--:--',
        progress: 0,
        activeHoursPaused: true,
        activeHoursResumeAt: nextActiveHoursStart(activeHours, now),
      })
      return
    }
    const nextMain = nextTick(now, mainMs, phase)
    const prog     = mainProgress(now, mainMs, phase)

    setState({
      mainCountdown: formatCountdown(nextMain - now),
      subCountdown:  subEnabledRef.current
        ? formatCountdown(nextSubTick(now, mainMs, subMs, phase) - now)
        : '--:--',
      progress: prog,
      activeHoursPaused: false,
      activeHoursResumeAt: 0,
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
    const activeHours = activeHoursRef.current

    const nextMain = nextTick(now, mainMs, phase)
    const nextSub  = subEnabledRef.current ? nextSubTick(now, mainMs, subMs, phase) : Infinity
    const nextEvent = Math.min(nextMain, nextSub)
    const resumesActiveHours = !isWithinActiveHours(activeHours, now) ||
      !isWithinActiveHours(activeHours, nextEvent)
    const triggerAt = resumesActiveHours ? nextActiveHoursStart(activeHours, now) : nextEvent
    const delay = Math.max(0, triggerAt - now)

    tickTimeoutRef.current = setTimeout(() => {
      if (!isRunningRef.current) return
      if (resumesActiveHours) {
        scheduleFallbackTick()
        return
      }
      const fireTime  = Date.now()
      const firedMain = Math.abs(fireTime - nextMain) < 1000
      const firedSub  = !firedMain && nextSub !== Infinity && Math.abs(fireTime - nextSub) < 1000
      const alarmOnce = firedMain && alarmOnceRef.current
      const temporarilyMuted = mutedUntilRef.current > fireTime || mutedIterationsRef.current > 0
      const muted = config.volume <= 0 || temporarilyMuted

      if (alarmOnce) {
        alarmOnceRef.current = false
        setAlarmOnceArmed(false)
      }
      if (firedMain && mutedIterationsRef.current > 0) {
        mutedIterationsRef.current -= 1
        setMutedIterationsRemaining(mutedIterationsRef.current)
      }

      if (firedMain && !muted && (config.alarmModeEnabled || alarmOnce)) {
        startFallbackAlarm(config.volume)
        if (alarmSilenceRef.current) clearTimeout(alarmSilenceRef.current)
        alarmSilenceRef.current = setTimeout(() => {
          alarmSilenceRef.current = null
          alarmPlayerRef.current?.remove()
          alarmPlayerRef.current = null
        }, Math.max(5, Math.min(3_600, config.alarmDurationSeconds)) * 1_000)
        scheduleFallbackTick()
        return
      }
      if (!muted && firedMain) playOneShot(gongPlayerRef.current, config.volume)
      else if (!muted && firedSub) playOneShot(bellPlayerRef.current, config.volume)

      scheduleFallbackTick()
    }, delay)
  }, [config.volume, config.alarmModeEnabled, config.alarmDurationSeconds])

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
    activeHoursRef.current = {
      activeHoursEnabled: startConfig.activeHoursEnabled,
      activeHoursStart: startConfig.activeHoursStart,
      activeHoursEnd: startConfig.activeHoursEnd,
      activeHoursDays: startConfig.activeHoursDays,
    }

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
    applyControlState({
      alarmOnceArmed: nativeState?.alarmOnceArmed ?? false,
      mutedUntil: nativeState?.mutedUntil ?? 0,
      mutedIterationsRemaining: nativeState?.mutedIterationsRemaining ?? 0,
    })
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
        activeHoursEnabled: startConfig.activeHoursEnabled,
        activeHoursStart: startConfig.activeHoursStart,
        activeHoursEnd: startConfig.activeHoursEnd,
        activeHoursDays: startConfig.activeHoursDays,
        alarmDurationSeconds: startConfig.alarmDurationSeconds,
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
  }, [config, updateDisplay, rafLoop, scheduleFallbackTick, applyControlState])

  const stop = useCallback(() => {
    isRunningRef.current = false
    setIsRunning(false)
    setIsAlarmRinging(false)
    applyControlState({ alarmOnceArmed: false, mutedUntil: 0, mutedIterationsRemaining: 0 })
    clearSession()

    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null }
    if (tickTimeoutRef.current) { clearTimeout(tickTimeoutRef.current); tickTimeoutRef.current = null }
    if (alarmSilenceRef.current) { clearTimeout(alarmSilenceRef.current); alarmSilenceRef.current = null }

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

    setState({
      mainCountdown: '--:--',
      subCountdown: '--:--',
      progress: 0,
      activeHoursPaused: false,
      activeHoursResumeAt: 0,
    })
  }, [applyControlState])

  // Dismisses an in-progress alarm ring without stopping the whole timer —
  // ticking resumes for the next interval.
  const dismissAlarm = useCallback(() => {
    setIsAlarmRinging(false)
    if (isNativeServiceAvailable) {
      SlotTimerService.stopAlarm()
      return
    }
    if (alarmSilenceRef.current) {
      clearTimeout(alarmSilenceRef.current)
      alarmSilenceRef.current = null
    }
    alarmPlayerRef.current?.remove()
    alarmPlayerRef.current = null
  }, [])

  const toggleAlarmOnce = useCallback(() => {
    if (isNativeServiceAvailable) {
      SlotTimerService.toggleAlarmOnce()
      const nativeState = SlotTimerService.getState()
      applyControlState({
        alarmOnceArmed: nativeState.alarmOnceArmed ?? false,
        mutedUntil: nativeState.mutedUntil ?? 0,
        mutedIterationsRemaining: nativeState.mutedIterationsRemaining ?? 0,
      })
      return
    }
    applyControlState({
      alarmOnceArmed: !alarmOnceRef.current,
      mutedUntil: mutedUntilRef.current,
      mutedIterationsRemaining: mutedIterationsRef.current,
    })
  }, [applyControlState])

  const muteForIterations = useCallback((count: number) => {
    if (isNativeServiceAvailable) SlotTimerService.muteForIterations(count)
    applyControlState({
      alarmOnceArmed: alarmOnceRef.current,
      mutedUntil: 0,
      mutedIterationsRemaining: Math.max(1, Math.min(99, count)),
    })
  }, [applyControlState])

  const muteForMinutes = useCallback((minutes: number) => {
    const until = Date.now() + Math.max(1, Math.min(1_440, minutes)) * 60_000
    if (isNativeServiceAvailable) SlotTimerService.muteForMinutes(minutes)
    applyControlState({
      alarmOnceArmed: alarmOnceRef.current,
      mutedUntil: until,
      mutedIterationsRemaining: 0,
    })
  }, [applyControlState])

  const clearTimedMute = useCallback(() => {
    if (isNativeServiceAvailable) SlotTimerService.clearMute()
    applyControlState({
      alarmOnceArmed: alarmOnceRef.current,
      mutedUntil: 0,
      mutedIterationsRemaining: 0,
    })
  }, [applyControlState])

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

  useEffect(() => {
    activeHoursRef.current = {
      activeHoursEnabled: config.activeHoursEnabled,
      activeHoursStart: config.activeHoursStart,
      activeHoursEnd: config.activeHoursEnd,
      activeHoursDays: config.activeHoursDays,
    }
    if (!isRunningRef.current) return
    if (isNativeServiceAvailable) {
      SlotTimerService.update(activeHoursRef.current)
    } else if (tickTimeoutRef.current) {
      clearTimeout(tickTimeoutRef.current)
      scheduleFallbackTick()
    }
    updateDisplay()
  }, [
    config.activeHoursEnabled,
    config.activeHoursStart,
    config.activeHoursEnd,
    config.activeHoursDays,
    scheduleFallbackTick,
    updateDisplay,
  ])

  // Live-update volume / notifications / alarm-mode toggle → native service
  useEffect(() => {
    if (isRunningRef.current && isNativeServiceAvailable) {
      SlotTimerService.update({
        volume: config.volume,
        notificationsEnabled: config.notificationsEnabled,
        alarmModeEnabled: config.alarmModeEnabled,
        alarmDurationSeconds: config.alarmDurationSeconds,
      })
    }
  }, [config.volume, config.notificationsEnabled, config.alarmModeEnabled, config.alarmDurationSeconds])

  // Live-update volume/alarm-mode in the JS fallback path — reschedule so the
  // pending timeout (which closed over the previous values) picks up the new
  // ones instead of firing once more at the stale value.
  useEffect(() => {
    if (!isRunningRef.current || isNativeServiceAvailable) return
    if (tickTimeoutRef.current) {
      clearTimeout(tickTimeoutRef.current)
      scheduleFallbackTick()
    }
  }, [config.volume, config.alarmModeEnabled, config.alarmDurationSeconds, scheduleFallbackTick])

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

  useEffect(() => {
    if (!isNativeServiceAvailable) return
    const listener = SlotTimerService.addControlListener(applyControlState)
    return () => listener?.remove()
  }, [applyControlState])

  useEffect(() => {
    if (mutedUntil <= Date.now()) return
    const timeout = setTimeout(() => {
      if (isNativeServiceAvailable) SlotTimerService.clearMute()
      applyControlState({
        alarmOnceArmed: alarmOnceRef.current,
        mutedUntil: 0,
        mutedIterationsRemaining: 0,
      })
    }, mutedUntil - Date.now())
    return () => clearTimeout(timeout)
  }, [mutedUntil, applyControlState])

  // Cleanup on unmount
  useEffect(() => () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    if (tickTimeoutRef.current) clearTimeout(tickTimeoutRef.current)
    if (alarmSilenceRef.current) clearTimeout(alarmSilenceRef.current)
    deactivateKeepAwake(KEEP_AWAKE_TAG)
  }, [])

  return {
    ...state,
    isRunning,
    start,
    stop,
    resyncPhase,
    isAlarmRinging,
    dismissAlarm,
    alarmOnceArmed,
    mutedUntil,
    mutedIterationsRemaining,
    toggleAlarmOnce,
    muteForIterations,
    muteForMinutes,
    clearTimedMute,
  }
}
