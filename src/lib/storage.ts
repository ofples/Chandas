import AsyncStorage from '@react-native-async-storage/async-storage'
import { TimerConfig } from '../types'

const CONFIG_KEY = 'slottimer-config'
const SESSION_KEY = 'slottimer-session'

export const DEFAULT_CONFIG: TimerConfig = {
  mainInterval: 30,
  subInterval: 5,
  snapEnabled: false,
  snapOffset: 0,
  subEnabled: true,
  notificationsEnabled: true,
  volume: 0.8,
  bgTrack: 1,
  bgVolume: 0.5,
  alarmModeEnabled: false,
}

export async function loadConfig(): Promise<TimerConfig> {
  try {
    const raw = await AsyncStorage.getItem(CONFIG_KEY)
    if (!raw) return DEFAULT_CONFIG
    return { ...DEFAULT_CONFIG, ...JSON.parse(raw) }
  } catch {
    return DEFAULT_CONFIG
  }
}

export async function saveConfig(config: TimerConfig): Promise<void> {
  try {
    await AsyncStorage.setItem(CONFIG_KEY, JSON.stringify(config))
  } catch { /* storage unavailable */ }
}

export interface TimerSession {
  phase: number
  mainMs: number
  subMs: number
}

export async function saveSession(s: TimerSession): Promise<void> {
  try { await AsyncStorage.setItem(SESSION_KEY, JSON.stringify(s)) } catch { /* ignore */ }
}

export async function loadSession(): Promise<TimerSession | null> {
  try {
    const raw = await AsyncStorage.getItem(SESSION_KEY)
    return raw ? (JSON.parse(raw) as TimerSession) : null
  } catch { return null }
}

export async function clearSession(): Promise<void> {
  try { await AsyncStorage.removeItem(SESSION_KEY) } catch { /* ignore */ }
}

export async function hasTimerSession(): Promise<boolean> {
  try { return (await AsyncStorage.getItem(SESSION_KEY)) !== null } catch { return false }
}
