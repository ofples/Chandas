import { describe, expect, it } from 'vitest'
import { createDefaultUnifiedConfigState, parseUnifiedConfigState, reduceUnifiedConfigCommand, UNNAMED_DRAFT_KEY, type ConfigStateCommand, type UnifiedConfigState } from '../unified-config-state'

function initial() {
  let serial = 0
  return createDefaultUnifiedConfigState({ now: () => 100, createId: () => `id-${++serial}` })
}
function apply(state: UnifiedConfigState, command: ConfigStateCommand) {
  const result = reduceUnifiedConfigCommand(state, command, { now: () => 200, createId: () => 'generated-id' })
  expect(result.status, result.reason).toBe('applied')
  return result.state
}
function editStep(state: UnifiedConfigState, label: string) {
  const key = state.selectedConfigId ?? UNNAMED_DRAFT_KEY
  const program = structuredClone(state.drafts[key].program)
  program.steps[0].label = label
  return apply(state, { type: 'edit', changes: { program, editorOptions: { enabledActionIds: ['run-length', 'notifications'] } } })
}

describe('independent configuration draft journeys', () => {
  it.each(['keep', 'discard', 'save'] as const)('preserves the explicit %s choice across switch and restart', choice => {
    let state = initial()
    const a = state.selectedConfigId!
    const original = state.configs[0].program.steps[0].label
    state = apply(state, { type: 'duplicate', id: a, newId: 'b' })
    expect(state.selectedConfigId).toBe(a)
    state = editStep(state, 'Unsaved A')
    state = apply(state, { type: 'switch', configId: 'b', choice })
    const loaded = parseUnifiedConfigState(JSON.stringify(state))
    expect(loaded.ok).toBe(true)
    if (!loaded.ok) throw new Error(loaded.reason)
    state = apply(loaded.value, { type: 'switch', configId: a, choice: 'keep' })
    expect(state.drafts[a].program.steps[0].label).toBe(choice === 'discard' ? original : 'Unsaved A')
    expect(state.drafts[a].dirty).toBe(choice === 'keep')
    expect(state.configs.find(config => config.id === a)!.program.steps[0].label).toBe(choice === 'save' ? 'Unsaved A' : original)
    if (choice !== 'discard') expect(state.drafts[a].editorOptions.enabledActionIds).toEqual(['run-length', 'notifications'])
  })

  it('cancelled switching retains the same state and edits', () => {
    let state = initial()
    state = apply(state, { type: 'duplicate', id: state.selectedConfigId!, newId: 'b' })
    state = editStep(state, 'Do not lose this')
    const before = JSON.stringify(state)
    const result = reduceUnifiedConfigCommand(state, { type: 'switch', configId: 'b', choice: 'cancel' })
    expect(result.state).toBe(state)
    expect(JSON.stringify(state)).toBe(before)
  })

  it('Save as selects the new card and preserves the outgoing unsaved draft', () => {
    let state = initial()
    const a = state.selectedConfigId!
    const original = state.configs[0].program.steps[0].label
    state = editStep(state, 'Copied changes')
    state = apply(state, { type: 'saveAs', id: 'b', name: 'New configuration' })
    expect(state.selectedConfigId).toBe('b')
    expect(state.drafts.b.dirty).toBe(false)
    expect(state.drafts[a].dirty).toBe(true)
    expect(state.configs.find(config => config.id === a)!.program.steps[0].label).toBe(original)
    expect(state.configs.find(config => config.id === 'b')!.program.steps[0].label).toBe('Copied changes')
    state = apply(state, { type: 'switch', configId: a, choice: 'keep' })
    expect(state.drafts[a].program.steps[0].label).toBe('Copied changes')
  })

  it('restores an unnamed kept draft after restart', () => {
    let state = initial()
    const a = state.selectedConfigId!
    state = apply(state, { type: 'switch', configId: null, choice: 'keep' })
    state = apply(state, { type: 'edit', changes: { name: 'Keep for later' } })
    state = editStep(state, 'Unnamed custom interval')
    state = apply(state, { type: 'switch', configId: a, choice: 'keep' })
    const loaded = parseUnifiedConfigState(JSON.stringify(state))
    if (!loaded.ok) throw new Error(loaded.reason)
    state = apply(loaded.value, { type: 'switch', configId: null, choice: 'keep' })
    expect(state.drafts[UNNAMED_DRAFT_KEY]).toMatchObject({ name: 'Keep for later', dirty: true, program: { steps: [{ label: 'Unnamed custom interval' }] } })
  })

  it('library actions preserve active edits and shared imported sounds', () => {
    let state = initial()
    const a = state.selectedConfigId!
    state = apply(state, { type: 'duplicate', id: a, newId: 'b' })
    state = editStep(state, 'Active draft')
    const draft = structuredClone(state.drafts[a])
    const sound = { kind: 'document' as const, uri: 'content://sounds/1', title: 'Imported bell' }
    state = apply(state, { type: 'setSoundLibrary', sounds: [sound, sound] })
    state = apply(state, { type: 'rename', id: 'b', name: 'Renamed B' })
    state = apply(state, { type: 'delete', id: 'b' })
    expect(state.drafts[a]).toEqual(draft)
    expect(state.soundLibrary).toEqual([sound])
  })

  it('deleting the selected clean card leaves a valid editable selection', () => {
    let state = initial()
    state = apply(state, { type: 'delete', id: state.selectedConfigId! })
    const loaded = parseUnifiedConfigState(JSON.stringify(state))
    expect(loaded.ok).toBe(true)
    expect(state.drafts[state.selectedConfigId ?? UNNAMED_DRAFT_KEY]).toBeDefined()
  })

  it('keeps 80-character configuration names valid after duplication', () => {
    let state = initial()
    state = apply(state, { type: 'rename', id: state.selectedConfigId!, name: '🔔'.repeat(80) })
    state = apply(state, { type: 'duplicate', id: state.selectedConfigId!, newId: 'copy' })
    expect(parseUnifiedConfigState(JSON.stringify(state)).ok).toBe(true)
    expect([...state.configs.find(config => config.id === 'copy')!.name].length).toBeLessThanOrEqual(80)
  })

  it.each(['__proto__', 'constructor'])('preserves authored configuration identity %s without dictionary collisions', id => {
    let state = initial()
    state = apply(state, { type: 'saveAs', id, name: 'Imported identity' })
    expect(Object.hasOwn(state.drafts, id)).toBe(true)
    expect(state.drafts[id].baseConfigId).toBe(id)
    expect(parseUnifiedConfigState(JSON.stringify(state)).ok).toBe(true)
    state = apply(state, { type: 'switch', configId: null, choice: 'keep' })
    expect(state.drafts[UNNAMED_DRAFT_KEY].baseConfigId).toBeUndefined()
    expect(state.drafts[id].baseConfigId).toBe(id)
  })

  it('rejects the reserved unnamed draft key as a saved configuration ID', () => {
    const state = initial()
    const result = reduceUnifiedConfigCommand(state, { type: 'saveAs', id: UNNAMED_DRAFT_KEY, name: 'Alias' })
    expect(result.status).toBe('blocked')
    expect(result.state).toBe(state)
  })

  it('treats absent optional fields and explicit undefined as the same authored value', () => {
    let state = initial()
    const id = state.selectedConfigId!
    const program = structuredClone(state.drafts[id].program)
    program.steps[0].subBellTracks[0].randomRepeat = undefined
    program.steps[0].subBellTracks[0].afterStartSeconds = undefined
    program.steps[0].endCue.hapticOverride = undefined
    state = apply(state, { type: 'edit', changes: { program } })
    expect(state.drafts[id].dirty).toBe(false)
  })
})
