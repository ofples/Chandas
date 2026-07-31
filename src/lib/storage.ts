import AsyncStorage from '@react-native-async-storage/async-storage'
import { TimerConfig } from '../types'

const CONFIG_KEY = 'chandas-config'
const SESSION_KEY = 'chandas-session'
const ADVANCED_SETTINGS_KEY = 'chandas-advanced-settings-expanded'

export const DEFAULT_CONFIG: TimerConfig = {
  mainInterval: 30,
  subInterval: 5,
  snapEnabled: false,
  snapOffset: 0,
  subEnabled: true,
  notificationsEnabled: true,
  focusModeEnabled: false,
  volume: 0.8,
  alarmModeEnabled: false,
  activeHoursEnabled: false,
  activeHoursStart: 8 * 60,
  activeHoursEnd: 22 * 60,
  activeHoursDays: 0b1111111,
  alarmDurationSeconds: 60,
}

export async function loadConfig(): Promise<TimerConfig> {
  try {
    const raw = await AsyncStorage.getItem(CONFIG_KEY)
    if (!raw) return DEFAULT_CONFIG
    // Notification delivery is now managed by the app and Android settings, not an in-app toggle.
    return { ...DEFAULT_CONFIG, ...JSON.parse(raw), notificationsEnabled: true }
  } catch {
    return DEFAULT_CONFIG
  }
}

export async function saveConfig(config: TimerConfig): Promise<void> {
  try {
    await AsyncStorage.setItem(CONFIG_KEY, JSON.stringify(config))
  } catch { /* storage unavailable */ }
}

export async function loadAdvancedSettingsExpanded(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(ADVANCED_SETTINGS_KEY)) === 'true'
  } catch {
    return false
  }
}

export async function saveAdvancedSettingsExpanded(expanded: boolean): Promise<void> {
  try {
    await AsyncStorage.setItem(ADVANCED_SETTINGS_KEY, String(expanded))
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
