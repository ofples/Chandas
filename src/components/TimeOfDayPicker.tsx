import { useRef, useState } from 'react'
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTheme } from '../theme/ThemeContext'

interface Props {
  title: string
  initial: number
  onConfirm: (minutes: number) => void
  onClose: () => void
}

export function TimeOfDayPicker({ title, initial, onConfirm, onClose }: Props) {
  const { tokens } = useTheme()
  const insets = useSafeAreaInsets()
  const minuteInput = useRef<TextInput>(null)
  const [hour, setHour] = useState(String(Math.floor(initial / 60)).padStart(2, '0'))
  const [minute, setMinute] = useState(String(initial % 60).padStart(2, '0'))

  const confirm = () => {
    const parsedHour = Number.parseInt(hour, 10)
    const parsedMinute = Number.parseInt(minute, 10)
    const safeHour = Number.isFinite(parsedHour) ? Math.max(0, Math.min(23, parsedHour)) : 0
    const safeMinute = Number.isFinite(parsedMinute) ? Math.max(0, Math.min(59, parsedMinute)) : 0
    onConfirm(safeHour * 60 + safeMinute)
  }

  return (
    <Modal transparent animationType="fade" visible onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose}>
        <Pressable
          style={[
            styles.sheet,
            { backgroundColor: tokens.surface, borderColor: tokens.border, paddingBottom: insets.bottom + 32 },
          ]}
          onPress={event => event.stopPropagation()}
        >
          <Text style={[styles.title, { color: tokens.textMuted }]}>{title}</Text>
          <View style={styles.timeRow}>
            <TextInput
              style={[styles.input, { backgroundColor: tokens.surfaceHi, borderColor: tokens.border, color: tokens.text }]}
              value={hour}
              onChangeText={setHour}
              keyboardType="number-pad"
              maxLength={2}
              autoFocus
              selectTextOnFocus
              returnKeyType="next"
              onSubmitEditing={() => minuteInput.current?.focus()}
              accessibilityLabel="Hour"
            />
            <Text style={[styles.separator, { color: tokens.textMuted }]}>:</Text>
            <TextInput
              ref={minuteInput}
              style={[styles.input, { backgroundColor: tokens.surfaceHi, borderColor: tokens.border, color: tokens.text }]}
              value={minute}
              onChangeText={setMinute}
              keyboardType="number-pad"
              maxLength={2}
              selectTextOnFocus
              onSubmitEditing={confirm}
              accessibilityLabel="Minute"
            />
          </View>
          <Pressable style={[styles.confirm, { backgroundColor: tokens.accent }]} onPress={confirm}>
            <Text style={styles.confirmLabel}>Set</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  )
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: {
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderWidth: 1.5,
    borderBottomWidth: 0,
    padding: 24,
    gap: 18,
  },
  title: { fontSize: 13, fontWeight: '500', letterSpacing: 1.3, textTransform: 'uppercase' },
  timeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12 },
  input: {
    width: 92,
    borderWidth: 1.5,
    borderRadius: 8,
    fontFamily: 'JetBrainsMono-Light',
    fontSize: 32,
    fontWeight: '300',
    fontVariant: ['tabular-nums'],
    paddingVertical: 12,
    textAlign: 'center',
  },
  separator: { fontFamily: 'JetBrainsMono-Light', fontSize: 30 },
  confirm: { paddingVertical: 14, borderRadius: 9999, alignItems: 'center' },
  confirmLabel: { color: '#fff', fontSize: 14, fontWeight: '600', letterSpacing: 0.8 },
})
