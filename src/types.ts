export interface TimerConfig {
  mainInterval: number    // minutes
  subInterval: number     // minutes
  snapEnabled: boolean
  snapOffset: number      // minutes (0–59)
  subEnabled: boolean          // whether sub-interval bell is active
  notificationsEnabled: boolean
  volume: number          // 0–1 (gong/bell volume)
  alarmModeEnabled: boolean // main gong becomes a continuous alarm (looping, full-screen) until dismissed
  activeHoursEnabled: boolean
  activeHoursStart: number // local minutes after midnight
  activeHoursEnd: number   // local minutes after midnight
  activeHoursDays: number  // Sunday-first seven-bit mask
  alarmDurationSeconds: number
}

export type AppState = 'config' | 'running'
