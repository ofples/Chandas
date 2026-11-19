/** Pure iOS host boundary. Bundled into the native module; no React/Expo imports. */
import type { NativeTimerConfig } from '../native/ChandasTimerService'
import type { AlarmBehavior, SoundRef, UnifiedTimerProgram } from '../types'
import { parseUnifiedTimerProgram } from './unified-timer'
import { currentStepEndAt, nextProgramEvent, programCycleDurationMs, seekStepTarget, sequenceSkipTarget, timelinePosition, type ScheduledProgramEvent } from './timeline'
import { effectiveAvailabilityForProgram, isCueAllowedByActiveHours, nextActiveHoursStart } from './activeHours'
import { gateProgramAudio, iterationMuteFor, type RuntimeMuteState } from './runtimeV2'
import { cueSounds } from './timerV2'

export interface IOSKernelRun {
  id: string
  name: string
  config: NativeTimerConfig
  soundState?: { sequence: Record<string, number>; randomPrevious: Record<string, number> }
}

export interface IOSKernelEvent {
  runId: string
  name: string
  event: ScheduledProgramEvent
  alarm: boolean
  audible: boolean
  volume: number
  soundId: string
  rarity: number
  winner: boolean
  label: string
  alarmExpiresAt: number
  nextConfig: NativeTimerConfig
  nextSoundState: NonNullable<IOSKernelRun['soundState']>
}

export const IOS_NOTIFICATION_BUDGET = 56
export const IOS_MAX_PLANNING_MS = 24 * 60 * 60 * 1_000
const MAX_SCAN = 20_000
const programCache = new Map<string, UnifiedTimerProgram>()

function programFor(config: NativeTimerConfig): UnifiedTimerProgram {
  const source = config.timerV2Program
  if (typeof source !== 'string' || source.length > 1_048_576) throw new Error('Invalid iOS program size')
  const cached = programCache.get(source)
  if (cached) return cached
  const result = parseUnifiedTimerProgram(config.timerV2Program)
  if (!result.ok) throw new Error(`Invalid iOS timer program: ${result.reason}`)
  if (programCache.size >= 16) programCache.delete(programCache.keys().next().value!)
  programCache.set(source, result.value)
  return result.value
}

export function validateIOSRun(run: IOSKernelRun): boolean {
  try {
    if (!run.id || run.id.length > 200 || !run.name || run.name.length > 200) return false
    programFor(run.config)
    return [run.config.timerV2Anchor, run.config.timerV2StartedAt].every(value => typeof value === 'number' && Number.isSafeInteger(value) && value > 0)
      && Number.isFinite(run.config.volume) && run.config.volume >= 0 && run.config.volume <= 1
      && [run.config.timerV2EndsAt, run.config.timerV2PausedAt, run.config.mutedUntil].every(value => value === undefined || Number.isSafeInteger(value) && value >= 0)
  } catch { return false }
}

function muteFor(config: NativeTimerConfig): RuntimeMuteState {
  return {
    mutedUntil: config.mutedUntil ?? 0,
    ...(config.mutedIterationEndId && config.mutedIterationEndAt ? {
      iteration: { endsAtLogicalId: config.mutedIterationEndId, endsAt: config.mutedIterationEndAt, iterations: config.mutedIterationCount ?? 1 },
    } : {}),
  }
}

function alarmFor(config: NativeTimerConfig): AlarmBehavior {
  return config.alarmModeEnabled ? 'locked' : config.alarmOnceArmed ? 'once' : 'off'
}

function withGate(config: NativeTimerConfig, mute: RuntimeMuteState, alarm: AlarmBehavior): NativeTimerConfig {
  return { ...config, alarmModeEnabled: alarm === 'locked', alarmOnceArmed: alarm === 'once', mutedUntil: mute.mutedUntil,
    mutedIterationEndId: mute.iteration?.endsAtLogicalId, mutedIterationEndAt: mute.iteration?.endsAt,
    mutedIterationCount: mute.iteration?.iterations ?? 0 }
}

function availability(config: NativeTimerConfig, program: UnifiedTimerProgram) {
  const value = config.availabilityPolicy ? JSON.parse(config.availabilityPolicy) : { enabled: false, weeklyWindows: [], overrides: [] }
  return effectiveAvailabilityForProgram(program, value)
}

