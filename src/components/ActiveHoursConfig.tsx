import { useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useTheme } from '../theme/ThemeContext'
import { TimeOfDayPicker } from './TimeOfDayPicker'
import { Toggle } from './Toggle'

interface Props {
  enabled: boolean
  startMinutes: number
  endMinutes: number
  onToggle: (enabled: boolean) => void
  onStartChange: (minutes: number) => void
  onEndChange: (minutes: number) => void
}

export function formatTimeOfDay(minutes: number): string {
  const normalized = ((minutes % 1_440) + 1_440) % 1_440
  return `${String(Math.floor(normalized / 60)).padStart(2, '0')}:${String(normalized % 60).padStart(2, '0')}`
}

export function ActiveHoursConfig({
  enabled,
  startMinutes,
  endMinutes,
  onToggle,
  onStartChange,
  onEndChange,
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
        <View style={styles.range}>
          <Pressable
            onPress={() => setEditing('start')}
            style={({ pressed }) => [styles.time, { borderColor: tokens.border, opacity: pressed ? 0.75 : 1 }]}
            accessibilityLabel={`Active hours start ${formatTimeOfDay(startMinutes)}`}
          >
            <Text style={[styles.timeLabel, { color: tokens.text }]}>{formatTimeOfDay(startMinutes)}</Text>
          </Pressable>
          <Text style={[styles.to, { color: tokens.textMuted }]}>to</Text>
          <Pressable
            onPress={() => setEditing('end')}
            style={({ pressed }) => [styles.time, { borderColor: tokens.border, opacity: pressed ? 0.75 : 1 }]}
            accessibilityLabel={`Active hours end ${formatTimeOfDay(endMinutes)}`}
          >
            <Text style={[styles.timeLabel, { color: tokens.text }]}>{formatTimeOfDay(endMinutes)}</Text>
          </Pressable>
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
  time: {
    minWidth: 84,
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 9999,
    borderWidth: 1.5,
    alignItems: 'center',
  },
  timeLabel: { fontFamily: 'JetBrainsMono-Regular', fontSize: 14, fontVariant: ['tabular-nums'] },
  to: { fontSize: 12 },
})
