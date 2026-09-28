import { useCallback, useEffect, useRef, useState } from 'react'
import { AppState, Platform } from 'react-native'
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake'
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio'
import type { AlarmBehavior, AppTimerSettings, BuiltInSoundId, SoundRef, TimerProgram, WorkingProgramState } from '../types'
import { effectiveAvailabilityForProgram, hasAvailableTime, isCueAllowedByActiveHours, isCueDeliveryAllowedByActiveHours, isWithinActiveHours, nextActiveHoursStart } from '../lib/activeHours'
import { formatCountdown } from '../lib/snapLogic'
import { sourceForSound, soundTitle } from '../lib/soundLibrary'
import { boundedRunProgress, nextProgramEvent, programCycleDurationMs, runEndAt, sequenceSkipTarget, timelinePosition, type TimelinePosition } from '../lib/timeline'
import { alarmBehaviorAfterGesture, emptyRuntimeMute, gateProgramAudio, isFreshScheduledEvent, iterationMuteFor, muteAfterScheduleChange, shouldSurfaceTimerSignal, timestampMuteForSeconds, type RuntimeMuteState } from '../lib/runtimeV2'
import { clearTimerV2Session, saveTimerV2Session } from '../lib/storage'
import { ChandasTimerService, isNativeServiceAvailable, type NativeTimerConfig } from '../native/ChandasTimerService'
import { cueHapticProfile, selectionHaptic, setAppHapticsEnabled, startRepeatingAlarmHaptic, stopRepeatingAlarmHaptic, tapHaptic, timerCueHaptic } from '../lib/haptics'
import { alignedClockAnchor } from '../lib/clockAlignment'
import { cueSounds, patternDurationSeconds, sequenceStepDurationSeconds } from '../lib/timerV2'
import { nextAudibleProgramEvent, programEventLabel } from '../lib/upcoming-events'

const KEEP_AWAKE_TAG = 'chandas-running-v2'
const ALARM_SOURCE = require('../../assets/sounds/alarm.mp3')
const NATIVE_NOTIFICATION_PRESENTATION = JSON.stringify({
  runningTitle: 'Chandas',
  nextCueAt: 'Next cue at {time}',
  resumesAt: 'Resumes at {time}',
  sessionEndsAt: 'Session ends at {time}',
  stopTimerAction: 'Stop timer',
  mainEventTitle: 'Chandas Gong',
  bellEventTitle: 'Chandas Bell',
  cueEventTitle: 'Chandas Cue',
  eventBody: 'Timer interval reached',
  completionEventTitle: 'Session complete',
  completionEventBody: 'Final bell',
  alarmTitle: "Chandas — Time's up",
  alarmBody: 'Alarm is ringing',
  stopAlarmAction: 'Stop alarm',
})

/**
 * A wake lock improves the foreground experience, but it is never part of the
 * timer's correctness contract. Web wake-lock requests can remain pending while
 * a preview tab is hidden, and a platform may reject them for policy reasons.
 * Android timing is owned by AlarmManager, so either outcome must not block a
 * session from starting or recovering.
 */
async function activateDisplayWakeLock(): Promise<void> {
  if (Platform.OS === 'web' || AppState.currentState !== 'active') return
  await activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch(() => undefined)
  if (AppState.currentState !== 'active') releaseDisplayWakeLock()
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
  nextAudibleAt: number
  nextAudibleLabel: string
  runEndsAt: number
  runRemainingMs: number
  runProgress: number
}

export interface UseTimerV2Return extends TimerV2Display {
  isRunning: boolean
  isPaused: boolean
  isAlarmRinging: boolean
  alarmBehavior: AlarmBehavior
  mute: RuntimeMuteState
  start: (restore?: number | { anchor: number; startedAt?: number; endsAt?: number; pausedAt?: number; randomSeed?: number; mute: RuntimeMuteState; alarmBehavior: AlarmBehavior; soundState?: { sequence: Record<string, number>; randomPrevious: Record<string, number> } }) => Promise<boolean>
  attachNativeSession: (restore: { anchor: number; startedAt?: number; endsAt?: number; pausedAt?: number; randomSeed?: number; mute: RuntimeMuteState; alarmBehavior: AlarmBehavior; soundState?: { sequence: Record<string, number>; randomPrevious: Record<string, number> } }) => Promise<void>
  /** False means Android still reports an authoritative live schedule. */
  stop: () => boolean
  dismissAlarm: () => void
  pressAlarm: () => void
  muteForIterations: (count: number) => void
  muteForMinutes: (minutes: number) => void
  muteForSeconds: (seconds: number) => void
  clearMute: () => void
  eventPulse: number
  completionPulse: number
  runtimeInterruption: 'exact-alarm-access' | null
  clearRuntimeInterruption: () => void
  setPaused: (paused: boolean) => boolean
  skipSequenceStep: (direction: 'next' | 'previous') => boolean
  reanchor: (nextProgram: TimerProgram, alignToClock: boolean, nextSettings?: AppTimerSettings, nextSourcePreset?: WorkingProgramState['sourcePreset']) => Promise<boolean>
}

