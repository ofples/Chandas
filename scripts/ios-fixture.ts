import { defaultPatternProgram } from '../src/lib/timerV2'
import { convertPatternToUnified } from '../src/lib/unified-timer'
const program = convertPatternToUnified(defaultPatternProgram())
program.steps = [{ ...program.steps[0], id: 'five', durationSeconds: 5, endAlarmEnabled: true, subBellsEnabled: false },
  { ...program.steps[0], id: 'two', durationSeconds: 2, endAlarmEnabled: false, subBellsEnabled: false }]
program.runPolicy.kind = 'continuous'; program.alarmBehavior = 'off'
console.log(JSON.stringify({ method: 'plan', after: 1_800_000_000_000, limit: 56, runs: [{ id: 'native-qa', name: 'Native QA', config: {
  mainMs: 5_000, subMs: 1_000, phase: 0, subEnabled: false, volume: 1, notificationsEnabled: true,
  focusModeEnabled: false, alarmModeEnabled: false, activeHoursEnabled: false, activeHoursStart: 0,
  activeHoursEnd: 1440, activeHoursDays: 127, alarmDurationSeconds: 60,
  timerV2Program: JSON.stringify(program), timerV2Anchor: 1_800_000_000_000, timerV2StartedAt: 1_800_000_000_000,
} }] }))
