import { describe, expect, it } from 'vitest'
import fixture from '../../../fixtures/timer-unified-timeline.json'
import type { UnifiedTimerProgram } from '../../types'
import { defaultAppTimerSettings } from '../timerV2'
import { nextUnifiedProgramEvent, unifiedCueIdentity } from '../unified-timeline'
import { iterationMuteFor } from '../runtimeV2'
import { clearUnifiedTimerSession, loadUnifiedTimerSession, parseUnifiedTimerSession, saveUnifiedTimerSession, UNIFIED_SESSION_KEY, type UnifiedTimerSession } from '../unified-session'
import type { AsyncKeyValueStorage } from '../unified-storage'

function session(id = 'accepted'): UnifiedTimerSession {
  return { schemaVersion: 3, sessionId: id, randomAlgorithmVersion: 1, anchor: 1000, startedAt: 1000, randomSeed: 1000, program: structuredClone(fixture.program) as UnifiedTimerProgram, settings: defaultAppTimerSettings(), mute: { mutedUntil: 0 }, alarmBehavior: 'off', soundState: { sequence: {}, randomPrevious: {} } }
}
class Store implements AsyncKeyValueStorage {
  records = new Map<string, string>()
  getItem = async (key: string) => this.records.get(key) ?? null
  setItem = async (key: string, value: string) => { this.records.set(key, value) }
  removeItem = async (key: string) => { this.records.delete(key) }
}

describe('accepted unified session persistence', () => {
  it('retains long namespaced playback cursors and unusual authored identities', async () => {
    const store = new Store()
    const source = session()
    const key = unifiedCueIdentity('s'.repeat(200), 't'.repeat(200))
    source.soundState.sequence = Object.fromEntries([[key, 7], ['__proto__', 2], ['constructor', 1]])
    source.soundState.randomPrevious = { [key]: 3 }
    expect((await saveUnifiedTimerSession(store, source)).ok).toBe(true)
    const loaded = await loadUnifiedTimerSession(store)
    if (loaded.status !== 'loaded') throw new Error('No accepted session')
    expect(loaded.session.soundState).toEqual(source.soundState)
    expect(Object.hasOwn(loaded.session.soundState.sequence, '__proto__')).toBe(true)
  })

  it('snapshots the accepted program and preferences before asynchronous writes', async () => {
    const store = new Store()
    const source = session()
    const saving = saveUnifiedTimerSession(store, source)
    source.program.steps[0].label = 'Later draft edit'
    source.settings.masterVolume = 0
    await saving
    const loaded = await loadUnifiedTimerSession(store)
    if (loaded.status !== 'loaded') throw new Error('No accepted session')
    expect(loaded.session.program.steps[0].label).toBe('Work')
    expect(loaded.session.settings.masterVolume).toBe(0.8)
  })

  it('preserves pause timing, seeds, mute endpoints, alarms and next delivery', () => {
    const source = session()
    source.anchor = 71000
    source.startedAt = 71000
    source.pausedAt = 132000
    source.mute = { mutedUntil: 170000, iteration: iterationMuteFor(source.program, source.anchor, source.pausedAt, 3) }
    source.alarmBehavior = 'locked'
    source.nativeGeneration = 'native-generation'
    source.sourcePreset = { id: 'saved', name: 'Configuration', createdAt: 100, deleted: true }
    const parsed = parseUnifiedTimerSession(JSON.stringify(source))
    if (!parsed.ok) throw new Error(parsed.reason)
    expect(parsed.value).toEqual(source)
    expect(nextUnifiedProgramEvent(parsed.value.program, parsed.value.anchor, parsed.value.pausedAt, parsed.value.startedAt, null, parsed.value.randomSeed)).toEqual(nextUnifiedProgramEvent(source.program, source.anchor, source.pausedAt, source.startedAt, null, source.randomSeed))
  })

  it('rejects a mute endpoint whose logical identity no longer matches its boundary', () => {
    const source = session()
    source.mute.iteration = { ...iterationMuteFor(source.program, 1000, 1000, 2), endsAtLogicalId: 'old-or-wrong-boundary' }
    expect(parseUnifiedTimerSession(source)).toMatchObject({ ok: false, raw: source })
  })

  it('serializes Stop after save and refuses a stale Stop for a newer accepted session', async () => {
    const store = new Store()
    const save = saveUnifiedTimerSession(store, session('first'))
    const stop = clearUnifiedTimerSession(store, 'first')
    expect((await save).ok).toBe(true)
    expect((await stop).ok).toBe(true)
    expect((await loadUnifiedTimerSession(store)).status).toBe('empty')
    await saveUnifiedTimerSession(store, session('newer'))
    expect((await clearUnifiedTimerSession(store, 'first')).ok).toBe(false)
    const loaded = await loadUnifiedTimerSession(store)
    expect(loaded).toMatchObject({ status: 'loaded', session: { sessionId: 'newer' } })
  })

  it.each([' {"schemaVersion":99}\n', '{broken'])('preserves unreadable/future session bytes on load, save and clear', async raw => {
    const store = new Store()
    store.records.set(UNIFIED_SESSION_KEY, raw)
    expect(await loadUnifiedTimerSession(store)).toMatchObject({ status: 'recovery-required', raw })
    expect((await saveUnifiedTimerSession(store, session())).ok).toBe(false)
    expect((await clearUnifiedTimerSession(store, 'accepted')).ok).toBe(false)
    expect(store.records.get(UNIFIED_SESSION_KEY)).toBe(raw)
  })

  it('requires a frozen deadline for bounded runs and retains the promised deadline through clock realignment', () => {
    const source = session()
    source.program.runPolicy.kind = 'duration'
    expect(parseUnifiedTimerSession(source).ok).toBe(false)
    source.endsAt = 76000
    source.program.alignment = { kind: 'local-clock', offsetMinutes: 0 }
    source.anchor = -12000
    const parsed = parseUnifiedTimerSession(source)
    expect(parsed.ok).toBe(true)
    if (parsed.ok) expect(parsed.value.endsAt).toBe(76000)
  })
})