export function timerV2DisplayFor(program: TimerProgram, settings: AppTimerSettings, mute: RuntimeMuteState, anchor: number, startedAt: number, terminalAt: number | null, now: number, randomSeed = anchor): TimerV2Display {
  const availability = effectiveAvailabilityForProgram(program, settings.availability)
  const active = isWithinActiveHours(availability, now)
  const endAt = terminalAt ?? 0
  const muteEndsAt = Math.max(mute.mutedUntil, mute.iteration?.endsAt ?? 0)
  const runtimeMuted = mute.mutedUntil > now || Boolean(mute.iteration)
  const nextAudible = settings.masterVolume > 0 && (!active || runtimeMuted)
    ? nextAudibleProgramEvent(program, availability, anchor, Math.max(now, muteEndsAt > now ? muteEndsAt - 1 : now), startedAt, terminalAt, event => event.winner.volume > 0, randomSeed)
    : null
  const audibleFields = { nextAudibleAt: nextAudible?.at ?? 0, nextAudibleLabel: nextAudible ? programEventLabel(program, nextAudible) : '' }
  if (!active) {
    return {
      mainCountdown: '--:--',
      nextCueCountdown: '--:--',
      nextCueLabel: 'Paused outside active hours',
      progress: 0,
      position: null,
      activeHoursPaused: true,
      activeHoursResumeAt: nextActiveHoursStart(availability, now),
      ...audibleFields,
      runEndsAt: endAt,
      runRemainingMs: endAt ? Math.max(0, endAt - now) : 0,
      runProgress: boundedRunProgress(startedAt, terminalAt, now),
    }
  }
  const position = timelinePosition(program, anchor, now, startedAt, terminalAt, randomSeed)
  const next = position.nextEvent
  if (!next) {
    return {
      mainCountdown: '00:00', nextCueCountdown: '00:00', nextCueLabel: 'Complete', progress: 1,
      position: null, activeHoursPaused: false, activeHoursResumeAt: 0,
      ...audibleFields,
      runEndsAt: endAt, runRemainingMs: 0,
      runProgress: endAt ? 1 : 0,
    }
  }
  const mainCountdown = program.mode === 'pattern'
    ? formatCountdown(anchor + (position.cycleIndex + 1) * patternDurationSeconds(program) * 1_000 - now)
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
    ...audibleFields,
    runEndsAt: endAt,
    runRemainingMs: endAt ? Math.max(0, endAt - now) : 0,
    runProgress: boundedRunProgress(startedAt, terminalAt, now),
  }
}

function nativeConfigFor(program: TimerProgram, settings: AppTimerSettings, anchor: number, startedAt: number, terminalAt: number | null, alarmModeEnabled = false, randomSeed = anchor): NativeTimerConfig {
  // Current Android binaries understand per-track enablement but predate the
  // group switch. Serialize an effective copy so an OTA can safely suppress the
  // whole layer, including after process death, without a native rebuild.
  const nativeProgram: TimerProgram = program.mode === 'pattern' && !program.subBellsEnabled
    ? { ...program, tracks: program.tracks.map(track => ({ ...track, enabled: false })) }
    : program
  const mainMs = program.mode === 'pattern'
    ? patternDurationSeconds(program) * 1_000
    : program.steps.reduce((sum, step) => sum + sequenceStepDurationSeconds(step) * 1_000, 0)
  const availability = effectiveAvailabilityForProgram(program, settings.availability)
  const capabilities = ChandasTimerService.getCapabilities()
  return {
    mainMs,
    subMs: 60_000,
    phase: 0,
    subEnabled: false,
    volume: settings.masterVolume,
    alarmSoundId: settings.alarmSound.kind === 'builtin' ? settings.alarmSound.id : settings.alarmSound.uri,
    ...(capabilities?.supportsAlarmVolume === true ? { alarmVolume: settings.alarmVolume } : {}),
    ...(capabilities?.supportsHapticProfiles === true ? {
      hapticsEnabled: settings.haptics.enabled,
      mainHapticPattern: settings.haptics.main.pattern,
      mainHapticStrength: settings.haptics.main.strength,
      subHapticPattern: settings.haptics.subBell.pattern,
      subHapticStrength: settings.haptics.subBell.strength,
      alarmHapticPattern: settings.haptics.alarm.pattern,
      alarmHapticStrength: settings.haptics.alarm.strength,
    } : {}),
    notificationsEnabled: settings.notificationsEnabled,
    liveCountdownEnabled: settings.liveCountdownEnabled,
    notificationPresentation: NATIVE_NOTIFICATION_PRESENTATION,
    muteDuringCallsEnabled: settings.muteDuringCallsEnabled,
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
    timerV2RandomSeed: randomSeed,
    ...(terminalAt ? { timerV2EndsAt: terminalAt } : {}),
  }
}

function builtInSoundsFor(program: TimerProgram, alarmSound: SoundRef): BuiltInSoundId[] {
  const ids = new Set<BuiltInSoundId>()
  const add = (sound: SoundRef | undefined) => {
    if (sound?.kind === 'builtin') ids.add(sound.id)
  }
  const addCue = (cue: { sound: SoundRef; sounds?: SoundRef[] } | undefined) => cueSounds(cue ?? { sound: { kind: 'builtin', id: 'clear-bell' } }).forEach(add)
  if (program.mode === 'pattern') {
    addCue(program.mainCue)
    program.tracks.forEach(addCue)
  } else {
    program.steps.forEach(addCue)
  }
  addCue(program.completionCue ?? undefined)
  add(alarmSound)
  return [...ids]
}