export function iosRunState(run: IOSKernelRun, now: number) {
  const c = run.config
  const p = programFor(c)
  const paused = c.timerV2PausedAt ?? 0
  const time = paused || now
  const active = !(c.timerV2EndsAt && (p.runPolicy.kind === 'until' ? now : time) >= c.timerV2EndsAt)
  const next = active ? nextProgramEvent(p, c.timerV2Anchor!, time, c.timerV2StartedAt!, c.timerV2EndsAt || null, c.timerV2RandomSeed ?? c.timerV2Anchor!) : null
  const position = timelinePosition(p, c.timerV2Anchor!, time, c.timerV2StartedAt!, c.timerV2EndsAt || null, c.timerV2RandomSeed ?? c.timerV2Anchor!)
  const step = p.steps[position.currentStepIndex ?? 0]
  return { ...c, active, ringing: false, nextEventAt: paused ? 0 : next?.at ?? 0, nextLogicalId: next?.logicalId ?? '',
    mutedIterationsRemaining: c.mutedIterationEndAt && c.mutedIterationEndAt > time ? c.mutedIterationCount ?? 1 : 0,
    currentStepName: p.steps.length > 1 ? step.label : '', currentStepEndAt: currentStepEndAt(p, position),
    stepIndex: position.currentStepIndex ?? 0, activeHoursResumeAt: nextActiveHoursStart(availability(c, p), time) }
}

function soundID(sound: SoundRef): string { return sound.kind === 'builtin' ? sound.id : sound.uri }
function hash(value: string): number {
  let h = 2166136261
  for (let index = 0; index < value.length; index++) h = Math.imul(h ^ value.charCodeAt(index), 16777619)
  return h >>> 0
}

function projected(run: IOSKernelRun, event: ScheduledProgramEvent): IOSKernelEvent {
  const c = run.config, p = programFor(c)
  const gate = gateProgramAudio({ event, now: event.at, masterVolume: c.volume, mute: muteFor(c), alarmBehavior: alarmFor(c), callActive: false })
  const allowed = isCueAllowedByActiveHours(availability(c, p), event.at)
  const alarm = gate.disposition === 'continuous-alarm'
  const sounds = cueSounds(event.winner)
  const soundState = { sequence: { ...run.soundState?.sequence }, randomPrevious: { ...run.soundState?.randomPrevious } }
  let index = 0
  if (sounds.length > 1 && event.winner.soundMode === 'random') {
    const choices = sounds.map((_, index) => index).filter(index => index !== soundState.randomPrevious[event.winner.cueId])
    index = choices[hash(`${event.logicalId}:${event.winner.cueId}:${c.timerV2RandomSeed}`) % choices.length]
    soundState.randomPrevious[event.winner.cueId] = index
  } else if (sounds.length > 1 && event.winner.soundMode === 'sequence') {
    index = (soundState.sequence[event.winner.cueId] ?? 0) % sounds.length
    soundState.sequence[event.winner.cueId] = (index + 1) % sounds.length
  }
  const position = timelinePosition(p, c.timerV2Anchor!, event.at, c.timerV2StartedAt!, c.timerV2EndsAt || null, c.timerV2RandomSeed)
  const cap = event.boundary === 'sequence-step' || event.boundary === 'sequence-cycle' ? currentStepEndAt(p, position) : Infinity
  const volume = c.volume * (alarm ? c.alarmVolume ?? 1 : event.winner.volume)
  return {
    runId: run.id, name: run.name, event, alarm, audible: allowed && gate.shouldPlay && volume > 0, volume,
    soundId: alarm ? c.alarmSoundId ?? 'alarm-tone' : soundID(sounds[index]),
    rarity: event.completesRun ? Number.MAX_SAFE_INTEGER : event.winner.occurrencesPerRound ? programCycleDurationMs(p) / event.winner.occurrencesPerRound
      : event.winner.cadenceSeconds ? event.winner.cadenceSeconds * 1_000 : programCycleDurationMs(p),
    winner: false, label: p.steps[event.stepIndex ?? 0]?.label ?? run.name,
    alarmExpiresAt: Math.min(event.at + c.alarmDurationSeconds * 1_000, cap, c.timerV2EndsAt || Infinity),
    nextConfig: withGate(c, gate.nextMute, gate.nextAlarmBehavior),
    nextSoundState: soundState,
  }
}

