import type { PatternProgram, SequenceProgram, SoundRef, TimerMode, TimerProgram } from '../types'

export interface TimelineCueCandidate {
  cueId: string
  kind: 'pattern-main' | 'pattern-track' | 'sequence-step' | 'run-complete'
  sound: SoundRef
  volume: number
  cadenceMinutes?: number
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
}

export interface TimelinePosition {
  mode: TimerMode
  cycleIndex: number
  cycleProgress: number
  currentStepIndex?: number
  stepProgress?: number
  nextEvent: ScheduledProgramEvent | null
}

const MINUTE_MS = 60_000

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
    (right.cadenceMinutes ?? 0) - (left.cadenceMinutes ?? 0)
      || (left.trackOrder ?? Number.MAX_SAFE_INTEGER) - (right.trackOrder ?? Number.MAX_SAFE_INTEGER),
  )[0]
}

export function nextPatternEvent(program: PatternProgram, anchor: number, now = Date.now()): ScheduledProgramEvent {
  const duration = program.mainMinutes * MINUTE_MS
  let cycleIndex = cycleIndexAt(now, anchor, duration)
  while (true) {
    const cycleStart = anchor + cycleIndex * duration
    const candidatesByTime = new Map<number, TimelineCueCandidate[]>()
    const mainAt = cycleStart + duration
    candidatesByTime.set(mainAt, [{
      cueId: 'main', kind: 'pattern-main', sound: program.mainCue.sound, volume: program.mainCue.volume,
    }])
    if (program.subBellsEnabled !== false) program.tracks.forEach((track, trackOrder) => {
      if (!track.enabled) return
      track.selectedOffsetsMinutes.forEach(offsetMinutes => {
        const at = cycleStart + offsetMinutes * MINUTE_MS
        const candidates = candidatesByTime.get(at) ?? []
        candidates.push({
          cueId: track.id,
          kind: 'pattern-track',
          sound: track.sound,
          volume: track.volume,
          cadenceMinutes: track.cadenceMinutes,
          trackOrder,
        })
        candidatesByTime.set(at, candidates)
      })
    })
    const at = [...candidatesByTime.keys()].filter(time => time > now).sort((a, b) => a - b)[0]
    if (at !== undefined) {
      const candidates = candidatesByTime.get(at)!
      const winner = candidates[0].kind === 'pattern-main' ? candidates[0] : winnerForCandidates(candidates)
      const boundary = winner.kind === 'pattern-main' ? 'main' : `offset:${Math.round((at - cycleStart) / MINUTE_MS)}`
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
  const offsets = program.steps.reduce<number[]>((values, step) => [...values, (values.at(-1) ?? 0) + step.durationMinutes * MINUTE_MS], [])
  const cycleDuration = offsets.at(-1)
  if (!cycleDuration) throw new Error('Sequence requires at least one positive-duration step')
  let cycleIndex = cycleIndexAt(now, anchor, cycleDuration)
  while (true) {
    const cycleStart = anchor + cycleIndex * cycleDuration
    const stepIndex = offsets.findIndex(offset => cycleStart + offset > now)
    if (stepIndex >= 0) {
      const step = program.steps[stepIndex]
      const at = cycleStart + offsets[stepIndex]
      const winner: TimelineCueCandidate = { cueId: step.id, kind: 'sequence-step', sound: step.sound, volume: step.volume }
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

export function programCycleDurationMs(program: TimerProgram): number {
  return program.mode === 'pattern'
    ? program.mainMinutes * MINUTE_MS
    : program.steps.reduce((total, step) => total + step.durationMinutes * MINUTE_MS, 0)
}

export function runEndAt(program: TimerProgram, anchor: number, startedAt: number): number | null {
  if (program.runPolicy.kind === 'continuous') return null
  if (program.runPolicy.kind === 'duration') return startedAt + program.runPolicy.durationSeconds * 1_000
  const duration = programCycleDurationMs(program)
  // A snapped Pattern can have a phase anchor before Start. Count only cycle
  // boundaries strictly after the accepted start timestamp.
  const firstBoundary = anchor + (Math.floor((startedAt - anchor) / duration) + 1) * duration
  return firstBoundary + (program.runPolicy.cycleCount - 1) * duration
}

function completionCandidate(program: TimerProgram): TimelineCueCandidate {
  const cue = program.completionCue ?? (program.mode === 'pattern' ? program.mainCue : program.steps.at(-1)!)
  return { cueId: 'completion', kind: 'run-complete', sound: cue.sound, volume: cue.volume }
}

/** Returns null once a bounded run has reached or passed its terminal instant. */
export function nextProgramEvent(program: TimerProgram, anchor: number, now = Date.now(), startedAt = anchor, terminalAt = runEndAt(program, anchor, startedAt)): ScheduledProgramEvent | null {
  const endAt = terminalAt
  if (endAt !== null && now >= endAt) return null
  const next = program.mode === 'pattern' ? nextPatternEvent(program, anchor, now) : nextSequenceEvent(program, anchor, now)
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

export function timelinePosition(program: TimerProgram, anchor: number, now = Date.now(), startedAt = anchor, terminalAt = runEndAt(program, anchor, startedAt)): TimelinePosition {
  const nextEvent = nextProgramEvent(program, anchor, now, startedAt, terminalAt)
  if (program.mode === 'pattern') {
    const duration = program.mainMinutes * MINUTE_MS
    const cycleIndex = cycleIndexAt(now, anchor, duration)
    const cycleStart = anchor + cycleIndex * duration
    return { mode: 'pattern', cycleIndex, cycleProgress: Math.max(0, Math.min(1, (now - cycleStart) / duration)), nextEvent }
  }
  const offsets = program.steps.reduce<number[]>((values, step) => [...values, (values.at(-1) ?? 0) + step.durationMinutes * MINUTE_MS], [])
  const total = offsets.at(-1)!
  const cycleIndex = cycleIndexAt(now, anchor, total)
  const cycleStart = anchor + cycleIndex * total
  const elapsed = Math.max(0, now - cycleStart)
  const currentStepIndex = offsets.findIndex(offset => elapsed < offset)
  const previous = currentStepIndex === 0 ? 0 : offsets[currentStepIndex - 1]
  const stepDuration = offsets[currentStepIndex] - previous
  return {
    mode: 'sequence',
    cycleIndex,
    cycleProgress: Math.max(0, Math.min(1, elapsed / total)),
    currentStepIndex,
    stepProgress: Math.max(0, Math.min(1, (elapsed - previous) / stepDuration)),
    nextEvent,
  }
}
