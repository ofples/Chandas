import type { CueSettings, SoundRef, UnifiedSubBellTrack, UnifiedTimerProgram, UnifiedTimerStep } from '../types'
import { alignedClockAnchor } from './clockAlignment'
import { randomTrackOffsetsSeconds } from './timerV2'

const SECOND_MS = 1_000
const MAX_MUTE_ITERATIONS = 99

export type UnifiedEventBoundary = 'step-end' | 'round-end' | 'step-offset' | 'run-complete'

export interface UnifiedCueCandidate {
  /** Stable, unambiguous cue key. For track cues it includes both step and track IDs. */
  cueId: string
  sourceCueId: string
  stepId: string
  trackId?: string
  kind: 'step-end' | 'sub-bell' | 'run-complete'
  alarmEnabled?: boolean
  sound: SoundRef
  volume: number
  sounds?: SoundRef[]
  soundMode?: CueSettings['soundMode']
  hapticOverride?: CueSettings['hapticOverride']
  showOnWatchFace: boolean
  cadenceSeconds?: number
  cadencePriority: number
  trackOrder?: number
}

export interface UnifiedScheduledEvent {
  at: number
  logicalId: string
  roundIndex: number
  cycleIndex: number
  stepIndex: number
  stepId: string
  offsetSeconds?: number
  boundary: UnifiedEventBoundary
  isRoundEnd: boolean
  candidates: UnifiedCueCandidate[]
  winner: UnifiedCueCandidate
  collision: boolean
  completesRun: boolean
  showOnWatchFace: boolean
}

export interface UnifiedTimelinePosition {
  anchor: number
  randomSeed: number
  roundIndex: number
  cycleIndex: number
  roundProgress: number
  currentStepIndex: number
  currentStepId: string
  stepProgress: number
  nextEvent: UnifiedScheduledEvent | null
}

export interface UnifiedIterationEnd { logicalId: string; at: number; iterations: number }
export interface UnifiedSkipTarget { anchor: number; startedAt: number; terminalAt: number | null; completesRun: boolean }

/** Encode arbitrary IDs without delimiter ambiguity; lengths use JS UTF-16 code units. */
export function unifiedCueIdentity(stepId: string, trackId?: string): string {
  const part = (value: string) => `${value.length}:${value}`
  return trackId === undefined ? `step:${part(stepId)}` : `track:${part(stepId)}${part(trackId)}`
}

function durations(program: UnifiedTimerProgram): number[] {
  if (!program.steps.length) throw new Error('Unified program requires at least one step')
  return program.steps.map(step => {
    if (!Number.isSafeInteger(step.durationSeconds) || step.durationSeconds < 1 || step.durationSeconds > 14_400) throw new Error('Unified step duration must be 1 to 14,400 exact seconds')
    return step.durationSeconds * SECOND_MS
  })
}

export function unifiedProgramDurationMs(program: UnifiedTimerProgram): number {
  return durations(program).reduce((sum, value) => sum + value, 0)
}

export function unifiedAlignedAnchor(program: UnifiedTimerProgram, now: number): number | null {
  if (program.alignment.kind !== 'local-clock') return null
  return alignedClockAnchor(unifiedProgramDurationMs(program) / SECOND_MS, program.alignment.offsetMinutes, now)
}

export function unifiedRunEndAt(program: UnifiedTimerProgram, anchor: number, startedAt: number): number | null {
  const policy = program.runPolicy
  if (policy.kind === 'continuous') return null
  if (policy.kind === 'duration') return startedAt + policy.durationSeconds * SECOND_MS
  const duration = unifiedProgramDurationMs(program)
  const firstBoundary = anchor + (Math.floor((startedAt - anchor) / duration) + 1) * duration
  return firstBoundary + (policy.cycleCount - 1) * duration
}

function roundAt(now: number, anchor: number, duration: number): number {
  return Math.max(0, Math.floor((now - anchor) / duration))
}

