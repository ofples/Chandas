export interface TimerConfig {
  mainInterval: number    // minutes
  subInterval: number     // minutes
  snapEnabled: boolean
  snapOffset: number      // minutes (0–59)
  subEnabled: boolean          // whether sub-interval bell is active
  notificationsEnabled: boolean
  volume: number          // 0–1 (gong/bell volume)
  bgTrack: 1 | 2 | 3     // background music track
  bgVolume: number        // 0–1; clamped to min 0.01 on mobile (prevents silent-tab throttling), 0 allowed on desktop
}

export type AppState = 'config' | 'running'
