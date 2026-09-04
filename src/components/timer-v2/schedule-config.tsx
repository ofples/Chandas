import { useState } from 'react'
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native'
import Animated, { FadeInDown, FadeOut, LinearTransition, useReducedMotion } from 'react-native-reanimated'
import type { AvailabilityPolicy, WeeklyAvailabilityWindow } from '../../types'
import { createProgramId, MAX_WEEKLY_WINDOWS } from '../../lib/timerV2'
import { useTheme } from '../../theme/ThemeContext'
import { TimeOfDayPicker } from '../TimeOfDayPicker'
import { Toggle } from '../Toggle'
import { formatTimeOfDay } from '../ActiveHoursConfig'
import { AddRowButton } from './AddRowButton'

interface Props {
  value: AvailabilityPolicy
  onChange: (value: AvailabilityPolicy) => void
  showHeading?: boolean
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

export function ScheduleConfig({ value, onChange, showHeading = true }: Props) {
  const { tokens } = useTheme()
  const reducedMotion = useReducedMotion()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [timePicker, setTimePicker] = useState<{ id: string; edge: 'start' | 'end' } | null>(null)
  const activeCount = value.weeklyWindows.filter(window => window.enabled && (window.days & 0b1111111) !== 0).length
  const patchWindow = (id: string, patch: Partial<WeeklyAvailabilityWindow>) => onChange({ ...value, weeklyWindows: value.weeklyWindows.map(window => window.id === id ? { ...window, ...patch } : window) })
  const removeWindow = (window: WeeklyAvailabilityWindow) => Alert.alert('Remove time range?', `${windowSummary(window)} will be removed.`, [{ text: 'Cancel', style: 'cancel' }, { text: 'Remove', style: 'destructive', onPress: () => { onChange({ ...value, weeklyWindows: value.weeklyWindows.filter(item => item.id !== window.id) }); setEditingId(current => current === window.id ? null : current) } }])
  const addWindow = () => {
    if (value.weeklyWindows.length >= MAX_WEEKLY_WINDOWS) return
    const previous = value.weeklyWindows.at(-1)
    const startMinutes = previous ? (previous.endMinutes + 60) % 1_440 : 8 * 60
    const window: WeeklyAvailabilityWindow = { id: createProgramId(), enabled: true, startMinutes, endMinutes: (startMinutes + 120) % 1_440, days: previous?.days ?? 0b1111111 }
    onChange({ ...value, weeklyWindows: [...value.weeklyWindows, window] })
    setEditingId(window.id)
  }

  return <View style={styles.section}>
    <View style={styles.toggleRow}><View style={styles.flex}><Text style={[showHeading ? styles.eyebrow : styles.rowTitle, { color: showHeading ? tokens.textMuted : tokens.text }]}>{showHeading ? 'SCHEDULE' : 'Active times'}</Text><Text style={[styles.helper, { color: tokens.textMuted }]}>{value.enabled ? `${activeCount} active time ${activeCount === 1 ? 'range' : 'ranges'}` : 'Available at any time'}</Text></View><Toggle value={value.enabled} onChange={enabled => onChange({ ...value, enabled })} accessibilityLabel="Timer schedule" /></View>
    {value.enabled ? <Animated.View entering={FadeInDown.duration(reducedMotion ? 80 : 180)} exiting={FadeOut.duration(reducedMotion ? 70 : 120)} layout={reducedMotion ? undefined : LinearTransition.duration(150)} style={styles.windowList}>
      {value.weeklyWindows.length === 0 ? <View style={styles.empty}><Text style={[styles.rowTitle, { color: tokens.text }]}>No active times yet</Text><Text style={[styles.helper, { color: tokens.textMuted }]}>Add a time range, or switch Schedule off to run at any time.</Text></View> : null}
      {value.weeklyWindows.map((window, index) => {
        const editing = editingId === window.id
        return <Animated.View key={window.id} layout={reducedMotion ? undefined : LinearTransition.duration(150)} style={[styles.window, index > 0 && { borderTopColor: tokens.border, borderTopWidth: StyleSheet.hairlineWidth }, { opacity: window.enabled ? 1 : 0.55 }]}>
          <View style={styles.windowHead}><Pressable onPress={() => setEditingId(editing ? null : window.id)} style={styles.flex} accessibilityRole="button" accessibilityLabel={`Edit ${windowSummary(window)}`}><Text style={[styles.rowTitle, { color: tokens.text }]}>{formatRange(window)}</Text><Text style={[styles.helper, { color: tokens.textMuted }]}>{daySummary(window.days)}</Text></Pressable><Toggle value={window.enabled} onChange={enabled => patchWindow(window.id, { enabled })} accessibilityLabel={`Enable time range ${index + 1}`} /></View>
          {editing ? <Animated.View entering={FadeInDown.duration(reducedMotion ? 80 : 150)} exiting={FadeOut.duration(reducedMotion ? 70 : 100)} style={styles.editor}>
            <View style={styles.range}><TimeButton label={`Starts ${formatTimeOfDay(window.startMinutes)}`} value={formatTimeOfDay(window.startMinutes)} onPress={() => setTimePicker({ id: window.id, edge: 'start' })} /><Text style={[styles.to, { color: tokens.textMuted }]}>to</Text><TimeButton label={`Ends ${formatTimeOfDay(window.endMinutes)}`} value={formatTimeOfDay(window.endMinutes)} onPress={() => setTimePicker({ id: window.id, edge: 'end' })} /></View>
            <View style={styles.days}>{DAYS.map(day => { const selected = (window.days & day.bit) !== 0; return <Pressable key={day.name} onPress={() => patchWindow(window.id, { days: selected ? window.days & ~day.bit : window.days | day.bit })} accessibilityRole="button" accessibilityLabel={day.name} accessibilityState={{ selected }} style={[styles.day, { borderColor: selected ? tokens.accent : tokens.border, backgroundColor: selected ? tokens.accentGlow : 'transparent' }]}><Text style={[styles.dayText, { color: selected ? tokens.accent : tokens.textMuted }]}>{day.short}</Text></Pressable> })}</View>
            {window.startMinutes === window.endMinutes ? <Text style={[styles.helper, { color: tokens.textMuted }]}>Same start and end means all day on these days.</Text> : null}
            {window.days === 0 ? <Text accessibilityRole="alert" style={[styles.helper, { color: tokens.warm }]}>Choose at least one day, or switch this range off.</Text> : null}
            <Pressable onPress={() => removeWindow(window)} accessibilityRole="button"><Text style={[styles.remove, { color: tokens.textMuted }]}>Remove time range</Text></Pressable>
          </Animated.View> : null}
        </Animated.View>
      })}
      <AddRowButton disabled={value.weeklyWindows.length >= MAX_WEEKLY_WINDOWS} onPress={addWindow} title={value.weeklyWindows.length >= MAX_WEEKLY_WINDOWS ? '16 range limit reached' : '+ Add time range'} />
    </Animated.View> : null}
    {timePicker ? <TimeOfDayPicker title={timePicker.edge === 'start' ? 'Starts at' : 'Ends at'} initial={(value.weeklyWindows.find(window => window.id === timePicker.id)?.[timePicker.edge === 'start' ? 'startMinutes' : 'endMinutes']) ?? 0} onConfirm={minutes => { patchWindow(timePicker.id, timePicker.edge === 'start' ? { startMinutes: minutes } : { endMinutes: minutes }); setTimePicker(null) }} onClose={() => setTimePicker(null)} /> : null}
  </View>
}

function TimeButton({ label, value, onPress }: { label: string; value: string; onPress: () => void }) {
  const { tokens } = useTheme()
  return <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} style={({ pressed }) => [styles.time, { borderColor: tokens.border, opacity: pressed ? 0.72 : 1 }]}><Text style={[styles.timeText, { color: tokens.text }]}>{value}</Text></Pressable>
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
  return window.startMinutes === window.endMinutes ? 'All day' : `${formatTimeOfDay(window.startMinutes)}–${formatTimeOfDay(window.endMinutes)}`
}

