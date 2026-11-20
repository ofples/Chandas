import { describe, expect, it } from 'vitest'
import { convertPatternToUnified } from '../unified-timer'
import { defaultPatternProgram } from '../timerV2'
import { IOS_KERNEL_CAPABILITIES, iosEventBatches, iosRepeatingSchedule, iosRunAction, iosRunState, validateIOSRun, type IOSKernelRun } from '../ios-timer-kernel'
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
  it('always publishes concrete control defaults for a new native session', () => {
    expect(iosRunState(run(), anchor)).toMatchObject({ mutedUntil: 0, mutedIterationsRemaining: 0,
      alarmOnceArmed: false, mutedIterationEndId: '', mutedIterationEndAt: 0 })
  })
  it('advertises limits that its bundled parser actually admits', () => {
    const p = stepped(); p.steps = [{ ...p.steps[1], durationSeconds: IOS_KERNEL_CAPABILITIES.maxCueDurationSeconds }]
    expect(validateIOSRun(run('at-limit', p))).toBe(true)
    p.steps[0].durationSeconds += 1
    expect(validateIOSRun(run('past-limit', p))).toBe(false)
  })
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
  it('does not replay cues from before a newly joined or edited run became effective', () => {
    const r = run('joined', stepped())
    r.config.timerV2StartedAt = anchor + 6_000
    expect(iosEventBatches([r], anchor, 1).batches[0][0].event.at).toBe(anchor + 7_000)
    r.effectiveFrom = anchor + 13_000
    expect(iosEventBatches([r], anchor, 1).batches[0][0].event.at).toBe(anchor + 14_000)
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
  it('changes only the selected step alarm and keeps the source program intact', () => {
    const r = run('toggle', stepped())
    const changed = iosRunAction(r, 'toggle-step-alarm:two', 0, anchor)!
    const p = JSON.parse(changed.config.timerV2Program!)
    expect(p.steps.map((step: { endAlarmEnabled: boolean }) => step.endAlarmEnabled)).toEqual([true, true])
    expect(JSON.parse(r.config.timerV2Program!).steps[1].endAlarmEnabled).toBe(false)
    expect(iosRunAction(r, 'toggle-step-alarm:missing', 0, anchor)).toBeNull()
  })
  it('honors an Until deadline even while paused', () => {
    const p = stepped(); p.runPolicy.kind = 'until'; p.runPolicy.untilMinutes = 0
    const r = run('until', p)
    r.config.timerV2EndsAt = anchor + 10_000; r.config.timerV2PausedAt = anchor + 1_000
    expect(iosRunState(r, anchor + 11_000).active).toBe(false)
  })
  it('cycles sound lists from the first choice and avoids adjacent random repeats', () => {
    const p = stepped(); p.steps = [p.steps[1]]
    p.steps[0].endCue = { ...p.steps[0].endCue, sounds: [{ kind: 'builtin', id: 'clear-bell' }, { kind: 'builtin', id: 'temple-gong' }], soundMode: 'sequence' }
    const sequence = iosEventBatches([run('sequence', p)], anchor, 4).batches.map(batch => batch[0].soundId)
    expect(sequence).toEqual(['clear-bell', 'temple-gong', 'clear-bell', 'temple-gong'])
    p.steps[0].endCue.soundMode = 'random'
    const random = iosEventBatches([run('random', p)], anchor, 20).batches.map(batch => batch[0].soundId)
    expect(random.every((sound, index) => !index || sound !== random[index - 1])).toBe(true)
  })
  it('compresses aligned one-minute and five-minute bells into a collision-free hourly pattern', () => {
    const p = stepped(); p.steps = [p.steps[1]]; p.steps[0].durationSeconds = 60
    const minute = run('minute', p)
    p.steps[0].durationSeconds = 300
    const result = iosRepeatingSchedule([minute, run('five', p)], anchor)!
    expect(result).toHaveLength(60)
    expect(result.filter(event => event.runId === 'five')).toHaveLength(12)
    expect(new Set(result.map(item => item.event.at % 3_600_000)).size).toBe(60)
  })
  it('refuses calendar compression when it would change random, mute or alarm behavior', () => {
    expect(iosRepeatingSchedule([run('alarm', stepped())], anchor)).toBeNull()
    const p = stepped(); p.steps = [p.steps[1]]; p.steps[0].durationSeconds = 300
    const r = run('muted', p); r.config.mutedUntil = anchor + 100_000
    expect(iosRepeatingSchedule([r], anchor)).toBeNull()
    const irregular = stepped(); irregular.steps.forEach(step => { step.endAlarmEnabled = false })
    expect(iosRepeatingSchedule([run('seven-seconds', irregular)], anchor)).toBeNull()
  })
  it('ends a bounded run exactly once and retains its terminal cue', () => {
    const p = stepped(); p.runPolicy = { ...p.runPolicy, kind: 'cycles', cycleCount: 1 }
    const r = run('bounded', p); r.config.timerV2EndsAt = anchor + 7_000
    const events = iosEventBatches([r], anchor, 20).batches.flat()
    expect(events.map(item => item.event.at - anchor)).toEqual([5_000, 7_000])
    expect(events[1].event.completesRun).toBe(true)
    expect(iosEventBatches([r], anchor + 7_000).batches).toEqual([])
  })
  it('keeps quiet-hours progression silent without suppressing another eligible timer', () => {
    const quiet = run('quiet', stepped()), audible = run('audible', stepped())
    quiet.config.availabilityPolicy = JSON.stringify({ enabled: true, weeklyWindows: [], overrides: [] })
    const batch = iosEventBatches([quiet, audible], anchor, 1).batches[0]
    expect(batch.find(item => item.runId === 'quiet')?.audible).toBe(false)
    expect(batch.filter(item => item.winner).map(item => item.runId)).toEqual(['audible'])
  })
  it('keeps the requested final mute boundary audible after pause/resume', () => {
    const muted = iosRunAction(run('iteration', stepped()), 'mute-iterations', 2, anchor)!
    const paused = iosRunAction(muted, 'pause', 0, anchor + 1_000)!
    const resumed = iosRunAction(paused, 'resume', 0, anchor + 11_000)!
    const deadline = resumed.config.mutedIterationEndAt!
    const events = iosEventBatches([resumed], anchor + 11_000, 20, deadline).batches.flat()
    expect(events.at(-1)?.event.at).toBe(deadline)
    expect(events.at(-1)?.audible).toBe(true)
    expect(events.slice(0, -1).every(event => !event.audible)).toBe(true)
    expect(iosRunAction(run(), 'mute-seconds', 604_800, anchor)?.config.mutedUntil).toBe(anchor + 604_800_000)
  })
  it('allocates background capacity to audible bells rather than muted sub-bells', () => {
    const p = convertPatternToUnified(defaultPatternProgram())
    p.runPolicy.kind = 'continuous'; p.steps[0].durationSeconds = 120; p.steps[0].subBellsEnabled = true
    p.steps[0].subBellTracks = [{ ...p.steps[0].subBellTracks[0], enabled: true, repeatEnabled: true,
      cadenceSeconds: 1, selectedOffsetsSeconds: Array.from({ length: 119 }, (_, index) => index + 1), volume: 0 }]
    const r = run('silent-sub', p)
    expect(iosEventBatches([r], anchor, 1).batches[0][0].event.at).toBe(anchor + 1_000)
    const audible = iosEventBatches([r], anchor, 2, undefined, true).batches.flat()
    expect(audible.map(event => event.event.at - anchor)).toEqual([120_000, 240_000])
    expect(audible.every(event => event.winner)).toBe(true)
  })
  it('schedules the next bell after a multi-day mute without needing a refill first', () => {
    const p = stepped(); p.steps = [{ ...p.steps[1], durationSeconds: 3600 }]
    const r = run('long', p); r.config.mutedUntil = anchor + 3 * 86_400_000
    const plan = iosEventBatches([r], anchor, 1, undefined, true)
    expect(plan.batches[0][0].event.at).toBe(anchor + 3 * 86_400_000)
  })
  it('preserves Alarm Once during quiet hours and jumps to the first allowed background bell', () => {
    const p = stepped(); p.steps = [{ ...p.steps[1], durationSeconds: 60 }]
    const r = run('quiet-once', p), date = new Date(anchor)
    const start = (date.getHours() * 60 + date.getMinutes() + 120) % 1440
    r.config.alarmOnceArmed = true
    r.config.availabilityPolicy = JSON.stringify({ enabled: true, weeklyWindows: [{ id: 'later', enabled: true,
      days: 127, startMinutes: start, endMinutes: (start + 30) % 1440 }], overrides: [] })
    const quiet = iosEventBatches([r], anchor, 1).batches[0][0]
    expect(quiet.audible).toBe(false)
    expect(quiet.nextConfig.alarmOnceArmed).toBe(true)
    const future = iosEventBatches([r], anchor, 1, undefined, true).batches[0][0]
    expect(future.event.at).toBeGreaterThan(anchor + 90 * 60_000)
    expect(future.alarm).toBe(true)
    expect(future.nextConfig.alarmOnceArmed).toBe(false)
  })
  it('jumps over long timed mutes and avoids scanning intentionally silent timers', () => {
    const p = stepped(); p.steps = [{ ...p.steps[1], durationSeconds: 60 }]
    const r = run('muted-hours', p); r.config.mutedUntil = anchor + 3 * 3_600_000
    const future = iosEventBatches([r], anchor, 1, undefined, true).batches[0][0]
    expect(future.event.at).toBe(r.config.mutedUntil)
    expect(future.nextConfig.mutedUntil).toBe(0)
    r.config.volume = 0
    expect(iosEventBatches([r], anchor, 56, undefined, true)).toMatchObject({ batches: [], truncated: false })
  })
})
