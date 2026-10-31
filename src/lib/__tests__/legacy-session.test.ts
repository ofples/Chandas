import { describe, expect, it, vi } from 'vitest'
const records = vi.hoisted(() => new Map<string, string>())
vi.mock('@react-native-async-storage/async-storage', () => ({ default: {
  getItem: async (key: string) => records.get(key) ?? null,
  setItem: async (key: string, value: string) => { records.set(key, value) },
  removeItem: async (key: string) => { records.delete(key) },
} }))
import { defaultPatternProgram, defaultSequenceProgram } from '../timerV2'
import { loadTimerV2Session } from '../storage'
import { legacySessionProgram } from '../legacy-session-program'
import { iterationMuteFor } from '../runtimeV2'
import { nextProgramEvent } from '../timeline'

describe('retained legacy session adapter', () => {
  it('resumes the exact accepted track order, cue list, seed, pause and mute identity', async () => {
    const program = defaultPatternProgram()
    const first = { ...program.tracks[0], id: 't'.repeat(200), enabled: true, cadenceMinutes: 2, sounds: [{ kind: 'builtin' as const, id: 'clear-bell' as const }, { kind: 'builtin' as const, id: 'temple-gong' as const }, { kind: 'builtin' as const, id: 'clear-bell' as const }], soundMode: 'sequence' as const }
    program.tracks = [first, { ...first, id: 'other', cadenceMinutes: 10 }]
    const mute = { mutedUntil: 100000, iteration: iterationMuteFor(program, 1000, 2000, 2) }
    const session = { schemaVersion: 2, anchor: 1000, startedAt: 1200, endsAt: 9000000, pausedAt: 130000, randomSeed: 1234, program, mute, alarmBehavior: 'locked', soundState: { sequence: { [first.id]: 2 }, randomPrevious: { [first.id]: 1 } } }
    const raw = JSON.stringify(session)
    records.set('chandas-timer-v2-session', raw)
    const loaded = await loadTimerV2Session()
    expect(loaded).toMatchObject(session)
    expect(loaded?.program).toEqual(program)
    expect(nextProgramEvent(loaded!.program, loaded!.anchor, loaded!.pausedAt, loaded!.startedAt, loaded!.endsAt, loaded!.randomSeed)).toEqual(nextProgramEvent(program, 1000, 130000, 1200, 9000000, 1234))
    expect(records.get('chandas-timer-v2-session')).toBe(raw)
  })

  it('retains accepted sequence cue identities and rejects ambiguous track identities', () => {
    const program = defaultSequenceProgram()
    expect(legacySessionProgram(program)).toEqual(program)
    const malformed = defaultPatternProgram()
    malformed.tracks[0].id = ''
    expect(legacySessionProgram(malformed)).toBeNull()
    expect(legacySessionProgram({ ...program, schemaVersion: 99 })).toBeNull()
  })
})