function cueCandidate(cue: CueSettings, step: UnifiedTimerStep, stepIndex: number, track?: UnifiedSubBellTrack, trackOrder?: number): UnifiedCueCandidate {
  const isTrack = !!track
  return {
    cueId: unifiedCueIdentity(step.id, track?.id),
    sourceCueId: isTrack ? track.id : step.id,
    stepId: step.id,
    ...(track ? { trackId: track.id } : {}),
    kind: isTrack ? 'sub-bell' : 'step-end',
    ...(!isTrack && step.endAlarmEnabled ? { alarmEnabled: true } : {}),
    sound: cue.sound,
    volume: cue.volume,
    ...(cue.sounds ? { sounds: cue.sounds } : {}),
    ...(cue.soundMode ? { soundMode: cue.soundMode } : {}),
    ...(cue.hapticOverride ? { hapticOverride: cue.hapticOverride } : {}),
    showOnWatchFace: track?.showOnWatchFace !== false,
    ...(track ? { cadenceSeconds: track.cadenceSeconds, cadencePriority: track.repeatEnabled ? track.cadenceSeconds : 0, trackOrder } : { cadencePriority: 0 }),
  }
}

function randomOffsets(track: UnifiedSubBellTrack, durationSeconds: number, roundIndex: number, seedAnchor: number): number[] {
  return track.randomRepeat ? randomTrackOffsetsSeconds(track.id, track.randomRepeat, durationSeconds, roundIndex, seedAnchor) : []
}

function offsetsForTrack(track: UnifiedSubBellTrack, durationSeconds: number, roundIndex: number, randomSeed: number): number[] {
  const offsets = track.repeatEnabled ? track.selectedOffsetsSeconds : []
  const values = [...offsets, ...randomOffsets(track, durationSeconds, roundIndex, randomSeed)]
  if (track.afterStartSeconds !== undefined) values.push(track.afterStartSeconds)
  if (track.beforeEndSeconds !== undefined) values.push(durationSeconds - track.beforeEndSeconds)
  return [...new Set(values.filter(value => Number.isSafeInteger(value) && value > 0 && value < durationSeconds))].sort((a, b) => a - b)
}

function winnerFor(candidates: UnifiedCueCandidate[]): UnifiedCueCandidate {
  return candidates.slice().sort((a, b) => b.cadencePriority - a.cadencePriority || (a.trackOrder ?? Number.MAX_SAFE_INTEGER) - (b.trackOrder ?? Number.MAX_SAFE_INTEGER))[0]
}

function candidateGroups(program: UnifiedTimerProgram, roundIndex: number, stepIndex: number, stepStart: number, randomSeed: number, visibleOnly: boolean): Map<number, UnifiedCueCandidate[]> {
  const step = program.steps[stepIndex]
  const durationSeconds = step.durationSeconds
  const endAt = stepStart + durationSeconds * SECOND_MS
  const result = new Map<number, UnifiedCueCandidate[]>()
  result.set(endAt, [cueCandidate(step.endCue, step, stepIndex)])
  if (!step.subBellsEnabled) return result
  step.subBellTracks.forEach((track, trackOrder) => {
    if (!track.enabled || (visibleOnly && !track.showOnWatchFace)) return
    offsetsForTrack(track, durationSeconds, roundIndex, randomSeed).forEach(offsetSeconds => {
      const at = stepStart + offsetSeconds * SECOND_MS
      const candidates = result.get(at) ?? []
      candidates.push(cueCandidate(track, step, stepIndex, track, trackOrder))
      result.set(at, candidates)
    })
  })
  return result
}

function completionCandidate(program: UnifiedTimerProgram): UnifiedCueCandidate {
  const last = program.steps[program.steps.length - 1]
  const cue = program.completionCue ?? last.endCue
  return {
    cueId: 'run-complete', sourceCueId: 'run-complete', stepId: last.id, kind: 'run-complete',
    sound: cue.sound, volume: cue.volume, ...(cue.sounds ? { sounds: cue.sounds } : {}),
    ...(cue.soundMode ? { soundMode: cue.soundMode } : {}), ...(cue.hapticOverride ? { hapticOverride: cue.hapticOverride } : {}),
    showOnWatchFace: true, cadencePriority: 0,
  }
}

