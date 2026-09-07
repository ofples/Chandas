import { describe, expect, it } from 'vitest'
import type { ProgramPreset } from '../../types'
import { configurationTransferFilename, MAX_CONFIGURATION_TRANSFER_CHARACTERS, parseConfigurationTransfer, serializeConfiguration } from '../configuration-transfer'
import { defaultPatternProgram, patternDurationSeconds, trackCadenceSeconds } from '../timerV2'

function preset(): ProgramPreset {
  const program = defaultPatternProgram()
  program.mainDurationSeconds = 95
  program.mainMinutes = 2
  program.tracks[0] = { ...program.tracks[0], cadenceMinutes: 1, cadenceSeconds: 15, selectedOffsetsMinutes: [], selectedOffsetsSeconds: [15, 30, 45, 60, 75, 90], enabled: true }
  return { id: 'local-only', name: 'Physio / morning', createdAt: 123, program }
}

describe('configuration transfer', () => {
  it('round-trips one normalized configuration with exact timing and a fresh local identity', () => {
    const exported = serializeConfiguration(preset(), 456)
    const imported = parseConfigurationTransfer(exported, [], 789)
    expect(imported.ok).toBe(true)
    if (!imported.ok) return
    expect(imported.preset.id).not.toBe('local-only')
    expect(imported.preset.createdAt).toBe(789)
    expect(imported.preset.name).toBe('Physio / morning')
    expect(patternDurationSeconds(imported.preset.program.mode === 'pattern' ? imported.preset.program : defaultPatternProgram())).toBe(95)
    expect(imported.preset.program.mode).toBe('pattern')
    if (imported.preset.program.mode === 'pattern') expect(trackCadenceSeconds(imported.preset.program.tracks[0])).toBe(15)
  })

  it('gives duplicate imported names a clear suffix', () => {
    const imported = parseConfigurationTransfer(serializeConfiguration(preset()), ['physio / MORNING'], 789)
    expect(imported.ok && imported.preset.name).toBe('Physio / morning (2)')
  })

  it('rejects empty, oversized, malformed, and future-version payloads', () => {
    expect(parseConfigurationTransfer('')).toEqual({ ok: false, error: 'empty' })
    expect(parseConfigurationTransfer('x'.repeat(MAX_CONFIGURATION_TRANSFER_CHARACTERS + 1))).toEqual({ ok: false, error: 'too-large' })
    expect(parseConfigurationTransfer('{"hello":true}')).toEqual({ ok: false, error: 'invalid' })
    const future = JSON.parse(serializeConfiguration(preset()))
    future.version = 99
    expect(parseConfigurationTransfer(JSON.stringify(future))).toEqual({ ok: false, error: 'unsupported-version' })
  })

  it('creates a recognizable, filesystem-safe filename', () => {
    expect(configurationTransferFilename('Physio / morning: 15s')).toBe('Physio-morning-15s.chandas.json')
  })
})
