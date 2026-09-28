import type { AvailabilityPolicy, TimerProgram } from '../types'
import { isCueAllowedByActiveHours, nextActiveHoursStart } from './activeHours'
import { nextProgramEvent, type ScheduledProgramEvent } from './timeline'

export interface UpcomingProgramEvent {
  event: ScheduledProgramEvent
  scheduleAllows: boolean
}

/** A short, chronological projection for setup UI. Suppressed events remain visible. */
export function upcomingProgramEvents(
  program: TimerProgram,
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
  program: TimerProgram,
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

export function programEventLabel(program: TimerProgram, event: ScheduledProgramEvent): string {
  if (event.completesRun && program.completionCue) return 'End gong'
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
