import { Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native'
import { useReducedMotion } from 'react-native-reanimated'
import type { AvailabilityPolicy } from '../../types'
import { scheduleSegmentsForDay } from '../../lib/activeHours'
import { useTheme } from '../../theme/ThemeContext'

export function ScheduleTimelinePreview({ value, onPress }: { value: AvailabilityPolicy; onPress: () => void }) {
  const { tokens } = useTheme()
  const reducedMotion = useReducedMotion()
  const segments = scheduleSegmentsForDay(value, new Date().getDay())
  const actualBoundaries = [...new Set(segments.flatMap(segment => [segment.start, segment.end]))]
  const boundaries = actualBoundaries.length <= 6 ? actualBoundaries : [0, 360, 720, 1_080, 1_440]
  const summary = !value.enabled
    ? 'Available at any time'
    : segments.length === 0
      ? 'No active time today'
      : segments.length === 1
        ? `Today · ${formatClock(segments[0].start)}–${formatClock(segments[0].end)}`
        : `Today · ${segments.length} active ranges`

  return <Pressable
    onPress={onPress}
    accessibilityRole="button"
    accessibilityLabel={`Edit schedule. ${summary}`}
    style={({ pressed }) => [styles.preview, { opacity: pressed ? 0.7 : 1, transform: [{ scale: pressed && !reducedMotion ? 0.995 : 1 }] }]}
  >
    <View style={styles.timeline}>
      <View style={[styles.baseline, { backgroundColor: tokens.border }]} />
      {segments.map(segment => <View key={`${segment.start}:${segment.end}`} style={[styles.activeRange, { left: `${segment.start / 1_440 * 100}%`, width: `${(segment.end - segment.start) / 1_440 * 100}%`, backgroundColor: tokens.accent }]} />)}
      {boundaries.map((minute, index) => <View key={minute} style={[styles.boundaryWrap, boundaryPosition(minute)]}>
        <View style={[styles.boundary, { backgroundColor: segments.length > 0 ? tokens.accent : tokens.border }]} />
        <Text style={[styles.boundaryLabel, index > 0 && minute - boundaries[index - 1] < 120 && styles.staggeredLabel, { color: tokens.textMuted }]}>{formatBoundary(minute)}</Text>
      </View>)}
    </View>
    <View style={styles.summaryRow}><Text style={[styles.summary, { color: tokens.textMuted }]}>{summary}</Text><Text style={[styles.chevron, { color: tokens.accent }]}>›</Text></View>
  </Pressable>
}

function boundaryPosition(minute: number): ViewStyle {
  if (minute <= 0) return { left: 0 }
  if (minute >= 1_440) return { right: 0 }
  return { left: `${minute / 1_440 * 100}%` as `${number}%`, marginLeft: -20 }
}

function formatBoundary(minute: number): string {
  if (minute >= 1_440) return '24'
  const normalized = ((Math.round(minute) % 1_440) + 1_440) % 1_440
  const hours = Math.floor(normalized / 60)
  const minutes = normalized % 60
  return minutes === 0 ? String(hours) : `${hours}:${String(minutes).padStart(2, '0')}`
}

function formatClock(minute: number): string {
  if (minute >= 1_440) return '24:00'
  const normalized = ((Math.round(minute) % 1_440) + 1_440) % 1_440
  return `${String(Math.floor(normalized / 60)).padStart(2, '0')}:${String(normalized % 60).padStart(2, '0')}`
}

const styles = StyleSheet.create({
  preview: { gap: 4, paddingTop: 2 },
  timeline: { height: 45, position: 'relative', marginHorizontal: 2 },
  baseline: { position: 'absolute', left: 0, right: 0, top: 12, height: 1 },
  activeRange: { position: 'absolute', top: 10, height: 5, borderRadius: 3 },
  boundaryWrap: { position: 'absolute', top: 5, width: 40, alignItems: 'center' },
  boundary: { width: 2, height: 15, borderRadius: 1 },
  boundaryLabel: { marginTop: 6, fontFamily: 'JetBrainsMono-Regular', fontSize: 8, fontVariant: ['tabular-nums'] },
  staggeredLabel: { marginTop: 16 },
  summaryRow: { minHeight: 24, flexDirection: 'row', alignItems: 'center', gap: 8 },
  summary: { flex: 1, fontSize: 12 },
  chevron: { width: 22, textAlign: 'center', fontSize: 22, lineHeight: 24, fontWeight: '300' },
})
