import { useCallback, useEffect, useRef, useState } from 'react'
import { AppState } from 'react-native'
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake'
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio'
import type { AlarmBehavior, AppTimerSettings, TimerProgram } from '../types'
import { isWithinActiveHours, nextActiveHoursStart } from '../lib/activeHours'
import { formatCountdown } from '../lib/snapLogic'
import { sourceForSound, soundTitle } from '../lib/soundLibrary'
import { nextProgramEvent, timelinePosition, type TimelinePosition } from '../lib/timeline'
import { emptyRuntimeMute, gateProgramAudio, iterationMuteFor, type RuntimeMuteState } from '../lib/runtimeV2'
import { clearTimerV2Session, saveTimerV2Session } from '../lib/storage'

const KEEP_AWAKE_TAG = 'chandas-running-v2'
const ALARM_SOURCE = require('../../assets/sounds/alarm.mp3')

export interface TimerV2Display {
  mainCountdown: string
  nextCueCountdown: string
  nextCueLabel: string
  progress: number
  position: TimelinePosition | null
  activeHoursPaused: boolean
  activeHoursResumeAt: number
}

export interface UseTimerV2Return extends TimerV2Display {
  isRunning: boolean
  isAlarmRinging: boolean
  alarmBehavior: AlarmBehavior
  mute: RuntimeMuteState
  start: (anchor?: number) => Promise<void>
  stop: () => void
  dismissAlarm: () => void
  pressAlarm: () => void
  muteForIterations: (count: number) => void
  muteForMinutes: (minutes: number) => void
  clearMute: () => void
}

function displayFor(program: TimerProgram, settings: AppTimerSettings, anchor: number, now: number): TimerV2Display {
  const active = isWithinActiveHours(settings, now)
  if (!active) {
    return {
      mainCountdown: '--:--',
      nextCueCountdown: '--:--',
      nextCueLabel: 'Paused outside active hours',
      progress: 0,
      position: null,
      activeHoursPaused: true,
      activeHoursResumeAt: nextActiveHoursStart(settings, now),
    }
  }
  const position = timelinePosition(program, anchor, now)
  const next = position.nextEvent
  const mainCountdown = program.mode === 'pattern'
    ? formatCountdown(anchor + (position.cycleIndex + 1) * program.mainMinutes * 60_000 - now)
    : formatCountdown(next.at - now)
  return {
    mainCountdown,
    nextCueCountdown: formatCountdown(next.at - now),
    nextCueLabel: next.winner.kind === 'pattern-main' ? 'Main gong' : soundTitle(next.winner.sound),
    progress: position.cycleProgress,
    position,
    activeHoursPaused: false,
    activeHoursResumeAt: 0,
  }
}

/**
 * Web/JS fallback for the V2 timeline. Android replaces this schedule with the
 * exact-alarm native service once that service receives the V2 program record.
 */
