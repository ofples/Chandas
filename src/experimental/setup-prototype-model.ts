import type { AppTimerSettings, CueSettings, PatternTrack, SoundRef, SubBellColorId, TimerAlignment } from '../types'
import { createProgramId, defaultAppTimerSettings, defaultPatternProgram } from '../lib/timerV2'

export const SETUP_PROTOTYPE_STORAGE_KEY = 'chandas.experimental-unified-setup.v1'

export interface PrototypeStep {
  id: string
  label: string
  durationSeconds: number
  endCue: CueSettings
  alarmEnabled: boolean
  subBellsEnabled: boolean
  tracks: PatternTrack[]
}

export interface PrototypeDraft {
  schemaVersion: 1
  name: string
  labelIsCustom: boolean
  steps: PrototypeStep[]
  alignment: TimerAlignment
  completionCue: CueSettings | null
  runPolicy: { kind: 'continuous' | 'cycles' | 'duration'; cycleCount: number; durationSeconds: number }
  settings: AppTimerSettings
  preferences: { overlayEnabled: boolean; exactTiming: boolean; widgetSize: 'compact' | 'standard'; widgetOpacity: number; widgetAppearance?: 'system' | 'dark' | 'light' }
  soundLibrary: SoundRef[]
}

export interface PrototypeSavedConfig { id: string; name: string; snapshot: PrototypeDraft; updatedAt: number; showInRunningSelector?: boolean }
export interface PrototypeStore { schemaVersion: 1; configs: PrototypeSavedConfig[]; activeConfigId: string | null; draft: PrototypeDraft; keptDrafts: Record<string, PrototypeDraft>; soundLibrary: SoundRef[] }
export type DirtySwitchChoice = 'save' | 'keep' | 'discard' | 'dismiss'

function demoTrack(durationSeconds: number): PatternTrack {
  const base = defaultPatternProgram().tracks[0]
  return { ...base, id: createProgramId(), enabled: true, cadenceMinutes: 5, cadenceSeconds: 5 * 60, selectedOffsetsMinutes: [5, 10, 15, 20, 25], selectedOffsetsSeconds: [300, 600, 900, 1200, 1500].filter(value => value < durationSeconds), repeatEnabled: true, afterStartSeconds: undefined, beforeEndSeconds: undefined, randomRepeat: undefined }
}

export function defaultPrototypeDraft(): PrototypeDraft {
  const base = defaultPatternProgram()
  const durationSeconds = 25 * 60
  const cue: CueSettings = { ...base.mainCue, sounds: [base.mainCue.sound], soundMode: 'single' }
  return {
    schemaVersion: 1,
    name: 'Quiet focus',
    labelIsCustom: true,
    steps: [{ id: createProgramId(), label: 'Focus', durationSeconds, endCue: cue, alarmEnabled: false, subBellsEnabled: true, tracks: [demoTrack(durationSeconds)] }],
    alignment: { kind: 'elapsed' },
    completionCue: null,
    runPolicy: { kind: 'continuous', cycleCount: 4, durationSeconds: 60 * 60 },
    settings: { ...defaultAppTimerSettings(), advancedModeEnabled: true, secondPrecisionEnabled: true },
    preferences: { overlayEnabled: false, exactTiming: true, widgetSize: 'standard', widgetOpacity: 0.9, widgetAppearance: 'system' },
    soundLibrary: [],
  }
}

export function createPrototypeStore(): PrototypeStore {
  return { schemaVersion: 1, configs: [], activeConfigId: null, draft: defaultPrototypeDraft(), keptDrafts: {}, soundLibrary: [] }
}

export function prototypeDraftJson(draft: PrototypeDraft): string { return JSON.stringify(draft) }
export function draftIsDirty(store: PrototypeStore): boolean {
  if (store.activeConfigId === null) {
    const kept = store.keptDrafts[draftKey(null)]
    return !kept || prototypeDraftJson(kept) !== prototypeDraftJson(store.draft)
  }
  const active = store.configs.find(config => config.id === store.activeConfigId)
  return !active || prototypeDraftJson(active.snapshot) !== prototypeDraftJson(store.draft)
}

export function normalizePrototypeStore(value: unknown): PrototypeStore {
  const fallback = createPrototypeStore()
  if (!value || typeof value !== 'object') return fallback
  const candidate = value as Partial<PrototypeStore>
  if (candidate.schemaVersion !== 1 || !candidate.draft || !Array.isArray(candidate.configs)) return fallback
  // Prototype records are intentionally isolated from TimerV2State. Keep malformed
  // or future-shaped data from becoming an automatic write target.
  const draft = candidate.draft as PrototypeDraft
  if (!isDraftRecord(draft)) return fallback
  const configs = candidate.configs.filter(config => config && typeof config.id === 'string' && typeof config.name === 'string' && isDraftRecord(config.snapshot))
  const keptDrafts = candidate.keptDrafts && typeof candidate.keptDrafts === 'object'
    ? Object.fromEntries(Object.entries(candidate.keptDrafts).filter(([, savedDraft]) => isDraftRecord(savedDraft))) as Record<string, PrototypeDraft>
    : {}
  return { schemaVersion: 1, configs, activeConfigId: typeof candidate.activeConfigId === 'string' ? candidate.activeConfigId : null, draft, keptDrafts, soundLibrary: Array.isArray(candidate.soundLibrary) ? candidate.soundLibrary.filter(isSoundRef) : [] }
}