function naturalEvent(program: UnifiedTimerProgram, anchor: number, now: number, randomSeed: number, visibleOnly: boolean): UnifiedScheduledEvent | null {
  const stepDurations = durations(program)
  const roundDuration = stepDurations.reduce((sum, value) => sum + value, 0)
  let roundIndex = roundAt(now, anchor, roundDuration)
  while (roundIndex < Number.MAX_SAFE_INTEGER / roundDuration) {
    const roundStart = anchor + roundIndex * roundDuration
    let stepStart = roundStart
    for (let stepIndex = 0; stepIndex < program.steps.length; stepIndex += 1) {
      const step = program.steps[stepIndex]
      const stepDuration = stepDurations[stepIndex]
      if (stepStart + stepDuration <= now) {
        stepStart += stepDuration
        continue
      }
      const groups = candidateGroups(program, roundIndex, stepIndex, stepStart, randomSeed, visibleOnly)
      const at = [...groups.keys()].filter(time => time > now).sort((a, b) => a - b)[0]
      if (at !== undefined) {
        const candidates = groups.get(at)!
        const winner = winnerFor(candidates)
        const isRoundEnd = stepIndex === program.steps.length - 1 && at === stepStart + stepDuration
        const isStepEnd = at === stepStart + stepDuration
        const offsetSeconds = isStepEnd ? undefined : Math.round((at - stepStart) / SECOND_MS)
        const semantic = isStepEnd ? `${anchor}:${roundIndex}:${unifiedCueIdentity(step.id)}:end` : `${anchor}:${roundIndex}:${unifiedCueIdentity(step.id)}:${offsetSeconds}`
        return {
          at, logicalId: `unified:${semantic}`, roundIndex, cycleIndex: roundIndex, stepIndex, stepId: step.id,
          ...(offsetSeconds !== undefined ? { offsetSeconds } : {}),
          boundary: isStepEnd ? (isRoundEnd ? 'round-end' : 'step-end') : 'step-offset', isRoundEnd,
          candidates, winner, collision: candidates.length > 1, completesRun: false,
          showOnWatchFace: candidates.some(candidate => candidate.showOnWatchFace),
        }
      }
      stepStart += stepDuration
    }
    roundIndex += 1
  }
  return null
}

/** Finds only the next event; one step's tracks are expanded at a time. */
export function nextUnifiedProgramEvent(
  program: UnifiedTimerProgram,
  anchor: number,
  now = Date.now(),
  startedAt = anchor,
  terminalAt = unifiedRunEndAt(program, anchor, startedAt),
  randomSeed = anchor,
  visibleOnly = false,
): UnifiedScheduledEvent | null {
  if (terminalAt !== null && now >= terminalAt) return null
  const natural = naturalEvent(program, anchor, now, randomSeed, visibleOnly)
  if (!natural || terminalAt === null || natural.at < terminalAt) return natural
  if (natural.at === terminalAt) {
    if (!program.completionCue) return { ...natural, completesRun: true, showOnWatchFace: true }
    const winner = completionCandidate(program)
    return { ...natural, candidates: [winner], winner, collision: false, completesRun: true, showOnWatchFace: true }
  }
  const winner = completionCandidate(program)
  const roundDuration = unifiedProgramDurationMs(program)
  return {
    at: terminalAt, logicalId: `unified:${anchor}:complete:${startedAt}:${terminalAt}`,
    roundIndex: Math.max(0, Math.floor((terminalAt - anchor) / roundDuration)),
    cycleIndex: Math.max(0, Math.floor((terminalAt - anchor) / roundDuration)),
    stepIndex: program.steps.length - 1, stepId: program.steps[program.steps.length - 1].id,
    boundary: 'run-complete', isRoundEnd: false, candidates: [winner], winner, collision: false,
    completesRun: true, showOnWatchFace: true,
  }
}

