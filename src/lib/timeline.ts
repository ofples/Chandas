import type { CueSettings, PatternProgram, RuntimeTimerProgram, SequenceProgram, SoundRef, TimerMode, TimerProgram, UnifiedTimerProgram } from '../types'
import { patternDurationSeconds, sequenceStepDurationSeconds, trackCadenceSeconds, trackEventOffsetsSeconds } from './timerV2'
import { nextUnifiedProgramEvent, unifiedProgramDurationMs, unifiedRunEndAt, unifiedSkipTarget, unifiedTimelinePosition, type UnifiedScheduledEvent } from './unified-timeline'

export interface TimelineCueCandidate {
  cueId: string
  sourceCueId?: string
  stepId?: string
  trackId?: string
  showOnWatchFace?: boolean
  kind: 'pattern-main' | 'pattern-track' | 'sequence-step' | 'run-complete'
  alarmEnabled?: boolean
  sound: SoundRef
  volume: number
  sounds?: SoundRef[]
  soundMode?: CueSettings['soundMode']
  hapticOverride?: CueSettings['hapticOverride']
  cadenceMinutes?: number
  cadenceSeconds?: number
  trackOrder?: number
}

export interface ScheduledProgramEvent {
  at: number
  logicalId: string
  cycleIndex: number
  boundary: 'pattern-main' | 'pattern-offset' | 'sequence-step' | 'sequence-cycle' | 'run-complete'
  candidates: TimelineCueCandidate[]
  winner: TimelineCueCandidate
  collision: boolean
  completesRun: boolean
  stepId?: string
  stepIndex?: number
  showOnWatchFace?: boolean
}

export interface TimelinePosition {
  mode: TimerMode
  anchor: number
  randomSeed: number
  cycleIndex: number
  cycleProgress: number
  currentStepIndex?: number
  stepProgress?: number
  nextEvent: ScheduledProgramEvent | null
}

/** Visual progress between cue boundaries inside the current Pattern cycle. */
export function cueSegmentProgress(offsets: number[], mainMinutes: number, elapsedMinutes: number): number {
  const selected = [...offsets].sort((left, right) => left - right)
  const next = selected.find(offset => offset > elapsedMinutes) ?? mainMinutes
  const previous = [...selected].reverse().find(offset => offset <= elapsedMinutes) ?? 0
  if (next <= previous) return 0
  return Math.max(0, Math.min(1, (elapsedMinutes - previous) / (next - previous)))
}

function cycleIndexAt(now: number, anchor: number, duration: number): number {
  return Math.max(0, Math.floor((now - anchor) / duration))
}

function logicalId(mode: TimerMode, anchor: number, cycleIndex: number, boundary: string): string {
  return `${mode}:${anchor}:${cycleIndex}:${boundary}`
}

function winnerForCandidates(candidates: TimelineCueCandidate[]): TimelineCueCandidate {
  // A slower bell carries more structural weight. Stable track order breaks the
  // uncommon tie between two tracks with the same repeat interval.
  return candidates.slice().sort((left, right) =>
    (right.cadenceSeconds ?? (right.cadenceMinutes ?? 0) * 60) - (left.cadenceSeconds ?? (left.cadenceMinutes ?? 0) * 60)
      || (left.trackOrder ?? Number.MAX_SAFE_INTEGER) - (right.trackOrder ?? Number.MAX_SAFE_INTEGER),
  )[0]
}