export function useTimerV2(program: TimerProgram, settings: AppTimerSettings): UseTimerV2Return {
  const [isRunning, setIsRunning] = useState(false)
  const [isAlarmRinging, setIsAlarmRinging] = useState(false)
  const [alarmBehavior, setAlarmBehavior] = useState<AlarmBehavior>('off')
  const [mute, setMute] = useState<RuntimeMuteState>(emptyRuntimeMute())
  const [display, setDisplay] = useState<TimerV2Display>({
    mainCountdown: '--:--', nextCueCountdown: '--:--', nextCueLabel: '', progress: 0,
    position: null, activeHoursPaused: false, activeHoursResumeAt: 0,
  })

  const runningRef = useRef(false)
  const anchorRef = useRef(0)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const rafRef = useRef<number | null>(null)
  const playerRef = useRef<AudioPlayer | null>(null)
  const alarmPlayerRef = useRef<AudioPlayer | null>(null)
  const alarmStopRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const programRef = useRef(program)
  const settingsRef = useRef(settings)
  const muteRef = useRef(mute)
  const alarmBehaviorRef = useRef<AlarmBehavior>('off')
  const lastAlarmPressRef = useRef(0)

  useEffect(() => { programRef.current = program }, [program])
  useEffect(() => { settingsRef.current = settings }, [settings])
  useEffect(() => { muteRef.current = mute }, [mute])
  useEffect(() => { alarmBehaviorRef.current = alarmBehavior }, [alarmBehavior])

  const refreshDisplay = useCallback(() => {
    if (!runningRef.current) return
    setDisplay(displayFor(programRef.current, settingsRef.current, anchorRef.current, Date.now()))
  }, [])

  const rafLoop = useCallback(() => {
    if (!runningRef.current) return
    refreshDisplay()
    rafRef.current = requestAnimationFrame(rafLoop)
  }, [refreshDisplay])

  const persistSession = useCallback((nextMute: RuntimeMuteState, nextAlarm: AlarmBehavior) => {
    if (!runningRef.current) return
    void saveTimerV2Session({
      schemaVersion: 2,
      anchor: anchorRef.current,
      program: programRef.current,
      mute: nextMute,
      alarmBehavior: nextAlarm,
    })
  }, [])

  const updateRuntimeState = useCallback((nextMute: RuntimeMuteState, nextAlarm: AlarmBehavior) => {
    muteRef.current = nextMute
    alarmBehaviorRef.current = nextAlarm
    setMute(nextMute)
    setAlarmBehavior(nextAlarm)
    persistSession(nextMute, nextAlarm)
  }, [persistSession])

  const dismissAlarm = useCallback(() => {
    if (alarmStopRef.current) clearTimeout(alarmStopRef.current)
    alarmStopRef.current = null
    alarmPlayerRef.current?.remove()
    alarmPlayerRef.current = null
    setIsAlarmRinging(false)
  }, [])

  const playEvent = useCallback((eventAt: number) => {
    const activeProgram = programRef.current
    const activeSettings = settingsRef.current
    const event = nextProgramEvent(activeProgram, anchorRef.current, eventAt - 1)
    if (event.at !== eventAt) return
    const gate = gateProgramAudio({
      event,
      now: Date.now(),
      masterVolume: activeSettings.masterVolume,
      mute: muteRef.current,
      alarmBehavior: alarmBehaviorRef.current,
      // The native scheduler owns call-state detection on Android. JS/web does
      // not have a trustworthy equivalent, so it never guesses call state.
      callActive: false,
    })
    updateRuntimeState(gate.nextMute, gate.nextAlarmBehavior)
    if (!gate.shouldPlay) return

    const shouldAlarm = event.winner.kind === 'pattern-main' && gate.nextAlarmBehavior !== 'off'
    if (shouldAlarm) {
      dismissAlarm()
      const player = createAudioPlayer(ALARM_SOURCE)
      player.loop = true
      player.volume = Math.max(0, Math.min(1, activeSettings.masterVolume * event.winner.volume))
      player.play()
      alarmPlayerRef.current = player
      setIsAlarmRinging(true)
      alarmStopRef.current = setTimeout(dismissAlarm, activeSettings.alarmDurationSeconds * 1000)
      return
    }
    const source = sourceForSound(event.winner.sound)
    if (!source) return
    playerRef.current?.remove()
    const player = createAudioPlayer(source)
    player.volume = Math.max(0, Math.min(1, activeSettings.masterVolume * event.winner.volume))
    player.play()
    playerRef.current = player
  }, [dismissAlarm, updateRuntimeState])

  const scheduleNext = useCallback(() => {
    if (!runningRef.current) return
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    const activeProgram = programRef.current
    const activeSettings = settingsRef.current
    const now = Date.now()
    const event = nextProgramEvent(activeProgram, anchorRef.current, now)
    const activeNow = isWithinActiveHours(activeSettings, now)
    const activeAtEvent = isWithinActiveHours(activeSettings, event.at)
    const triggerAt = activeNow && activeAtEvent ? event.at : nextActiveHoursStart(activeSettings, now)
    timeoutRef.current = setTimeout(() => {
      if (!runningRef.current) return
      const firedAt = Date.now()
      if (activeNow && activeAtEvent) playEvent(event.at)
      // When returning to active hours the scheduler only finds the next
      // future event; it deliberately never replays inactive/call-muted cues.
      refreshDisplay()
      scheduleNext()
    }, Math.max(0, triggerAt - firedAtSafe(now)))
  }, [playEvent, refreshDisplay])

  const start = useCallback(async (anchor = Date.now()) => {
    anchorRef.current = anchor
    runningRef.current = true
    setIsRunning(true)
    await setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: false })
    await activateKeepAwakeAsync(KEEP_AWAKE_TAG)
    refreshDisplay()
    rafRef.current = requestAnimationFrame(rafLoop)
    persistSession(muteRef.current, alarmBehaviorRef.current)
    scheduleNext()
  }, [persistSession, rafLoop, refreshDisplay, scheduleNext])

  const stop = useCallback(() => {
    runningRef.current = false
    setIsRunning(false)
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    timeoutRef.current = null
    rafRef.current = null
    dismissAlarm()
    playerRef.current?.remove()
    playerRef.current = null
    deactivateKeepAwake(KEEP_AWAKE_TAG)
    void clearTimerV2Session()
    setDisplay({ mainCountdown: '--:--', nextCueCountdown: '--:--', nextCueLabel: '', progress: 0, position: null, activeHoursPaused: false, activeHoursResumeAt: 0 })
  }, [dismissAlarm])

  const pressAlarm = useCallback(() => {
    const now = Date.now()
    const current = alarmBehaviorRef.current
    const next: AlarmBehavior = current === 'once' && now - lastAlarmPressRef.current < 400
      ? 'locked'
      : current === 'off'
        ? 'once'
        : 'off'
    lastAlarmPressRef.current = now
    updateRuntimeState(muteRef.current, next)
  }, [updateRuntimeState])

  const muteForIterations = useCallback((count: number) => {
    const next = { mutedUntil: 0, iteration: iterationMuteFor(programRef.current, anchorRef.current, Date.now(), count) }
    updateRuntimeState(next, alarmBehaviorRef.current)
  }, [updateRuntimeState])

  const muteForMinutes = useCallback((minutes: number) => {
    const next = { mutedUntil: Date.now() + Math.max(1, Math.min(1_440, Math.round(minutes))) * 60_000 }
    updateRuntimeState(next, alarmBehaviorRef.current)
  }, [updateRuntimeState])

  const clearMute = useCallback(() => updateRuntimeState(emptyRuntimeMute(), alarmBehaviorRef.current), [updateRuntimeState])

  useEffect(() => {
    const subscription = AppState.addEventListener('change', nextState => {
      if (nextState !== 'active' || !runningRef.current) return
      refreshDisplay()
      scheduleNext()
    })
    return () => subscription.remove()
  }, [refreshDisplay, scheduleNext])

  useEffect(() => () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    playerRef.current?.remove()
    alarmPlayerRef.current?.remove()
  }, [])

  return {
    ...display,
    isRunning,
    isAlarmRinging,
    alarmBehavior,
    mute,
    start,
    stop,
    dismissAlarm,
    pressAlarm,
    muteForIterations,
    muteForMinutes,
    clearMute,
  }
}

// Keeps delay calculation explicit and prevents a stale ``now`` closure from
// scheduling a negative timeout after a costly state update.
function firedAtSafe(fallback: number): number {
  const current = Date.now()
  return Number.isFinite(current) ? current : fallback
}
