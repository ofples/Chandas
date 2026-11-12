import type { AlarmBehavior, AppTimerSettings, UnifiedTimerProgram, WorkingProgramState } from '../types'
import type { RuntimeMuteState } from './runtimeV2'
import type { AsyncKeyValueStorage } from './unified-storage'
import { parseUnifiedTimerProgram } from './unified-timer'
import { parseUnifiedTimerSettings } from './unified-config-state'
import { unifiedIterationEnd } from './unified-timeline'

export const UNIFIED_SESSION_KEY = 'chandas-timer-unified-session-v3'
export const UNIFIED_RUNS_KEY = 'chandas-timer-unified-runs-v1'

/** Frozen accepted run; configuration drafts never write this record. */
export interface UnifiedTimerSession {
  schemaVersion: 3
  sessionId: string
  randomAlgorithmVersion: 1
  anchor: number
  startedAt: number
  endsAt?: number
  pausedAt?: number
  randomSeed: number
  program: UnifiedTimerProgram
  settings: AppTimerSettings
  mute: RuntimeMuteState
  alarmBehavior: AlarmBehavior
  sourcePreset?: WorkingProgramState['sourcePreset']
  nativeGeneration?: string
  soundState: { sequence: Record<string, number>; randomPrevious: Record<string, number> }
}

type ParseResult = { ok: true; value: UnifiedTimerSession } | { ok: false; raw: unknown; reason: string }
export type SessionWriteResult = { ok: true } | { ok: false; reason: string }
export type SessionLoadResult = { status: 'empty' } | { status: 'loaded'; session: UnifiedTimerSession } | { status: 'recovery-required'; raw?: string; reason: string }
export type RunCollectionLoadResult = { status: 'loaded'; sessions: UnifiedTimerSession[] } | Extract<SessionLoadResult, { status: 'recovery-required' }>
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const integer = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value)
const id = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 200

function cursors(value: unknown): Record<string, number> | null {
  if (!record(value) || Object.entries(value).some(([key, index]) => key.length === 0 || key.length > 512 || !integer(index) || index < 0)) return null
  return Object.fromEntries(Object.entries(value)) as Record<string, number>
}

export function parseUnifiedTimerSession(input: unknown): ParseResult {
  const fail = (reason: string): ParseResult => ({ ok: false, raw: input, reason })
  let raw = input
  if (typeof raw === 'string') { try { raw = JSON.parse(raw) as unknown } catch { return fail('Session is not valid JSON') } }
  if (!record(raw) || raw.schemaVersion !== 3 || !id(raw.sessionId) || raw.randomAlgorithmVersion !== 1) return fail('Unsupported session schema or random algorithm')
  if (!integer(raw.anchor) || !integer(raw.startedAt) || !integer(raw.randomSeed)
    || (raw.endsAt !== undefined && (!integer(raw.endsAt) || raw.endsAt <= raw.startedAt))
    || (raw.pausedAt !== undefined && (!integer(raw.pausedAt) || raw.pausedAt < raw.startedAt))) return fail('Invalid accepted session timing')
  const program = parseUnifiedTimerProgram(raw.program)
  const settings = parseUnifiedTimerSettings(raw.settings)
  if (!program.ok || !settings) return fail('Invalid frozen program or timer settings')
  if ((program.value.runPolicy.kind === 'continuous') !== (raw.endsAt === undefined)) return fail('Run deadline does not match the run policy')
  if (raw.alarmBehavior !== 'off' && raw.alarmBehavior !== 'once' && raw.alarmBehavior !== 'locked') return fail('Invalid alarm behavior')
  if (raw.nativeGeneration !== undefined && !id(raw.nativeGeneration)) return fail('Invalid native session generation')
  const source = raw.sourcePreset
  if (source !== undefined && (!record(source) || !id(source.id) || typeof source.name !== 'string' || [...source.name].length > 80 || !integer(source.createdAt) || (source.deleted !== undefined && typeof source.deleted !== 'boolean'))) return fail('Invalid source configuration identity')
  if (!record(raw.mute) || !integer(raw.mute.mutedUntil) || raw.mute.mutedUntil < 0) return fail('Invalid timer mute')
  const mute: RuntimeMuteState = { mutedUntil: raw.mute.mutedUntil }
  if (raw.mute.iteration !== undefined) {
    const iteration = raw.mute.iteration
    if (!record(iteration) || !integer(iteration.endsAt) || !integer(iteration.iterations) || iteration.iterations < 1 || iteration.iterations > 99 || typeof iteration.endsAtLogicalId !== 'string') return fail('Invalid iteration mute')
    const expected = unifiedIterationEnd(program.value, raw.anchor, iteration.endsAt - 1, 1)
    if (expected.at !== iteration.endsAt || expected.logicalId !== iteration.endsAtLogicalId) return fail('Iteration mute no longer identifies a round boundary')
    mute.iteration = { endsAt: iteration.endsAt, endsAtLogicalId: iteration.endsAtLogicalId, iterations: iteration.iterations }
  }
  if (!record(raw.soundState)) return fail('Missing sound playback state')
  const sequence = cursors(raw.soundState.sequence)
  const randomPrevious = cursors(raw.soundState.randomPrevious)
  if (!sequence || !randomPrevious) return fail('Invalid sound playback state')
  return { ok: true, value: {
    schemaVersion: 3, sessionId: raw.sessionId, randomAlgorithmVersion: 1,
    anchor: raw.anchor, startedAt: raw.startedAt, randomSeed: raw.randomSeed,
    ...(raw.endsAt !== undefined ? { endsAt: raw.endsAt as number } : {}), ...(raw.pausedAt !== undefined ? { pausedAt: raw.pausedAt as number } : {}),
    program: program.value, settings, mute, alarmBehavior: raw.alarmBehavior,
    ...(source !== undefined ? { sourcePreset: { ...source as NonNullable<UnifiedTimerSession['sourcePreset']> } } : {}),
    ...(raw.nativeGeneration !== undefined ? { nativeGeneration: raw.nativeGeneration as string } : {}),
    soundState: { sequence, randomPrevious },
  } }
}