/** Schema-4 programs use the same audio/alarm gates as retained legacy sessions. */
function unifiedRuntimeEvent(event: UnifiedScheduledEvent, singleStep: boolean): ScheduledProgramEvent {
  const candidates = event.candidates.map<TimelineCueCandidate>(candidate => ({
    cueId: candidate.cueId,
    sourceCueId: candidate.sourceCueId,
    stepId: candidate.stepId,
    trackId: candidate.trackId,
    showOnWatchFace: candidate.showOnWatchFace,
    kind: candidate.kind === 'sub-bell' ? 'pattern-track' : candidate.kind === 'step-end' ? (singleStep ? 'pattern-main' : 'sequence-step') : 'run-complete',
    alarmEnabled: candidate.alarmEnabled,
    sound: candidate.sound, volume: candidate.volume, sounds: candidate.sounds, soundMode: candidate.soundMode, hapticOverride: candidate.hapticOverride,
    cadenceSeconds: candidate.cadencePriority > 0 ? candidate.cadenceSeconds : undefined,
    trackOrder: candidate.trackOrder,
  }))
  return {
    at: event.at, logicalId: event.logicalId, cycleIndex: event.roundIndex,
    stepId: event.stepId, stepIndex: event.stepIndex,
    boundary: event.boundary === 'step-offset' ? 'pattern-offset' : event.boundary === 'step-end' ? (singleStep ? 'pattern-main' : 'sequence-step') : event.boundary === 'round-end' ? (singleStep ? 'pattern-main' : 'sequence-cycle') : 'run-complete',
    candidates, winner: candidates[event.candidates.indexOf(event.winner)], collision: event.collision, completesRun: event.completesRun,
    showOnWatchFace: event.showOnWatchFace,
  }
}

export function nextPatternEvent(program: PatternProgram, anchor: number, now = Date.now(), randomSeed = anchor): ScheduledProgramEvent {
  const duration = patternDurationSeconds(program) * 1_000
  let cycleIndex = cycleIndexAt(now, anchor, duration)
  while (true) {
    const cycleStart = anchor + cycleIndex * duration
    const candidatesByTime = new Map<number, TimelineCueCandidate[]>()
    const mainAt = cycleStart + duration
    candidatesByTime.set(mainAt, [{
      cueId: 'main', kind: 'pattern-main', sound: program.mainCue.sound, volume: program.mainCue.volume, sounds: program.mainCue.sounds, soundMode: program.mainCue.soundMode, hapticOverride: program.mainCue.hapticOverride,
    }])
    if (program.subBellsEnabled !== false) program.tracks.forEach((track, trackOrder) => {
      if (!track.enabled) return
      trackEventOffsetsSeconds(track, duration / 1_000, cycleIndex, randomSeed).forEach(offsetSeconds => {
        const at = cycleStart + offsetSeconds * 1_000
        if (at >= mainAt) return
        const candidates = candidatesByTime.get(at) ?? []
        candidates.push({
          cueId: track.id,
          kind: 'pattern-track',
          sound: track.sound,
          volume: track.volume,
          sounds: track.sounds, soundMode: track.soundMode, hapticOverride: track.hapticOverride,
          ...(track.repeatEnabled === false ? {} : { cadenceMinutes: track.cadenceMinutes, cadenceSeconds: trackCadenceSeconds(track) }),
          trackOrder,
        })
        candidatesByTime.set(at, candidates)
      })
    })
    const at = [...candidatesByTime.keys()].filter(time => time > now).sort((a, b) => a - b)[0]
    if (at !== undefined) {
      const candidates = candidatesByTime.get(at)!
      const winner = candidates[0].kind === 'pattern-main' ? candidates[0] : winnerForCandidates(candidates)
      const offsetSeconds = Math.round((at - cycleStart) / 1_000)
      const boundary = winner.kind === 'pattern-main' ? 'main' : offsetSeconds % 60 === 0 ? `offset:${offsetSeconds / 60}` : `offset-seconds:${offsetSeconds}`
      return {
        at,
        logicalId: logicalId('pattern', anchor, cycleIndex, boundary),
        cycleIndex,
        boundary: winner.kind === 'pattern-main' ? 'pattern-main' : 'pattern-offset',
        candidates,
        winner,
        collision: candidates.length > 1,
        completesRun: false,
      }
    }
    cycleIndex += 1
  }
}

