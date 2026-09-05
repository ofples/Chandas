import type { SubBellColorId } from '../types'

export interface SubBellColorOption {
  id: SubBellColorId
  label: string
  value: string
}

/**
 * A deliberately compact, dark/light-theme-safe palette. The stored value is
 * a semantic ID so we can tune the actual colors later without migrating data.
 */
export const SUB_BELL_COLORS: readonly SubBellColorOption[] = [
  { id: 'violet', label: 'Violet', value: '#7C6FF7' },
  { id: 'blue', label: 'Blue', value: '#5B8DEF' },
  { id: 'cyan', label: 'Cyan', value: '#4AAFD1' },
  { id: 'teal', label: 'Teal', value: '#43B7A0' },
  { id: 'green', label: 'Green', value: '#70B66A' },
  { id: 'lime', label: 'Lime', value: '#A5B957' },
  { id: 'amber', label: 'Amber', value: '#D5AA55' },
  { id: 'orange', label: 'Orange', value: '#DE8B55' },
  { id: 'coral', label: 'Coral', value: '#DB6F73' },
  { id: 'rose', label: 'Rose', value: '#D76BA5' },
] as const

const IDS = new Set<SubBellColorId>(SUB_BELL_COLORS.map(option => option.id))

export function defaultSubBellColor(index: number): SubBellColorId {
  return SUB_BELL_COLORS[Math.abs(index) % SUB_BELL_COLORS.length].id
}

export function normalizeSubBellColor(value: unknown, index: number): SubBellColorId {
  return typeof value === 'string' && IDS.has(value as SubBellColorId)
    ? value as SubBellColorId
    : defaultSubBellColor(index)
}

export function subBellColorValue(value: unknown, index: number): string {
  const id = normalizeSubBellColor(value, index)
  return SUB_BELL_COLORS.find(option => option.id === id)?.value ?? SUB_BELL_COLORS[0].value
}
