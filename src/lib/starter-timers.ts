import type { UnifiedTimerProgram, UnifiedTimerStep } from '../types'
import type { UnifiedConfigState, UnifiedTimerConfig, UnifiedTimerDraft } from './unified-config-state'
import { defaultAppTimerSettings } from './timerV2'

export const STARTER_TIMER_IDS = ['starter:pomodoro', 'starter:workout', 'starter:meditation'] as const
export const STARTER_TIMER_DETAILS: Record<string, string> = {
  'starter:pomodoro': '25m focus, 5m break · 4 rounds',
  'starter:workout': '1m move, 1m recover · 5 rounds',
  'starter:meditation': '10m · a gentle bell halfway',
}

/** Ordinary configurations: editing and deleting them uses the normal library flow. */
export function createStarterTimers(now = Date.now()): UnifiedTimerConfig[] {
  const step = (id: string, label: string, durationSeconds: number, color: UnifiedTimerStep['color']): UnifiedTimerStep => ({
    id, label, labelIsCustom: true, durationSeconds, color,
    endCue: { sound: { kind: 'builtin', id: 'clear-bell' }, volume: 0.8 },
    endAlarmEnabled: false, subBellsEnabled: false, subBellTracks: [],
  })
  const program = (steps: UnifiedTimerStep[], cycleCount: number): UnifiedTimerProgram => ({
    schemaVersion: 4, mode: 'unified', steps, alignment: { kind: 'elapsed' }, completionCue: null,
    runPolicy: { kind: 'cycles', cycleCount, durationSeconds: 1800 }, alarmBehavior: 'off',
  })
  const meditation = step('starter:meditation:sit', 'Meditate', 600, 'teal')
  meditation.endCue = { sound: { kind: 'builtin', id: 'temple-gong' }, volume: 0.6, hapticOverride: 'off' }
  meditation.subBellsEnabled = true
  meditation.subBellTracks = [{
    id: 'starter:meditation:halfway', label: 'Halfway', enabled: true, color: 'blue', showOnWatchFace: true,
    cadenceSeconds: 300, repeatEnabled: true, selectedOffsetsSeconds: [300],
    sound: { kind: 'builtin', id: 'clear-bell' }, volume: 0.5, hapticOverride: 'off',
  }]
  const entries: Array<[typeof STARTER_TIMER_IDS[number], string, UnifiedTimerProgram]> = [
    ['starter:pomodoro', 'Pomodoro', program([
      step('starter:pomodoro:focus', 'Focus', 1500, 'violet'), step('starter:pomodoro:break', 'Break', 300, 'green'),
    ], 4)],
    ['starter:workout', 'Workout intervals', program([
      step('starter:workout:move', 'Move', 60, 'orange'), step('starter:workout:recover', 'Recover', 60, 'blue'),
    ], 5)],
    ['starter:meditation', 'Meditation', program([meditation], 1)],
  ]
  return entries.map(([id, name, program]) => ({
    id, name, program, createdAt: now, updatedAt: now, settings: defaultAppTimerSettings(),
    showInRunningSelector: true, editorOptions: { enabledActionIds: [], configurationNameIsCustom: true },
  }))
}

/** Called only for a genuinely new installation, never on an existing library. */
export function addFirstRunStarters(state: UnifiedConfigState, now: number): UnifiedConfigState {
  const configs = createStarterTimers(now)
  const drafts: Record<string, UnifiedTimerDraft> = { ...state.drafts }
  for (const config of configs) drafts[config.id] = {
    baseConfigId: config.id, name: config.name, program: config.program, settings: config.settings,
    editorOptions: config.editorOptions, updatedAt: now, dirty: false,
  }
  return { ...state, configs: [...state.configs, ...configs], drafts, onboardingStatus: 'pending' }
}
