import { expect, test } from 'vitest'
import { defaultPatternProgram } from '../timerV2'
import { nextPatternEvent } from '../timeline'
import { nextActiveHoursStart, hasAvailableTime, scheduleSegmentsForDay, isCueAllowedByActiveHours, isCueDeliveryAllowedByActiveHours } from '../activeHours'
import { serializeConfiguration, parseConfigurationTransfer } from '../configuration-transfer'
import type { AvailabilityPolicy, ProgramPreset } from '../../types'
import { nextAudibleProgramEvent, upcomingProgramEvents } from '../upcoming-events'

test('overnight Quiet resumes at this morning’s end', () => {
  const policy: AvailabilityPolicy = { enabled: true, overrides: [], weeklyWindows: [
    { id: 'active', enabled: true, days: 127, startMinutes: 0, endMinutes: 0, behavior: 'active' },
    { id: 'quiet', enabled: true, days: 127, startMinutes: 1320, endMinutes: 360, behavior: 'mute' },
  ] }
  expect(nextActiveHoursStart(policy, new Date(2026, 8, 21, 1).getTime())).toBe(new Date(2026, 8, 21, 6).getTime())
})
test('fully excluded future override does not count as availability', () => {
  const now = new Date(2026, 8, 21, 1).getTime()
  const policy: AvailabilityPolicy = { enabled: true, weeklyWindows: [], overrides: [
    { id: 'active', source: 'calendar', behavior: 'active', startAt: now + 1000, endAt: now + 2000 },
    { id: 'quiet', source: 'calendar', behavior: 'mute', startAt: now, endAt: now + 3000 },
  ] }
  expect(hasAvailableTime(policy, now)).toBe(false)
})
test('cadence cue outranks a colliding one-off with disabled cadence', () => {
  const program = defaultPatternProgram()
  program.subBellsEnabled = true
  program.tracks = [
    { ...program.tracks[0], id: 'oneoff', cadenceMinutes: 20, cadenceSeconds: 1200, repeatEnabled: false, afterStartSeconds: 300 },
    { ...program.tracks[0], id: 'repeat', cadenceMinutes: 5, cadenceSeconds: 300, selectedOffsetsMinutes: [5], selectedOffsetsSeconds: [300], repeatEnabled: true },
  ]
  expect(nextPatternEvent(program, 0, 299000).winner.cueId).toBe('repeat')
})
const preset = (): ProgramPreset => ({ id: 'test', name: 'Test', createdAt: 1, showInRunningSelector: false, program: defaultPatternProgram() })
test('configuration transfer preserves hidden selector metadata', () => {
  const result = parseConfigurationTransfer(serializeConfiguration(preset()))
  expect(result.ok && result.preset.showInRunningSelector).toBe(false)
})
test('transfer detects device audio in a secondary sound', () => {
  const value = preset()
  if (value.program.mode !== 'pattern') throw new Error('fixture')
  value.program.mainCue.sounds = [value.program.mainCue.sound, { kind: 'document', uri: 'content://example/audio', title: 'Device audio' }]
  const result = parseConfigurationTransfer(serializeConfiguration(value))
  expect(result.ok && result.hasDeviceSpecificSounds).toBe(true)
})
test('weekly subtraction and exact closing bell work for daytime Quiet', () => {
  const policy: AvailabilityPolicy = { enabled: true, overrides: [], weeklyWindows: [
    { id: 'active', enabled: true, days: 127, startMinutes: 240, endMinutes: 1320, behavior: 'active' },
    { id: 'quiet', enabled: true, days: 127, startMinutes: 540, endMinutes: 660, behavior: 'mute' },
  ] }
  expect(scheduleSegmentsForDay(policy, 1)).toEqual([{ start: 240, end: 540 }, { start: 660, end: 1320 }])
  expect(isCueAllowedByActiveHours(policy, new Date(2026, 8, 21, 9).getTime())).toBe(true)
  expect(isCueAllowedByActiveHours(policy, new Date(2026, 8, 21, 9, 1).getTime())).toBe(false)
  const closing = new Date(2026, 8, 21, 9).getTime()
  expect(isCueDeliveryAllowedByActiveHours(policy, closing, closing + 500)).toBe(true)
  const ordinary = new Date(2026, 8, 21, 8, 59, 59).getTime()
  expect(isCueDeliveryAllowedByActiveHours(policy, ordinary, closing + 500)).toBe(false)
  expect(isCueDeliveryAllowedByActiveHours(policy, ordinary, ordinary + 5_001)).toBe(false)
})

test('upcoming preview marks quiet cues and jumps to the next audible event', () => {
  const now = new Date(2026, 8, 21, 8).getTime()
  const program = defaultPatternProgram()
  program.mainMinutes = 10
  program.mainDurationSeconds = 600
  program.subBellsEnabled = false
  program.tracks = []
  const policy: AvailabilityPolicy = { enabled: true, weeklyWindows: [], overrides: [
    { id: 'later', source: 'calendar', behavior: 'active', startAt: now + 25 * 60_000, endAt: now + 60 * 60_000 },
  ] }
  const upcoming = upcomingProgramEvents(program, policy, now, now, now, null, 3)
  expect(upcoming.map(item => [item.event.at, item.scheduleAllows])).toEqual([
    [now + 10 * 60_000, false],
    [now + 20 * 60_000, false],
    [now + 30 * 60_000, true],
  ])
  expect(nextAudibleProgramEvent(program, policy, now, now, now, null)?.at).toBe(now + 30 * 60_000)
})
