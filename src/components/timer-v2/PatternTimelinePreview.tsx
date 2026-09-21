import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useReducedMotion } from 'react-native-reanimated'
import type { PatternTrack } from '../../types'
import { formatCompactDurationSeconds, trackEventOffsetsSeconds } from '../../lib/timerV2'
import { subBellColorValue } from '../../lib/subBellColors'
import { tapHaptic } from '../../lib/haptics'
import { useTheme } from '../../theme/ThemeContext'

interface Props {
  tracks: PatternTrack[]
  mainDurationSeconds: number
  onPress?: () => void
}

/** Shared cue timeline used by both the editor and saved-configuration review. */
export function PatternTimelinePreview({ tracks, mainDurationSeconds, onPress }: Props) {
  const { tokens } = useTheme()
  const reducedMotion = useReducedMotion()
  const active = tracks.filter(track => track.enabled)
  return <Pressable
    disabled={!onPress}
    onPress={onPress ? () => { tapHaptic(); onPress() } : undefined}
    hitSlop={onPress ? 6 : undefined}
    style={({ pressed }) => [styles.timeline, { opacity: pressed && onPress ? 0.7 : 1, transform: [{ scale: pressed && onPress && !reducedMotion ? 0.995 : 1 }] }]}
    accessibilityRole={onPress ? 'button' : undefined}
    accessibilityLabel={onPress ? 'Configure sub-bells from cue timeline' : 'One main interval cue preview'}
    accessibilityHint={onPress ? 'Opens the Sub-bells editor' : undefined}
  >
    <View style={[styles.timelineLine, { backgroundColor: tokens.border }]} />
    <View style={[styles.timelineBoundary, { left: 0, backgroundColor: tokens.accent }]} />
    <View style={[styles.timelineBoundary, { right: 0, backgroundColor: tokens.accent }]} />
    {active.flatMap((track, trackIndex) => trackEventOffsetsSeconds(track, mainDurationSeconds).map(offset =>
      <View key={`${track.id}:${offset}`} style={[styles.timelineCue, { left: `${offset / mainDurationSeconds * 100}%`, top: 8 + trackIndex * 6, backgroundColor: subBellColorValue(track.color, trackIndex) }]} />
    ))}
    <Text style={[styles.timelineStart, { color: tokens.textMuted }]}>0</Text>
    <Text style={[styles.timelineEnd, { color: tokens.textMuted }]}>{formatCompactDurationSeconds(mainDurationSeconds)}</Text>
  </Pressable>
}

const styles = StyleSheet.create({
  timeline: { height: 43, position: 'relative', overflow: 'hidden', paddingHorizontal: 8 },
  timelineLine: { position: 'absolute', left: 8, right: 8, top: 17, height: 1 },
  timelineBoundary: { position: 'absolute', top: 11, width: 2, height: 13 },
  timelineCue: { position: 'absolute', width: 5, height: 5, marginLeft: -2.5, borderRadius: 3 },
  timelineStart: { position: 'absolute', left: 7, bottom: 2, fontSize: 8 },
  timelineEnd: { position: 'absolute', right: 7, bottom: 2, fontSize: 8 },
})
