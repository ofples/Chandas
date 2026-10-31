import { describe, expect, it } from 'vitest'
import {
  createPrototypeStore,
  addPrototypeLibrarySound,
  addStep,
  duplicateStep,
  deleteConfig,
  duplicateConfig,
  draftIsDirty,
  importPrototypeConfig,
  normalizePrototypeStore,
  saveAsConfig,
  saveCurrentConfig,
  switchConfig,
} from '../setup-prototype-model'

describe('experimental setup draft model', () => {
  it('adds a fresh step, duplicates existing bells explicitly, and preserves saved selector metadata', () => {
    const saved = saveCurrentConfig(createPrototypeStore())
    const original = saved.draft.steps[0]
    expect(addStep(original).tracks).toEqual([])
    expect(duplicateStep(original).tracks).toHaveLength(original.tracks.length)
    const hidden = { ...saved, configs: saved.configs.map(config => ({ ...config, showInRunningSelector: false })) }
    expect(saveCurrentConfig(hidden).configs[0].showInRunningSelector).toBe(false)
  })
  it('retains an unnamed draft and imported sounds when changing configurations', () => {
    const saved = saveCurrentConfig(createPrototypeStore(), 'Saved')
    const current = { ...saved, activeConfigId: null, draft: { ...saved.draft, name: 'Unfinished' } }
    const sound = { kind: 'document' as const, uri: 'content://example/sound', title: 'My bell' }
    const withLibrary = addPrototypeLibrarySound(current, sound)
    const switched = switchConfig(withLibrary, saved.activeConfigId!, 'keep')
    expect(switched.soundLibrary).toEqual([sound])
    const returned = switchConfig(switched, '__unsaved__', 'discard')
    expect(returned.activeConfigId).toBeNull()
    expect(returned.draft.name).toBe('Unfinished')
    expect(returned.soundLibrary).toEqual([sound])
  })

  it('rejects imports missing timing policies or schedule structure', () => {
    const store = createPrototypeStore()
    const incomplete = JSON.parse(JSON.stringify(store.draft))
    delete incomplete.alignment
    expect(importPrototypeConfig(store, { schemaVersion: 1, draft: incomplete })).toBe(store)
    incomplete.alignment = { kind: 'elapsed' }
    incomplete.settings.availability = {}
    expect(importPrototypeConfig(store, { schemaVersion: 1, draft: incomplete })).toBe(store)
  })
  it('saves a named snapshot and reports edits against that snapshot', () => {
    const saved = saveAsConfig(createPrototypeStore(), 'Morning')
    expect(draftIsDirty(saved)).toBe(false)

    const edited = { ...saved, draft: { ...saved.draft, name: 'Morning edit' } }
    expect(draftIsDirty(edited)).toBe(true)
    const committed = saveCurrentConfig(edited)
    expect(draftIsDirty(committed)).toBe(false)
    expect(committed.configs.find(config => config.id === committed.activeConfigId)?.snapshot.name).toBe('Morning edit')
  })

  it('keeps a dirty setup draft while switching and restores it when returning', () => {
    const first = saveAsConfig(createPrototypeStore(), 'First')
    const firstId = first.activeConfigId!
    const second = saveAsConfig({ ...first, draft: { ...first.draft, name: 'Second' } }, 'Second')
    const secondId = second.activeConfigId!
    const editedSecond = { ...second, draft: { ...second.draft, name: 'Second kept draft' } }

    const atFirst = switchConfig(editedSecond, firstId, 'keep')
    expect(atFirst.activeConfigId).toBe(firstId)
    expect(atFirst.draft.name).toBe('First')
    expect(atFirst.keptDrafts[secondId]?.name).toBe('Second kept draft')

    const backAtSecond = switchConfig(atFirst, secondId, 'discard')
    expect(backAtSecond.activeConfigId).toBe(secondId)
    expect(backAtSecond.draft.name).toBe('Second kept draft')
  })

  it('discard removes a kept dirty draft and duplicate leaves the current draft untouched', () => {
    const first = saveAsConfig(createPrototypeStore(), 'First')
    const second = saveAsConfig({ ...first, draft: { ...first.draft, name: 'Second' } }, 'Second')
    const secondId = second.activeConfigId!
    const dirty = { ...second, draft: { ...second.draft, name: 'Discard me' } }
    const switched = switchConfig(dirty, first.activeConfigId!, 'discard')
    expect(switched.keptDrafts[secondId]).toBeUndefined()

    const duplicate = duplicateConfig(switched, first.activeConfigId!)
    expect(duplicate.activeConfigId).toBe(switched.activeConfigId)
    expect(duplicate.draft).toEqual(switched.draft)
    expect(duplicate.configs).toHaveLength(switched.configs.length + 1)
  })

  it('imports a validated configuration without changing the active draft and rejects malformed data', () => {
    const store = saveAsConfig(createPrototypeStore(), 'Current')
    const before = store.draft
    const imported = importPrototypeConfig(store, { schemaVersion: 1, draft: { ...before, name: 'Imported' } })
    expect(imported.draft).toBe(before)
    expect(imported.activeConfigId).toBe(store.activeConfigId)
    expect(imported.configs.at(-1)?.name).toBe('Imported')
    expect(importPrototypeConfig(store, { schemaVersion: 1, steps: [] })).toBe(store)
  })

  it('normalizes storage separately and falls back safely for malformed drafts', () => {
    const store = createPrototypeStore()
    expect(normalizePrototypeStore(JSON.parse(JSON.stringify(store)))).toEqual(store)
    expect(normalizePrototypeStore({ schemaVersion: 1, draft: { schemaVersion: 1, steps: [] }, configs: [] }).draft.steps).toHaveLength(1)
    const deleted = deleteConfig(saveAsConfig(store, 'Temporary'), 'missing-id')
    expect(deleted.configs).toHaveLength(1)
  })
})
