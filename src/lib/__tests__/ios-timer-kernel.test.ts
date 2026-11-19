import { describe, expect, it } from 'vitest'
import { convertPatternToUnified } from '../unified-timer'
import { defaultPatternProgram } from '../timerV2'
import { iosEventBatches, iosRunAction, iosRunState, validateIOSRun, type IOSKernelRun } from '../ios-timer-kernel'
import type { UnifiedTimerProgram } from '../../types'

const anchor = 1_800_000_000_000
function run(id = 'run', program = convertPatternToUnified(defaultPatternProgram())): IOSKernelRun {
  return { id, name: 'Test timer', config: {
    mainMs: 300_000, subMs: 60_000, phase: 0, subEnabled: false, volume: 1, notificationsEnabled: true,
    focusModeEnabled: false, alarmModeEnabled: false, activeHoursEnabled: false, activeHoursStart: 0,
    activeHoursEnd: 1440, activeHoursDays: 127, alarmDurationSeconds: 60,
    timerV2Program: JSON.stringify(program), timerV2Anchor: anchor, timerV2StartedAt: anchor,
  } }
}
function stepped(): UnifiedTimerProgram {
  const p = convertPatternToUnified(defaultPatternProgram())
  p.runPolicy.kind = 'continuous'; p.alarmBehavior = 'off'
  p.steps = [{ ...p.steps[0], id: 'five', durationSeconds: 5, endAlarmEnabled: true, subBellsEnabled: false },
    { ...p.steps[0], id: 'two', durationSeconds: 2, endAlarmEnabled: false, subBellsEnabled: false }]
  return p
}

describe('iOS canonical native kernel', () => {
  it('never inherits the preceding step alarm across 200 rounds', () => {
    const r = run('five-two', stepped())
    for (let round = 0; round < 200; round++) {
      const { batches } = iosEventBatches([r], anchor + round * 7_000, 2)
      expect(batches.map(batch => [batch[0].event.at - anchor, batch[0].alarm])).toEqual([[round * 7_000 + 5_000, true], [round * 7_000 + 7_000, false]])
      expect(batches[0][0].alarmExpiresAt).toBe(anchor + round * 7_000 + 7_000)
    }
  })
  it('resolves simultaneous timers once, preferring the rarer cue', () => {
    const p = convertPatternToUnified(defaultPatternProgram())
    p.steps[0].subBellsEnabled = false; p.steps[0].durationSeconds = 60; p.runPolicy.kind = 'continuous'
    const minute = run('minute', p)
    p.steps[0].durationSeconds = 300
    const five = run('five', p)
    const batch = iosEventBatches([minute, five], anchor + 299_000, 1).batches[0]
    expect(batch).toHaveLength(2)
    expect(batch.filter(item => item.winner).map(item => item.runId)).toEqual(['five'])
  })
  it('keeps random and percentage points identical across independent replanning', () => {
    const p = stepped(); p.steps = [p.steps[0]]; p.steps[0].durationSeconds = 120; p.steps[0].endAlarmEnabled = false
    const track = convertPatternToUnified(defaultPatternProgram()).steps[0].subBellTracks[0]
    p.steps[0].subBellsEnabled = true
    p.steps[0].subBellTracks = [{ ...track, enabled: true, repeatEnabled: false, points: [{ id: 'half', kind: 'percent', value: 50 }], randomRepeat: { minSeconds: 7, maxSeconds: 13 } }]
    const r = run('points', p)
    const first = iosEventBatches([r], anchor, 30)
    const halfway = first.batches.find(batch => batch[0].event.at === anchor + 60_000)
    expect(halfway).toBeDefined()
    const later = iosEventBatches([r], anchor + 55_000, 8)
    expect(later.batches.map(batch => batch[0].event.logicalId)).toEqual(first.batches.filter(batch => batch[0].event.at > anchor + 55_000).slice(0, 8).map(batch => batch[0].event.logicalId))
  })
  it('retains absolute mute deadlines through pause/resume and excludes paused schedules', () => {
    const r = run('mute', stepped())
    const muted = iosRunAction(r, 'mute-seconds', 60, anchor)!
    const paused = iosRunAction(muted, 'pause', 0, anchor + 1_000)!
    expect(iosEventBatches([paused], anchor + 2_000).batches).toEqual([])
    const resumed = iosRunAction(paused, 'resume', 0, anchor + 11_000)!
    expect(resumed.config.timerV2Anchor).toBe(anchor + 10_000)
    expect(resumed.config.mutedUntil).toBe(anchor + 60_000)
    expect(iosEventBatches([resumed], anchor + 11_000, 2).batches.every(batch => !batch[0].audible)).toBe(true)
  })
  it('caps background planning and never reports infinite coverage', () => {
    const plan = iosEventBatches([run('short', stepped())], anchor)
    expect(plan.batches).toHaveLength(56)
    expect(plan.truncated).toBe(true)
    expect(plan.coveredThrough).toBe(anchor + 28 * 7_000)
  })
  it('supports pause, seek and exact end without changing the source configuration', () => {
    const r = run('seek', stepped()), before = JSON.stringify(r)
    const sought = iosRunAction(r, 'seek-step:5000', 0, anchor + 1_000)!
    expect(iosRunState(sought, anchor + 1_000).currentStepEndAt - anchor - 1_000).toBe(2_500)
    expect(JSON.stringify(r)).toBe(before)
    expect(iosRunAction(r, 'unrecognized', 0, anchor)).toBeNull()
    expect(iosRunState({ ...r, config: { ...r.config, timerV2EndsAt: anchor + 7_000 } }, anchor + 7_000).active).toBe(false)
  })
  it('rejects malformed/future programs instead of passing them to the daemon', () => {
    const r = run()
    expect(validateIOSRun(r)).toBe(true)
    expect(validateIOSRun({ ...r, config: { ...r.config, timerV2Program: '{"schemaVersion":99}' } })).toBe(false)
    expect(validateIOSRun({ ...r, config: { ...r.config, timerV2Anchor: NaN } })).toBe(false)
  })
})
