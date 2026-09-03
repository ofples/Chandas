import type { AlarmBehavior, TimerProgram } from '../types'
import type { ScheduledProgramEvent } from './timeline'

export interface IterationMute {
  /** The final main/cycle boundary that remains audible and clears mute. */
  endsAtLogicalId: string
  endsAt: number
  /** Original user choice, retained for an honest selected state in the UI. */
  iterations: number
}

export interface RuntimeMuteState {
  mutedUntil: number
  iteration?: IterationMute
}

export type AudioGateReason = 'none' | 'master-muted' | 'timed-mute' | 'iteration-mute' | 'call-active'
export type AudioDisposition = 'suppressed' | 'one-shot' | 'continuous-alarm'

export interface AudioGateResult {
  shouldPlay: boolean
  disposition: AudioDisposition
  reason: AudioGateReason
  nextMute: RuntimeMuteState
  nextAlarmBehavior: AlarmBehavior
  consumeAlarmOnce: boolean
}

export const EVENT_FRESHNESS_WINDOW_MS = 5_000

/** A throttled JS timer must not replay an old cue when its tab wakes later. */
export function isFreshScheduledEvent(eventAt: number, observedAt: number, windowMs = EVENT_FRESHNESS_WINDOW_MS): boolean {
  return Number.isFinite(eventAt) && Number.isFinite(observedAt) && observedAt >= eventAt && observedAt - eventAt <= windowMs
}

/** Native bridge events animate only if delivery itself happened while this UI was effectively current. */
export function shouldSurfaceTimerSignal(
  event: { suppressed: boolean; firedAt?: number },
  observedAt: number,
  appActive: boolean,
  windowMs = EVENT_FRESHNESS_WINDOW_MS,
): boolean {
  return appActive && !event.suppressed && typeof event.firedAt === 'number' && Math.abs(observedAt - event.firedAt) <= windowMs
}

export function emptyRuntimeMute(): RuntimeMuteState {
  return { mutedUntil: 0 }
}

/** Pure transition table for the intentionally exclusive alarm tap gestures. */
export function alarmBehaviorAfterGesture(current: AlarmBehavior, gesture: 'single' | 'double'): AlarmBehavior {
  if (gesture === 'double') return current === 'locked' ? 'off' : 'locked'
  return current === 'off' ? 'once' : 'off'
}

/** Schedule identities are invalid after structural change or reanchoring. */
export function muteAfterScheduleChange(mute: RuntimeMuteState): RuntimeMuteState {
  return mute.iteration ? { mutedUntil: mute.mutedUntil } : mute
}

function cycleIndexAt(now: number, anchor: number, cycleMs: number): number {
  return Math.max(0, Math.floor((now - anchor) / cycleMs))
}

/**
 * Calculates the boundary identity before muting begins. The identity is
 * intentionally persisted instead of a decrementing counter so a timezone or
 * process restart cannot accidentally suppress the final audible boundary.
 */
export function iterationMuteFor(program: TimerProgram, anchor: number, now: number, count: number): IterationMute {
  const iterations = Math.max(1, Math.min(99, Math.round(count)))
  if (program.mode === 'pattern') {
    const cycleMs = program.mainMinutes * 60_000
    const currentCycle = cycleIndexAt(now, anchor, cycleMs)
    const nextMainCycle = anchor + (currentCycle + 1) * cycleMs <= now ? currentCycle + 1 : currentCycle
    const endingCycle = nextMainCycle + iterations - 1
    return { endsAtLogicalId: `pattern:${anchor}:${endingCycle}:main`, endsAt: anchor + (endingCycle + 1) * cycleMs, iterations }
  }
  const cycleMs = program.steps.reduce((total, step) => total + step.durationMinutes * 60_000, 0)
  const currentCycle = cycleIndexAt(now, anchor, cycleMs)
  const nextCycle = anchor + (currentCycle + 1) * cycleMs <= now ? currentCycle + 1 : currentCycle
  const endingCycle = nextCycle + iterations - 1
  return {
    endsAtLogicalId: `sequence:${anchor}:${endingCycle}:step:${program.steps.length - 1}`,
    endsAt: anchor + (endingCycle + 1) * cycleMs,
    iterations,
  }
}

/** Applies mute/call/alarm policy to one already-resolved scheduled event. */
export function gateProgramAudio(options: {
  event: ScheduledProgramEvent
  now: number
  masterVolume: number
  mute: RuntimeMuteState
  alarmBehavior: AlarmBehavior
  callActive: boolean
}): AudioGateResult {
  const { event, now, masterVolume, mute, alarmBehavior, callActive } = options
  const normalizedMute: RuntimeMuteState = mute.mutedUntil > 0 && now >= mute.mutedUntil
    ? { mutedUntil: 0, iteration: mute.iteration }
    : mute
  const isMain = event.boundary === 'pattern-main'
  const continuousAlarmRequested = isMain && alarmBehavior !== 'off'
  const consumesOnce = isMain && alarmBehavior === 'once'
  const consumedAlarmBehavior: AlarmBehavior = consumesOnce ? 'off' : alarmBehavior

  // A call is a temporary external gate. It must not consume or clear the
  // user's timed mute or alarm state, and the missed event is never replayed.
  if (callActive && !continuousAlarmRequested) {
    return { shouldPlay: false, disposition: 'suppressed', reason: 'call-active', nextMute: normalizedMute, nextAlarmBehavior: alarmBehavior, consumeAlarmOnce: false }
  }
  if (masterVolume <= 0) {
    return { shouldPlay: false, disposition: 'suppressed', reason: 'master-muted', nextMute: normalizedMute, nextAlarmBehavior: alarmBehavior, consumeAlarmOnce: false }
  }
  if (normalizedMute.mutedUntil > now) {
    return { shouldPlay: false, disposition: 'suppressed', reason: 'timed-mute', nextMute: normalizedMute, nextAlarmBehavior: alarmBehavior, consumeAlarmOnce: false }
  }

  const iteration = normalizedMute.iteration
  if (iteration) {
    if (event.logicalId === iteration.endsAtLogicalId || event.at > iteration.endsAt) {
      // At the requested final boundary the cue is audible. If process delay
      // moved past it, clear safely and resume only at this future event.
      return { shouldPlay: true, disposition: isMain && alarmBehavior !== 'off' ? 'continuous-alarm' : 'one-shot', reason: 'none', nextMute: { mutedUntil: 0 }, nextAlarmBehavior: consumedAlarmBehavior, consumeAlarmOnce: consumesOnce }
    }
    return { shouldPlay: false, disposition: 'suppressed', reason: 'iteration-mute', nextMute: normalizedMute, nextAlarmBehavior: alarmBehavior, consumeAlarmOnce: false }
  }
  return {
    shouldPlay: true,
    disposition: isMain && alarmBehavior !== 'off' ? 'continuous-alarm' : 'one-shot',
    reason: 'none',
    nextMute: normalizedMute,
    nextAlarmBehavior: consumedAlarmBehavior,
    consumeAlarmOnce: consumesOnce,
  }
}
