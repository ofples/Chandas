import { useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import Animated, { FadeInDown, FadeOut, LinearTransition, useReducedMotion } from 'react-native-reanimated'
import type { AvailabilityPolicy, WeeklyAvailabilityWindow } from '../../types'
import { createProgramId, MAX_WEEKLY_WINDOWS } from '../../lib/timerV2'
import { useTheme } from '../../theme/ThemeContext'
import { Toggle } from '../Toggle'
import { AddRowButton } from './AddRowButton'
import { selectionHaptic, tapHaptic } from '../../lib/haptics'
import { SwipeToDeleteRow } from './swipe-to-delete-row'
import { ClockTimeInput, formatClockTime } from './ClockTimeInput'

interface Props {
  value: AvailabilityPolicy
  onChange: (value: AvailabilityPolicy) => void
  showHeading?: boolean
  showEnabledControl?: boolean
}

const DAYS = [
  { short: 'S', compact: 'Sun', name: 'Sunday', bit: 1 << 0 },
  { short: 'M', compact: 'Mon', name: 'Monday', bit: 1 << 1 },
  { short: 'T', compact: 'Tue', name: 'Tuesday', bit: 1 << 2 },
  { short: 'W', compact: 'Wed', name: 'Wednesday', bit: 1 << 3 },
  { short: 'T', compact: 'Thu', name: 'Thursday', bit: 1 << 4 },
  { short: 'F', compact: 'Fri', name: 'Friday', bit: 1 << 5 },
  { short: 'S', compact: 'Sat', name: 'Saturday', bit: 1 << 6 },
] as const

export function ScheduleConfig({ value, onChange, showHeading = true, showEnabledControl = true }: Props) {
  const { tokens } = useTheme()
  const reducedMotion = useReducedMotion()
  const [editingId, setEditingId] = useState<string | null>(null)
  const activeCount = value.weeklyWindows.filter(window => window.enabled && (window.behavior ?? 'active') === 'active' && (window.days & 0b1111111) !== 0).length
  const quietCount = value.weeklyWindows.filter(window => window.enabled && window.behavior === 'mute' && (window.days & 0b1111111) !== 0).length
  const sortedWindows = [...value.weeklyWindows].sort((left, right) => (left.behavior === 'mute' ? 1 : 0) - (right.behavior === 'mute' ? 1 : 0) || left.startMinutes - right.startMinutes || left.endMinutes - right.endMinutes || left.id.localeCompare(right.id))
  const patchWindow = (id: string, patch: Partial<WeeklyAvailabilityWindow>) => onChange({ ...value, weeklyWindows: value.weeklyWindows.map(window => window.id === id ? { ...window, ...patch } : window).sort(sortWindows) })
  const removeWindow = (window: WeeklyAvailabilityWindow) => {
    onChange({ ...value, weeklyWindows: value.weeklyWindows.filter(item => item.id !== window.id) })
    setEditingId(current => current === window.id ? null : current)
  }
  const addWindow = () => {
    if (value.weeklyWindows.length >= MAX_WEEKLY_WINDOWS) return
    const previous = value.weeklyWindows.at(-1)
    const startMinutes = previous ? (previous.endMinutes + 60) % 1_440 : 8 * 60
    const window: WeeklyAvailabilityWindow = { id: createProgramId(), enabled: true, startMinutes, endMinutes: (startMinutes + 120) % 1_440, days: previous?.days ?? 0b1111111, behavior: 'active' }
    onChange({ ...value, weeklyWindows: [...value.weeklyWindows, window].sort(sortWindows) })
    setEditingId(window.id)
  }

  const showWindows = showEnabledControl ? value.enabled : true

  return <View style={styles.section}>
    {showEnabledControl ? <View style={styles.toggleRow}><View style={styles.flex}><Text style={[showHeading ? styles.eyebrow : styles.rowTitle, { color: showHeading ? tokens.textMuted : tokens.text }]}>{showHeading ? 'SCHEDULE' : 'Active times'}</Text><Text style={[styles.helper, { color: tokens.textMuted }]}>{value.enabled ? `${activeCount} active · ${quietCount} quiet` : 'Available at any time'}</Text></View><Toggle value={value.enabled} onChange={enabled => onChange({ ...value, enabled })} accessibilityLabel="Timer schedule" /></View> : null}
    {showWindows ? <Animated.View entering={FadeInDown.duration(reducedMotion ? 80 : 180)} exiting={FadeOut.duration(reducedMotion ? 70 : 120)} layout={reducedMotion ? undefined : LinearTransition.duration(150)} style={styles.windowList}>
      {value.weeklyWindows.length === 0 ? <View style={styles.empty}><Text style={[styles.rowTitle, { color: tokens.text }]}>No active times yet</Text><Text style={[styles.helper, { color: tokens.textMuted }]}>Add a time range to define when the timer may sound.</Text></View> : null}
      {sortedWindows.map((window, index) => {
        const editing = editingId === window.id
        return <SwipeToDeleteRow key={window.id} accessibilityLabel={`Delete ${windowSummary(window)}`} onDelete={() => removeWindow(window)}><Animated.View layout={reducedMotion ? undefined : LinearTransition.duration(150)} style={[styles.window, { borderBottomColor: tokens.border, backgroundColor: tokens.surface, opacity: window.enabled ? 1 : 0.55 }]}>
          <View style={styles.windowHead}><Pressable onPress={() => { tapHaptic(); setEditingId(editing ? null : window.id) }} style={styles.flex} accessibilityRole="button" accessibilityLabel={`Edit ${windowSummary(window)}`}><Text style={[styles.rowTitle, { color: tokens.text }]}>{window.behavior === 'mute' ? 'Quiet · ' : 'Active · '}{formatRange(window)}</Text><Text style={[styles.helper, { color: tokens.textMuted }]}>{daySummary(window.days)}</Text></Pressable><Toggle value={window.enabled} onChange={enabled => patchWindow(window.id, { enabled })} accessibilityLabel={`Enable time range ${index + 1}`} /></View>
          {editing ? <Animated.View entering={FadeInDown.duration(reducedMotion ? 80 : 150)} exiting={FadeOut.duration(reducedMotion ? 70 : 100)} style={styles.editor}>
            <View style={styles.range}><ClockTimeField label="Starts" value={window.startMinutes} onChange={startMinutes => patchWindow(window.id, { startMinutes })} /><Text style={[styles.to, { color: tokens.textMuted }]}>to</Text><ClockTimeField label="Ends" value={window.endMinutes} onChange={endMinutes => patchWindow(window.id, { endMinutes })} /></View>
            <View style={styles.kindRow}><Pressable onPress={() => patchWindow(window.id, { behavior: 'active' })} accessibilityRole="button" accessibilityState={{ selected: (window.behavior ?? 'active') === 'active' }} style={[styles.kind, { borderColor: (window.behavior ?? 'active') === 'active' ? tokens.accent : tokens.border, backgroundColor: (window.behavior ?? 'active') === 'active' ? tokens.accentGlow : 'transparent' }]}><Text style={[styles.kindText, { color: (window.behavior ?? 'active') === 'active' ? tokens.accent : tokens.textMuted }]}>Active</Text></Pressable><Pressable onPress={() => patchWindow(window.id, { behavior: 'mute' })} accessibilityRole="button" accessibilityState={{ selected: window.behavior === 'mute' }} style={[styles.kind, { borderColor: window.behavior === 'mute' ? tokens.warm : tokens.border, backgroundColor: window.behavior === 'mute' ? tokens.warmGlow : 'transparent' }]}><Text style={[styles.kindText, { color: window.behavior === 'mute' ? tokens.warm : tokens.textMuted }]}>Quiet</Text></Pressable></View>
            <View style={styles.days}>{DAYS.map(day => { const selected = (window.days & day.bit) !== 0; return <Pressable key={day.name} onPress={() => { selectionHaptic(); patchWindow(window.id, { days: selected ? window.days & ~day.bit : window.days | day.bit }) }} accessibilityRole="button" accessibilityLabel={day.name} accessibilityState={{ selected }} style={[styles.day, { borderColor: selected ? tokens.accent : tokens.border, backgroundColor: selected ? tokens.accentGlow : 'transparent' }]}><Text style={[styles.dayText, { color: selected ? tokens.accent : tokens.textMuted }]}>{day.short}</Text></Pressable> })}</View>
            {window.startMinutes === window.endMinutes ? <Text style={[styles.helper, { color: tokens.textMuted }]}>Same start and end means all day on these days.</Text> : null}
            {window.days === 0 ? <Text accessibilityRole="alert" style={[styles.helper, { color: tokens.warm }]}>Choose at least one day, or switch this range off.</Text> : null}
          </Animated.View> : null}
        </Animated.View></SwipeToDeleteRow>
      })}
      <AddRowButton disabled={value.weeklyWindows.length >= MAX_WEEKLY_WINDOWS} onPress={addWindow} title={value.weeklyWindows.length >= MAX_WEEKLY_WINDOWS ? '16 range limit reached' : '+ Add time range'} />
    </Animated.View> : null}
  </View>
}

function ClockTimeField({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  const { tokens } = useTheme()
  return <View style={styles.timeField}>
    <Text style={[styles.timeLabel, { color: tokens.text }]}>{label}</Text>
    <ClockTimeInput value={value} onChange={onChange} accessibilityLabel={`${label} time`} />
  </View>
}

function daySummary(days: number): string {
  const normalized = days & 0b1111111
  if (normalized === 0b1111111) return 'Every day'
  if (normalized === 0b0111110) return 'Weekdays'
  if (normalized === 0b1000001) return 'Weekends'
  if (normalized === 0) return 'No days selected'
  return DAYS.filter(day => (normalized & day.bit) !== 0).map(day => day.compact).join(', ')
}

function formatRange(window: WeeklyAvailabilityWindow): string {
  return window.startMinutes === window.endMinutes ? 'All day' : `${formatClockTime(window.startMinutes)}–${formatClockTime(window.endMinutes)}`
}

function windowSummary(window: WeeklyAvailabilityWindow): string {
  return `${window.behavior === 'mute' ? 'Quiet' : 'Active'} ${formatRange(window)} on ${daySummary(window.days)}`
}

function sortWindows(left: WeeklyAvailabilityWindow, right: WeeklyAvailabilityWindow): number {
  return (left.behavior === 'mute' ? 1 : 0) - (right.behavior === 'mute' ? 1 : 0) || left.startMinutes - right.startMinutes || left.endMinutes - right.endMinutes || left.id.localeCompare(right.id)
}

const styles = StyleSheet.create({
  section: { gap: 12 }, toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 14 }, flex: { flex: 1, minWidth: 0, gap: 3 }, eyebrow: { fontSize: 11, fontWeight: '700', letterSpacing: 1.3 }, helper: { fontSize: 12, lineHeight: 17 }, rowTitle: { fontSize: 14, fontWeight: '700' },
  windowList: { gap: 0 }, window: { paddingVertical: 10, gap: 12, borderBottomWidth: StyleSheet.hairlineWidth }, windowHead: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 12 }, editor: { gap: 12 },
  range: { flexDirection: 'row', alignItems: 'flex-end', gap: 9 }, timeField: { flex: 1, gap: 5 }, timeLabel: { fontSize: 14, lineHeight: 20, fontWeight: '700' }, to: { fontSize: 12, paddingBottom: 14 }, kindRow: { flexDirection: 'row', gap: 8 }, kind: { minHeight: 36, paddingHorizontal: 14, borderWidth: 1.5, borderRadius: 18, justifyContent: 'center' }, kindText: { fontSize: 12, fontWeight: '700' },
  days: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 }, day: { width: 40, height: 40, borderWidth: 1.5, borderRadius: 20, alignItems: 'center', justifyContent: 'center' }, dayText: { fontSize: 10, fontWeight: '700' },
  empty: { paddingVertical: 9, gap: 4 },
})