function requiresExactSubBellRuntime(program: TimerProgram): boolean {
  return program.mode === 'pattern'
    && program.subBellsEnabled
    && program.tracks.some(track => track.enabled && (typeof track.cadenceSeconds === 'number' || Array.isArray(track.selectedOffsetsSeconds)))
}

function supportsProgram(program: TimerProgram): boolean {
  if (!isNativeServiceAvailable) return true
  const capabilities = ChandasTimerService.getCapabilities()
  if (capabilities === null || capabilities.programSchemaMin > program.schemaVersion || capabilities.programSchemaMax < program.schemaVersion) return false
  const cues = program.mode === 'pattern' ? [program.mainCue, ...program.tracks, program.completionCue] : [...program.steps, program.completionCue]
  if (capabilities.supportsUnlimitedSounds !== true && cues.some(cue => (cue?.sounds?.length ?? 0) > 8)) return false
  if (program.mode === 'pattern' && capabilities.supportsRandomRepeat !== true && program.tracks.some(track => !!track.randomRepeat)) return false
  if (program.mode === 'sequence' && capabilities.supportsStepAlarms !== true && program.steps.some(step => step.alarmEnabled)) return false
  return true
}

function alignedAnchorForStart(program: TimerProgram, now: number): number {
  if (program.alignment.kind !== 'local-clock') return now
  return alignedClockAnchor(programCycleDurationMs(program) / 1_000, program.alignment.offsetMinutes, now)
}

/**
 * Web/JS fallback for the V2 timeline. Android replaces this schedule with the
 * exact-alarm native service once that service receives the V2 program record.
 */