const queues = new WeakMap<object, Promise<unknown>>()
function enqueue<T>(storage: AsyncKeyValueStorage, action: () => Promise<T>): Promise<T> {
  const next = (queues.get(storage) ?? Promise.resolve()).catch(() => undefined).then(action)
  queues.set(storage, next)
  return next
}

function configurationKey(session: UnifiedTimerSession): string | null {
  return session.sourcePreset?.id ?? null
}

async function readRunCollection(storage: AsyncKeyValueStorage): Promise<RunCollectionLoadResult> {
  const raw = await storage.getItem(UNIFIED_RUNS_KEY)
  if (raw === null) {
    // A missing collection can inherit the previous single run. An empty
    // collection is authoritative and must never resurrect that old record.
    const legacy = await storage.getItem(UNIFIED_SESSION_KEY)
    if (legacy === null) return { status: 'loaded', sessions: [] }
    const parsed = parseUnifiedTimerSession(legacy)
    return parsed.ok
      ? { status: 'loaded', sessions: [parsed.value] }
      : { status: 'recovery-required', raw: legacy, reason: parsed.reason }
  }
  const fail = (reason: string): RunCollectionLoadResult => ({ status: 'recovery-required', raw, reason })
  let value: unknown
  try { value = JSON.parse(raw) } catch { return fail('The timer collection is not valid JSON') }
  if (!record(value) || value.schemaVersion !== 1 || !Array.isArray(value.sessions)) return fail('Unsupported timer collection')
  const sessions: UnifiedTimerSession[] = []
  const runIds = new Set<string>()
  const configurations = new Set<string | null>()
  for (const input of value.sessions) {
    const parsed = parseUnifiedTimerSession(input)
    if (!parsed.ok) return fail(parsed.reason)
    const session = parsed.value
    const key = configurationKey(session)
    if (runIds.has(session.sessionId) || configurations.has(key)) return fail('Duplicate active run identity')
    runIds.add(session.sessionId)
    configurations.add(key)
    sessions.push(session)
  }
  return { status: 'loaded', sessions }
}

export function loadUnifiedTimerRuns(storage: AsyncKeyValueStorage): Promise<RunCollectionLoadResult> {
  return enqueue(storage, async () => {
    try { return await readRunCollection(storage) }
    catch { return { status: 'recovery-required', reason: 'Timer collection could not be read' } }
  })
}

async function writeRunCollection(storage: AsyncKeyValueStorage, sessions: UnifiedTimerSession[]): Promise<SessionWriteResult> {
  const snapshot = JSON.stringify({ schemaVersion: 1, sessions })
  await storage.setItem(UNIFIED_RUNS_KEY, snapshot)
  return await storage.getItem(UNIFIED_RUNS_KEY) === snapshot
    ? { ok: true }
    : { ok: false, reason: 'Timer collection write could not be verified' }
}

