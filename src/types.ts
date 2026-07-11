export interface TimerConfig {
  mainInterval: number    // minutes
  subInterval: number     // minutes
  snapEnabled: boolean
  snapOffset: number      // minutes (0–59)
  subEnabled: boolean          // whether sub-interval bell is active
  notificationsEnabled: boolean
  volume: number          // 0–1 (gong/bell volume)
  bgTrack: 1 | 2 | 3     // background music track
  bgVolume: number        // 0–1; 0 allowed — fully mutable, no keep-alive constraint on native
  alarmModeEnabled: boolean // main gong becomes a continuous alarm (looping, full-screen) until dismissed
}

export type AppState = 'config' | 'running'
