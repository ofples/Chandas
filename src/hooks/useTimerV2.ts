import { useCallback, useEffect, useRef, useState } from 'react'
import { AppState, Platform } from 'react-native'
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake'
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio'
import * as Haptics from 'expo-haptics'
import type { AlarmBehavior, AppTimerSettings, TimerProgram } from '../types'
import { effectiveAvailabilityForProgram, hasAvailableTime, isWithinActiveHours, nextActiveHoursStart } from '../lib/activeHours'
import { formatCountdown } from '../lib/snapLogic'
import { sourceForSound, soundTitle } from '../lib/soundLibrary'
import { nextProgramEvent, runEndAt, timelinePosition, type TimelinePosition } from '../lib/timeline'
import { alarmBehaviorAfterGesture, emptyRuntimeMute, gateProgramAudio, isFreshScheduledEvent, iterationMuteFor, muteAfterScheduleChange, shouldSurfaceTimerSignal, type RuntimeMuteState } from '../lib/runtimeV2'
import { clearTimerV2Session, saveTimerV2Session } from '../lib/storage'
import { ChandasTimerService, isNativeServiceAvailable, type NativeTimerConfig } from '../native/ChandasTimerService'

const KEEP_AWAKE_TAG = 'chandas-running-v2'
const ALARM_SOURCE = require('../../assets/sounds/alarm.mp3')

/**
 * A wake lock improves the foreground experience, but it is never part of the
 * timer's correctness contract. Web wake-lock requests can remain pending while
 * a preview tab is hidden, and a platform may reject them for policy reasons.
 * Android timing is owned by AlarmManager, so either outcome must not block a
 * session from starting or recovering.
 */
async function activateDisplayWakeLock(): Promise<void> {
  if (Platform.OS === 'web') return
  await activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch(() => undefined)
}

function releaseDisplayWakeLock(): void {
  if (Platform.OS === 'web') return
  void deactivateKeepAwake(KEEP_AWAKE_TAG).catch(() => undefined)
}

export interface TimerV2Display {
  mainCountdown: string
  nextCueCountdown: string
  nextCueLabel: string
  progress: number
  position: TimelinePosition | null
  activeHoursPaused: boolean
  activeHoursResumeAt: number
  runEndsAt: number
  runRemainingMs: number
}

export interface UseTimerV2Return extends TimerV2Display {
  isRunning: boolean
  isAlarmRinging: boolean
  alarmBehavior: AlarmBehavior
  mute: RuntimeMuteState
  start: (restore?: number | { anchor: number; startedAt?: number; endsAt?: number; mute: RuntimeMuteState; alarmBehavior: AlarmBehavior }) => Promise<boolean>
  attachNativeSession: (restore: { anchor: number; startedAt?: number; endsAt?: number; mute: RuntimeMuteState; alarmBehavior: AlarmBehavior }) => Promise<void>
  stop: () => void
  dismissAlarm: () => void
  pressAlarm: () => void
  muteForIterations: (count: number) => void
  muteForMinutes: (minutes: number) => void
  clearMute: () => void
  eventPulse: number
  completionPulse: number
  runtimeInterruption: 'exact-alarm-access' | null
  clearRuntimeInterruption: () => void
  reanchor: (nextProgram: TimerProgram, alignToClock: boolean) => Promise<boolean>
}

