import type { UnifiedSubBellTrack } from '../types'

export function unifiedCadenceOffsets(durationSeconds: number, cadenceSeconds: number): number[] {
  return Array.from({ length: Math.max(0, Math.floor((durationSeconds - 1) / cadenceSeconds)) }, (_, index) => (index + 1) * cadenceSeconds)
}

/** Keep the original editor's all-cues vs custom-selection behavior when changing cadence. */
export function unifiedTrackCadencePatch(track: UnifiedSubBellTrack, durationSeconds: number, cadenceSeconds: number): Pick<UnifiedSubBellTrack, 'cadenceSeconds' | 'selectedOffsetsSeconds'> {
  const previous = unifiedCadenceOffsets(durationSeconds, track.cadenceSeconds)
  const selected = new Set(track.selectedOffsetsSeconds)
  const allSelected = previous.length === 0 || previous.every(offset => selected.has(offset))
  const visible = allSelected
    ? unifiedCadenceOffsets(durationSeconds, cadenceSeconds)
    : track.selectedOffsetsSeconds.filter(offset => offset < durationSeconds && offset % cadenceSeconds === 0)
  const dormant = track.selectedOffsetsSeconds.filter(offset => offset >= durationSeconds)
  return { cadenceSeconds, selectedOffsetsSeconds: [...new Set([...visible, ...dormant])].sort((a, b) => a - b) }
}
