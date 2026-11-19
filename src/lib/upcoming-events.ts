import type { AlarmBehavior, AvailabilityPolicy, RuntimeTimerProgram } from '../types'
import { effectiveAvailabilityForProgram, isCueAllowedByActiveHours, nextActiveHoursStart } from './activeHours'
import { nextProgramEvent, programCycleDurationMs, type ScheduledProgramEvent } from './timeline'

export interface UpcomingProgramEvent {
  event: ScheduledProgramEvent
  scheduleAllows: boolean
}

export interface CueMuteSuggestion {
  at: number
  label: string
  timerName?: string
  alarm: boolean
  rarity: number
}

export function upcomingMuteSuggestions(program: RuntimeTimerProgram, availability: AvailabilityPolicy, anchor: number, from: number, startedAt: number, terminalAt: number | null, randomSeed: number, alarm: AlarmBehavior, limit = 3): CueMuteSuggestion[] {
  const visibleProgram = program.mode === 'unified'
    ? { ...program, steps: program.steps.map(step => ({ ...step, subBellTracks: step.subBellTracks.filter(track => track.showOnWatchFace !== false) })) }
    : program.mode === 'pattern' ? { ...program, tracks: program.tracks.filter(track => track.showOnWatchFace !== false) } : program
  const candidates: Array<CueMuteSuggestion & { cueId: string }> = []
  const schedule = effectiveAvailabilityForProgram(program, availability)
  const isAlarm = (cue: ScheduledProgramEvent) => !cue.completesRun && (
    cue.winner.alarmEnabled === true || (cue.boundary === 'pattern-main' && alarm !== 'off')
  )
  const round = programCycleDurationMs(program)
  let cursor = from
  const distinct = new Set<string>()
  for (let i = 0; i < Math.max(12, limit) && (limit > 3 || distinct.size < 3); i++) {
    const event = nextAudibleProgramEvent(visibleProgram, schedule, anchor, cursor, startedAt, terminalAt,
      cue => cue.winner.volume > 0 || isAlarm(cue), randomSeed)
    if (!event) break
    const winner = event.winner
    const spacing = winner.occurrencesPerRound ? round / winner.occurrencesPerRound : (winner.cadenceSeconds ?? round / 1000) * 1000
    candidates.push({ at: event.at, label: programEventLabel(program, event), cueId: winner.cueId, alarm: isAlarm(event), rarity: event.completesRun ? Infinity : spacing })
    distinct.add(event.winner.cueId)
    cursor = event.at
  }
  const firstByCue = candidates.filter((candidate, index) => candidates.findIndex(event => event.cueId === candidate.cueId) === index)
  const result = limit > 3 ? candidates : [...firstByCue, ...candidates.filter(candidate => !firstByCue.includes(candidate))]
  return result.slice(0, limit).sort((a, b) => a.at - b.at)
    .map(({ at, label, alarm: rings, rarity }) => ({ at, label, alarm: rings, rarity }))
}

/** A short, chronological projection for setup UI. Suppressed events remain visible. */
export function upcomingProgramEvents(
  program: RuntimeTimerProgram,
  availability: AvailabilityPolicy,
  anchor: number,
  from: number,
  startedAt: number,
  terminalAt: number | null,
  limit = 4,
): UpcomingProgramEvent[] {
  const result: UpcomingProgramEvent[] = []
  let cursor = from
  for (let index = 0; index < Math.max(0, limit); index += 1) {
    const event = nextProgramEvent(program, anchor, cursor, startedAt, terminalAt)
    if (!event) break
    result.push({ event, scheduleAllows: isCueAllowedByActiveHours(availability, event.at) })
    cursor = event.at
  }
  return result
}

/** Finds the next schedule-eligible cue without iterating through every cue in a long quiet span. */
export function nextAudibleProgramEvent(
  program: RuntimeTimerProgram,
  availability: AvailabilityPolicy,
  anchor: number,
  from: number,
  startedAt: number,
  terminalAt: number | null,
  canPlaySound: (event: ScheduledProgramEvent) => boolean = () => true,
  randomSeed = anchor,
): ScheduledProgramEvent | null {
  let cursor = from
  for (let attempt = 0; attempt < 128; attempt += 1) {
    const event = nextProgramEvent(program, anchor, cursor, startedAt, terminalAt, randomSeed)
    if (!event) return null
    if (isCueAllowedByActiveHours(availability, event.at)) {
      if (canPlaySound(event)) return event
      cursor = event.at
      continue
    }
    const resumesAt = nextActiveHoursStart(availability, event.at)
    if (resumesAt <= 0 || (terminalAt !== null && resumesAt > terminalAt)) return null
    cursor = Math.max(event.at, resumesAt - 1)
  }
  return null
}

export function programEventLabel(program: RuntimeTimerProgram, event: ScheduledProgramEvent): string {
  if (event.completesRun && program.completionCue) return 'End gong'
  if (program.mode === 'unified') {
    const step = program.steps.find(step => step.id === event.stepId)
    if (event.winner.kind === 'pattern-track') return step?.subBellTracks.find(track => track.id === event.winner.trackId)?.label ?? 'Sub-bell'
    if (event.winner.kind === 'run-complete') return program.noMainInterval ? 'Timer ends' : 'End gong'
    return step?.label || 'Step cue'
  }
  if (program.mode === 'pattern') {
    if (event.boundary === 'pattern-main') return 'Main gong'
    return program.tracks.find(track => track.id === event.winner.cueId)?.label ?? 'Sub-bell'
  }
  return program.steps.find(step => step.id === event.winner.cueId)?.label ?? 'Sequence cue'
}

export function formatEventLocalTime(timestamp: number): string {
  const date = new Date(timestamp)
  const includeSeconds = date.getSeconds() !== 0
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', ...(includeSeconds ? { second: '2-digit' as const } : {}) })
}