/** Globally merged batches, including silent progression. No timestamp is split. */
export function iosEventBatches(runs: IOSKernelRun[], after: number, batchLimit = IOS_NOTIFICATION_BUDGET, through = after + IOS_MAX_PLANNING_MS) {
  const working = runs.filter(validateIOSRun).filter(run => !run.config.timerV2PausedAt).map(run => ({ ...run, config: { ...run.config } }))
  let cursor = after, scans = 0
  const batches: IOSKernelEvent[][] = []
  while (batches.length < Math.max(1, Math.min(64, batchLimit)) && scans++ < MAX_SCAN) {
    const upcoming = working.map(run => {
      const c = run.config
      return { run, event: nextProgramEvent(programFor(c), c.timerV2Anchor!, cursor, c.timerV2StartedAt!, c.timerV2EndsAt || null, c.timerV2RandomSeed ?? c.timerV2Anchor!) }
    }).filter((value): value is { run: IOSKernelRun; event: ScheduledProgramEvent } => value.event !== null)
    if (!upcoming.length) break
    const at = Math.min(...upcoming.map(value => value.event.at))
    if (at > through) break
    const batch = upcoming.filter(value => value.event.at === at).map(({ run, event }) => projected(run, event))
    const winner = batch.filter(value => value.audible).sort((a, b) => Number(b.alarm) - Number(a.alarm) || b.rarity - a.rarity || (a.runId < b.runId ? -1 : a.runId > b.runId ? 1 : 0))[0]
    if (winner) winner.winner = true
    batch.forEach(item => { const run = working.find(run => run.id === item.runId)!; run.config = item.nextConfig; if (item.winner && !item.alarm) run.soundState = item.nextSoundState })
    batches.push(batch)
    cursor = at
  }
  return { batches, coveredThrough: cursor, truncated: batches.length >= batchLimit || scans >= MAX_SCAN }
}

/** Exact hourly calendar compression, only when the complete audible pattern repeats.
 * Unlike a delayed repeating interval trigger, this preserves the accepted phase.
 * Irregular, bounded, muted and alarm-enabled programs stay on the bounded queue.
 */
export function iosRepeatingSchedule(runs: IOSKernelRun[], now: number): IOSKernelEvent[] | null {
  const hour = 3_600_000
  const active = runs.filter(run => !run.config.timerV2PausedAt)
  if (!active.length || active.some(run => !validateIOSRun(run))) return null
  for (const run of active) {
    const c = run.config, p = programFor(c)
    if (p.runPolicy.kind !== 'continuous' || c.timerV2EndsAt || c.alarmModeEnabled || c.alarmOnceArmed
      || c.mutedUntil && c.mutedUntil > now || c.mutedIterationEndAt && c.mutedIterationEndAt > now
      || availability(c, p).enabled || p.steps.some(step => step.endAlarmEnabled)) return null
    if (!p.noMainInterval && hour % programCycleDurationMs(p) !== 0) return null
    const cues = p.steps.flatMap(step => [step.endCue, ...step.subBellTracks.filter(track => step.subBellsEnabled && track.enabled)])
    if (cues.some(cue => cueSounds(cue).length > 1 && cue.soundMode !== 'single')) return null
    for (const step of p.steps) for (const track of step.subBellTracks.filter(track => step.subBellsEnabled && track.enabled)) {
      if (track.randomRepeat || p.noMainInterval && hour % (track.cadenceSeconds * 1_000) !== 0) return null
    }
  }
  const base = Math.ceil(Math.max(now, ...active.map(run => run.config.timerV2StartedAt!)) / hour) * hour
  const plan = iosEventBatches(active, base, 64, base + hour)
  if (plan.truncated) return null
  const events = plan.batches.flat().filter(event => event.winner)
  if (new Set(events.map(event => Math.floor((event.event.at % hour) / 1_000))).size !== events.length) return null
  // Leave at least one slot for other app notifications; native also checks pending requests.
  return events.length > 0 && events.length <= 63 ? events : null
}

