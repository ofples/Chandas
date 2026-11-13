import { useCallback, useEffect, useRef, useState } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { AppState, Platform } from 'react-native'
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake'
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio'
import type { AlarmBehavior, AppTimerSettings, BuiltInSoundId, SoundRef, RuntimeTimerProgram as TimerProgram, WorkingProgramState } from '../types'
import { effectiveAvailabilityForProgram, hasAvailableTime, isCueAllowedByActiveHours, isCueDeliveryAllowedByActiveHours, isWithinActiveHours, nextActiveHoursStart } from '../lib/activeHours'
import { formatCountdown } from '../lib/snapLogic'
import { sourceForSound, soundTitle } from '../lib/soundLibrary'
import { boundedRunProgress, currentStepEndAt, nextProgramEvent, programCycleDurationMs, runEndAt, seekStepTarget, sequenceSkipTarget, timelinePosition, type TimelinePosition } from '../lib/timeline'
import { alarmBehaviorAfterGesture, alarmBehaviorForReanchor, emptyRuntimeMute, gateProgramAudio, isFreshScheduledEvent, iterationMuteFor, muteAfterScheduleChange, programEventIsVisible, shouldSurfaceTimerSignal, timestampMuteForSeconds, type RuntimeMuteState } from '../lib/runtimeV2'
import { clearTimerV2Session, saveTimerV2Session } from '../lib/storage'
import { ChandasTimerService, isNativeServiceAvailable, type NativeTimerConfig } from '../native/ChandasTimerService'
import { cueHapticProfile, selectionHaptic, setAppHapticsEnabled, startRepeatingAlarmHaptic, stopRepeatingAlarmHaptic, tapHaptic, timerCueHaptic } from '../lib/haptics'
import { alignedClockAnchor } from '../lib/clockAlignment'
import { createProgramId, cueSounds, patternDurationSeconds, programForVisibleCues, sequenceStepDurationSeconds } from '../lib/timerV2'
import { nextAudibleProgramEvent, programEventLabel } from '../lib/upcoming-events'
import { clearUnifiedTimerRun, clearUnifiedTimerSession, saveUnifiedTimerRun, saveUnifiedTimerSession } from '../lib/unified-session'
import { nativeSupportsRuntimeProgram, requiresExactSubBellRuntime } from '../lib/runtime-capabilities'

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
async function activateDisplayWakeLock(tag: string): Promise<void> {
  if (Platform.OS === 'web' || AppState.currentState !== 'active') return
  await activateKeepAwakeAsync(tag).catch(() => undefined)
  if (AppState.currentState !== 'active') releaseDisplayWakeLock(tag)
}

