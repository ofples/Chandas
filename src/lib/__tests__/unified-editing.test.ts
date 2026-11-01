import { describe, expect, it } from 'vitest'
import { createUnsavedUnifiedConfigState, UNNAMED_DRAFT_KEY } from '../unified-config-state'
import { unifiedTrackCadencePatch, unifiedTrackDurationPatch } from '../unified-editing'

describe('unified cadence editing', () => {
  it('updates all repeat points when a previously complete cadence changes', () => {
    const track = createUnsavedUnifiedConfigState().drafts[UNNAMED_DRAFT_KEY]!.program.steps[0].subBellTracks[0]
    const authored = { ...track, cadenceSeconds: 120, selectedOffsetsSeconds: [120, 240, 360, 480, 900] }
    expect(unifiedTrackCadencePatch(authored, 600, 60)).toEqual({ cadenceSeconds: 60, selectedOffsetsSeconds: [60, 120, 180, 240, 300, 360, 420, 480, 540, 900] })
    expect(authored.selectedOffsetsSeconds).toEqual([120, 240, 360, 480, 900])
  })

  it('retains compatible custom selections and dormant points instead of selecting every cue', () => {
    const track = createUnsavedUnifiedConfigState().drafts[UNNAMED_DRAFT_KEY]!.program.steps[0].subBellTracks[0]
    expect(unifiedTrackCadencePatch({ ...track, cadenceSeconds: 120, selectedOffsetsSeconds: [120, 360, 900] }, 600, 180))
      .toEqual({ cadenceSeconds: 180, selectedOffsetsSeconds: [360, 900] })
  })

  it('extends complete cadence on duration growth, preserving custom, disabled and dormant selections', () => {
    const track = createUnsavedUnifiedConfigState().drafts[UNNAMED_DRAFT_KEY]!.program.steps[0].subBellTracks[0]
    const full = { ...track, repeatEnabled: true, cadenceSeconds: 120, selectedOffsetsSeconds: [120, 240, 900] }
    expect(unifiedTrackDurationPatch(full, 360, 600).selectedOffsetsSeconds).toEqual([120, 240, 360, 480, 900])
    expect(unifiedTrackDurationPatch({ ...full, selectedOffsetsSeconds: [240, 900] }, 360, 600).selectedOffsetsSeconds).toEqual([240, 900])
    expect(unifiedTrackDurationPatch({ ...full, repeatEnabled: false }, 360, 600).selectedOffsetsSeconds).toEqual([120, 240, 900])
    expect(unifiedTrackDurationPatch(full, 360, 180).selectedOffsetsSeconds).toEqual([120, 240, 900])
    expect(full.selectedOffsetsSeconds).toEqual([120, 240, 900])
  })
})