export function nextSequenceEvent(program: SequenceProgram, anchor: number, now = Date.now()): ScheduledProgramEvent {
  const offsets = program.steps.reduce<number[]>((values, step) => [...values, (values.at(-1) ?? 0) + sequenceStepDurationSeconds(step) * 1_000], [])
  const cycleDuration = offsets.at(-1)
  if (!cycleDuration) throw new Error('Sequence requires at least one positive-duration step')
  let cycleIndex = cycleIndexAt(now, anchor, cycleDuration)
  while (true) {
    const cycleStart = anchor + cycleIndex * cycleDuration
    const stepIndex = offsets.findIndex(offset => cycleStart + offset > now)
    if (stepIndex >= 0) {
      const step = program.steps[stepIndex]
      const at = cycleStart + offsets[stepIndex]
      const winner: TimelineCueCandidate = { cueId: step.id, kind: 'sequence-step', alarmEnabled: step.alarmEnabled === true, sound: step.sound, volume: step.volume, sounds: step.sounds, soundMode: step.soundMode, hapticOverride: step.hapticOverride }
      return {
        at,
        logicalId: logicalId('sequence', anchor, cycleIndex, `step:${stepIndex}`),
        cycleIndex,
        boundary: stepIndex === program.steps.length - 1 ? 'sequence-cycle' : 'sequence-step',
        candidates: [winner],
        winner,
        collision: false,
        completesRun: false,
      }
    }
    cycleIndex += 1
  }
}

export function programCycleDurationMs(program: RuntimeTimerProgram): number {
  if (program.mode === 'unified') return unifiedProgramDurationMs(program)
  return program.mode === 'pattern'
    ? patternDurationSeconds(program) * 1_000
    : program.steps.reduce((total, step) => total + sequenceStepDurationSeconds(step) * 1_000, 0)
}

export function runEndAt(program: RuntimeTimerProgram, anchor: number, startedAt: number): number | null {
  if (program.mode === 'unified') return unifiedRunEndAt(program, anchor, startedAt)
  if (program.runPolicy.kind === 'continuous') return null
  if (program.runPolicy.kind === 'duration') return startedAt + program.runPolicy.durationSeconds * 1_000
  const duration = programCycleDurationMs(program)
  // A snapped program can have a phase anchor before Start. Count only cycle
  // boundaries strictly after the accepted start timestamp.
  const firstBoundary = anchor + (Math.floor((startedAt - anchor) / duration) + 1) * duration
  return firstBoundary + (program.runPolicy.cycleCount - 1) * duration
}

/** Overall progress through a bounded run, independent of its current cycle. */
export function boundedRunProgress(startedAt: number, terminalAt: number | null, now = Date.now()): number {
  if (terminalAt === null || terminalAt <= startedAt) return 0
  return Math.max(0, Math.min(1, (now - startedAt) / (terminalAt - startedAt)))
}

function completionCandidate(program: TimerProgram): TimelineCueCandidate {
  const cue = program.completionCue ?? (program.mode === 'pattern' ? program.mainCue : program.steps.at(-1)!)
  return { cueId: 'completion', kind: 'run-complete', sound: cue.sound, volume: cue.volume, sounds: cue.sounds, soundMode: cue.soundMode, hapticOverride: cue.hapticOverride }
}

/** Returns null once a bounded run has reached or passed its terminal instant. */
export function nextProgramEvent(program: RuntimeTimerProgram, anchor: number, now = Date.now(), startedAt = anchor, terminalAt = runEndAt(program, anchor, startedAt), randomSeed = anchor): ScheduledProgramEvent | null {
  if (program.mode === 'unified') {
    const event = nextUnifiedProgramEvent(program, anchor, now, startedAt, terminalAt, randomSeed)
    return event ? unifiedRuntimeEvent(event, program.steps.length === 1) : null
  }
  const endAt = terminalAt
  if (endAt !== null && now >= endAt) return null
  const next = program.mode === 'pattern' ? nextPatternEvent(program, anchor, now, randomSeed) : nextSequenceEvent(program, anchor, now)
  if (endAt === null || next.at < endAt) return next
  if (next.at === endAt) {
    if (!program.completionCue) return { ...next, completesRun: true }
    const winner = completionCandidate(program)
    return { ...next, candidates: [winner], winner, collision: false, completesRun: true }
  }
  const winner = completionCandidate(program)
  return {
    at: endAt,
    logicalId: `${program.mode}:${anchor}:complete:${startedAt}:${endAt}`,
    cycleIndex: Math.max(0, Math.floor((endAt - anchor) / programCycleDurationMs(program))),
    boundary: 'run-complete',
    candidates: [winner],
    winner,
    collision: false,
    completesRun: true,
  }
}

