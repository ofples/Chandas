import { useState } from 'react'
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { useTheme } from '../theme/ThemeContext'

interface Props {
  title: string
  initial: number
  min?: number
  max?: number
  onConfirm: (value: number) => void
  onClose: () => void
}

// Bottom-sheet numeric picker — ported from legacy-web .modal-overlay/.modal-sheet.
export function CustomMinutePicker({ title, initial, min = 1, max = 59, onConfirm, onClose }: Props) {
  const { tokens } = useTheme()
  const [text, setText] = useState(String(initial))

  const handleConfirm = () => {
    const parsed = parseInt(text, 10)
    const value = Number.isFinite(parsed) ? parsed : initial
    onConfirm(Math.max(min, Math.min(max, value)))
  }

  return (
    <Modal transparent animationType="fade" visible onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose}>
        <Pressable
          style={[styles.sheet, { backgroundColor: tokens.surface, borderColor: tokens.border }]}
          onPress={e => e.stopPropagation()}
        >
          <Text style={[styles.title, { color: tokens.textMuted }]}>{title}</Text>
          <View style={styles.inputRow}>
            <TextInput
              style={[styles.input, { backgroundColor: tokens.surfaceHi, borderColor: tokens.border, color: tokens.text }]}
              value={text}
              onChangeText={setText}
              keyboardType="number-pad"
              autoFocus
              selectTextOnFocus
              onSubmitEditing={handleConfirm}
            />
            <Text style={[styles.unit, { color: tokens.textMuted }]}>min</Text>
          </View>
          <Pressable
            style={[styles.confirm, { backgroundColor: tokens.accent }]}
            onPress={handleConfirm}
          >
            <Text style={styles.confirmLabel}>Set</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  )
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderWidth: 1.5,
    borderBottomWidth: 0,
    padding: 24,
    paddingBottom: 32,
    gap: 16,
  },
  title: {
    fontSize: 13,
    fontWeight: '500',
    letterSpacing: 1.3,
    textTransform: 'uppercase',
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  input: {
    flex: 1,
    borderWidth: 1.5,
    borderRadius: 10,
    fontFamily: 'JetBrainsMono-Light',
    fontSize: 32,
    fontWeight: '300',
    paddingVertical: 12,
    paddingHorizontal: 16,
    textAlign: 'center',
  },
  unit: {
    fontSize: 13,
  },
  confirm: {
    paddingVertical: 14,
    borderRadius: 9999,
    alignItems: 'center',
  },
  confirmLabel: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
    letterSpacing: 0.8,
  },
})