export function saveCurrentConfig(store: PrototypeStore, name = store.draft.name): PrototypeStore {
  const cleanName = name.trim() || 'Untitled setup'
  const id = store.activeConfigId ?? createProgramId()
  const saved = { ...store.configs.find(config => config.id === id), id, name: cleanName, snapshot: { ...store.draft, name: cleanName }, updatedAt: Date.now() }
  const configs = store.configs.some(item => item.id === id) ? store.configs.map(item => item.id === id ? saved : item) : [...store.configs, saved]
  const keptDrafts = { ...store.keptDrafts }
  delete keptDrafts[draftKey(store.activeConfigId)]
  return { ...store, activeConfigId: id, draft: saved.snapshot, configs, keptDrafts, soundLibrary: mergeSoundLibrary(store.soundLibrary, store.draft.soundLibrary) }
}

export function saveAsConfig(store: PrototypeStore, name: string): PrototypeStore {
  const cleanName = name.trim() || 'Untitled setup'
  const saved = { id: createProgramId(), name: cleanName, snapshot: { ...store.draft, name: cleanName }, updatedAt: Date.now() }
  const keptDrafts = { ...store.keptDrafts }
  delete keptDrafts[draftKey(store.activeConfigId)]
  return { ...store, activeConfigId: saved.id, draft: saved.snapshot, configs: [...store.configs, saved], keptDrafts, soundLibrary: mergeSoundLibrary(store.soundLibrary, store.draft.soundLibrary) }
}

export function switchConfig(store: PrototypeStore, targetId: string, choice: DirtySwitchChoice, saveAsName?: string): PrototypeStore {
  const isUnsavedDraftTarget = targetId === draftKey(null) && Boolean(store.keptDrafts[draftKey(null)])
  if (choice === 'dismiss' || (!isUnsavedDraftTarget && !store.configs.some(config => config.id === targetId))) return store
  let next = store
  if (draftIsDirty(store) && choice === 'save') next = saveAsName ? saveAsConfig(store, saveAsName) : saveCurrentConfig(store)
  if (draftIsDirty(store) && choice === 'keep') next = { ...store, keptDrafts: { ...store.keptDrafts, [draftKey(store.activeConfigId)]: jsonClone(store.draft) } }
  if (draftIsDirty(store) && choice === 'discard') {
    const keptDrafts = { ...store.keptDrafts }
    delete keptDrafts[draftKey(store.activeConfigId)]
    next = { ...store, keptDrafts }
  }
  const target = next.configs.find(config => config.id === targetId) ?? store.configs.find(config => config.id === targetId)
  if (!target && !isUnsavedDraftTarget) return store
  const key = isUnsavedDraftTarget ? draftKey(null) : draftKey(target!.id)
  const draft = jsonClone(next.keptDrafts[key] ?? target!.snapshot)
  draft.soundLibrary = [...next.soundLibrary]
  return { ...next, activeConfigId: isUnsavedDraftTarget ? null : target!.id, draft }
}

export function duplicateConfig(store: PrototypeStore, sourceId: string, name?: string): PrototypeStore {
  const source = store.configs.find(config => config.id === sourceId)
  if (!source) return store
  const duplicate = { id: createProgramId(), name: name?.trim() || `${source.name} copy`, snapshot: { ...jsonClone(source.snapshot), name: name?.trim() || `${source.name} copy` }, updatedAt: Date.now() }
  return { ...store, configs: [...store.configs, duplicate] }
}

export function renameConfig(store: PrototypeStore, id: string, name: string): PrototypeStore {
  const cleanName = name.trim()
  if (!cleanName) return store
  return { ...store, configs: store.configs.map(item => item.id === id ? { ...item, name: cleanName, snapshot: { ...item.snapshot, name: cleanName } } : item), draft: store.activeConfigId === id ? { ...store.draft, name: cleanName } : store.draft }
}

export function deleteConfig(store: PrototypeStore, id: string): PrototypeStore {
  const configs = store.configs.filter(item => item.id !== id)
  const keptDrafts = { ...store.keptDrafts }
  delete keptDrafts[draftKey(id)]
  return { ...store, configs, keptDrafts, activeConfigId: store.activeConfigId === id ? null : store.activeConfigId }
}

export function importPrototypeConfig(store: PrototypeStore, value: unknown, suggestedName?: string): PrototypeStore {
  const candidate = value && typeof value === 'object' && 'draft' in value ? (value as { draft: unknown }).draft : value
  if (!isDraftRecord(candidate)) return store
  const name = suggestedName?.trim() || candidate.name.trim() || 'Imported setup'
  const snapshot = { ...jsonClone(candidate), name, soundLibrary: mergeSoundLibrary(candidate.soundLibrary, store.soundLibrary) }
  return { ...store, configs: [...store.configs, { id: createProgramId(), name, snapshot, updatedAt: Date.now() }], soundLibrary: mergeSoundLibrary(store.soundLibrary, candidate.soundLibrary) }
}

