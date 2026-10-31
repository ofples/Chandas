import type { AppTimerSettings, CueSettings, SoundRef } from '../types'
import type { UnifiedTimerConfig } from './unified-config-state'
import { convertLegacyProgramToUnified } from './unified-timer'
import { convertLegacyTimerSettings, parseUnifiedTimerSettings } from './unified-config-state'
import { createProgramId, defaultAppTimerSettings, cueSounds } from './timerV2'
import { parseUnifiedTimerProgram } from './unified-timer'

export const UNIFIED_CONFIGURATION_TRANSFER_FORMAT = 'chandas.configuration' as const
export const UNIFIED_CONFIGURATION_TRANSFER_VERSION = 2 as const
export const UNIFIED_CONFIGURATION_PROGRAM_SCHEMA = 4 as const
export const MAX_UNIFIED_CONFIGURATION_TRANSFER_CHARACTERS = 256_000

export type UnifiedConfigurationTransferError = 'empty' | 'too-large' | 'invalid' | 'unsupported-version' | 'unsupported-program-schema'

export type UnifiedConfigurationTransferResult =
  | { ok: true; config: UnifiedTimerConfig; hasDeviceSpecificSounds: boolean; sourceVersion: 1 | 2 }
  | { ok: false; error: UnifiedConfigurationTransferError }

export interface TransferDependencies { now?: number; createId?: () => string }

interface TransferEnvelopeV2 {
  format: typeof UNIFIED_CONFIGURATION_TRANSFER_FORMAT
  version: 2
  programSchema: 4
  settingsSchema: 1
  exportedAt: string
  configuration: Pick<UnifiedTimerConfig, 'name' | 'createdAt' | 'showInRunningSelector' | 'program' | 'settings' | 'editorOptions'>
}

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const clone = <T>(value: T): T => typeof structuredClone === 'function' ? structuredClone(value) : JSON.parse(JSON.stringify(value)) as T

export function serializeUnifiedConfiguration(config: UnifiedTimerConfig, now = Date.now()): string {
  const program = parseUnifiedTimerProgram(config.program)
  const settings = parseUnifiedTimerSettings(config.settings)
  if (!program.ok || !settings || !validName(config.name) || !validEditorOptions(config.editorOptions)) throw new Error('Cannot export an invalid timer configuration.')
  const envelope: TransferEnvelopeV2 = {
    format: UNIFIED_CONFIGURATION_TRANSFER_FORMAT, version: UNIFIED_CONFIGURATION_TRANSFER_VERSION,
    programSchema: UNIFIED_CONFIGURATION_PROGRAM_SCHEMA, settingsSchema: 1,
    exportedAt: new Date(now).toISOString(),
    configuration: {
      name: config.name.trim(), createdAt: config.createdAt,
      showInRunningSelector: config.showInRunningSelector,
      program: program.value, settings, editorOptions: clone(config.editorOptions),
    },
  }
  return JSON.stringify(envelope, null, 2)
}

