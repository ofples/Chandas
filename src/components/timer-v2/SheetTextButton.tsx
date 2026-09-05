import { Pressable, StyleSheet, Text } from 'react-native'
import { useReducedMotion } from 'react-native-reanimated'
import { useTheme } from '../../theme/ThemeContext'

interface Props {
  label: string
  onPress: () => void
  disabled?: boolean
  accessibilityLabel?: string
  tone?: 'accent' | 'muted' | 'danger'
}

/** One quiet, generous text action for sheet navigation and secondary actions. */
export function SheetTextButton({ label, onPress, disabled = false, accessibilityLabel, tone = 'accent' }: Props) {
  const { tokens } = useTheme()
  const reducedMotion = useReducedMotion()
  const color = tone === 'muted' ? tokens.textMuted : tone === 'danger' ? tokens.warm : tokens.accent
  return <Pressable
    disabled={disabled}
    hitSlop={6}
    onPress={onPress}
    accessibilityRole="button"
    accessibilityLabel={accessibilityLabel ?? label}
    accessibilityState={{ disabled }}
    style={({ pressed }) => [styles.button, { opacity: disabled ? 0.35 : pressed ? 0.65 : 1, transform: [{ scale: pressed && !disabled && !reducedMotion ? 0.97 : 1 }] }]}
  ><Text style={[styles.text, { color }]}>{label}</Text></Pressable>
}

const styles = StyleSheet.create({
  button: { minHeight: 44, minWidth: 44, justifyContent: 'center' },
  text: { fontSize: 13, lineHeight: 18, fontWeight: '700' },
})