function windowSummary(window: WeeklyAvailabilityWindow): string {
  return `${formatRange(window)} on ${daySummary(window.days)}`
}

const styles = StyleSheet.create({
  section: { gap: 12 }, toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 14 }, flex: { flex: 1, minWidth: 0, gap: 3 }, eyebrow: { fontSize: 11, fontWeight: '700', letterSpacing: 1.3 }, helper: { fontSize: 12, lineHeight: 17 }, rowTitle: { fontSize: 14, fontWeight: '700' },
  windowList: { gap: 0 }, window: { paddingVertical: 10, gap: 12 }, windowHead: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 12 }, editor: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(127,127,127,0.25)', paddingTop: 12, gap: 12 },
  range: { flexDirection: 'row', alignItems: 'center', gap: 9 }, time: { minWidth: 92, minHeight: 42, borderWidth: 1.5, borderRadius: 99, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14 }, timeText: { fontFamily: 'JetBrainsMono-Regular', fontSize: 13, fontVariant: ['tabular-nums'] }, to: { fontSize: 12 },
  days: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 }, day: { width: 40, height: 40, borderWidth: 1.5, borderRadius: 20, alignItems: 'center', justifyContent: 'center' }, dayText: { fontSize: 10, fontWeight: '700' }, remove: { fontSize: 11, textDecorationLine: 'underline', paddingVertical: 3 },
  empty: { paddingVertical: 9, gap: 4 },
})