export function duplicateStep(step: PrototypeStep): PrototypeStep {
  return { ...jsonClone(step), id: createProgramId(), label: `${step.label} copy`, tracks: step.tracks.map(track => ({ ...jsonClone(track), id: createProgramId() })) }
}

export function moveStep(steps: PrototypeStep[], from: number, to: number): PrototypeStep[] {
  if (from < 0 || from >= steps.length || to < 0 || to >= steps.length || from === to) return steps
  const next = [...steps]
  const [item] = next.splice(from, 1)
  next.splice(to, 0, item)
  return next
}

export function addStep(source: PrototypeStep): PrototypeStep {
  return { id: createProgramId(), label: 'New step', durationSeconds: 5 * 60, endCue: { ...source.endCue }, alarmEnabled: false, subBellsEnabled: false, tracks: [] }
}

export function newPrototypeTrack(index: number, durationSeconds: number, color?: SubBellColorId): PatternTrack {
  const base = demoTrack(durationSeconds)
  return { ...base, id: createProgramId(), label: `Sub-bell ${index + 1}`, color: color ?? base.color, selectedOffsetsMinutes: [], selectedOffsetsSeconds: [], repeatEnabled: false, afterStartSeconds: undefined, beforeEndSeconds: undefined, randomRepeat: undefined }
}

export function withCueSound(cue: CueSettings, sound: SoundRef): CueSettings {
  return { ...cue, sound, sounds: [sound], soundMode: 'single' }
}

export function addPrototypeLibrarySound(store: PrototypeStore, sound: SoundRef): PrototypeStore {
  if (sound.kind === 'builtin') return store
  const key = sound.kind === 'android' ? sound.uri : sound.uri
  const soundLibrary = mergeSoundLibrary(store.soundLibrary, [sound])
  return { ...store, soundLibrary, draft: { ...store.draft, soundLibrary } }
}

function draftKey(id: string | null): string { return id ?? '__unsaved__' }
function jsonClone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T }
function mergeSoundLibrary(...libraries: SoundRef[][]): SoundRef[] {
  const seen = new Set<string>()
  return libraries.flat().filter(sound => {
    if (!isSoundRef(sound) || sound.kind === 'builtin') return false
    const key = `${sound.kind}:${sound.uri}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
function isSoundRef(value: unknown): value is SoundRef {
  if (!value || typeof value !== 'object') return false
  const sound = value as Partial<SoundRef>
  return sound.kind === 'builtin' ? typeof sound.id === 'string'
    : (sound.kind === 'android' || sound.kind === 'document') && typeof sound.uri === 'string' && typeof sound.title === 'string'
}
function isDraftRecord(value: unknown): value is PrototypeDraft {
  if (!value || typeof value !== 'object') return false
  const draft = value as Partial<PrototypeDraft>
  if (draft.schemaVersion !== 1 || typeof draft.name !== 'string' || !Array.isArray(draft.steps) || draft.steps.length < 1 || !draft.settings || !draft.preferences || !Array.isArray(draft.soundLibrary)) return false
  if (!draft.steps.every(step => step && typeof step.id === 'string' && typeof step.label === 'string' && Number.isFinite(step.durationSeconds) && step.durationSeconds! >= 1 && isSoundRef(step.endCue?.sound) && Array.isArray(step.tracks) && step.tracks.every(track => track && typeof track.id === 'string' && typeof track.enabled === 'boolean' && isSoundRef(track.sound)))) return false
  if (!draft.alignment || !['elapsed', 'local-clock'].includes(draft.alignment.kind)) return false
  if (draft.alignment.kind === 'local-clock' && !Number.isFinite(draft.alignment.offsetMinutes)) return false
  if (!draft.runPolicy || !['continuous', 'cycles', 'duration'].includes(draft.runPolicy.kind) || !Number.isFinite(draft.runPolicy.durationSeconds) || !Number.isFinite(draft.runPolicy.cycleCount)) return false
  if (!draft.settings.availability || !Array.isArray(draft.settings.availability.weeklyWindows) || !Array.isArray(draft.settings.availability.overrides)) return false
  if (!draft.settings.haptics || !['main', 'subBell', 'alarm'].every(key => {
    const profile = draft.settings!.haptics[key as 'main' | 'subBell' | 'alarm']
    return profile && ['single', 'double', 'triple'].includes(profile.pattern) && ['gentle', 'balanced', 'strong'].includes(profile.strength)
  })) return false
  return Boolean(Number.isFinite(draft.settings.masterVolume) && typeof draft.preferences.overlayEnabled === 'boolean' && typeof draft.preferences.exactTiming === 'boolean' && (draft.preferences.widgetSize === 'compact' || draft.preferences.widgetSize === 'standard') && Number.isFinite(draft.preferences.widgetOpacity))
}