export function unifiedTimelinePosition(
  program: UnifiedTimerProgram,
  anchor: number,
  now = Date.now(),
  startedAt = anchor,
  terminalAt = unifiedRunEndAt(program, anchor, startedAt),
  randomSeed = anchor,
): UnifiedTimelinePosition {
  const stepDurations = durations(program)
  const roundDuration = stepDurations.reduce((sum, value) => sum + value, 0)
  const roundIndex = roundAt(now, anchor, roundDuration)
  const roundStart = anchor + roundIndex * roundDuration
  const roundElapsed = Math.max(0, now - roundStart)
  let accumulated = 0
  let currentStepIndex = stepDurations.findIndex(value => { accumulated += value; return roundElapsed < accumulated })
  if (currentStepIndex < 0) currentStepIndex = program.steps.length - 1
  const stepStartElapsed = stepDurations.slice(0, currentStepIndex).reduce((sum, value) => sum + value, 0)
  const stepDuration = stepDurations[currentStepIndex]
  return {
    anchor, randomSeed, roundIndex, cycleIndex: roundIndex,
    roundProgress: Math.max(0, Math.min(1, roundElapsed / roundDuration)),
    currentStepIndex, currentStepId: program.steps[currentStepIndex].id,
    stepProgress: Math.max(0, Math.min(1, (roundElapsed - stepStartElapsed) / stepDuration)),
    nextEvent: nextUnifiedProgramEvent(program, anchor, now, startedAt, terminalAt, randomSeed),
  }
}

export function unifiedIterationEnd(program: UnifiedTimerProgram, anchor: number, now: number, count: number): UnifiedIterationEnd {
  const duration = unifiedProgramDurationMs(program)
  const iterations = Math.max(1, Math.min(MAX_MUTE_ITERATIONS, Math.round(count)))
  const roundIndex = roundAt(now, anchor, duration)
  const endingRound = roundIndex + iterations - 1
  const last = program.steps[program.steps.length - 1]
  return { logicalId: `unified:${anchor}:${endingRound}:${unifiedCueIdentity(last.id)}:end`, at: anchor + (endingRound + 1) * duration, iterations }
}

export function unifiedSkipTarget(program: UnifiedTimerProgram, anchor: number, now: number, startedAt: number, terminalAt: number | null, direction: 'next' | 'previous'): UnifiedSkipTarget | null {
  if (program.steps.length < 2) return null
  const position = unifiedTimelinePosition(program, anchor, now, startedAt, terminalAt)
  const index = position.currentStepIndex
  const roundDuration = unifiedProgramDurationMs(program)
  if (direction === 'previous' && index === 0 && position.roundIndex === 0 && terminalAt !== null) return null
  const currentRoundEnd = anchor + (position.roundIndex + 1) * roundDuration
  if (direction === 'next' && index === program.steps.length - 1 && terminalAt !== null && currentRoundEnd >= terminalAt) return { anchor, startedAt, terminalAt, completesRun: true }
  const target = (index + (direction === 'next' ? 1 : -1) + program.steps.length) % program.steps.length
  const targetRound = direction === 'next' && target === 0 ? position.roundIndex + 1 : direction === 'previous' && index === 0 && position.roundIndex > 0 ? position.roundIndex - 1 : position.roundIndex
  const before = durations(program).slice(0, target).reduce((sum, value) => sum + value, 0)
  const nextAnchor = now - targetRound * roundDuration - before
  const delta = nextAnchor - anchor
  const cycleBounded = program.runPolicy.kind === 'cycles'
  return {
    anchor: nextAnchor,
    startedAt: cycleBounded ? startedAt + delta : startedAt,
    terminalAt: cycleBounded && terminalAt !== null ? terminalAt + delta : terminalAt,
    completesRun: false,
  }
}
