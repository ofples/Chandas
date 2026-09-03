import { useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useTheme } from '../theme/ThemeContext'
import { TimeOfDayPicker } from './TimeOfDayPicker'
import { Toggle } from './Toggle'

interface Props {
  enabled: boolean
  startMinutes: number
  endMinutes: number
  days: number
  onToggle: (enabled: boolean) => void
  onStartChange: (minutes: number) => void
  onEndChange: (minutes: number) => void
  onDaysChange: (days: number) => void
}

const DAYS = [
  { label: 'S', name: 'Sunday', bit: 1 << 0 },
  { label: 'M', name: 'Monday', bit: 1 << 1 },
  { label: 'T', name: 'Tuesday', bit: 1 << 2 },
  { label: 'W', name: 'Wednesday', bit: 1 << 3 },
  { label: 'T', name: 'Thursday', bit: 1 << 4 },
  { label: 'F', name: 'Friday', bit: 1 << 5 },
  { label: 'S', name: 'Saturday', bit: 1 << 6 },
] as const

export function formatTimeOfDay(minutes: number): string {
  const normalized = ((minutes % 1_440) + 1_440) % 1_440
  return `${String(Math.floor(normalized / 60)).padStart(2, '0')}:${String(normalized % 60).padStart(2, '0')}`
}

export function ActiveHoursConfig({
  enabled,
  startMinutes,
  endMinutes,
  days,
  onToggle,
  onStartChange,
  onEndChange,
  onDaysChange,
}: Props) {
  const { tokens } = useTheme()
  const [editing, setEditing] = useState<'start' | 'end' | null>(null)

  return (
    <View style={styles.section}>
      <View style={styles.toggleRow}>
        <Text style={[styles.label, { color: tokens.textMuted }]}>Active hours</Text>
        <Toggle value={enabled} onChange={onToggle} accessibilityLabel="Active hours" />
      </View>

      {enabled && (
        <View style={styles.details}>
          <View style={styles.range}>
            <Pressable
            onPress={() => setEditing('start')}
            style={({ pressed }) => [styles.time, { borderColor: tokens.border, opacity: pressed ? 0.75 : 1 }]}
            accessibilityLabel={`Active hours start ${formatTimeOfDay(startMinutes)}`}
            accessibilityRole="button"
            >
              <Text style={[styles.timeLabel, { color: tokens.text }]}>{formatTimeOfDay(startMinutes)}</Text>
            </Pressable>
            <Text style={[styles.to, { color: tokens.textMuted }]}>to</Text>
            <Pressable
            onPress={() => setEditing('end')}
            style={({ pressed }) => [styles.time, { borderColor: tokens.border, opacity: pressed ? 0.75 : 1 }]}
            accessibilityLabel={`Active hours end ${formatTimeOfDay(endMinutes)}`}
            accessibilityRole="button"
            >
              <Text style={[styles.timeLabel, { color: tokens.text }]}>{formatTimeOfDay(endMinutes)}</Text>
            </Pressable>
          </View>
          <View style={styles.days}>
            {DAYS.map(day => {
              const selected = (days & day.bit) !== 0
              return <Pressable
                key={day.name}
                onPress={() => onDaysChange(selected ? days & ~day.bit : days | day.bit)}
                accessibilityRole="button"
                accessibilityLabel={day.name}
                accessibilityState={{ selected }}
                style={[styles.day, { borderColor: selected ? tokens.accent : tokens.border, backgroundColor: selected ? tokens.accentGlow : 'transparent' }]}
              ><Text style={[styles.dayText, { color: selected ? tokens.accent : tokens.textMuted }]}>{day.label}</Text></Pressable>
            })}
          </View>
          {days === 0 ? <Text style={[styles.warning, { color: tokens.accent }]}>Choose at least one active day.</Text> : null}
        </View>
      )}

      {editing && (
        <TimeOfDayPicker
          title={editing === 'start' ? 'Starts at' : 'Ends at'}
          initial={editing === 'start' ? startMinutes : endMinutes}
          onConfirm={minutes => {
            if (editing === 'start') onStartChange(minutes)
            else onEndChange(minutes)
            setEditing(null)
          }}
          onClose={() => setEditing(null)}
        />
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  section: { gap: 12 },
  toggleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  label: { fontSize: 11, fontWeight: '500', letterSpacing: 1.3, textTransform: 'uppercase' },
  range: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: 4 },
  details: { gap: 12 },
  days: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  day: { width: 44, height: 44, borderWidth: 1.5, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  dayText: { fontSize: 11, fontWeight: '700' },
  warning: { fontSize: 11, fontWeight: '600' },
  time: {
    minWidth: 84,
    minHeight: 44,
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 9999,
    borderWidth: 1.5,
    alignItems: 'center',
  },
  timeLabel: { fontFamily: 'JetBrainsMono-Regular', fontSize: 14, fontVariant: ['tabular-nums'] },
  to: { fontSize: 12 },
})