export function timelinePosition(program: RuntimeTimerProgram, anchor: number, now = Date.now(), startedAt = anchor, terminalAt = runEndAt(program, anchor, startedAt), randomSeed = anchor): TimelinePosition {
  if (program.mode === 'unified') {
    const position = unifiedTimelinePosition(program, anchor, now, startedAt, terminalAt, randomSeed)
    return { mode: program.steps.length === 1 ? 'pattern' : 'sequence', anchor, randomSeed, cycleIndex: position.roundIndex, cycleProgress: position.roundProgress, currentStepIndex: position.currentStepIndex, stepProgress: position.stepProgress, nextEvent: position.nextEvent ? unifiedRuntimeEvent(position.nextEvent, program.steps.length === 1) : null }
  }
  const nextEvent = nextProgramEvent(program, anchor, now, startedAt, terminalAt, randomSeed)
  if (program.mode === 'pattern') {
    const duration = patternDurationSeconds(program) * 1_000
    const cycleIndex = cycleIndexAt(now, anchor, duration)
    const cycleStart = anchor + cycleIndex * duration
    return { mode: 'pattern', anchor, randomSeed, cycleIndex, cycleProgress: Math.max(0, Math.min(1, (now - cycleStart) / duration)), nextEvent }
  }
  const offsets = program.steps.reduce<number[]>((values, step) => [...values, (values.at(-1) ?? 0) + sequenceStepDurationSeconds(step) * 1_000], [])
  const total = offsets.at(-1)!
  const cycleIndex = cycleIndexAt(now, anchor, total)
  const cycleStart = anchor + cycleIndex * total
  const elapsed = Math.max(0, now - cycleStart)
  const currentStepIndex = offsets.findIndex(offset => elapsed < offset)
  const previous = currentStepIndex === 0 ? 0 : offsets[currentStepIndex - 1]
  const stepDuration = offsets[currentStepIndex] - previous
  return {
    mode: 'sequence',
    anchor,
    randomSeed,
    cycleIndex,
    cycleProgress: Math.max(0, Math.min(1, elapsed / total)),
    currentStepIndex,
    stepProgress: Math.max(0, Math.min(1, (elapsed - previous) / stepDuration)),
    nextEvent,
  }
}

export interface SequenceSkipTarget {
  anchor: number
  startedAt: number
  terminalAt: number | null
  completesRun: boolean
}

/** Silently places an adjacent step at its beginning while preserving round count. */
export function sequenceSkipTarget(program: SequenceProgram | UnifiedTimerProgram, anchor: number, now: number, startedAt: number, terminalAt: number | null, direction: 'next' | 'previous'): SequenceSkipTarget | null {
  if (program.mode === 'unified') return unifiedSkipTarget(program, anchor, now, startedAt, terminalAt, direction)
  if (program.steps.length < 2) return null
  const position = timelinePosition(program, anchor, now, startedAt, terminalAt)
  const index = position.currentStepIndex ?? 0
  if (direction === 'previous' && index === 0 && position.cycleIndex === 0 && terminalAt !== null) return null
  if (direction === 'next' && index === program.steps.length - 1 && terminalAt !== null && position.nextEvent?.completesRun) {
    return { anchor, startedAt, terminalAt, completesRun: true }
  }
  const target = (index + (direction === 'next' ? 1 : -1) + program.steps.length) % program.steps.length
  const targetCycle = direction === 'next' && target === 0 ? position.cycleIndex + 1 : direction === 'previous' && index === 0 && position.cycleIndex > 0 ? position.cycleIndex - 1 : position.cycleIndex
  const before = program.steps.slice(0, target).reduce((sum, step) => sum + sequenceStepDurationSeconds(step) * 1_000, 0)
  const nextAnchor = now - targetCycle * programCycleDurationMs(program) - before
  const delta = nextAnchor - anchor
  const cycleBounded = program.runPolicy.kind === 'cycles'
  return {
    anchor: nextAnchor,
    startedAt: cycleBounded ? startedAt + delta : startedAt,
    terminalAt: cycleBounded && terminalAt !== null ? terminalAt + delta : terminalAt,
    completesRun: false,
  }
}