function displayFor(program: TimerProgram, settings: AppTimerSettings, anchor: number, startedAt: number, terminalAt: number | null, now: number): TimerV2Display {
  const availability = effectiveAvailabilityForProgram(program, settings.availability)
  const active = isWithinActiveHours(availability, now)
  const endAt = terminalAt ?? 0
  if (!active) {
    return {
      mainCountdown: '--:--',
      nextCueCountdown: '--:--',
      nextCueLabel: 'Paused outside active hours',
      progress: 0,
      position: null,
      activeHoursPaused: true,
      activeHoursResumeAt: nextActiveHoursStart(availability, now),
      runEndsAt: endAt,
      runRemainingMs: endAt ? Math.max(0, endAt - now) : 0,
    }
  }
  const position = timelinePosition(program, anchor, now, startedAt, terminalAt)
  const next = position.nextEvent
  if (!next) {
    return {
      mainCountdown: '00:00', nextCueCountdown: '00:00', nextCueLabel: 'Complete', progress: 1,
      position: null, activeHoursPaused: false, activeHoursResumeAt: 0,
      runEndsAt: endAt, runRemainingMs: 0,
    }
  }
  const mainCountdown = program.mode === 'pattern'
    ? formatCountdown(anchor + (position.cycleIndex + 1) * program.mainMinutes * 60_000 - now)
    : formatCountdown(next.at - now)
  return {
    mainCountdown,
    nextCueCountdown: formatCountdown(next.at - now),
    nextCueLabel: program.mode === 'pattern'
      ? next.winner.kind === 'pattern-main' ? 'Main gong' : program.tracks.find(track => track.id === next.winner.cueId)?.label ?? soundTitle(next.winner.sound)
      : program.steps.find(step => step.id === next.winner.cueId)?.label ?? soundTitle(next.winner.sound),
    progress: position.cycleProgress,
    position,
    activeHoursPaused: false,
    activeHoursResumeAt: 0,
    runEndsAt: endAt,
    runRemainingMs: endAt ? Math.max(0, endAt - now) : 0,
  }
}

function nativeConfigFor(program: TimerProgram, settings: AppTimerSettings, anchor: number, startedAt: number, terminalAt: number | null, alarmModeEnabled = false): NativeTimerConfig {
  // Current Android binaries understand per-track enablement but predate the
  // group switch. Serialize an effective copy so an OTA can safely suppress the
  // whole layer, including after process death, without a native rebuild.
  const nativeProgram: TimerProgram = program.mode === 'pattern' && !program.subBellsEnabled
    ? { ...program, tracks: program.tracks.map(track => ({ ...track, enabled: false })) }
    : program
  const mainMs = program.mode === 'pattern'
    ? program.mainMinutes * 60_000
    : program.steps.reduce((sum, step) => sum + step.durationMinutes * 60_000, 0)
  const availability = effectiveAvailabilityForProgram(program, settings.availability)
  return {
    mainMs,
    subMs: 60_000,
    phase: 0,
    subEnabled: false,
    volume: settings.masterVolume,
    notificationsEnabled: settings.notificationsEnabled,
    focusModeEnabled: settings.focusAutomationEnabled,
    alarmModeEnabled,
    activeHoursEnabled: availability.enabled,
    activeHoursStart: availability.weeklyWindows[0]?.startMinutes ?? 480,
    activeHoursEnd: availability.weeklyWindows[0]?.endMinutes ?? 1_320,
    activeHoursDays: availability.weeklyWindows[0]?.days ?? 0,
    availabilityPolicy: JSON.stringify(availability),
    alarmDurationSeconds: settings.alarmDurationSeconds,
    timerV2Program: JSON.stringify(nativeProgram),
    timerV2Anchor: anchor,
    timerV2StartedAt: startedAt,
    ...(terminalAt ? { timerV2EndsAt: terminalAt } : {}),
  }
}

