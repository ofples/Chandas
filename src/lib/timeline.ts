import type { PatternProgram, SequenceProgram, SoundRef, TimerMode, TimerProgram } from '../types'

export interface TimelineCueCandidate {
  cueId: string
  kind: 'pattern-main' | 'pattern-track' | 'sequence-step'
  sound: SoundRef
  volume: number
  cadenceMinutes?: number
  trackOrder?: number
}

export interface ScheduledProgramEvent {
  at: number
  logicalId: string
  cycleIndex: number
  candidates: TimelineCueCandidate[]
  winner: TimelineCueCandidate
  collision: boolean
}

export interface TimelinePosition {
  mode: TimerMode
  cycleIndex: number
  cycleProgress: number
  currentStepIndex?: number
  stepProgress?: number
  nextEvent: ScheduledProgramEvent
}

const MINUTE_MS = 60_000

function cycleIndexAt(now: number, anchor: number, duration: number): number {
  return Math.max(0, Math.floor((now - anchor) / duration))
}

function logicalId(mode: TimerMode, anchor: number, cycleIndex: number, boundary: string): string {
  return `${mode}:${anchor}:${cycleIndex}:${boundary}`
}

function winnerForCandidates(candidates: TimelineCueCandidate[]): TimelineCueCandidate {
  // D-028: UI list order is the only collision priority. Lower array index wins.
  return candidates.slice().sort((left, right) => (left.trackOrder ?? Number.MIN_SAFE_INTEGER) - (right.trackOrder ?? Number.MIN_SAFE_INTEGER))[0]
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
    program.tracks.forEach((track, trackOrder) => {
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
      return { at, logicalId: logicalId('pattern', anchor, cycleIndex, boundary), cycleIndex, candidates, winner, collision: candidates.length > 1 }
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
        candidates: [winner],
        winner,
        collision: false,
      }
    }
    cycleIndex += 1
  }
}

export function nextProgramEvent(program: TimerProgram, anchor: number, now = Date.now()): ScheduledProgramEvent {
  return program.mode === 'pattern' ? nextPatternEvent(program, anchor, now) : nextSequenceEvent(program, anchor, now)
}

export function timelinePosition(program: TimerProgram, anchor: number, now = Date.now()): TimelinePosition {
  const nextEvent = nextProgramEvent(program, anchor, now)
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
