import { describe, expect, it } from 'vitest'
import { createStarterTimers, STARTER_TIMER_IDS } from '../starter-timers'
import { createUnsavedUnifiedConfigState, parseUnifiedConfigState, reduceUnifiedConfigCommand, UNNAMED_DRAFT_KEY } from '../unified-config-state'
import { bootstrapUnifiedConfigState, saveUnifiedConfigState, UNIFIED_CONFIG_STORAGE_KEY, type AsyncKeyValueStorage } from '../unified-storage'
import { parseUnifiedTimerProgram } from '../unified-timer'
import { nextProgramEvent, runEndAt } from '../timeline'

class Storage implements AsyncKeyValueStorage {
  values = new Map<string, string>()
  getItem = async (key: string) => this.values.get(key) ?? null
  setItem = async (key: string, value: string) => { this.values.set(key, value) }
}

describe('first-run tutorial and starter timers', () => {
  it('provides valid, bounded starter programs with the advertised timing and no alarms', () => {
    const timers = createStarterTimers(100)
    expect(timers.map(config => config.id)).toEqual(STARTER_TIMER_IDS)
    const anchor = 1_000_000
    expect(timers.map(({ program }) => {
      expect(parseUnifiedTimerProgram(program).ok).toBe(true)
      expect(program.alarmBehavior).toBe('off')
      expect(program.steps.every(step => !step.endAlarmEnabled)).toBe(true)
      return (runEndAt(program, anchor, anchor)! - anchor) / 60_000
    })).toEqual([120, 10, 10])
    expect(timers.map(({ program }) => (nextProgramEvent(program, anchor, anchor, anchor, null)!.at - anchor) / 1000)).toEqual([1500, 60, 300])
  })

  it('does not reseed deleted starters or repeat a skipped tour on relaunch', async () => {
    const storage = new Storage()
    const boot = await bootstrapUnifiedConfigState(storage, { now: () => 100 })
    expect(boot.status).toBe('loaded')
    if (boot.status !== 'loaded') return
    expect(boot.state.onboardingStatus).toBe('pending')
    const draft = boot.state.drafts[UNNAMED_DRAFT_KEY]
    let state = reduceUnifiedConfigCommand(boot.state, { type: 'finishOnboarding', completed: false }).state
    for (const id of STARTER_TIMER_IDS) state = reduceUnifiedConfigCommand(state, { type: 'delete', id }).state
    expect(state.drafts[UNNAMED_DRAFT_KEY]).toEqual(draft)
    expect((await saveUnifiedConfigState(storage, state)).status).toBe('saved')
    const relaunched = await bootstrapUnifiedConfigState(storage)
    expect(relaunched).toMatchObject({ status: 'loaded', source: 'unified', state: { onboardingStatus: 'dismissed', configs: [] } })
  })

  it('leaves existing user libraries alone and allows an explicit starter import without replacing a draft', async () => {
    const storage = new Storage()
    const existing = createUnsavedUnifiedConfigState({ now: () => 100 })
    storage.values.set(UNIFIED_CONFIG_STORAGE_KEY, JSON.stringify(existing))
    const loaded = await bootstrapUnifiedConfigState(storage)
    if (loaded.status !== 'loaded') throw new Error('Existing library did not load')
    expect(loaded.state.configs).toEqual([])
    expect(loaded.state.onboardingStatus).toBeUndefined()
    const before = loaded.state.drafts[UNNAMED_DRAFT_KEY]
    const added = reduceUnifiedConfigCommand(loaded.state, { type: 'importConfig', config: createStarterTimers(101)[0], select: false })
    expect(added.status).toBe('applied')
    expect(added.state.selectedConfigId).toBeNull()
    expect(added.state.drafts[UNNAMED_DRAFT_KEY]).toEqual(before)
    expect(added.state.configs.map(config => config.name)).toEqual(['Pomodoro'])
  })

  it('retains completion when a user exits a later replay, without changing timer content', () => {
    const state = createUnsavedUnifiedConfigState()
    const completed = reduceUnifiedConfigCommand(state, { type: 'finishOnboarding', completed: true }).state
    const dismissedReplay = reduceUnifiedConfigCommand(completed, { type: 'finishOnboarding', completed: false }).state
    expect(dismissedReplay.onboardingStatus).toBe('completed')
    expect(dismissedReplay.configs).toEqual(state.configs)
    expect(dismissedReplay.drafts).toEqual(state.drafts)
    expect(parseUnifiedConfigState(JSON.stringify(dismissedReplay)).ok).toBe(true)
  })

  it('rejects malformed tutorial metadata without silently replacing user state', () => {
    const state = createUnsavedUnifiedConfigState()
    for (const onboardingStatus of [false, ['pending'], 'unknown', 1]) {
      expect(parseUnifiedConfigState({ ...state, onboardingStatus }).ok).toBe(false)
    }
  })
})