export function parseUnifiedConfigurationTransfer(text: string, existingNames: string[] = [], deps: TransferDependencies = {}): UnifiedConfigurationTransferResult {
  const source = text.trim()
  if (!source) return { ok: false, error: 'empty' }
  if (source.length > MAX_UNIFIED_CONFIGURATION_TRANSFER_CHARACTERS) return { ok: false, error: 'too-large' }
  try {
    const parsed = JSON.parse(source) as unknown
    if (!record(parsed) || parsed.format !== UNIFIED_CONFIGURATION_TRANSFER_FORMAT) return { ok: false, error: 'invalid' }
    if (parsed.version !== 1 && parsed.version !== UNIFIED_CONFIGURATION_TRANSFER_VERSION) return { ok: false, error: 'unsupported-version' }
    if (!record(parsed.configuration)) return { ok: false, error: 'invalid' }
    if (parsed.version === 2) {
      if (parsed.programSchema !== UNIFIED_CONFIGURATION_PROGRAM_SCHEMA) return { ok: false, error: 'unsupported-program-schema' }
      if (parsed.settingsSchema !== 1) return { ok: false, error: 'unsupported-version' }
    }
    const configuration = parsed.configuration
    if (!validName(configuration.name)) return { ok: false, error: 'invalid' }
    if (configuration.createdAt !== undefined && (typeof configuration.createdAt !== 'number' || !Number.isFinite(configuration.createdAt))) return { ok: false, error: 'invalid' }
    if (configuration.showInRunningSelector !== undefined && typeof configuration.showInRunningSelector !== 'boolean') return { ok: false, error: 'invalid' }
    const id = deps.createId?.() ?? createProgramId()
    const now = deps.now ?? Date.now()
    const name = importedName(configuration.name.trim(), existingNames)
    let program
    let settings: AppTimerSettings | null
    let editorOptions = { enabledActionIds: [] as string[] }
    if (parsed.version === 2) {
      const validatedProgram = parseUnifiedTimerProgram(configuration.program)
      settings = parseUnifiedTimerSettings(configuration.settings)
      if (!validatedProgram.ok || !settings || (configuration.editorOptions !== undefined && !validEditorOptions(configuration.editorOptions))) return { ok: false, error: 'invalid' }
      program = validatedProgram.value
      if (configuration.editorOptions !== undefined) editorOptions = clone(configuration.editorOptions) as typeof editorOptions
    } else {
      const converted = convertLegacyProgramToUnified(configuration.program, `transfer-v1-${id}`)
      if (!converted.ok) return { ok: false, error: 'invalid' }
      program = converted.value
      let windowIndex = 0
      settings = configuration.settings === undefined
        ? defaultTransferSettings()
        : convertLegacyTimerSettings(configuration.settings, () => `transfer-v1-${id}:window-${++windowIndex}`)
      if (!settings) return { ok: false, error: 'invalid' }
    }
    const config: UnifiedTimerConfig = {
      id, name, createdAt: now, updatedAt: now, program, settings,
      showInRunningSelector: configuration.showInRunningSelector !== false,
      editorOptions,
    }
    return { ok: true, config, sourceVersion: parsed.version, hasDeviceSpecificSounds: hasDeviceSpecificSounds(config) }
  } catch { return { ok: false, error: 'invalid' } }
}

function defaultTransferSettings(): AppTimerSettings {
  const settings = defaultAppTimerSettings()
  settings.availability.weeklyWindows = settings.availability.weeklyWindows.map((window, index) => ({ ...window, id: `transfer-v1:window-${index + 1}` }))
  return settings
}

function validName(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && [...value.trim()].length <= 80
}

function validEditorOptions(value: unknown): value is { enabledActionIds: string[] } {
  return record(value) && Array.isArray(value.enabledActionIds)
    && value.enabledActionIds.every(id => typeof id === 'string' && id.length > 0 && id.length <= 120)
    && new Set(value.enabledActionIds).size === value.enabledActionIds.length
}

function importedName(name: string, existingNames: string[]): string {
  const taken = new Set(existingNames.map(value => value.trim().toLocaleLowerCase()))
  if (!taken.has(name.toLocaleLowerCase())) return name
  for (let suffix = 2; suffix <= 999; suffix += 1) {
    const marker = ` (${suffix})`
    const candidate = `${[...name].slice(0, 80 - [...marker].length).join('')}${marker}`
    if (!taken.has(candidate.toLocaleLowerCase())) return candidate
  }
  return `${[...name].slice(0, 67).join('')} (imported)`
}

function hasDeviceSpecificSounds(config: UnifiedTimerConfig): boolean {
  const cues: Array<Pick<CueSettings, 'sound' | 'sounds'>> = []
  config.program.steps.forEach(step => { cues.push(step.endCue, ...step.subBellTracks) })
  if (config.program.completionCue) cues.push(config.program.completionCue)
  const sounds: SoundRef[] = [...cues.flatMap(cueSounds), config.settings.alarmSound]
  return sounds.some(sound => sound.kind !== 'builtin')
}

