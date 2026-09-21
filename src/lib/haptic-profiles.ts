import type { HapticPattern, HapticProfile, HapticStrength, TimerHapticsSettings } from '../types'

export const HAPTIC_PATTERNS = [
  { value: 'single', label: 'Single' },
  { value: 'double', label: 'Double' },
  { value: 'triple', label: 'Triple' },
] as const satisfies readonly { value: HapticPattern; label: string }[]

export const HAPTIC_STRENGTHS = [
  { value: 'gentle', label: 'Gentle' },
  { value: 'balanced', label: 'Balanced' },
  { value: 'strong', label: 'Strong' },
] as const satisfies readonly { value: HapticStrength; label: string }[]

export function defaultTimerHapticsSettings(): TimerHapticsSettings {
  return {
    enabled: true,
    main: { pattern: 'single', strength: 'strong' },
    subBell: { pattern: 'single', strength: 'gentle' },
    alarm: { pattern: 'double', strength: 'strong' },
  }
}

export function normalizeTimerHapticsSettings(value: unknown): TimerHapticsSettings {
  const defaults = defaultTimerHapticsSettings()
  if (!value || typeof value !== 'object') return defaults
  const candidate = value as Partial<TimerHapticsSettings>
  return {
    enabled: candidate.enabled !== false,
    main: normalizeHapticProfile(candidate.main, defaults.main),
    subBell: normalizeHapticProfile(candidate.subBell, defaults.subBell),
    alarm: normalizeHapticProfile(candidate.alarm, defaults.alarm),
  }
}

export function normalizeHapticProfile(value: unknown, fallback: HapticProfile): HapticProfile {
  if (!value || typeof value !== 'object') return fallback
  const candidate = value as Partial<HapticProfile>
  return {
    pattern: isHapticPattern(candidate.pattern) ? candidate.pattern : fallback.pattern,
    strength: isHapticStrength(candidate.strength) ? candidate.strength : fallback.strength,
  }
}

export function hapticProfileSummary(profile: HapticProfile): string {
  return `${labelForPattern(profile.pattern)} · ${labelForStrength(profile.strength)}`
}

export function labelForPattern(pattern: HapticPattern): string {
  return HAPTIC_PATTERNS.find(option => option.value === pattern)?.label ?? 'Single'
}

export function labelForStrength(strength: HapticStrength): string {
  return HAPTIC_STRENGTHS.find(option => option.value === strength)?.label ?? 'Balanced'
}

function isHapticPattern(value: unknown): value is HapticPattern {
  return value === 'single' || value === 'double' || value === 'triple'
}

function isHapticStrength(value: unknown): value is HapticStrength {
  return value === 'gentle' || value === 'balanced' || value === 'strong'
}