function releaseDisplayWakeLock(tag: string): void {
  if (Platform.OS === 'web') return
  void deactivateKeepAwake(tag).catch(() => undefined)
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

export interface TimerRestore {
  anchor: number
  startedAt?: number
  endsAt?: number
  pausedAt?: number
  randomSeed?: number
  mute: RuntimeMuteState
  alarmBehavior: AlarmBehavior
  soundState?: { sequence: Record<string, number>; randomPrevious: Record<string, number> }
  sessionId?: string
  nativeGeneration?: string
}

export interface UseTimerV2Return extends TimerV2Display {
  sessionId: string | null
  nativeGeneration?: string
  sessionPersistenceError: string | null
  getSessionIdentity: () => { sessionId: string | null; nativeGeneration?: string }
  isRunning: boolean
  isPaused: boolean
  isAlarmRinging: boolean
  alarmBehavior: AlarmBehavior
  mute: RuntimeMuteState
  start: (restore?: number | TimerRestore, input?: TimerStartInput) => Promise<boolean>
  attachNativeSession: (restore: TimerRestore) => Promise<void>
  /** False means Android still reports an authoritative live schedule. */
  stop: () => boolean
  dismissAlarm: () => void
  pressAlarm: () => AlarmBehavior
  muteForIterations: (count: number) => void
  muteForMinutes: (minutes: number) => void
  muteForSeconds: (seconds: number) => void
  muteUntil: (deadline: number) => void
  clearMute: () => void
  eventPulse: number
  completionPulse: number
  runtimeInterruption: 'exact-alarm-access' | null
  clearRuntimeInterruption: () => void
  setPaused: (paused: boolean) => boolean
  skipSequenceStep: (direction: 'next' | 'previous' | number) => boolean
  seekStep: (fraction: number) => boolean
  reanchor: (nextProgram: TimerProgram, alignToClock: boolean, nextSettings?: AppTimerSettings, nextSourcePreset?: WorkingProgramState['sourcePreset'], alarmBehaviorForNewTimer?: AlarmBehavior) => Promise<boolean>
}

interface TimerStartInput {
  program: TimerProgram
  settings: AppTimerSettings
  sourcePreset?: WorkingProgramState['sourcePreset']
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
  const position = timelinePosition(programForVisibleCues(program), anchor, now, startedAt, terminalAt, randomSeed)
  const next = position.nextEvent
  if (program.mode === 'unified' && program.noMainInterval) {
    return {
      mainCountdown: next ? formatCountdown(next.at - now) : '∞',
      nextCueCountdown: next ? formatCountdown(next.at - now) : '--:--',
      nextCueLabel: next ? programEventLabel(program, next) : '',
      progress: 0, position, activeHoursPaused: false, activeHoursResumeAt: 0,
      ...audibleFields, runEndsAt: endAt, runRemainingMs: endAt ? Math.max(0, endAt - now) : 0,
      runProgress: boundedRunProgress(startedAt, terminalAt, now),
    }
  }
  if (!next) {
    return {
      mainCountdown: '00:00', nextCueCountdown: '00:00', nextCueLabel: 'Complete', progress: 1,
      position: null, activeHoursPaused: false, activeHoursResumeAt: 0,
      ...audibleFields,
      runEndsAt: endAt, runRemainingMs: 0,
      runProgress: endAt ? 1 : 0,
    }
  }
  const mainCountdown = program.mode === 'unified'
    ? formatCountdown(Math.min(currentStepEndAt(program, position), program.steps.length > 1 ? terminalAt ?? Infinity : Infinity) - now)
    : program.mode === 'pattern'
    ? formatCountdown(anchor + (position.cycleIndex + 1) * patternDurationSeconds(program) * 1_000 - now)
    : formatCountdown(next.at - now)
  return {
    mainCountdown,
    nextCueCountdown: formatCountdown(next.at - now),
    nextCueLabel: program.mode === 'unified' ? programEventLabel(program, next) : program.mode === 'pattern'
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
  const mainMs = programCycleDurationMs(program)
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
  if (program.mode === 'unified') {
    program.steps.forEach(step => { addCue(step.endCue); step.subBellTracks.forEach(addCue) })
  } else if (program.mode === 'pattern') {
    addCue(program.mainCue)
    program.tracks.forEach(addCue)
  } else {
    program.steps.forEach(addCue)
  }
  addCue(program.completionCue ?? undefined)
  add(alarmSound)
  return [...ids]
}

function supportsProgram(program: TimerProgram): boolean {
  return !isNativeServiceAvailable || nativeSupportsRuntimeProgram(program, ChandasTimerService.getCapabilities())
}

function alignedAnchorForStart(program: TimerProgram, now: number): number {
  if (program.alignment.kind !== 'local-clock') return now
  return alignedClockAnchor(programCycleDurationMs(program) / 1_000, program.alignment.offsetMinutes, now)
}

/**
 * Web/JS fallback for the V2 timeline. Android replaces this schedule with the
 * exact-alarm native service once that service receives the V2 program record.
 */
export interface TimerRuntimeScope {
  /** Unique for the lifetime of the controller, including while paused. */
  key: string
  native: typeof ChandasTimerService | null
  alarms?: RunAlarmQueue
  cues?: RunCueArbitrator
}

export interface RunCueArbitrator {
  offer: (candidate: { id: string; at: number; alarm: boolean; rarity: number; isCurrent: () => boolean }) => Promise<boolean>
}

export interface RunAlarmQueue {
  enqueue: (id: string, ring: () => boolean) => void
  cancelPending: (id: string) => void
  release: (id: string) => void
}

export function useTimerV2(program: TimerProgram, settings: AppTimerSettings, sourcePreset?: WorkingProgramState['sourcePreset'], scope?: TimerRuntimeScope): UseTimerV2Return {
  const service = scope ? scope.native : isNativeServiceAvailable ? ChandasTimerService : null
  const scoped = scope !== undefined
  const alarmQueue = scope?.alarms
  const cueArbitrator = scope?.cues
  const runKey = scope?.key
  const wakeLockTag = scope ? `${KEEP_AWAKE_TAG}:${scope.key}` : KEEP_AWAKE_TAG
  const [sessionPersistenceError, setSessionPersistenceError] = useState<string | null>(null)
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
  const alarmDeadline = useRef(0)
  const alarmExpiryRef = useRef<ReturnType<typeof setTimeout> | null>(null)
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
  const sessionIdRef = useRef<string | null>(null)
  const nativeGenerationRef = useRef<string | undefined>(undefined)
  const persistenceGenerationRef = useRef(0)
  const getSessionIdentity = useCallback(() => ({ sessionId: sessionIdRef.current, nativeGeneration: nativeGenerationRef.current }), [])
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

  const persistSession = useCallback(async (nextMute: RuntimeMuteState, nextAlarm: AlarmBehavior, mode: 'start' | 'update' = 'update', beforeStart = false): Promise<boolean> => {
    if (!runningRef.current && !beforeStart) return true
    const generation = ++persistenceGenerationRef.current
    const activeProgram = programRef.current
    const snapshot = {
      anchor: anchorRef.current,
      randomSeed: randomSeedRef.current || anchorRef.current,
      startedAt: startedAtRef.current,
      ...(endsAtRef.current ? { endsAt: endsAtRef.current } : {}),
      ...(pausedAtRef.current ? { pausedAt: pausedAtRef.current } : {}),
      mute: nextMute,
      alarmBehavior: nextAlarm,
      sourcePreset: sourcePresetRef.current,
      soundState: { sequence: Object.fromEntries(cueSoundCursorRef.current), randomPrevious: Object.fromEntries(previousCueSoundRef.current) },
      settings: settingsRef.current,
    }
    if (activeProgram.mode === 'unified') {
      const session = {
        ...snapshot, schemaVersion: 3 as const, sessionId: sessionIdRef.current!, randomAlgorithmVersion: 1 as const,
        program: activeProgram, ...(nativeGenerationRef.current ? { nativeGeneration: nativeGenerationRef.current } : {}),
      }
      const saved = scoped
        ? await saveUnifiedTimerRun(AsyncStorage, session, mode)
        : await saveUnifiedTimerSession(AsyncStorage, session)
      if (generation === persistenceGenerationRef.current) setSessionPersistenceError(saved.ok ? null : saved.reason)
      return saved.ok
    }
    await saveTimerV2Session({ ...snapshot, schemaVersion: 2, program: activeProgram })
    return true
  }, [scoped])

  const clearPersistedSession = useCallback(() => {
    ++persistenceGenerationRef.current
    if (programRef.current.mode !== 'unified') { void clearTimerV2Session(); return }
    const sessionId = sessionIdRef.current
    const clear = scoped ? clearUnifiedTimerRun : clearUnifiedTimerSession
    if (sessionId) void clear(AsyncStorage, sessionId).then(result => {
      if (!result.ok) setSessionPersistenceError(result.reason)
    })
  }, [scoped])

  const updateRuntimeState = useCallback((nextMute: RuntimeMuteState, nextAlarm: AlarmBehavior) => {
    muteRef.current = nextMute
    alarmBehaviorRef.current = nextAlarm
    setMute(nextMute)
    setAlarmBehavior(nextAlarm)
    persistSession(nextMute, nextAlarm)
  }, [persistSession])

  const releaseLocalAlarm = useCallback(() => {
    if (alarmExpiryRef.current) clearTimeout(alarmExpiryRef.current)
    alarmExpiryRef.current = null
    alarmDeadline.current = 0
    if (alarmPlayerRef.current || !alarmQueue) stopRepeatingAlarmHaptic()
    try { alarmPlayerRef.current?.remove() } catch { /* player may already be released */ }
    alarmPlayerRef.current = null
    if (runKey) alarmQueue?.release(runKey)
  }, [alarmQueue, runKey])

  const dismissAlarm = useCallback(() => {
    if (service) {
      // The Android service acknowledges after it releases its player.
      service.stopAlarm()
      return
    }
    releaseLocalAlarm()
    setIsAlarmRinging(false)
  }, [releaseLocalAlarm, service])

  const playEvent = useCallback(async (eventAt: number): Promise<boolean> => {
    const activeProgram = programRef.current
    const activeSettings = settingsRef.current
    const event = nextProgramEvent(activeProgram, anchorRef.current, eventAt - 1, startedAtRef.current, endsAtRef.current, randomSeedRef.current || anchorRef.current)
    if (!event || event.at !== eventAt) return false
    if (alarmDeadline.current > 0 && alarmDeadline.current <= eventAt) {
      setIsAlarmRinging(false)
      releaseLocalAlarm()
    }
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
    if (programEventIsVisible(activeProgram, event)) setEventPulse(value => value + 1)

    const alarm = gate.disposition === 'continuous-alarm'
    if (cueArbitrator && runKey && (alarm || event.winner.volume > 0)) {
      const anchor = anchorRef.current
      const round = programCycleDurationMs(activeProgram)
      const spacing = event.winner.occurrencesPerRound
        ? round / event.winner.occurrencesPerRound
        : event.winner.cadenceSeconds ? event.winner.cadenceSeconds * 1000 : round
      const rarity = event.completesRun ? Infinity : spacing
      const isCurrent = () => runningRef.current && pausedAtRef.current === null && anchorRef.current === anchor
      const wins = await cueArbitrator.offer({ id: runKey, at: eventAt, alarm, rarity, isCurrent })
      if (!wins || !isCurrent()) return event.completesRun
    }
    if (alarm) {
      const stepped = event.boundary === 'sequence-step' || event.boundary === 'sequence-cycle'
      const following = stepped ? timelinePosition(activeProgram, anchorRef.current, event.at, startedAtRef.current, endsAtRef.current) : null
      const durationEnd = event.at + activeSettings.alarmDurationSeconds * 1000
      const expiresAt = Math.min(durationEnd, following ? currentStepEndAt(activeProgram, following) : Infinity, endsAtRef.current ?? Infinity)
      const ring = () => {
        if (!runningRef.current || Date.now() >= expiresAt) return false
        const settings = settingsRef.current
        try {
          const player = createAudioPlayer(sourceForSound(settings.alarmSound) ?? ALARM_SOURCE)
          alarmPlayerRef.current = player
          player.loop = true
          player.volume = Math.max(0, Math.min(1, settings.masterVolume * settings.alarmVolume))
          player.play()
          startRepeatingAlarmHaptic(settings.haptics)
          setIsAlarmRinging(true)
          if (Number.isFinite(expiresAt)) {
            alarmDeadline.current = expiresAt
            alarmExpiryRef.current = setTimeout(() => {
              setIsAlarmRinging(false)
              releaseLocalAlarm()
            }, Math.max(0, expiresAt - Date.now()))
          }
          return true
        } catch {
          try { alarmPlayerRef.current?.remove() } catch { /* release a failed player if present */ }
          alarmPlayerRef.current = null
          return false
        }
      }
      if (alarmQueue && runKey) alarmQueue.enqueue(runKey, ring)
      else { dismissAlarm(); ring() }
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
  }, [alarmQueue, cueArbitrator, dismissAlarm, persistSession, releaseLocalAlarm, runKey, updateRuntimeState])

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
    releaseLocalAlarm()
    setIsAlarmRinging(false)
    releaseDisplayWakeLock(wakeLockTag)
    clearPersistedSession()
    setCompletionPulse(value => value + 1)
  }, [clearPersistedSession, releaseLocalAlarm, wakeLockTag])

  const scheduleNext = useCallback(() => {
    if (!runningRef.current) return
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    const activeProgram = programRef.current
    const activeSettings = settingsRef.current
    const now = Date.now()
    if (pausedAtRef.current !== null) {
      if (activeProgram.runPolicy.kind === 'until' && endsAtRef.current !== null) {
        timeoutRef.current = setTimeout(finishJsRun, Math.max(0, endsAtRef.current - now))
      }
      return
    }
    let event = nextProgramEvent(activeProgram, anchorRef.current, now, startedAtRef.current, endsAtRef.current, randomSeedRef.current || anchorRef.current)
    if (!event) {
      if (activeProgram.mode === 'unified' && activeProgram.noMainInterval && endsAtRef.current === null) refreshDisplay()
      else finishJsRun()
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
    timeoutRef.current = setTimeout(async () => {
      if (!runningRef.current) return
      const anchor = anchorRef.current
      const firedAt = Date.now()
      const firedAvailability = effectiveAvailabilityForProgram(programRef.current, settingsRef.current.availability)
      const availableWhenFired = isCueDeliveryAllowedByActiveHours(firedAvailability, event.at, firedAt)
      const shouldPlay = availableWhenFired && isFreshScheduledEvent(event.at, firedAt)
      let completed = event.completesRun
      if (shouldPlay) {
        try { completed = await playEvent(event.at) || completed }
        catch { /* A failed sound must not interrupt future timer boundaries. */ }
      }
      if (!runningRef.current || anchorRef.current !== anchor) return
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

  const start = useCallback(async (restore?: number | TimerRestore, input?: TimerStartInput) => {
    const acceptedProgram = input?.program ?? programRef.current
    const acceptedSettings = input?.settings ?? settingsRef.current
    const acceptedSource = input ? input.sourcePreset : sourcePresetRef.current
    const request = ++reanchorRequestRef.current
    nativeUpdateGenerationRef.current += 1
    setRuntimeInterruption(null)
    const restored = typeof restore === 'number' ? undefined : restore
    const acceptedSessionId = restored?.sessionId ?? runKey ?? createProgramId()
    setSessionPersistenceError(null)
    const acceptedAt = Date.now()
    const anchor = typeof restore === 'number' ? restore : restored?.anchor ?? alignedAnchorForStart(acceptedProgram, acceptedAt)
    const randomSeed = restored?.randomSeed ?? acceptedAt
    const startedAt = restored?.startedAt ?? (typeof restore === 'number' ? restore : acceptedAt)
    const endsAt = restored?.endsAt && restored.endsAt > 0 ? restored.endsAt : runEndAt(acceptedProgram, anchor, startedAt)
    const acceptedAlarmBehavior: AlarmBehavior = acceptedProgram.mode === 'unified' && acceptedProgram.noMainInterval ? 'off' : restored?.alarmBehavior ?? (acceptedProgram.mode === 'unified' ? acceptedProgram.alarmBehavior : 'off')
    if (!hasAvailableTime(effectiveAvailabilityForProgram(acceptedProgram, acceptedSettings.availability), acceptedAt)) return false
    if (nextProgramEvent(acceptedProgram, anchor, restored?.pausedAt ?? acceptedAt, startedAt, endsAt, randomSeed) === null
      && !(acceptedProgram.mode === 'unified' && acceptedProgram.noMainInterval && endsAt === null)) return false
    if (service && (!service.canScheduleExactAlarms() || !supportsProgram(acceptedProgram))) return false
    if (service && requiresExactSubBellRuntime(acceptedProgram) && service.getCapabilities()?.supportsSubBellSecondPrecision !== true) return false
    if (service) await service.prepareBuiltInSounds(builtInSoundsFor(acceptedProgram, acceptedSettings.alarmSound))
    if (request !== reanchorRequestRef.current) return false
    await setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: false })
    await activateDisplayWakeLock(wakeLockTag)
    if (request !== reanchorRequestRef.current) return false
    const nativeConfig = nativeConfigFor(acceptedProgram, acceptedSettings, anchor, startedAt, endsAt, acceptedAlarmBehavior === 'locked', randomSeed)
    nativeConfig.timerV2PausedAt = restored?.pausedAt ?? 0
    nativeConfig.alarmOnceArmed = acceptedAlarmBehavior === 'once'
    if (restored) {
      nativeConfig.mutedUntil = restored.mute.mutedUntil
      nativeConfig.mutedIterationEndId = restored.mute.iteration?.endsAtLogicalId
      nativeConfig.mutedIterationEndAt = restored.mute.iteration?.endsAt
      nativeConfig.mutedIterationCount = restored.mute.iteration?.iterations
    }
    programRef.current = acceptedProgram
    settingsRef.current = acceptedSettings
    sourcePresetRef.current = acceptedSource
    sessionIdRef.current = acceptedSessionId
    nativeGenerationRef.current = restored?.nativeGeneration
    anchorRef.current = anchor
    randomSeedRef.current = randomSeed
    startedAtRef.current = startedAt
    endsAtRef.current = endsAt
    pausedAtRef.current = restored?.pausedAt ?? null
    setIsPaused(pausedAtRef.current !== null)
    cueSoundCursorRef.current = new Map(Object.entries(restored?.soundState?.sequence ?? {}))
    previousCueSoundRef.current = new Map(Object.entries(restored?.soundState?.randomPrevious ?? {}))
    const journaled = service && scoped
      ? await persistSession(restored?.mute ?? emptyRuntimeMute(), acceptedAlarmBehavior, 'start', true)
      : false
    if (service && ((scoped && !journaled) || request !== reanchorRequestRef.current || !service.start(nativeConfig))) {
      if (journaled) clearPersistedSession()
      releaseDisplayWakeLock(wakeLockTag)
      return false
    }
    if (service) nativeGenerationRef.current = service.getState().sessionGeneration
    updateRuntimeState(restored?.mute ?? emptyRuntimeMute(), acceptedAlarmBehavior)
    runningRef.current = true
    setIsRunning(true)
    refreshDisplay()
    scheduleDisplayTick()
    const persisted = await persistSession(restored?.mute ?? muteRef.current, acceptedAlarmBehavior, journaled ? 'update' : 'start')
    if (request !== reanchorRequestRef.current || !runningRef.current) return false
    if (!persisted && !service) {
      runningRef.current = false
      setIsRunning(false)
      if (refreshIntervalRef.current) clearTimeout(refreshIntervalRef.current)
      releaseDisplayWakeLock(wakeLockTag)
      return false
    }
    // Setup edits during asynchronous preparation stay in the draft.
    programRef.current = acceptedProgram
    settingsRef.current = acceptedSettings
    sourcePresetRef.current = acceptedSource
    if (!service) scheduleNext()
    return true
  }, [clearPersistedSession, persistSession, refreshDisplay, runKey, scoped, scheduleDisplayTick, scheduleNext, updateRuntimeState, service, wakeLockTag])

  const attachNativeSession = useCallback(async (restore: TimerRestore) => {
    if (service && !service.getState().active) {
      throw new Error('Native timer is no longer active')
    }
    sessionIdRef.current = restore.sessionId ?? `native:${restore.nativeGeneration ?? createProgramId()}`
    nativeGenerationRef.current = restore.nativeGeneration ?? service?.getState().sessionGeneration
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
    setIsAlarmRinging(service?.isRinging() ?? false)
    refreshDisplay()
    scheduleDisplayTick()

    if (service) {
      await service.prepareBuiltInSounds(builtInSoundsFor(programRef.current, settingsRef.current.alarmSound)).catch(() => false)
      // Reapply the OTA-owned envelope when reconnecting after a launch. This
      // refreshes presentation metadata and additive settings without touching
      // mute/alarm-once controls or replacing the authoritative native anchor.
      try {
        service.update(nativeConfigFor(
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
    await activateDisplayWakeLock(wakeLockTag)
  }, [refreshDisplay, scheduleDisplayTick, updateRuntimeState, service, wakeLockTag])

  const stop = useCallback(() => {
    // Invalidate any re-anchor waiting on asset preparation before asking
    // Android to stop. Otherwise that continuation could recreate a native
    // schedule after the user has already returned to configuration.
    reanchorRequestRef.current += 1
    nativeUpdateGenerationRef.current += 1
    // Do not dismantle the local running surface until Android confirms that
    // its durable schedule is inactive. This prevents a configuration-screen
    // limbo state in which native bells can continue in the background.
    if (service && !service.stop()) return false
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
    releaseLocalAlarm()
    setIsAlarmRinging(false)
    try { playerRef.current?.remove() } catch { /* continue local teardown */ }
    playerRef.current = null
    const clearedMute = emptyRuntimeMute()
    muteRef.current = clearedMute
    alarmBehaviorRef.current = 'off'
    setMute(clearedMute)
    setAlarmBehavior('off')
    releaseDisplayWakeLock(wakeLockTag)
    clearPersistedSession()
    setDisplay({ mainCountdown: '--:--', nextCueCountdown: '--:--', nextCueLabel: '', progress: 0, position: null, activeHoursPaused: false, activeHoursResumeAt: 0, nextAudibleAt: 0, nextAudibleLabel: '', runEndsAt: 0, runRemainingMs: 0, runProgress: 0 })
    return true
  }, [clearPersistedSession, releaseLocalAlarm, service, wakeLockTag])

  const applyAlarmBehavior = useCallback((current: AlarmBehavior, next: AlarmBehavior) => {
    updateRuntimeState(muteRef.current, next)
    if (service && runningRef.current) {
      if ((current === 'once') !== (next === 'once')) service.toggleAlarmOnce()
      service.update({ alarmModeEnabled: next === 'locked' })
    }
  }, [updateRuntimeState, service])

  const pressAlarm = useCallback(() => {
    if (alarmTapTimeoutRef.current) {
      clearTimeout(alarmTapTimeoutRef.current)
      alarmTapTimeoutRef.current = null
      const startedFrom = alarmTapStartRef.current ?? alarmBehaviorRef.current
      alarmTapStartRef.current = null
      const current = alarmBehaviorRef.current
      const next = alarmBehaviorAfterGesture(startedFrom, 'double')
      applyAlarmBehavior(current, next)
      return next
    }

    const startedFrom = alarmBehaviorRef.current
    alarmTapStartRef.current = startedFrom
    const next = alarmBehaviorAfterGesture(startedFrom, 'single')
    applyAlarmBehavior(startedFrom, next)
    alarmTapTimeoutRef.current = setTimeout(() => {
      alarmTapTimeoutRef.current = null
      alarmTapStartRef.current = null
    }, 400)
    return next
  }, [applyAlarmBehavior])

  const muteForIterations = useCallback((count: number) => {
    const next = { mutedUntil: 0, iteration: iterationMuteFor(programRef.current, anchorRef.current, Date.now(), count) }
    updateRuntimeState(next, alarmBehaviorRef.current)
    if (service && runningRef.current) service.muteForIterations(count)
    tapHaptic()
  }, [updateRuntimeState, service])

  const muteForSeconds = useCallback((seconds: number) => {
    const next = timestampMuteForSeconds(Date.now(), seconds)
    updateRuntimeState(next, alarmBehaviorRef.current)
    if (service && runningRef.current) service.muteForSeconds(seconds)
    tapHaptic()
  }, [updateRuntimeState, service])

  const muteForMinutes = useCallback((minutes: number) => {
    muteForSeconds(minutes * 60)
  }, [muteForSeconds])

  const muteUntil = useCallback((deadline: number) => {
    if (!Number.isFinite(deadline) || deadline <= Date.now()) return
    updateRuntimeState({ mutedUntil: deadline }, alarmBehaviorRef.current)
    if (service && runningRef.current) service.muteUntil(deadline)
    tapHaptic()
  }, [updateRuntimeState, service])

  const clearMute = useCallback(() => {
    updateRuntimeState(emptyRuntimeMute(), alarmBehaviorRef.current)
    if (service && runningRef.current) service.clearMute()
    selectionHaptic()
  }, [updateRuntimeState, service])

  const syncNativeClock = useCallback(() => {
    const native = service?.getState()
    if (!native?.active) return false
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
  }, [persistSession, refreshDisplay, scheduleDisplayTick, service])

  const setPaused = useCallback((paused: boolean) => {
    if (!runningRef.current || paused === (pausedAtRef.current !== null)) return false
    if (service) {
      const result = service.floatingOverlayAction(paused ? 'pause' : 'resume')
      if (!result.success) return false
      syncNativeClock()
    } else if (paused) {
      if (runKey) alarmQueue?.cancelPending(runKey)
      pausedAtRef.current = Date.now()
      setIsPaused(true)
      scheduleNext()
    } else {
      const delta = Math.max(0, Date.now() - pausedAtRef.current!)
      anchorRef.current += delta
      startedAtRef.current += delta
      if (endsAtRef.current !== null && programRef.current.runPolicy.kind !== 'until') endsAtRef.current += delta
      const oldMute = muteRef.current
      updateRuntimeState({
        mutedUntil: oldMute.mutedUntil > Date.now() ? oldMute.mutedUntil : 0,
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
  }, [alarmQueue, persistSession, refreshDisplay, runKey, scheduleDisplayTick, scheduleNext, syncNativeClock, updateRuntimeState, service])

  const moveTimeline = useCallback((action: { steps: number } | { fraction: number }) => {
    const program = programRef.current
    if (!runningRef.current || alarmPlayerRef.current) return false
    const distance = 'steps' in action ? action.steps : 0
    if ('steps' in action && (!Number.isInteger(distance) || !distance || Math.abs(distance) > 64 || program.mode === 'pattern' || program.steps.length < 2)) return false
    if (service) {
      const command = 'fraction' in action ? `seek-step:${Math.floor(action.fraction * 10_000)}`
        : distance === 1 ? 'next-step' : distance === -1 ? 'previous-step' : `skip-steps:${distance}`
      const result = service.floatingOverlayAction(command)
      if (!result.success) return false
      syncNativeClock()
    } else {
      const now = pausedAtRef.current ?? Date.now()
      let target = { anchor: anchorRef.current, startedAt: startedAtRef.current, terminalAt: endsAtRef.current, completesRun: false }
      if ('fraction' in action) {
        const seek = seekStepTarget(program, target.anchor, now, target.startedAt, target.terminalAt, action.fraction)
        if (!seek) return false
        target = seek
      } else if (program.mode !== 'pattern') {
        for (let i = 0; i < Math.abs(distance); i++) {
          const next = sequenceSkipTarget(program, target.anchor, now, target.startedAt, target.terminalAt, distance > 0 ? 'next' : 'previous')
          if (!next || next.completesRun && i < Math.abs(distance) - 1) return false
          target = next
        }
      }
      if (runKey) alarmQueue?.cancelPending(runKey)
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
    return true
  }, [alarmQueue, finishJsRun, persistSession, refreshDisplay, runKey, scheduleNext, syncNativeClock, updateRuntimeState, service])
  const skipSequenceStep = useCallback((direction: 'next' | 'previous' | number) => {
    const moved = moveTimeline({ steps: direction === 'next' ? 1 : direction === 'previous' ? -1 : direction })
    if (moved && typeof direction !== 'number') selectionHaptic()
    return moved
  }, [moveTimeline])
  const seekStep = useCallback((fraction: number) => moveTimeline({ fraction }), [moveTimeline])

  /** Restarts the live timeline without stopping the session or losing runtime controls. */
  const reanchor = useCallback(async (nextProgram: TimerProgram, alignToClock: boolean, nextSettings = settingsRef.current, nextSourcePreset = sourcePresetRef.current, alarmBehaviorForNewTimer?: AlarmBehavior) => {
    if (!runningRef.current) return false
    const request = ++reanchorRequestRef.current
    nativeUpdateGenerationRef.current += 1
    // A ringing alarm is intentionally exclusive. Never tear it down merely
    // to attempt a replacement that could be rejected.
    if (service && service.getState().ringing) return false
    if (!service && alarmPlayerRef.current) return false
    if (service && (!service.canScheduleExactAlarms() || !supportsProgram(nextProgram))) return false
    if (service && requiresExactSubBellRuntime(nextProgram) && service.getCapabilities()?.supportsSubBellSecondPrecision !== true) return false
    if (service) await service.prepareBuiltInSounds(builtInSoundsFor(nextProgram, nextSettings.alarmSound))
    if (request !== reanchorRequestRef.current || !runningRef.current) return false
    if (service && service.getState().ringing) return false
    const anchor = alignToClock ? alignedAnchorForStart(nextProgram, Date.now()) : Date.now()
    const randomSeed = Date.now()
    const startedAt = Date.now()
    const endsAt = nextProgram.runPolicy.kind === 'until' && alarmBehaviorForNewTimer === undefined
      ? endsAtRef.current
      : runEndAt(nextProgram, anchor, startedAt)
    if (endsAt !== null && endsAt <= startedAt) return false
    const currentMute = muteRef.current
    // Reanchoring changes cycle identities. Preserve timestamp mute, but clear
    // cycle mute so its promised final boundary cannot silently move.
    const nextMute = muteAfterScheduleChange(currentMute)
    const nextAlarm = alarmBehaviorForReanchor(nextProgram, alarmBehaviorRef.current, alarmBehaviorForNewTimer)
    const config = nativeConfigFor(nextProgram, nextSettings, anchor, startedAt, endsAt, nextAlarm === 'locked', randomSeed)
    config.alarmOnceArmed = nextAlarm === 'once'
    config.mutedUntil = nextMute.mutedUntil
    config.mutedIterationEndId = nextMute.iteration?.endsAtLogicalId
    config.mutedIterationEndAt = nextMute.iteration?.endsAt
    config.mutedIterationCount = nextMute.iteration?.iterations
    if (!service && nextProgram.mode === 'unified') {
      const session = {
        schemaVersion: 3 as const, sessionId: sessionIdRef.current!, randomAlgorithmVersion: 1 as const,
        anchor, randomSeed, startedAt, ...(endsAt !== null ? { endsAt } : {}),
        program: nextProgram, settings: nextSettings, mute: nextMute, alarmBehavior: nextAlarm,
        sourcePreset: nextSourcePreset, soundState: { sequence: {}, randomPrevious: {} },
      }
      const saved = scoped
        ? await saveUnifiedTimerRun(AsyncStorage, session, 'update')
        : await saveUnifiedTimerSession(AsyncStorage, session)
      if (request !== reanchorRequestRef.current || !runningRef.current) return false
      setSessionPersistenceError(saved.ok ? null : saved.reason)
      if (!saved.ok) return false
    }
    if (service && !service.start(config)) return false
    if (!service && runKey) alarmQueue?.cancelPending(runKey)
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    timeoutRef.current = null
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
    nativeGenerationRef.current = service ? service.getState().sessionGeneration : undefined
    await persistSession(nextMute, nextAlarm)
    if (request !== reanchorRequestRef.current || !runningRef.current) return false
    if (!service) scheduleNext()
    return true
  }, [alarmQueue, dismissAlarm, persistSession, runKey, scheduleNext, updateRuntimeState, scoped, service])

  useEffect(() => {
    const subscription = AppState.addEventListener('change', nextState => {
      if (nextState !== 'active') {
        if (refreshIntervalRef.current) clearTimeout(refreshIntervalRef.current)
        refreshIntervalRef.current = null
        releaseDisplayWakeLock(wakeLockTag)
        return
      }
      if (!runningRef.current) return
      scheduleDisplayTick()
      void activateDisplayWakeLock(wakeLockTag)
      if (service) {
        const native = service.getState()
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
      if (!service) scheduleNext()
    })
    return () => subscription.remove()
  }, [refreshDisplay, scheduleDisplayTick, scheduleNext, service, stop, syncNativeClock, updateRuntimeState, wakeLockTag])

  useEffect(() => {
    if (!service) return
    setIsAlarmRinging(service.isRinging())
    const listener = service.addAlarmListener(ringing => {
      if (ringing) service.stopSoundPreview()
      setIsAlarmRinging(ringing)
    })
    return () => listener?.remove()
  }, [service])

  useEffect(() => {
    if (!service) return
    const listener = service.addTimerStateListener(state => {
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
  }, [service, stop, syncNativeClock])

  useEffect(() => {
    if (!service) return
    const listener = service.addControlListener(state => {
      const nextMute: RuntimeMuteState = state.mutedIterationEndId && state.mutedIterationEndAt
        ? { mutedUntil: state.mutedUntil, iteration: { endsAtLogicalId: state.mutedIterationEndId, endsAt: state.mutedIterationEndAt, iterations: Math.max(1, state.mutedIterationsRemaining) } }
        : { mutedUntil: state.mutedUntil }
      const nextAlarm = alarmBehaviorRef.current === 'locked' ? 'locked' : state.alarmOnceArmed ? 'once' : 'off'
      updateRuntimeState(nextMute, nextAlarm)
    })
    return () => listener?.remove()
  }, [service, updateRuntimeState])

  useEffect(() => {
    if (!service) return
    const listener = service.addTimerEventListener(event => {
      service.stopSoundPreview()
      const projected = nextProgramEvent(programRef.current, anchorRef.current, event.at - 1, startedAtRef.current, endsAtRef.current, randomSeedRef.current || anchorRef.current)
      const matchesSession = projected?.logicalId === event.logicalId && projected.at === event.at
      if (shouldSurfaceTimerSignal(event, Date.now(), AppState.currentState === 'active') && matchesSession && programEventIsVisible(programRef.current, projected)) {
        // Android performs cue haptics beside its exact alarm so background and
        // foreground behavior match without producing a double vibration here.
        if (Platform.OS !== 'android') timerCueHaptic(event.boundary, settingsRef.current.haptics)
        setEventPulse(value => value + 1)
      }
      if (event.completesRun && matchesSession && projected.completesRun) setCompletionPulse(value => value + 1)
    })
    return () => listener?.remove()
  }, [service])

  useEffect(() => {
    if (!runningRef.current) return
    // Keep the recoverable working program current even on the web fallback;
    // native Android additionally receives the debounced authoritative update.
    persistSession(muteRef.current, alarmBehaviorRef.current)
    if (!service) {
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
      void service.prepareBuiltInSounds(builtInSoundsFor(updateProgram, settingsRef.current.alarmSound)).then(() => {
        if (runningRef.current && updateGeneration === nativeUpdateGenerationRef.current && randomSeedRef.current === updateSeed && programRef.current === updateProgram) {
          service.update(nativeConfigFor(updateProgram, settingsRef.current, anchorRef.current, startedAtRef.current, endsAtRef.current, alarmBehaviorRef.current === 'locked', randomSeedRef.current || anchorRef.current))
        }
      }).catch(() => undefined)
    }, 120)
    return () => {
      if (nativeUpdateRef.current) clearTimeout(nativeUpdateRef.current)
      nativeUpdateRef.current = null
    }
  }, [persistSession, program, scheduleNext, service, settings])

  useEffect(() => () => {
    reanchorRequestRef.current += 1
    nativeUpdateGenerationRef.current += 1
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    if (refreshIntervalRef.current) clearTimeout(refreshIntervalRef.current)
    if (nativeUpdateRef.current) clearTimeout(nativeUpdateRef.current)
    if (alarmTapTimeoutRef.current) clearTimeout(alarmTapTimeoutRef.current)
    alarmTapStartRef.current = null
    playerRef.current?.remove()
    releaseLocalAlarm()
    releaseDisplayWakeLock(wakeLockTag)
  }, [releaseLocalAlarm, wakeLockTag])

  return {
    ...display,
    sessionId: sessionIdRef.current,
    nativeGeneration: nativeGenerationRef.current,
    sessionPersistenceError,
    getSessionIdentity,
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
    muteUntil,
    clearMute,
    eventPulse,
    completionPulse,
    runtimeInterruption,
    clearRuntimeInterruption,
    setPaused,
    skipSequenceStep,
    seekStep,
    reanchor,
  }
}

// Keeps delay calculation explicit and prevents a stale ``now`` closure from
// scheduling a negative timeout after a costly state update.
function firedAtSafe(fallback: number): number {
  const current = Date.now()
  return Number.isFinite(current) ? current : fallback
}
