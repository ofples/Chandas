import { describe, expect, it } from 'vitest'
import { defaultTimerV2State } from '../timerV2'
import { createDefaultUnifiedConfigState } from '../unified-config-state'
import { bootstrapUnifiedConfigState, saveUnifiedConfigState, UNIFIED_CONFIG_STORAGE_KEY, UNIFIED_MIGRATION_MARKER_KEY, LEGACY_TIMER_STORAGE_KEYS, type AsyncKeyValueStorage } from '../unified-storage'

class Store implements AsyncKeyValueStorage {
  records = new Map<string, string>()
  writes: string[] = []
  reads: string[] = []
  getItem = async (key: string) => { this.reads.push(key); return this.records.get(key) ?? null }
  setItem = async (key: string, value: string) => { this.writes.push(key); this.records.set(key, value) }
}
function seedLegacy(store: Store, saved = true) {
  const state = defaultTimerV2State()
  if (saved) {
    state.presets = [{ id: 'saved', name: 'Saved', createdAt: 100, program: structuredClone(state.workingPrograms.pattern), settings: structuredClone(state.settings) }]
    state.workingPrograms.sourcePreset = { id: 'saved', name: 'Saved', createdAt: 100 }
  }
  store.records.set(LEGACY_TIMER_STORAGE_KEYS.workingPrograms, JSON.stringify(state.workingPrograms))
  store.records.set(LEGACY_TIMER_STORAGE_KEYS.settings, JSON.stringify(state.settings))
  store.records.set(LEGACY_TIMER_STORAGE_KEYS.presets, JSON.stringify(state.presets))
  store.records.set(LEGACY_TIMER_STORAGE_KEYS.soundLibrary, JSON.stringify(state.soundLibrary))
  return state
}

describe('independent unified persistence acceptance', () => {
  it('rejects a versioned future payload in the unversioned V1 key', async () => {
    const store = new Store()
    const raw = '{"schemaVersion":99,"mainInterval":30,"futureTimer":true}'
    store.records.set(LEGACY_TIMER_STORAGE_KEYS.config, raw)
    const loaded = await bootstrapUnifiedConfigState(store)
    expect(loaded.status).toBe('recovery-required')
    expect(store.records.get(LEGACY_TIMER_STORAGE_KEYS.config)).toBe(raw)
    expect(store.records.has(UNIFIED_CONFIG_STORAGE_KEY)).toBe(false)
  })
  it('links an unchanged legacy Pattern to its saved snapshot without false dirty state', async () => {
    const store = new Store()
    seedLegacy(store)
    const result = await bootstrapUnifiedConfigState(store, { now: () => 200 })
    if (result.status !== 'loaded') throw new Error(result.message)
    expect(result.state.selectedConfigId).toBe('saved')
    expect(result.state.drafts.saved.dirty).toBe(false)
    expect(result.state.drafts.saved.program).toEqual(result.state.configs[0].program)
  })

  it('preserves unsaved current timer preferences separately from saved preset preferences', async () => {
    const store = new Store()
    const legacy = seedLegacy(store)
    legacy.settings.masterVolume = 0.19
    legacy.settings.notificationsEnabled = false
    store.records.set(LEGACY_TIMER_STORAGE_KEYS.settings, JSON.stringify(legacy.settings))
    const original = new Map(store.records)
    const result = await bootstrapUnifiedConfigState(store, { now: () => 200 })
    if (result.status !== 'loaded') throw new Error(result.message)
    expect(result.state.drafts.saved.settings).toEqual(legacy.settings)
    expect(result.state.drafts.saved.dirty).toBe(true)
    expect(result.state.configs[0].settings).toEqual(legacy.presets[0].settings)
    for (const [key, value] of original) expect(store.records.get(key)).toBe(value)
  })

  it.each(['{bad json', ' { "schemaVersion": 99, "extra": true }\n'])('protects existing unreadable or future unified state on load and save: %s', async raw => {
    const store = new Store()
    store.records.set(UNIFIED_CONFIG_STORAGE_KEY, raw)
    const loaded = await bootstrapUnifiedConfigState(store)
    expect(loaded.status).toBe('recovery-required')
    if (loaded.status !== 'recovery-required') throw new Error('Unexpected load')
    expect(loaded.raw).toBe(raw)
    const state = createDefaultUnifiedConfigState()
    const saved = await saveUnifiedConfigState(store, state)
    expect(saved.status).not.toBe('saved')
    expect(store.records.get(UNIFIED_CONFIG_STORAGE_KEY)).toBe(raw)
    expect(store.writes).toEqual([])
  })

  it('serializes overlapping bootstrap attempts so only one initial configuration wins', async () => {
    const store = new Store()
    let entered!: () => void
    const started = new Promise<void>(resolve => { entered = resolve })
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const set = store.setItem
    let first = true
    store.setItem = async (key, value) => {
      if (key === UNIFIED_CONFIG_STORAGE_KEY && first) { first = false; entered(); await gate }
      await set(key, value)
    }
    const a = bootstrapUnifiedConfigState(store, { now: () => 100, createId: () => 'first' })
    await started
    const b = bootstrapUnifiedConfigState(store, { now: () => 200, createId: () => 'second' })
    await new Promise(resolve => setTimeout(resolve, 0))
    release()
    const [firstResult, secondResult] = await Promise.all([a, b])
    if (firstResult.status !== 'loaded' || secondResult.status !== 'loaded') throw new Error('Bootstrap failed')
    expect(secondResult.state).toEqual(firstResult.state)
    expect(store.writes.filter(key => key === UNIFIED_CONFIG_STORAGE_KEY)).toHaveLength(1)
  })

  it('reuses the written envelope after a verification read failure without repeating migration', async () => {
    const store = new Store()
    seedLegacy(store)
    const get = store.getItem
    let verificationFailed = false
    store.getItem = async key => {
      if (key === UNIFIED_CONFIG_STORAGE_KEY && store.records.has(key) && !verificationFailed) {
        verificationFailed = true
        throw new Error('Interrupted verification')
      }
      return get(key)
    }
    const first = await bootstrapUnifiedConfigState(store, { now: () => 100 })
    expect(first.status).toBe('recovery-required')
    expect(store.records.has(UNIFIED_MIGRATION_MARKER_KEY)).toBe(false)
    const written = store.records.get(UNIFIED_CONFIG_STORAGE_KEY)
    const retry = await bootstrapUnifiedConfigState(store, { now: () => 999 })
    expect(retry.status).toBe('loaded')
    expect(store.records.get(UNIFIED_CONFIG_STORAGE_KEY)).toBe(written)
    expect(store.writes.filter(key => key === UNIFIED_CONFIG_STORAGE_KEY)).toHaveLength(1)
  })

  it('neither reads prototype storage nor modifies legacy running sessions', async () => {
    const store = new Store()
    seedLegacy(store)
    const nativeSession = '{ "schemaVersion": 2, "anchor": 12345, "soundState": {"sequence":{"main":2}} }'
    store.records.set(LEGACY_TIMER_STORAGE_KEYS.v2Session, nativeSession)
    await bootstrapUnifiedConfigState(store)
    expect(store.records.get(LEGACY_TIMER_STORAGE_KEYS.v2Session)).toBe(nativeSession)
    expect(store.writes).not.toContain(LEGACY_TIMER_STORAGE_KEYS.v2Session)
    expect(store.reads.some(key => key.includes('experimental'))).toBe(false)
  })
})
