import { useState } from 'react'
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { useTheme } from '../theme/ThemeContext'
import { BottomSheet } from './timer-v2/BottomSheet'

interface Props {
  title: string
  initial: number
  min?: number
  max?: number
  onConfirm: (value: number) => void
  onClose: () => void
}

/** Elapsed-duration editor. Deliberately not a clock picker: durations may exceed 24 hours. */
export function CustomMinutePicker({ title, initial, min = 1, max = 59, onConfirm, onClose }: Props) {
  const { tokens } = useTheme()
  const [hours, setHours] = useState(String(Math.floor(initial / 60)))
  const [minutes, setMinutes] = useState(String(initial % 60))

  const handleConfirm = () => {
    const parsedHours = Number.parseInt(hours, 10)
    const parsedMinutes = Number.parseInt(minutes, 10)
    const total = (Number.isFinite(parsedHours) ? parsedHours : 0) * 60 + (Number.isFinite(parsedMinutes) ? parsedMinutes : 0)
    onConfirm(Math.max(min, Math.min(max, total || initial)))
  }

  return <BottomSheet visible title={title} onClose={onClose} scroll={false}>
    <Text style={[styles.helper, { color: tokens.textMuted }]}>Set an elapsed duration.</Text>
    <View style={styles.fields}>
      <DurationField label="Hours" value={hours} onChange={setHours} maxLength={3} />
      <Text style={[styles.colon, { color: tokens.textMuted }]}>:</Text>
      <DurationField label="Minutes" value={minutes} onChange={value => setMinutes(value ? String(Math.min(59, Number(value))) : '')} maxLength={2} />
    </View>
    <Pressable onPress={handleConfirm} accessibilityRole="button" accessibilityLabel={`Set ${title}`} style={({ pressed }) => [styles.confirm, { backgroundColor: tokens.accent, opacity: pressed ? 0.76 : 1 }]}><Text style={styles.confirmLabel}>Set duration</Text></Pressable>
  </BottomSheet>
}

function DurationField({ label, value, onChange, maxLength }: { label: string; value: string; onChange: (value: string) => void; maxLength: number }) {
  const { tokens } = useTheme()
  return <View style={styles.fieldWrap}>
    <TextInput autoFocus={label === 'Hours'} value={value} onChangeText={text => onChange(text.replace(/\D/g, '').slice(0, maxLength))} keyboardType="number-pad" selectTextOnFocus maxLength={maxLength} style={[styles.input, { backgroundColor: tokens.surfaceHi, borderColor: tokens.border, color: tokens.text }]} accessibilityLabel={label} />
    <Text style={[styles.label, { color: tokens.textMuted }]}>{label.toUpperCase()}</Text>
  </View>
}

const styles = StyleSheet.create({
  helper: { fontSize: 12, lineHeight: 17 },
  fields: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'center', gap: 9, paddingVertical: 4 },
  fieldWrap: { alignItems: 'center', gap: 6 },
  input: { width: 86, minHeight: 52, borderWidth: 1.5, borderRadius: 12, fontFamily: 'JetBrainsMono-Regular', fontSize: 24, paddingHorizontal: 8, textAlign: 'center', fontVariant: ['tabular-nums'] },
  label: { fontSize: 9, fontWeight: '700', letterSpacing: 1 },
  colon: { fontFamily: 'JetBrainsMono-Regular', fontSize: 24, paddingTop: 10 },
  confirm: { minHeight: 48, borderRadius: 99, alignItems: 'center', justifyContent: 'center' },
  confirmLabel: { color: '#fff', fontSize: 14, fontWeight: '700' },
})