export function useTimerV2(program: TimerProgram, settings: AppTimerSettings, sourcePreset?: WorkingProgramState['sourcePreset']): UseTimerV2Return {
  const [isRunning, setIsRunning] = useState(false)
  const [isPaused, setIsPaused] = useState(false)
  const [isAlarmRinging, setIsAlarmRinging] = useState(false)
  const [alarmBehavior, setAlarmBehavior] = useState<AlarmBehavior>('off')
  const [mute, setMute] = useState<RuntimeMuteState>(emptyRuntimeMute())
  const [eventPulse, setEventPulse] = useState(0)
  const [completionPulse, setCompletionPulse] = useState(0)
  const [runtimeInterruption, setRuntimeInterruption] = useState<'exact-alarm-access' | null>(null)
  const [display, setDisplay] = useState<TimerV2Display>({
    mainCountdown: '--:--', nextCueCountdown: '--:--', nextCueLabel: '', progress: 0,
    position: null, activeHoursPaused: false, activeHoursResumeAt: 0, nextAudibleAt: 0, nextAudibleLabel: '', runEndsAt: 0, runRemainingMs: 0, runProgress: 0,
  })

  const runningRef = useRef(false)
  const anchorRef = useRef(0)
  const randomSeedRef = useRef(0)
  const startedAtRef = useRef(0)
  const endsAtRef = useRef<number | null>(null)
  const pausedAtRef = useRef<number | null>(null)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const refreshIntervalRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const playerRef = useRef<AudioPlayer | null>(null)
  const alarmPlayerRef = useRef<AudioPlayer | null>(null)
  const nativeUpdateRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const nativeUpdateGenerationRef = useRef(0)
  const programRef = useRef(program)
  const settingsRef = useRef(settings)
  const sourcePresetRef = useRef(sourcePreset)
  const muteRef = useRef(mute)
  const alarmBehaviorRef = useRef<AlarmBehavior>('off')
  const alarmTapTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const alarmTapStartRef = useRef<AlarmBehavior | null>(null)
  const reanchorRequestRef = useRef(0)
  const cueSoundCursorRef = useRef(new Map<string, number>())
  const previousCueSoundRef = useRef(new Map<string, number>())
  const clearRuntimeInterruption = useCallback(() => setRuntimeInterruption(null), [])

  useEffect(() => { programRef.current = program }, [program])
  useEffect(() => { settingsRef.current = settings }, [settings])
  useEffect(() => { sourcePresetRef.current = sourcePreset }, [sourcePreset])
  useEffect(() => { setAppHapticsEnabled(settings.haptics.enabled) }, [settings.haptics.enabled])
  useEffect(() => { muteRef.current = mute }, [mute])
  useEffect(() => { alarmBehaviorRef.current = alarmBehavior }, [alarmBehavior])

  const refreshDisplay = useCallback(() => {
    if (!runningRef.current) return
    setDisplay(timerV2DisplayFor(programRef.current, settingsRef.current, muteRef.current, anchorRef.current, startedAtRef.current, endsAtRef.current, pausedAtRef.current ?? Date.now(), randomSeedRef.current || anchorRef.current))
  }, [])

  const scheduleDisplayTick = useCallback(() => {
    if (refreshIntervalRef.current) clearTimeout(refreshIntervalRef.current)
    refreshIntervalRef.current = null
    if (!runningRef.current || pausedAtRef.current !== null || AppState.currentState !== 'active') return
    const delay = 1_000 - (Date.now() % 1_000) + 12
    refreshIntervalRef.current = setTimeout(() => {
      refreshIntervalRef.current = null
      refreshDisplay()
      scheduleDisplayTick()
    }, delay)
  }, [refreshDisplay])

  const persistSession = useCallback((nextMute: RuntimeMuteState, nextAlarm: AlarmBehavior) => {
    if (!runningRef.current) return
    void saveTimerV2Session({
      schemaVersion: 2,
      anchor: anchorRef.current,
      randomSeed: randomSeedRef.current || anchorRef.current,
      startedAt: startedAtRef.current,
      ...(endsAtRef.current ? { endsAt: endsAtRef.current } : {}),
      ...(pausedAtRef.current ? { pausedAt: pausedAtRef.current } : {}),
      program: programRef.current,
      mute: nextMute,
      alarmBehavior: nextAlarm,
      sourcePreset: sourcePresetRef.current,
      soundState: { sequence: Object.fromEntries(cueSoundCursorRef.current), randomPrevious: Object.fromEntries(previousCueSoundRef.current) },
      settings: settingsRef.current,
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
    stopRepeatingAlarmHaptic()
    try { alarmPlayerRef.current?.remove() } catch { /* player may already be released */ }
    alarmPlayerRef.current = null
    setIsAlarmRinging(false)
  }, [])

  const playEvent = useCallback((eventAt: number): boolean => {
    const activeProgram = programRef.current
    const activeSettings = settingsRef.current
    const event = nextProgramEvent(activeProgram, anchorRef.current, eventAt - 1, startedAtRef.current, endsAtRef.current, randomSeedRef.current || anchorRef.current)
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
      startRepeatingAlarmHaptic(activeSettings.haptics)
      const player = createAudioPlayer(sourceForSound(activeSettings.alarmSound) ?? ALARM_SOURCE)
      player.loop = true
      player.volume = Math.max(0, Math.min(1, activeSettings.masterVolume * activeSettings.alarmVolume))
      player.play()
      alarmPlayerRef.current = player
      setIsAlarmRinging(true)
      return event.completesRun
    }
    if (activeSettings.haptics.enabled && event.winner.hapticOverride !== 'off') {
      if (event.winner.hapticOverride) cueHapticProfile(event.winner.hapticOverride)
      else timerCueHaptic(event.boundary, activeSettings.haptics)
    }
    const sounds = event.winner.sounds?.length ? event.winner.sounds : [event.winner.sound]
    let sound = sounds[0]
    let selectedIndex: number | null = null
    if (sounds.length > 1 && event.winner.soundMode === 'random') {
      const previous = previousCueSoundRef.current.get(event.winner.cueId)
      const choices = sounds.map((_, index) => index).filter(index => index !== previous)
      const selected = choices[Math.floor(Math.random() * choices.length)]
      sound = sounds[selected]
      selectedIndex = selected
    } else if (sounds.length > 1 && event.winner.soundMode === 'sequence') {
      const index = cueSoundCursorRef.current.get(event.winner.cueId) ?? 0
      sound = sounds[index % sounds.length]
      selectedIndex = index % sounds.length
    }
    const source = sourceForSound(sound)
    if (!source) return event.completesRun
    try { playerRef.current?.remove() } catch { /* player may already be released */ }
    const player = createAudioPlayer(source)
    player.volume = Math.max(0, Math.min(1, activeSettings.masterVolume * event.winner.volume))
    player.play()
    playerRef.current = player
    if (selectedIndex !== null && event.winner.soundMode === 'random') previousCueSoundRef.current.set(event.winner.cueId, selectedIndex)
    if (selectedIndex !== null && event.winner.soundMode === 'sequence') cueSoundCursorRef.current.set(event.winner.cueId, (selectedIndex + 1) % sounds.length)
    persistSession(muteRef.current, alarmBehaviorRef.current)
    return event.completesRun
  }, [dismissAlarm, persistSession, updateRuntimeState])

  const finishJsRun = useCallback(() => {
    runningRef.current = false
    setIsRunning(false)
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    if (refreshIntervalRef.current) clearTimeout(refreshIntervalRef.current)
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
    stopRepeatingAlarmHaptic()
    setIsAlarmRinging(false)
    releaseDisplayWakeLock()
    void clearTimerV2Session()
    setCompletionPulse(value => value + 1)
  }, [])

  const scheduleNext = useCallback(() => {
    if (!runningRef.current) return
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    if (pausedAtRef.current !== null) return
    const activeProgram = programRef.current
    const activeSettings = settingsRef.current
    const now = Date.now()
    let event = nextProgramEvent(activeProgram, anchorRef.current, now, startedAtRef.current, endsAtRef.current, randomSeedRef.current || anchorRef.current)
    if (!event) {
      finishJsRun()
      return
    }
    const availability = effectiveAvailabilityForProgram(activeProgram, activeSettings.availability)
    const activeNow = isWithinActiveHours(availability, now)
    const activeAtEvent = isCueAllowedByActiveHours(availability, event.at)
    // When we are active now but the cue itself is outside the window, search
    // from that skipped cue. Searching from `now` would simply return `now`
    // and create an immediate rescheduling loop.
    const resumesAt = nextActiveHoursStart(availability, activeNow ? event.at : now)
    if ((!activeNow || !activeAtEvent) && resumesAt <= 0 && !event.completesRun) {
      refreshDisplay()
      return
    }
    if (!event.completesRun && (!activeNow || !activeAtEvent) && endsAtRef.current !== null && resumesAt >= endsAtRef.current) {
      // Availability only gates sound. It must never postpone a bounded run's
      // terminal event beyond its fixed deadline.
      event = nextProgramEvent(activeProgram, anchorRef.current, endsAtRef.current - 1, startedAtRef.current, endsAtRef.current, randomSeedRef.current || anchorRef.current) ?? event
    }
    const triggerAt = event.completesRun || (activeNow && activeAtEvent) ? event.at : resumesAt
    timeoutRef.current = setTimeout(() => {
      if (!runningRef.current) return
      const firedAt = Date.now()
      const firedAvailability = effectiveAvailabilityForProgram(programRef.current, settingsRef.current.availability)
      const availableWhenFired = isCueDeliveryAllowedByActiveHours(firedAvailability, event.at, firedAt)
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

  const start = useCallback(async (restore?: number | { anchor: number; startedAt?: number; endsAt?: number; pausedAt?: number; randomSeed?: number; mute: RuntimeMuteState; alarmBehavior: AlarmBehavior; soundState?: { sequence: Record<string, number>; randomPrevious: Record<string, number> } }) => {
    const request = ++reanchorRequestRef.current
    nativeUpdateGenerationRef.current += 1
    setRuntimeInterruption(null)
    const restored = typeof restore === 'number' ? undefined : restore
    const acceptedAt = Date.now()
    const anchor = typeof restore === 'number' ? restore : restored?.anchor ?? alignedAnchorForStart(programRef.current, acceptedAt)
    const randomSeed = restored?.randomSeed ?? acceptedAt
    const startedAt = restored?.startedAt ?? (typeof restore === 'number' ? restore : acceptedAt)
    const endsAt = restored?.endsAt && restored.endsAt > 0 ? restored.endsAt : runEndAt(programRef.current, anchor, startedAt)
    if (!hasAvailableTime(effectiveAvailabilityForProgram(programRef.current, settingsRef.current.availability), acceptedAt)) return false
    if (nextProgramEvent(programRef.current, anchor, restored?.pausedAt ?? acceptedAt, startedAt, endsAt, randomSeed) === null) return false
    if (isNativeServiceAvailable && (!ChandasTimerService.canScheduleExactAlarms() || !supportsProgram(programRef.current))) return false
    if (isNativeServiceAvailable && requiresExactSubBellRuntime(programRef.current) && ChandasTimerService.getCapabilities()?.supportsSubBellSecondPrecision !== true) return false
    if (isNativeServiceAvailable) await ChandasTimerService.prepareBuiltInSounds(builtInSoundsFor(programRef.current, settingsRef.current.alarmSound))
    if (request !== reanchorRequestRef.current) return false
    await setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: false })
    await activateDisplayWakeLock()
    const nativeConfig = nativeConfigFor(programRef.current, settingsRef.current, anchor, startedAt, endsAt, restored?.alarmBehavior === 'locked' || (!restored && alarmBehaviorRef.current === 'locked'), randomSeed)
    nativeConfig.timerV2PausedAt = restored?.pausedAt ?? 0
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
    randomSeedRef.current = randomSeed
    startedAtRef.current = startedAt
    endsAtRef.current = endsAt
    pausedAtRef.current = restored?.pausedAt ?? null
    setIsPaused(pausedAtRef.current !== null)
    cueSoundCursorRef.current = new Map(Object.entries(restored?.soundState?.sequence ?? {}))
    previousCueSoundRef.current = new Map(Object.entries(restored?.soundState?.randomPrevious ?? {}))
    if (restored) updateRuntimeState(restored.mute, restored.alarmBehavior)
    runningRef.current = true
    setIsRunning(true)
    refreshDisplay()
    scheduleDisplayTick()
    persistSession(restored?.mute ?? muteRef.current, restored?.alarmBehavior ?? alarmBehaviorRef.current)
    if (!isNativeServiceAvailable) scheduleNext()
    return true
  }, [persistSession, refreshDisplay, scheduleDisplayTick, scheduleNext, updateRuntimeState])

  const attachNativeSession = useCallback(async (restore: { anchor: number; startedAt?: number; endsAt?: number; pausedAt?: number; randomSeed?: number; mute: RuntimeMuteState; alarmBehavior: AlarmBehavior; soundState?: { sequence: Record<string, number>; randomPrevious: Record<string, number> } }) => {
    if (isNativeServiceAvailable && !ChandasTimerService.getState().active) {
      throw new Error('Native timer is no longer active')
    }
    anchorRef.current = restore.anchor
    randomSeedRef.current = restore.randomSeed ?? restore.anchor
    startedAtRef.current = restore.startedAt ?? restore.anchor
    endsAtRef.current = restore.endsAt && restore.endsAt > 0 ? restore.endsAt : runEndAt(programRef.current, restore.anchor, restore.startedAt ?? restore.anchor)
    pausedAtRef.current = restore.pausedAt ?? null
    setIsPaused(pausedAtRef.current !== null)
    cueSoundCursorRef.current = new Map(Object.entries(restore.soundState?.sequence ?? {}))
    previousCueSoundRef.current = new Map(Object.entries(restore.soundState?.randomPrevious ?? {}))

    // Claim the already-authoritative native session before doing any optional
    // asset/audio preparation. A cold process may need noticeable time to open
    // those resources; that delay must never look like a stopped timer to React.
    runningRef.current = true
    updateRuntimeState(restore.mute, restore.alarmBehavior)
    setIsRunning(true)
    setIsAlarmRinging(isNativeServiceAvailable && ChandasTimerService.isRinging())
    refreshDisplay()
    scheduleDisplayTick()

    if (isNativeServiceAvailable) {
      await ChandasTimerService.prepareBuiltInSounds(builtInSoundsFor(programRef.current, settingsRef.current.alarmSound)).catch(() => false)
      // Reapply the OTA-owned envelope when reconnecting after a launch. This
      // refreshes presentation metadata and additive settings without touching
      // mute/alarm-once controls or replacing the authoritative native anchor.
      try {
        ChandasTimerService.update(nativeConfigFor(
          programRef.current,
          settingsRef.current,
          anchorRef.current,
          startedAtRef.current,
          endsAtRef.current,
          restore.alarmBehavior === 'locked',
          randomSeedRef.current,
        ))
      } catch { /* the persisted native schedule remains authoritative */ }
    }
    await setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: false }).catch(() => undefined)
    await activateDisplayWakeLock()
  }, [refreshDisplay, scheduleDisplayTick, updateRuntimeState])

  const stop = useCallback(() => {
    // Invalidate any re-anchor waiting on asset preparation before asking
    // Android to stop. Otherwise that continuation could recreate a native
    // schedule after the user has already returned to configuration.
    reanchorRequestRef.current += 1
    nativeUpdateGenerationRef.current += 1
    // Do not dismantle the local running surface until Android confirms that
    // its durable schedule is inactive. This prevents a configuration-screen
    // limbo state in which native bells can continue in the background.
    if (isNativeServiceAvailable && !ChandasTimerService.stop()) return false
    runningRef.current = false
    setIsRunning(false)
    pausedAtRef.current = null
    setIsPaused(false)
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    if (refreshIntervalRef.current) clearTimeout(refreshIntervalRef.current)
    if (nativeUpdateRef.current) clearTimeout(nativeUpdateRef.current)
    if (alarmTapTimeoutRef.current) clearTimeout(alarmTapTimeoutRef.current)
    alarmTapTimeoutRef.current = null
    alarmTapStartRef.current = null
    timeoutRef.current = null
    refreshIntervalRef.current = null
    try { alarmPlayerRef.current?.remove() } catch { /* continue local teardown */ }
    alarmPlayerRef.current = null
    stopRepeatingAlarmHaptic()
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
    setDisplay({ mainCountdown: '--:--', nextCueCountdown: '--:--', nextCueLabel: '', progress: 0, position: null, activeHoursPaused: false, activeHoursResumeAt: 0, nextAudibleAt: 0, nextAudibleLabel: '', runEndsAt: 0, runRemainingMs: 0, runProgress: 0 })
    return true
  }, [])

  const applyAlarmBehavior = useCallback((current: AlarmBehavior, next: AlarmBehavior) => {
    updateRuntimeState(muteRef.current, next)
    if (isNativeServiceAvailable && runningRef.current) {
      if ((current === 'once') !== (next === 'once')) ChandasTimerService.toggleAlarmOnce()
      ChandasTimerService.update({ alarmModeEnabled: next === 'locked' })
    }
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
    tapHaptic()
  }, [updateRuntimeState])

  const muteForSeconds = useCallback((seconds: number) => {
    const next = timestampMuteForSeconds(Date.now(), seconds)
    updateRuntimeState(next, alarmBehaviorRef.current)
    if (isNativeServiceAvailable && runningRef.current) ChandasTimerService.muteForSeconds(seconds)
    tapHaptic()
  }, [updateRuntimeState])

  const muteForMinutes = useCallback((minutes: number) => {
    muteForSeconds(minutes * 60)
  }, [muteForSeconds])

  const clearMute = useCallback(() => {
    updateRuntimeState(emptyRuntimeMute(), alarmBehaviorRef.current)
    if (isNativeServiceAvailable && runningRef.current) ChandasTimerService.clearMute()
    selectionHaptic()
  }, [updateRuntimeState])

  const syncNativeClock = useCallback(() => {
    const native = ChandasTimerService.getState()
    if (!native.active) return false
    if (native.timerV2Anchor && native.timerV2Anchor > 0) anchorRef.current = native.timerV2Anchor
    if (native.timerV2RandomSeed && native.timerV2RandomSeed > 0) randomSeedRef.current = native.timerV2RandomSeed
    if (native.timerV2StartedAt && native.timerV2StartedAt > 0) startedAtRef.current = native.timerV2StartedAt
    endsAtRef.current = native.timerV2EndsAt && native.timerV2EndsAt > 0 ? native.timerV2EndsAt : null
    pausedAtRef.current = native.timerV2PausedAt && native.timerV2PausedAt > 0 ? native.timerV2PausedAt : null
    setIsPaused(pausedAtRef.current !== null)
    persistSession(muteRef.current, alarmBehaviorRef.current)
    refreshDisplay()
    scheduleDisplayTick()
    return true
  }, [persistSession, refreshDisplay, scheduleDisplayTick])

  const setPaused = useCallback((paused: boolean) => {
    if (!runningRef.current || paused === (pausedAtRef.current !== null)) return false
    if (isNativeServiceAvailable) {
      const result = ChandasTimerService.floatingOverlayAction(paused ? 'pause' : 'resume')
      if (!result.success) return false
      syncNativeClock()
    } else if (paused) {
      pausedAtRef.current = Date.now()
      setIsPaused(true)
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    } else {
      const delta = Math.max(0, Date.now() - pausedAtRef.current!)
      anchorRef.current += delta
      startedAtRef.current += delta
      if (endsAtRef.current !== null) endsAtRef.current += delta
      const oldMute = muteRef.current
      updateRuntimeState({
        mutedUntil: oldMute.mutedUntil > pausedAtRef.current! ? oldMute.mutedUntil + delta : 0,
        ...(oldMute.iteration ? { iteration: iterationMuteFor(programRef.current, anchorRef.current, Date.now(), oldMute.iteration.iterations) } : {}),
      }, alarmBehaviorRef.current)
      pausedAtRef.current = null
      setIsPaused(false)
      scheduleNext()
    }
    persistSession(muteRef.current, alarmBehaviorRef.current)
    refreshDisplay()
    scheduleDisplayTick()
    selectionHaptic()
    return true
  }, [persistSession, refreshDisplay, scheduleDisplayTick, scheduleNext, syncNativeClock, updateRuntimeState])

  const skipSequenceStep = useCallback((direction: 'next' | 'previous') => {
    if (!runningRef.current || programRef.current.mode !== 'sequence' || programRef.current.steps.length < 2) return false
    if (isNativeServiceAvailable) {
      const result = ChandasTimerService.floatingOverlayAction(direction === 'next' ? 'next-step' : 'previous-step')
      if (!result.success) return false
      syncNativeClock()
    } else {
      const program = programRef.current
      const now = pausedAtRef.current ?? Date.now()
      const target = sequenceSkipTarget(program, anchorRef.current, now, startedAtRef.current, endsAtRef.current, direction)
      if (!target) return false
      if (target.completesRun) {
        finishJsRun()
        return true
      }
      anchorRef.current = target.anchor
      startedAtRef.current = target.startedAt
      endsAtRef.current = target.terminalAt
      if (muteRef.current.iteration) updateRuntimeState({ ...muteRef.current, iteration: iterationMuteFor(program, target.anchor, now, muteRef.current.iteration.iterations) }, alarmBehaviorRef.current)
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
      if (pausedAtRef.current === null) scheduleNext()
    }
    persistSession(muteRef.current, alarmBehaviorRef.current)
    refreshDisplay()
    selectionHaptic()
    return true
  }, [finishJsRun, persistSession, refreshDisplay, scheduleNext, syncNativeClock, updateRuntimeState])

  /** Restarts the live timeline without stopping the session or losing runtime controls. */
  const reanchor = useCallback(async (nextProgram: TimerProgram, alignToClock: boolean, nextSettings = settingsRef.current, nextSourcePreset = sourcePresetRef.current) => {
    if (!runningRef.current) return false
    const request = ++reanchorRequestRef.current
    nativeUpdateGenerationRef.current += 1
    // A ringing alarm is intentionally exclusive. Never tear it down merely
    // to attempt a replacement that could be rejected.
    if (isNativeServiceAvailable && ChandasTimerService.getState().ringing) return false
    if (!isNativeServiceAvailable && alarmPlayerRef.current) return false
    if (isNativeServiceAvailable && (!ChandasTimerService.canScheduleExactAlarms() || !supportsProgram(nextProgram))) return false
    if (isNativeServiceAvailable && requiresExactSubBellRuntime(nextProgram) && ChandasTimerService.getCapabilities()?.supportsSubBellSecondPrecision !== true) return false
    if (isNativeServiceAvailable) await ChandasTimerService.prepareBuiltInSounds(builtInSoundsFor(nextProgram, nextSettings.alarmSound))
    if (request !== reanchorRequestRef.current || !runningRef.current) return false
    if (isNativeServiceAvailable && ChandasTimerService.getState().ringing) return false
    const anchor = alignToClock ? alignedAnchorForStart(nextProgram, Date.now()) : Date.now()
    const randomSeed = Date.now()
    const startedAt = Date.now()
    const endsAt = runEndAt(nextProgram, anchor, startedAt)
    const currentMute = muteRef.current
    // Reanchoring changes cycle identities. Preserve timestamp mute, but clear
    // cycle mute so its promised final boundary cannot silently move.
    const nextMute = muteAfterScheduleChange(currentMute)
    const nextAlarm: AlarmBehavior = nextProgram.mode === 'sequence' ? 'off' : alarmBehaviorRef.current
    const config = nativeConfigFor(nextProgram, nextSettings, anchor, startedAt, endsAt, nextAlarm === 'locked', randomSeed)
    config.alarmOnceArmed = nextAlarm === 'once'
    config.mutedUntil = nextMute.mutedUntil
    config.mutedIterationEndId = nextMute.iteration?.endsAtLogicalId
    config.mutedIterationEndAt = nextMute.iteration?.endsAt
    config.mutedIterationCount = nextMute.iteration?.iterations
    if (isNativeServiceAvailable && !ChandasTimerService.start(config)) return false
    programRef.current = nextProgram
    settingsRef.current = nextSettings
    sourcePresetRef.current = nextSourcePreset
    anchorRef.current = anchor
    randomSeedRef.current = randomSeed
    startedAtRef.current = startedAt
    endsAtRef.current = endsAt
    pausedAtRef.current = null
    setIsPaused(false)
    cueSoundCursorRef.current.clear()
    previousCueSoundRef.current.clear()
    updateRuntimeState(nextMute, nextAlarm)
    setDisplay(timerV2DisplayFor(nextProgram, nextSettings, nextMute, anchor, startedAt, endsAt, Date.now(), randomSeed))
    void saveTimerV2Session({ schemaVersion: 2, anchor, randomSeed, startedAt, ...(endsAt ? { endsAt } : {}), program: nextProgram, mute: nextMute, alarmBehavior: nextAlarm, sourcePreset: nextSourcePreset, settings: nextSettings })
    if (!isNativeServiceAvailable) scheduleNext()
    return true
  }, [dismissAlarm, scheduleNext, updateRuntimeState])

  useEffect(() => {
    const subscription = AppState.addEventListener('change', nextState => {
      if (nextState !== 'active') {
        if (refreshIntervalRef.current) clearTimeout(refreshIntervalRef.current)
        refreshIntervalRef.current = null
        releaseDisplayWakeLock()
        return
      }
      if (!runningRef.current) return
      scheduleDisplayTick()
      void activateDisplayWakeLock()
      if (isNativeServiceAvailable) {
        const native = ChandasTimerService.getState()
        if (!native.active) {
          stop()
          return
        }
        syncNativeClock()
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
  }, [refreshDisplay, scheduleDisplayTick, scheduleNext, stop, syncNativeClock, updateRuntimeState])

  useEffect(() => {
    if (!isNativeServiceAvailable) return
    setIsAlarmRinging(ChandasTimerService.isRinging())
    const listener = ChandasTimerService.addAlarmListener(ringing => {
      if (ringing) ChandasTimerService.stopSoundPreview()
      setIsAlarmRinging(ringing)
    })
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
      syncNativeClock()
    })
    return () => listener?.remove()
  }, [stop, syncNativeClock])

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
      ChandasTimerService.stopSoundPreview()
      if (shouldSurfaceTimerSignal(event, Date.now(), AppState.currentState === 'active')) {
        // Android performs cue haptics beside its exact alarm so background and
        // foreground behavior match without producing a double vibration here.
        if (Platform.OS !== 'android') timerCueHaptic(event.boundary, settingsRef.current.haptics)
        setEventPulse(value => value + 1)
      }
      if (event.completesRun) setCompletionPulse(value => value + 1)
    })
    return () => listener?.remove()
  }, [])

  useEffect(() => {
    if (!runningRef.current) return
    // Keep the recoverable working program current even on the web fallback;
    // native Android additionally receives the debounced authoritative update.
    persistSession(muteRef.current, alarmBehaviorRef.current)
    if (!isNativeServiceAvailable) {
      scheduleNext()
      return
    }
    if (nativeUpdateRef.current) clearTimeout(nativeUpdateRef.current)
    const updateGeneration = ++nativeUpdateGenerationRef.current
    nativeUpdateRef.current = setTimeout(() => {
      nativeUpdateRef.current = null
      if (!runningRef.current || updateGeneration !== nativeUpdateGenerationRef.current) return
      const updateProgram = programRef.current
      const updateSeed = randomSeedRef.current
      void ChandasTimerService.prepareBuiltInSounds(builtInSoundsFor(updateProgram, settingsRef.current.alarmSound)).then(() => {
        if (runningRef.current && updateGeneration === nativeUpdateGenerationRef.current && randomSeedRef.current === updateSeed && programRef.current === updateProgram) {
          ChandasTimerService.update(nativeConfigFor(updateProgram, settingsRef.current, anchorRef.current, startedAtRef.current, endsAtRef.current, alarmBehaviorRef.current === 'locked', randomSeedRef.current || anchorRef.current))
        }
      }).catch(() => undefined)
    }, 120)
    return () => {
      if (nativeUpdateRef.current) clearTimeout(nativeUpdateRef.current)
      nativeUpdateRef.current = null
    }
  }, [persistSession, program, scheduleNext, settings])

  useEffect(() => () => {
    reanchorRequestRef.current += 1
    nativeUpdateGenerationRef.current += 1
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    if (refreshIntervalRef.current) clearTimeout(refreshIntervalRef.current)
    if (nativeUpdateRef.current) clearTimeout(nativeUpdateRef.current)
    if (alarmTapTimeoutRef.current) clearTimeout(alarmTapTimeoutRef.current)
    alarmTapStartRef.current = null
    playerRef.current?.remove()
    alarmPlayerRef.current?.remove()
    stopRepeatingAlarmHaptic()
    releaseDisplayWakeLock()
  }, [])

  return {
    ...display,
    isRunning,
    isPaused,
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
    muteForSeconds,
    clearMute,
    eventPulse,
    completionPulse,
    runtimeInterruption,
    clearRuntimeInterruption,
    setPaused,
    skipSequenceStep,
    reanchor,
  }
}

// Keeps delay calculation explicit and prevents a stale ``now`` closure from
// scheduling a negative timeout after a costly state update.
function firedAtSafe(fallback: number): number {
  const current = Date.now()
  return Number.isFinite(current) ? current : fallback
}