/** A host command never edits a saved configuration, only this accepted run. */
export function iosRunAction(run: IOSKernelRun, action: string, amount: number, now: number): IOSKernelRun | null {
  const p = programFor(run.config), c = { ...run.config }
  const time = c.timerV2PausedAt || now
  if (action === 'pause') {
    if (!c.timerV2PausedAt) c.timerV2PausedAt = now
    if (p.alignment.kind === 'local-clock') c.timerV2Program = JSON.stringify({ ...p, alignment: { kind: 'elapsed' } })
  }
  else if (action === 'resume') {
    if (c.timerV2PausedAt) {
      const shift = now - c.timerV2PausedAt
      c.timerV2Anchor! += shift; c.timerV2StartedAt! += shift
      if (c.timerV2EndsAt && p.runPolicy.kind !== 'until') c.timerV2EndsAt += shift
      if (c.mutedIterationEndAt) c.mutedIterationEndAt += shift
      c.timerV2PausedAt = 0
    }
  } else if (action === 'mute-seconds') return { ...run, config: withGate(c, { mutedUntil: now + Math.max(1, Math.min(86_400, amount)) * 1_000 }, alarmFor(c)) }
  else if (action === 'mute-iterations') return { ...run, config: withGate(c, { mutedUntil: 0, iteration: iterationMuteFor(p, c.timerV2Anchor!, time, amount) }, alarmFor(c)) }
  else if (action === 'clear-mute') return { ...run, config: withGate(c, { mutedUntil: 0 }, alarmFor(c)) }
  else if (action === 'alarm-once') c.alarmOnceArmed = !c.alarmOnceArmed
  else if (action.startsWith('toggle-step-alarm:')) {
    const id = action.slice('toggle-step-alarm:'.length)
    if (p.noMainInterval || !p.steps.some(step => step.id === id)) return null
    c.timerV2Program = JSON.stringify({ ...p, steps: p.steps.map(step => step.id === id ? { ...step, endAlarmEnabled: !step.endAlarmEnabled } : step) })
  }
  else {
    let target
    if (action.startsWith('seek-step:')) target = seekStepTarget(p, c.timerV2Anchor!, time, c.timerV2StartedAt!, c.timerV2EndsAt || null, Number(action.slice(10)) / 10_000)
    else {
      const distance = action === 'next-step' ? 1 : action === 'previous-step' ? -1 : action.startsWith('skip-steps:') ? Number(action.slice(11)) : NaN
      if (!Number.isInteger(distance) || !distance || Math.abs(distance) > 64) return null
      let a = c.timerV2Anchor!, start = c.timerV2StartedAt!, end = c.timerV2EndsAt || null
      for (let count = 0; count < Math.abs(distance); count++) {
        target = sequenceSkipTarget(p, a, time, start, end, distance > 0 ? 'next' : 'previous')
        if (!target) return null
        a = target.anchor; start = target.startedAt; end = target.terminalAt
        if (target.completesRun) break
      }
    }
    if (!target) return null
    c.timerV2Anchor = target.anchor; c.timerV2StartedAt = target.startedAt; c.timerV2EndsAt = target.terminalAt ?? 0
    c.mutedIterationEndId = undefined; c.mutedIterationEndAt = undefined; c.mutedIterationCount = 0
  }
  return { ...run, config: c }
}

// A single JSON entry point keeps the Swift boundary small and fixture-testable.
export function invokeIOSKernel(request: string): string {
  const input = JSON.parse(request)
  const result = input.method === 'validate' ? validateIOSRun(input.run)
    : input.method === 'state' ? iosRunState(input.run, input.now)
      : input.method === 'action' ? iosRunAction(input.run, input.action, input.amount ?? 0, input.now)
        : input.method === 'plan' ? iosEventBatches(input.runs, input.after, input.limit, input.through)
          : input.method === 'repeating' ? iosRepeatingSchedule(input.runs, input.now)
          : (() => { throw new Error('Unknown iOS kernel method') })()
  return JSON.stringify(result)
}
