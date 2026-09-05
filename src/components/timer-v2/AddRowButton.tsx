import { Pressable, StyleSheet, Text } from 'react-native'
import { useReducedMotion } from 'react-native-reanimated'
import { useTheme } from '../../theme/ThemeContext'
import { tapHaptic } from '../../lib/haptics'

export function AddRowButton({ title, disabled = false, onPress }: { title: string; disabled?: boolean; onPress: () => void }) {
  const { tokens } = useTheme()
  const reducedMotion = useReducedMotion()
  return <Pressable
    disabled={disabled}
    onPress={() => { tapHaptic(); onPress() }}
    accessibilityRole="button"
    accessibilityLabel={title}
    accessibilityState={{ disabled }}
    style={({ pressed }) => [styles.button, { borderColor: disabled ? tokens.border : tokens.accent, opacity: disabled ? 0.42 : pressed ? 0.76 : 1, transform: [{ scale: pressed && !disabled && !reducedMotion ? 0.99 : 1 }] }]}
  ><Text style={[styles.text, { color: disabled ? tokens.textMuted : tokens.accent }]}>{title}</Text></Pressable>
}

const styles = StyleSheet.create({
  button: { minHeight: 48, borderWidth: 1.5, borderStyle: 'dashed', borderRadius: 13, alignItems: 'center', justifyContent: 'center', marginTop: 8 },
  text: { fontSize: 13, fontWeight: '700' },
})
