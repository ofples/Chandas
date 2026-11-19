import type { BellPoint, UnifiedSubBellTrack } from '../types'

type PointTrack = Pick<UnifiedSubBellTrack, 'points' | 'afterStartSeconds' | 'beforeEndSeconds'>

/** Read old markers without rewriting a saved configuration or losing its identity. */
export function bellPoints(track: PointTrack): BellPoint[] {
  return [...(track.points ?? []),
    ...(track.afterStartSeconds === undefined ? [] : [{ id: 'legacy-after', kind: 'start' as const, value: track.afterStartSeconds }]),
    ...(track.beforeEndSeconds === undefined ? [] : [{ id: 'legacy-before', kind: 'end' as const, value: track.beforeEndSeconds }]),
  ]
}

/** Round once, identically on JS and Android. Sub-bells live strictly inside a step. */
export function bellPointSeconds(point: BellPoint, durationSeconds: number): number {
  return point.kind === 'percent' ? Math.floor(durationSeconds * point.value / 100 + 0.5)
    : point.kind === 'end' ? durationSeconds - point.value : point.value
}

export function bellPointOffsets(track: PointTrack, durationSeconds: number): number[] {
  return [...new Set(bellPoints(track).map(point => bellPointSeconds(point, durationSeconds))
    .filter(seconds => seconds > 0 && seconds < durationSeconds))].sort((a, b) => a - b)
}

export function validBellPoints(value: unknown): value is BellPoint[] {
  if (!Array.isArray(value) || value.length > 32) return false
  const ids = new Set<string>()
  return value.every(point => {
    if (!point || typeof point !== 'object' || typeof point.id !== 'string' || !point.id.length || point.id.length > 128 || ids.has(point.id)) return false
    ids.add(point.id)
    return point.kind === 'percent' ? Number.isFinite(point.value) && point.value >= 0.1 && point.value <= 99.9 && Math.abs(point.value * 10 - Math.round(point.value * 10)) < 0.000001
      : (point.kind === 'start' || point.kind === 'end') && Number.isSafeInteger(point.value) && point.value >= 1 && point.value <= 14_400
  })
}
