import { useState } from 'react'
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTheme } from '../theme/ThemeContext'
import { ClockTimeInput } from './timer-v2/ClockTimeInput'

interface Props {
  title: string
  initial: number
  onConfirm: (minutes: number) => void
  onClose: () => void
}

export function TimeOfDayPicker({ title, initial, onConfirm, onClose }: Props) {
  const { tokens } = useTheme()
  const insets = useSafeAreaInsets()
  const [minutes, setMinutes] = useState(initial)

  const confirm = () => {
    onConfirm(minutes)
  }

  return (
    <Modal transparent animationType="fade" visible onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.keyboardAvoider}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <Pressable style={styles.overlay} onPress={onClose} accessible={false}>
          <Pressable
            style={[
              styles.sheet,
              { backgroundColor: tokens.surface, borderColor: tokens.border, paddingBottom: insets.bottom + 32 },
            ]}
            onPress={event => event.stopPropagation()}
            accessibilityViewIsModal
          >
            <Text style={[styles.title, { color: tokens.textMuted }]}>{title}</Text>
            <ClockTimeInput value={minutes} onChange={setMinutes} autoFocus accessibilityLabel={title} style={[styles.input, { backgroundColor: tokens.surfaceHi }]} />
            <Pressable style={[styles.confirm, { backgroundColor: tokens.accent }]} onPress={confirm} accessibilityRole="button" accessibilityLabel={`Set ${title}`}>
              <Text style={styles.confirmLabel}>Set</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  )
}

const styles = StyleSheet.create({
  keyboardAvoider: { flex: 1 },
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
  input: {
    width: '100%',
    borderRadius: 12,
    fontFamily: 'JetBrainsMono-Light',
    fontSize: 32,
    fontWeight: '300',
    fontVariant: ['tabular-nums'],
    paddingVertical: 12,
    textAlign: 'center',
  },
  confirm: { paddingVertical: 14, borderRadius: 9999, alignItems: 'center' },
  confirmLabel: { color: '#fff', fontSize: 14, fontWeight: '600', letterSpacing: 0.8 },
})
