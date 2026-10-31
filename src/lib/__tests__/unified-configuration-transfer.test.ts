import { describe, expect, it } from 'vitest'
import { defaultTimerV2State } from '../timerV2'
import { createDefaultUnifiedConfigState } from '../unified-config-state'
import {
  parseUnifiedConfigurationTransfer, serializeUnifiedConfiguration,
  UNIFIED_CONFIGURATION_TRANSFER_FORMAT,
} from '../unified-configuration-transfer'

describe('unified configuration transfer', () => {
  it('roundtrips schema 4 program, full settings, selector metadata and editor options', () => {
    const state = createDefaultUnifiedConfigState({ now: () => 123, createId: () => 'fixture-id' })
    const config = { ...state.configs[0]!, editorOptions: { enabledActionIds: ['haptics', 'schedule'] }, showInRunningSelector: false }
    config.settings.masterVolume = 0.37
    config.settings.availability.enabled = true
    const text = serializeUnifiedConfiguration(config, 1_700_000_000_000)
    const envelope = JSON.parse(text)
    expect(envelope.format).toBe(UNIFIED_CONFIGURATION_TRANSFER_FORMAT)
    expect(envelope.version).toBe(2)
    expect(envelope.programSchema).toBe(4)
    const imported = parseUnifiedConfigurationTransfer(text, [], { now: 456, createId: () => 'imported-id' })
    expect(imported.ok).toBe(true)
    if (!imported.ok) return
    expect(imported.sourceVersion).toBe(2)
    expect(imported.config.id).toBe('imported-id')
    expect(imported.config.name).toBe('Timer')
    expect(imported.config.settings.masterVolume).toBe(0.37)
    expect(imported.config.settings.availability.enabled).toBe(true)
    expect(imported.config.showInRunningSelector).toBe(false)
    expect(imported.config.editorOptions.enabledActionIds).toEqual(['haptics', 'schedule'])
  })

  it('imports the old version 1 envelope through strict legacy program and settings adapters', () => {
    const old = defaultTimerV2State()
    const text = JSON.stringify({
      format: UNIFIED_CONFIGURATION_TRANSFER_FORMAT,
      version: 1,
      exportedAt: new Date(0).toISOString(),
      configuration: { name: 'Legacy Cycle', createdAt: 10, program: old.workingPrograms.pattern, settings: old.settings, showInRunningSelector: true },
    })
    const imported = parseUnifiedConfigurationTransfer(text, [], { now: 999, createId: () => 'legacy-import-id' })
    expect(imported.ok).toBe(true)
    if (!imported.ok) return
    expect(imported.sourceVersion).toBe(1)
    expect(imported.config.program.schemaVersion).toBe(4)
    expect(imported.config.name).toBe('Legacy Cycle')
    expect(imported.config.createdAt).toBe(999)
    expect(imported.config.settings.masterVolume).toBe(old.settings.masterVolume)
  })

  it('assigns distinct deterministic IDs to multiple legacy schedule windows with omitted IDs', () => {
    const old = defaultTimerV2State()
    const text = JSON.stringify({
      format: UNIFIED_CONFIGURATION_TRANSFER_FORMAT, version: 1,
      configuration: {
        name: 'Window import', program: old.workingPrograms.pattern,
        settings: { availability: { enabled: true, weeklyWindows: [
          { enabled: true, startMinutes: 100, endMinutes: 200, days: 1 },
          { enabled: true, startMinutes: 300, endMinutes: 400, days: 2 },
        ], overrides: [] } },
      },
    })
    const imported = parseUnifiedConfigurationTransfer(text, [], { now: 10, createId: () => 'window-import' })
    expect(imported.ok).toBe(true)
    if (!imported.ok) return
    expect(imported.config.settings.availability.weeklyWindows.map(window => window.id)).toEqual([
      'transfer-v1-window-import:window-1', 'transfer-v1-window-import:window-2',
    ])
  })

  it('rejects future envelope/program versions and malformed present fields', () => {
    const state = createDefaultUnifiedConfigState({ now: () => 1, createId: () => 'id' })
    const text = serializeUnifiedConfiguration(state.configs[0]!)
    expect(parseUnifiedConfigurationTransfer(text.replace('"version": 2', '"version": 9')).ok).toBe(false)
    expect(parseUnifiedConfigurationTransfer(text.replace('"programSchema": 4', '"programSchema": 5')).ok).toBe(false)
    const malformed = JSON.parse(text)
    malformed.configuration.settings.masterVolume = 'quiet'
    expect(parseUnifiedConfigurationTransfer(JSON.stringify(malformed)).ok).toBe(false)
    const legacyFuture = JSON.stringify({ format: UNIFIED_CONFIGURATION_TRANSFER_FORMAT, version: 1, configuration: { name: 'Future', program: { schemaVersion: 99, mode: 'pattern' } } })
    expect(parseUnifiedConfigurationTransfer(legacyFuture).ok).toBe(false)
  })

  it('warns when an imported setup relies on device-specific sounds and avoids colliding names', () => {
    const state = createDefaultUnifiedConfigState({ now: () => 1, createId: () => 'id' })
    const config = state.configs[0]!
    config.program.steps[0]!.endCue.sound = { kind: 'document', uri: 'content://imported/audio', title: 'Imported sound', mimeType: 'audio/wav' }
    const text = serializeUnifiedConfiguration(config)
    const imported = parseUnifiedConfigurationTransfer(text, ['Timer'], { now: 123, createId: () => 'imported' })
    expect(imported.ok).toBe(true)
    if (!imported.ok) return
    expect(imported.config.name).toBe('Timer (2)')
    expect(imported.hasDeviceSpecificSounds).toBe(true)
  })
})

