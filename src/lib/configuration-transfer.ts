import type { ProgramPreset, SoundRef, TimerProgram } from '../types'
import { createProgramId, normalizePreset } from './timerV2'

export const CONFIGURATION_TRANSFER_FORMAT = 'chandas.configuration'
export const CONFIGURATION_TRANSFER_VERSION = 1
export const MAX_CONFIGURATION_TRANSFER_CHARACTERS = 256_000

interface ConfigurationTransferEnvelope {
  format: typeof CONFIGURATION_TRANSFER_FORMAT
  version: typeof CONFIGURATION_TRANSFER_VERSION
  exportedAt: string
  configuration: Pick<ProgramPreset, 'name' | 'createdAt' | 'program'>
}

export type ConfigurationTransferError = 'empty' | 'too-large' | 'invalid' | 'unsupported-version'

export type ConfigurationTransferResult =
  | { ok: true; preset: ProgramPreset; hasDeviceSpecificSounds: boolean }
  | { ok: false; error: ConfigurationTransferError }

export function serializeConfiguration(preset: ProgramPreset, now = Date.now()): string {
  const normalized = normalizePreset(preset)
  if (!normalized) throw new Error('Cannot export an invalid configuration.')
  const envelope: ConfigurationTransferEnvelope = {
    format: CONFIGURATION_TRANSFER_FORMAT,
    version: CONFIGURATION_TRANSFER_VERSION,
    exportedAt: new Date(now).toISOString(),
    configuration: {
      name: normalized.name,
      createdAt: normalized.createdAt,
      program: normalized.program,
    },
  }
  return JSON.stringify(envelope, null, 2)
}

export function parseConfigurationTransfer(text: string, existingNames: string[] = [], now = Date.now()): ConfigurationTransferResult {
  const source = text.trim()
  if (!source) return { ok: false, error: 'empty' }
  if (source.length > MAX_CONFIGURATION_TRANSFER_CHARACTERS) return { ok: false, error: 'too-large' }

  try {
    const parsed = JSON.parse(source) as unknown
    if (!parsed || typeof parsed !== 'object') return { ok: false, error: 'invalid' }
    const envelope = parsed as Partial<ConfigurationTransferEnvelope>
    if (envelope.format !== CONFIGURATION_TRANSFER_FORMAT) return { ok: false, error: 'invalid' }
    if (envelope.version !== CONFIGURATION_TRANSFER_VERSION) return { ok: false, error: 'unsupported-version' }
    if (!envelope.configuration || typeof envelope.configuration !== 'object') return { ok: false, error: 'invalid' }

    const normalized = normalizePreset(envelope.configuration)
    if (!normalized) return { ok: false, error: 'invalid' }
    const preset: ProgramPreset = {
      ...normalized,
      id: createProgramId(),
      name: availableImportedName(normalized.name, existingNames),
      createdAt: now,
    }
    return { ok: true, preset, hasDeviceSpecificSounds: programHasDeviceSpecificSounds(preset.program) }
  } catch {
    return { ok: false, error: 'invalid' }
  }
}

export function configurationTransferFilename(name: string): string {
  const stem = name
    .normalize('NFKD')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 64)
  return `${stem || 'chandas-configuration'}.chandas.json`
}

function availableImportedName(name: string, existingNames: string[]): string {
  const taken = new Set(existingNames.map(value => value.trim().toLocaleLowerCase()))
  if (!taken.has(name.toLocaleLowerCase())) return name
  for (let suffix = 2; suffix <= 999; suffix += 1) {
    const marker = ` (${suffix})`
    const candidate = `${[...name].slice(0, Math.max(1, 80 - marker.length)).join('')}${marker}`
    if (!taken.has(candidate.toLocaleLowerCase())) return candidate
  }
  return `${[...name].slice(0, 67).join('')} (imported)`
}

function programHasDeviceSpecificSounds(program: TimerProgram): boolean {
  const sounds: SoundRef[] = program.mode === 'pattern'
    ? [program.mainCue.sound, ...(program.completionCue ? [program.completionCue.sound] : []), ...program.tracks.map(track => track.sound)]
    : [...program.steps.map(step => step.sound), ...(program.completionCue ? [program.completionCue.sound] : [])]
  return sounds.some(sound => sound.kind !== 'builtin')
}