function alignedAnchorForStart(program: TimerProgram, now: number): number {
  if (program.mode !== 'pattern' || program.alignment.kind !== 'local-clock') return now
  const date = new Date(now)
  const minuteOfDay = date.getHours() * 60 + date.getMinutes()
  const elapsedMinutes = ((minuteOfDay - program.alignment.offsetMinutes) % program.mainMinutes + program.mainMinutes) % program.mainMinutes
  return now - elapsedMinutes * 60_000 - date.getSeconds() * 1_000 - date.getMilliseconds()
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
  const [eventPulse, setEventPulse] = useState(0)
  const [completionPulse, setCompletionPulse] = useState(0)
  const [runtimeInterruption, setRuntimeInterruption] = useState<'exact-alarm-access' | null>(null)
  const [display, setDisplay] = useState<TimerV2Display>({
    mainCountdown: '--:--', nextCueCountdown: '--:--', nextCueLabel: '', progress: 0,
    position: null, activeHoursPaused: false, activeHoursResumeAt: 0, runEndsAt: 0, runRemainingMs: 0,
  })

  const runningRef = useRef(false)
  const anchorRef = useRef(0)
  const startedAtRef = useRef(0)
  const endsAtRef = useRef<number | null>(null)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const refreshIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const playerRef = useRef<AudioPlayer | null>(null)
  const alarmPlayerRef = useRef<AudioPlayer | null>(null)
  const nativeUpdateRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const programRef = useRef(program)
  const settingsRef = useRef(settings)
  const muteRef = useRef(mute)
  const alarmBehaviorRef = useRef<AlarmBehavior>('off')
  const alarmTapTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const alarmTapStartRef = useRef<AlarmBehavior | null>(null)
  const clearRuntimeInterruption = useCallback(() => setRuntimeInterruption(null), [])

  useEffect(() => { programRef.current = program }, [program])
  useEffect(() => { settingsRef.current = settings }, [settings])
  useEffect(() => { muteRef.current = mute }, [mute])
  useEffect(() => { alarmBehaviorRef.current = alarmBehavior }, [alarmBehavior])

  const refreshDisplay = useCallback(() => {
    if (!runningRef.current) return
    setDisplay(displayFor(programRef.current, settingsRef.current, anchorRef.current, startedAtRef.current, endsAtRef.current, Date.now()))
  }, [])

  const persistSession = useCallback((nextMute: RuntimeMuteState, nextAlarm: AlarmBehavior) => {
    if (!runningRef.current) return
    void saveTimerV2Session({
      schemaVersion: 2,
      anchor: anchorRef.current,
      startedAt: startedAtRef.current,
      ...(endsAtRef.current ? { endsAt: endsAtRef.current } : {}),
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
    if (isNativeServiceAvailable) ChandasTimerService.stopAlarm()
    try { alarmPlayerRef.current?.remove() } catch { /* player may already be released */ }
    alarmPlayerRef.current = null
    setIsAlarmRinging(false)
  }, [])

  const playEvent = useCallback((eventAt: number): boolean => {
    const activeProgram = programRef.current
    const activeSettings = settingsRef.current
    const event = nextProgramEvent(activeProgram, anchorRef.current, eventAt - 1, startedAtRef.current, endsAtRef.current)
    if (!event || event.at !== eventAt) return false
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
    if (!gate.shouldPlay) return event.completesRun
    setEventPulse(value => value + 1)

    if (gate.disposition === 'continuous-alarm') {
      dismissAlarm()
      const player = createAudioPlayer(sourceForSound(event.winner.sound) ?? ALARM_SOURCE)
      player.loop = true
      player.volume = Math.max(0, Math.min(1, activeSettings.masterVolume * event.winner.volume))
      player.play()
      alarmPlayerRef.current = player
      setIsAlarmRinging(true)
      return event.completesRun
    }
    const source = sourceForSound(event.winner.sound)
    if (!source) return event.completesRun
    try { playerRef.current?.remove() } catch { /* player may already be released */ }
    const player = createAudioPlayer(source)
    player.volume = Math.max(0, Math.min(1, activeSettings.masterVolume * event.winner.volume))
    player.play()
    playerRef.current = player
    return event.completesRun
  }, [dismissAlarm, updateRuntimeState])

  const finishJsRun = useCallback(() => {
    runningRef.current = false
    setIsRunning(false)
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    if (refreshIntervalRef.current) clearInterval(refreshIntervalRef.current)
    timeoutRef.current = null
    refreshIntervalRef.current = null
    // Runtime controls belong to the completed session. Keeping them armed
    // would make a later Start unexpectedly inherit an old mute/alarm choice.
    const clearedMute = emptyRuntimeMute()
    muteRef.current = clearedMute
    alarmBehaviorRef.current = 'off'
    setMute(clearedMute)
    setAlarmBehavior('off')
    try { alarmPlayerRef.current?.remove() } catch { /* continue to the authoritative native stop */ }
    alarmPlayerRef.current = null
    setIsAlarmRinging(false)
    releaseDisplayWakeLock()
    void clearTimerV2Session()
    setCompletionPulse(value => value + 1)
  }, [])

  const scheduleNext = useCallback(() => {
    if (!runningRef.current) return
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    const activeProgram = programRef.current
    const activeSettings = settingsRef.current
    const now = Date.now()
    let event = nextProgramEvent(activeProgram, anchorRef.current, now, startedAtRef.current, endsAtRef.current)
    if (!event) {
      finishJsRun()
      return
    }
    const availability = effectiveAvailabilityForProgram(activeProgram, activeSettings.availability)
    const activeNow = isWithinActiveHours(availability, now)
    const activeAtEvent = isWithinActiveHours(availability, event.at)
    // When we are active now but the cue itself is outside the window, search
    // from that skipped cue. Searching from `now` would simply return `now`
    // and create an immediate rescheduling loop.
    const resumesAt = nextActiveHoursStart(availability, activeNow ? event.at : now)
    if (!event.completesRun && (!activeNow || !activeAtEvent) && endsAtRef.current !== null && resumesAt >= endsAtRef.current) {
      // Availability only gates sound. It must never postpone a bounded run's
      // terminal event beyond its fixed deadline.
      event = nextProgramEvent(activeProgram, anchorRef.current, endsAtRef.current - 1, startedAtRef.current, endsAtRef.current) ?? event
    }
    const triggerAt = event.completesRun || (activeNow && activeAtEvent) ? event.at : resumesAt
    timeoutRef.current = setTimeout(() => {
      if (!runningRef.current) return
      const firedAt = Date.now()
      const firedAvailability = effectiveAvailabilityForProgram(programRef.current, settingsRef.current.availability)
      const availableWhenFired = event.completesRun ? isWithinActiveHours(firedAvailability, firedAt) : activeNow && activeAtEvent
      const shouldPlay = availableWhenFired && isFreshScheduledEvent(event.at, firedAt)
      const completed = shouldPlay ? playEvent(event.at) : event.completesRun
      if (completed) {
        finishJsRun()
        return
      }
      // When returning to active hours the scheduler only finds the next
      // future event; it deliberately never replays inactive/call-muted cues.
      refreshDisplay()
      scheduleNext()
    }, Math.max(0, triggerAt - firedAtSafe(now)))
  }, [finishJsRun, playEvent, refreshDisplay])

  const start = useCallback(async (restore?: number | { anchor: number; startedAt?: number; endsAt?: number; mute: RuntimeMuteState; alarmBehavior: AlarmBehavior }) => {
    setRuntimeInterruption(null)
    const restored = typeof restore === 'number' ? undefined : restore
    const acceptedAt = Date.now()
    const anchor = typeof restore === 'number' ? restore : restored?.anchor ?? alignedAnchorForStart(programRef.current, acceptedAt)
    const startedAt = restored?.startedAt ?? (typeof restore === 'number' ? restore : acceptedAt)
    const endsAt = restored?.endsAt && restored.endsAt > 0 ? restored.endsAt : runEndAt(programRef.current, anchor, startedAt)
    if (!hasAvailableTime(effectiveAvailabilityForProgram(programRef.current, settingsRef.current.availability), acceptedAt)) return false
    if (nextProgramEvent(programRef.current, anchor, acceptedAt, startedAt, endsAt) === null) return false
    if (isNativeServiceAvailable && !ChandasTimerService.canScheduleExactAlarms()) return false
    await setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: false })
    await activateDisplayWakeLock()
    const nativeConfig = nativeConfigFor(programRef.current, settingsRef.current, anchor, startedAt, endsAt, restored?.alarmBehavior === 'locked' || (!restored && alarmBehaviorRef.current === 'locked'))
    if (restored) {
      nativeConfig.alarmOnceArmed = restored.alarmBehavior === 'once'
      nativeConfig.mutedUntil = restored.mute.mutedUntil
      nativeConfig.mutedIterationEndId = restored.mute.iteration?.endsAtLogicalId
      nativeConfig.mutedIterationEndAt = restored.mute.iteration?.endsAt
      nativeConfig.mutedIterationCount = restored.mute.iteration?.iterations
    }
    if (isNativeServiceAvailable && !ChandasTimerService.start(nativeConfig)) {
      releaseDisplayWakeLock()
      return false
    }
    anchorRef.current = anchor
    startedAtRef.current = startedAt
    endsAtRef.current = endsAt
    if (restored) updateRuntimeState(restored.mute, restored.alarmBehavior)
    runningRef.current = true
    setIsRunning(true)
    refreshDisplay()
    if (refreshIntervalRef.current) clearInterval(refreshIntervalRef.current)
    refreshIntervalRef.current = setInterval(refreshDisplay, 250)
    persistSession(restored?.mute ?? muteRef.current, restored?.alarmBehavior ?? alarmBehaviorRef.current)
    if (!isNativeServiceAvailable) scheduleNext()
    return true
  }, [persistSession, refreshDisplay, scheduleNext, updateRuntimeState])

  const attachNativeSession = useCallback(async (restore: { anchor: number; startedAt?: number; endsAt?: number; mute: RuntimeMuteState; alarmBehavior: AlarmBehavior }) => {
    anchorRef.current = restore.anchor
    startedAtRef.current = restore.startedAt ?? restore.anchor
    endsAtRef.current = restore.endsAt && restore.endsAt > 0 ? restore.endsAt : runEndAt(programRef.current, restore.anchor, restore.startedAt ?? restore.anchor)
    runningRef.current = true
    updateRuntimeState(restore.mute, restore.alarmBehavior)
    setIsRunning(true)
    setIsAlarmRinging(ChandasTimerService.isRinging())
    await setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: false })
    await activateDisplayWakeLock()
    refreshDisplay()
    if (refreshIntervalRef.current) clearInterval(refreshIntervalRef.current)
    refreshIntervalRef.current = setInterval(refreshDisplay, 250)
  }, [refreshDisplay, updateRuntimeState])

  const stop = useCallback(() => {
    runningRef.current = false
    setIsRunning(false)
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    if (refreshIntervalRef.current) clearInterval(refreshIntervalRef.current)
    if (nativeUpdateRef.current) clearTimeout(nativeUpdateRef.current)
    if (alarmTapTimeoutRef.current) clearTimeout(alarmTapTimeoutRef.current)
    alarmTapTimeoutRef.current = null
    alarmTapStartRef.current = null
    timeoutRef.current = null
    refreshIntervalRef.current = null
    // A full stop goes directly to the authoritative native stop. Calling the
    // narrower alarm-dismiss path first allowed an Android window-cleanup
    // exception to prevent the timer itself from ever being stopped.
    if (isNativeServiceAvailable) ChandasTimerService.stop()
    try { alarmPlayerRef.current?.remove() } catch { /* continue local teardown */ }
    alarmPlayerRef.current = null
    setIsAlarmRinging(false)
    try { playerRef.current?.remove() } catch { /* continue local teardown */ }
    playerRef.current = null
    const clearedMute = emptyRuntimeMute()
    muteRef.current = clearedMute
    alarmBehaviorRef.current = 'off'
    setMute(clearedMute)
    setAlarmBehavior('off')
    releaseDisplayWakeLock()
    void clearTimerV2Session()
    setDisplay({ mainCountdown: '--:--', nextCueCountdown: '--:--', nextCueLabel: '', progress: 0, position: null, activeHoursPaused: false, activeHoursResumeAt: 0, runEndsAt: 0, runRemainingMs: 0 })
  }, [])

  const applyAlarmBehavior = useCallback((current: AlarmBehavior, next: AlarmBehavior) => {
    updateRuntimeState(muteRef.current, next)
    if (isNativeServiceAvailable && runningRef.current) {
      if ((current === 'once') !== (next === 'once')) ChandasTimerService.toggleAlarmOnce()
      ChandasTimerService.update({ alarmModeEnabled: next === 'locked' })
    }
    const feedback = next === 'locked' ? Haptics.ImpactFeedbackStyle.Medium : Haptics.ImpactFeedbackStyle.Light
    void Haptics.impactAsync(feedback).catch(() => undefined)
  }, [updateRuntimeState])

  const pressAlarm = useCallback(() => {
    if (alarmTapTimeoutRef.current) {
      clearTimeout(alarmTapTimeoutRef.current)
      alarmTapTimeoutRef.current = null
      const startedFrom = alarmTapStartRef.current ?? alarmBehaviorRef.current
      alarmTapStartRef.current = null
      const current = alarmBehaviorRef.current
      applyAlarmBehavior(current, alarmBehaviorAfterGesture(startedFrom, 'double'))
      return
    }

    const startedFrom = alarmBehaviorRef.current
    alarmTapStartRef.current = startedFrom
    applyAlarmBehavior(startedFrom, alarmBehaviorAfterGesture(startedFrom, 'single'))
    alarmTapTimeoutRef.current = setTimeout(() => {
      alarmTapTimeoutRef.current = null
      alarmTapStartRef.current = null
    }, 400)
  }, [applyAlarmBehavior])

  const muteForIterations = useCallback((count: number) => {
    const next = { mutedUntil: 0, iteration: iterationMuteFor(programRef.current, anchorRef.current, Date.now(), count) }
    updateRuntimeState(next, alarmBehaviorRef.current)
    if (isNativeServiceAvailable && runningRef.current) ChandasTimerService.muteForIterations(count)
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined)
  }, [updateRuntimeState])

  const muteForMinutes = useCallback((minutes: number) => {
    const next = { mutedUntil: Date.now() + Math.max(1, Math.min(1_440, Math.round(minutes))) * 60_000 }
    updateRuntimeState(next, alarmBehaviorRef.current)
    if (isNativeServiceAvailable && runningRef.current) ChandasTimerService.muteForMinutes(minutes)
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined)
  }, [updateRuntimeState])

  const clearMute = useCallback(() => {
    updateRuntimeState(emptyRuntimeMute(), alarmBehaviorRef.current)
    if (isNativeServiceAvailable && runningRef.current) ChandasTimerService.clearMute()
    void Haptics.selectionAsync().catch(() => undefined)
  }, [updateRuntimeState])

  /** Restarts the live timeline without stopping the session or losing runtime controls. */
  const reanchor = useCallback(async (nextProgram: TimerProgram, alignToClock: boolean) => {
    if (!runningRef.current) return false
    if (isNativeServiceAvailable && !ChandasTimerService.canScheduleExactAlarms()) return false
    const anchor = alignToClock ? alignedAnchorForStart(nextProgram, Date.now()) : Date.now()
    const startedAt = Date.now()
    const endsAt = runEndAt(nextProgram, anchor, startedAt)
    const currentMute = muteRef.current
    // Reanchoring changes cycle identities. Preserve timestamp mute, but clear
    // cycle mute so its promised final boundary cannot silently move.
    const nextMute = muteAfterScheduleChange(currentMute)
    const nextAlarm = alarmBehaviorRef.current
    const config = nativeConfigFor(nextProgram, settingsRef.current, anchor, startedAt, endsAt, nextAlarm === 'locked')
    config.alarmOnceArmed = nextAlarm === 'once'
    config.mutedUntil = nextMute.mutedUntil
    config.mutedIterationEndId = nextMute.iteration?.endsAtLogicalId
    config.mutedIterationEndAt = nextMute.iteration?.endsAt
    config.mutedIterationCount = nextMute.iteration?.iterations
    dismissAlarm()
    if (isNativeServiceAvailable && !ChandasTimerService.start(config)) return false
    programRef.current = nextProgram
    anchorRef.current = anchor
    startedAtRef.current = startedAt
    endsAtRef.current = endsAt
    updateRuntimeState(nextMute, nextAlarm)
    setDisplay(displayFor(nextProgram, settingsRef.current, anchor, startedAt, endsAt, Date.now()))
    void saveTimerV2Session({ schemaVersion: 2, anchor, startedAt, ...(endsAt ? { endsAt } : {}), program: nextProgram, mute: nextMute, alarmBehavior: nextAlarm })
    if (!isNativeServiceAvailable) scheduleNext()
    return true
  }, [dismissAlarm, scheduleNext, updateRuntimeState])

  useEffect(() => {
    const subscription = AppState.addEventListener('change', nextState => {
      if (nextState !== 'active' || !runningRef.current) return
      if (isNativeServiceAvailable) {
        const native = ChandasTimerService.getState()
        if (!native.active) {
          stop()
          return
        }
        if (native.timerV2Anchor && native.timerV2Anchor > 0) anchorRef.current = native.timerV2Anchor
        const nextMute: RuntimeMuteState = native.mutedIterationEndId && native.mutedIterationEndAt
          ? { mutedUntil: native.mutedUntil ?? 0, iteration: { endsAtLogicalId: native.mutedIterationEndId, endsAt: native.mutedIterationEndAt, iterations: Math.max(1, native.mutedIterationsRemaining ?? 1) } }
          : { mutedUntil: native.mutedUntil ?? 0 }
        const nextAlarm: AlarmBehavior = native.alarmModeEnabled ? 'locked' : native.alarmOnceArmed ? 'once' : 'off'
        updateRuntimeState(nextMute, nextAlarm)
        setIsAlarmRinging(native.ringing)
      }
      refreshDisplay()
      if (!isNativeServiceAvailable) scheduleNext()
    })
    return () => subscription.remove()
  }, [refreshDisplay, scheduleNext, stop, updateRuntimeState])

  useEffect(() => {
    if (!isNativeServiceAvailable) return
    setIsAlarmRinging(ChandasTimerService.isRinging())
    const listener = ChandasTimerService.addAlarmListener(setIsAlarmRinging)
    return () => listener?.remove()
  }, [])

  useEffect(() => {
    if (!isNativeServiceAvailable) return
    const listener = ChandasTimerService.addTimerStateListener(state => {
      if (!runningRef.current) return
      if (!state.exactTimingAvailable) {
        setRuntimeInterruption('exact-alarm-access')
        stop()
        return
      }
      if (!state.active) {
        stop()
        return
      }
      if (state.timerV2Anchor > 0 && state.timerV2Anchor !== anchorRef.current) {
        anchorRef.current = state.timerV2Anchor
        persistSession(muteRef.current, alarmBehaviorRef.current)
        refreshDisplay()
      }
    })
    return () => listener?.remove()
  }, [persistSession, refreshDisplay, stop])

  useEffect(() => {
    if (!isNativeServiceAvailable) return
    const listener = ChandasTimerService.addControlListener(state => {
      const nextMute: RuntimeMuteState = state.mutedIterationEndId && state.mutedIterationEndAt
        ? { mutedUntil: state.mutedUntil, iteration: { endsAtLogicalId: state.mutedIterationEndId, endsAt: state.mutedIterationEndAt, iterations: Math.max(1, state.mutedIterationsRemaining) } }
        : { mutedUntil: state.mutedUntil }
      const nextAlarm = alarmBehaviorRef.current === 'locked' ? 'locked' : state.alarmOnceArmed ? 'once' : 'off'
      updateRuntimeState(nextMute, nextAlarm)
    })
    return () => listener?.remove()
  }, [updateRuntimeState])

  useEffect(() => {
    if (!isNativeServiceAvailable) return
    const listener = ChandasTimerService.addTimerEventListener(event => {
      if (shouldSurfaceTimerSignal(event, Date.now(), AppState.currentState === 'active')) setEventPulse(value => value + 1)
      if (event.completesRun) setCompletionPulse(value => value + 1)
    })
    return () => listener?.remove()
  }, [])

  useEffect(() => {
    if (!runningRef.current) return
    // Keep the recoverable working program current even on the web fallback;
    // native Android additionally receives the debounced authoritative update.
    persistSession(muteRef.current, alarmBehaviorRef.current)
    if (!isNativeServiceAvailable) return
    if (nativeUpdateRef.current) clearTimeout(nativeUpdateRef.current)
    nativeUpdateRef.current = setTimeout(() => {
      nativeUpdateRef.current = null
      if (runningRef.current) ChandasTimerService.update(nativeConfigFor(programRef.current, settingsRef.current, anchorRef.current, startedAtRef.current, endsAtRef.current, alarmBehaviorRef.current === 'locked'))
    }, 120)
    return () => {
      if (nativeUpdateRef.current) clearTimeout(nativeUpdateRef.current)
      nativeUpdateRef.current = null
    }
  }, [persistSession, program, settings])

  useEffect(() => () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    if (refreshIntervalRef.current) clearInterval(refreshIntervalRef.current)
    if (nativeUpdateRef.current) clearTimeout(nativeUpdateRef.current)
    if (alarmTapTimeoutRef.current) clearTimeout(alarmTapTimeoutRef.current)
    alarmTapStartRef.current = null
    playerRef.current?.remove()
    alarmPlayerRef.current?.remove()
    releaseDisplayWakeLock()
  }, [])

  return {
    ...display,
    isRunning,
    isAlarmRinging,
    alarmBehavior,
    mute,
    start,
    attachNativeSession,
    stop,
    dismissAlarm,
    pressAlarm,
    muteForIterations,
    muteForMinutes,
    clearMute,
    eventPulse,
    completionPulse,
    runtimeInterruption,
    clearRuntimeInterruption,
    reanchor,
  }
}

// Keeps delay calculation explicit and prevents a stale ``now`` closure from
// scheduling a negative timeout after a costly state update.
function firedAtSafe(fallback: number): number {
  const current = Date.now()
  return Number.isFinite(current) ? current : fallback
}