/** Register a new run or update the same accepted run without replacing its peers. */
export function saveUnifiedTimerRun(storage: AsyncKeyValueStorage, input: UnifiedTimerSession, mode: 'start' | 'update'): Promise<SessionWriteResult> {
  const parsed = parseUnifiedTimerSession(input)
  if (!parsed.ok) return Promise.resolve({ ok: false, reason: parsed.reason })
  const session = parsed.value
  return enqueue(storage, async () => {
    try {
      const current = await readRunCollection(storage)
      if (current.status !== 'loaded') return { ok: false, reason: current.reason }
      const index = current.sessions.findIndex(run => run.sessionId === session.sessionId)
      const key = configurationKey(session)
      if (current.sessions.some((run, i) => i !== index && configurationKey(run) === key)) {
        return { ok: false, reason: 'This configuration already has a live run' }
      }
      if (index < 0 && mode === 'update') return { ok: false, reason: 'The run has already ended' }
      if (index >= 0 && configurationKey(current.sessions[index]) !== key) {
        return { ok: false, reason: 'An accepted run cannot change configurations' }
      }
      const sessions = [...current.sessions]
      if (index < 0) sessions.push(session)
      else sessions[index] = session
      return await writeRunCollection(storage, sessions)
    } catch { return { ok: false, reason: 'Timer run could not be saved' } }
  })
}

export function clearUnifiedTimerRun(storage: AsyncKeyValueStorage, sessionId: string): Promise<SessionWriteResult> {
  return enqueue(storage, async () => {
    try {
      const current = await readRunCollection(storage)
      if (current.status !== 'loaded') return { ok: false, reason: current.reason }
      const remaining = current.sessions.filter(run => run.sessionId !== sessionId)
      if (remaining.length === current.sessions.length) return { ok: true }
      return await writeRunCollection(storage, remaining)
    } catch { return { ok: false, reason: 'Timer run could not be cleared' } }
  })
}

export function loadUnifiedTimerSession(storage: AsyncKeyValueStorage): Promise<SessionLoadResult> {
  return enqueue(storage, async () => {
    try {
      const raw = await storage.getItem(UNIFIED_SESSION_KEY)
      if (raw === null) return { status: 'empty' }
      const parsed = parseUnifiedTimerSession(raw)
      return parsed.ok ? { status: 'loaded', session: parsed.value } : { status: 'recovery-required', raw, reason: parsed.reason }
    } catch { return { status: 'recovery-required', reason: 'Session storage could not be read' } }
  })
}

export function saveUnifiedTimerSession(storage: AsyncKeyValueStorage, session: UnifiedTimerSession): Promise<SessionWriteResult> {
  const parsed = parseUnifiedTimerSession(session)
  if (!parsed.ok) return Promise.resolve({ ok: false, reason: parsed.reason })
  const snapshot = JSON.stringify(parsed.value)
  return enqueue(storage, async () => {
    try {
      const existing = await storage.getItem(UNIFIED_SESSION_KEY)
      if (existing !== null && !parseUnifiedTimerSession(existing).ok) return { ok: false, reason: 'An unreadable session is preserved for recovery' }
      await storage.setItem(UNIFIED_SESSION_KEY, snapshot)
      return await storage.getItem(UNIFIED_SESSION_KEY) === snapshot ? { ok: true } : { ok: false, reason: 'Session write could not be verified' }
    } catch { return { ok: false, reason: 'Session could not be persisted' } }
  })
}

/** A stale Stop callback cannot delete a more recently accepted session. */
export function clearUnifiedTimerSession(storage: AsyncKeyValueStorage, expectedSessionId: string): Promise<SessionWriteResult> {
  return enqueue(storage, async () => {
    try {
      const existing = await storage.getItem(UNIFIED_SESSION_KEY)
      if (existing === null) return { ok: true }
      const parsed = parseUnifiedTimerSession(existing)
      if (!parsed.ok || parsed.value.sessionId !== expectedSessionId) return { ok: false, reason: 'The stored session is newer or requires recovery' }
      if (!storage.removeItem) return { ok: false, reason: 'Session storage cannot remove records' }
      await storage.removeItem(UNIFIED_SESSION_KEY)
      return await storage.getItem(UNIFIED_SESSION_KEY) === null ? { ok: true } : { ok: false, reason: 'Session removal could not be verified' }
    } catch { return { ok: false, reason: 'Session could not be cleared' } }
  })
}
