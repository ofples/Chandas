import { useAppReducedMotion } from '../../theme/ThemeContext'
import { Pressable, StyleSheet, Text } from 'react-native'
import { useTheme } from '../../theme/ThemeContext'
import { tapHaptic } from '../../lib/haptics'

export function AddRowButton({ title, disabled = false, onPress }: { title: string; disabled?: boolean; onPress: () => void }) {
  const { tokens, theme } = useTheme()
  const reducedMotion = useAppReducedMotion()
  return <Pressable
    disabled={disabled}
    onPress={() => { tapHaptic(); onPress() }}
    accessibilityRole="button"
    accessibilityLabel={title}
    accessibilityState={{ disabled }}
    style={({ pressed }) => [styles.button, { borderColor: disabled ? tokens.border : tokens.accent, backgroundColor: theme === 'eink' && disabled ? tokens.surfaceHi : 'transparent', opacity: theme === 'eink' ? 1 : disabled ? 0.42 : pressed ? 0.76 : 1, transform: [{ scale: pressed && !disabled && !reducedMotion ? 0.99 : 1 }] }]}
  ><Text style={[styles.text, { color: theme === 'eink' ? disabled ? tokens.textDisabled : tokens.text : disabled ? tokens.textMuted : tokens.accent }]}>{title}</Text></Pressable>
}

const styles = StyleSheet.create({
  button: { minHeight: 48, borderWidth: 1.5, borderStyle: 'dashed', borderRadius: 13, alignItems: 'center', justifyContent: 'center', marginTop: 8 },
  text: { fontSize: 13, fontWeight: '700' },
})
