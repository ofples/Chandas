import { useAppReducedMotion } from '../../theme/ThemeContext'
import { Pressable, StyleSheet, Text } from 'react-native'
import { useTheme } from '../../theme/ThemeContext'
import { tapHaptic } from '../../lib/haptics'

interface Props {
  label: string
  onPress: () => void
  disabled?: boolean
  accessibilityLabel?: string
  tone?: 'accent' | 'muted' | 'danger'
  feedback?: boolean
}

/** One quiet, generous text action for sheet navigation and secondary actions. */
export function SheetTextButton({ label, onPress, disabled = false, accessibilityLabel, tone = 'accent', feedback = true }: Props) {
  const { tokens, theme } = useTheme()
  const reducedMotion = useAppReducedMotion()
  const color = tone === 'muted' ? tokens.textMuted : tone === 'danger' ? tokens.warm : tokens.accent
  return <Pressable
    disabled={disabled}
    hitSlop={6}
    onPress={() => { if (feedback) tapHaptic(); onPress() }}
    accessibilityRole="button"
    accessibilityLabel={accessibilityLabel ?? label}
    accessibilityState={{ disabled }}
    style={({ pressed }) => [styles.button, { opacity: theme === 'eink' ? 1 : disabled ? 0.35 : pressed ? 0.65 : 1, transform: [{ scale: pressed && !disabled && !reducedMotion ? 0.97 : 1 }] }]}
  ><Text style={[styles.text, { color: theme === 'eink' ? disabled ? tokens.textDisabled : tokens.text : color }]}>{label}</Text></Pressable>
}

const styles = StyleSheet.create({
  button: { minHeight: 44, minWidth: 44, justifyContent: 'center' },
  text: { fontSize: 13, lineHeight: 18, fontWeight: '700' },
})
