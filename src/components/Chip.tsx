import { Pressable, StyleSheet, Text } from 'react-native'
import { useReducedMotion } from 'react-native-reanimated'
import { useTheme } from '../theme/ThemeContext'

interface Props {
  label: string
  active: boolean
  disabled?: boolean
  onPress: () => void
  compact?: boolean
  accessibilityLabel?: string
}

// Pill chip — ported from legacy-web .chip / .chip.active.
export function Chip({ label, active, disabled, onPress, compact = false, accessibilityLabel }: Props) {
  const { tokens } = useTheme()
  const reducedMotion = useReducedMotion()
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ selected: active, disabled }}
      style={({ pressed }) => [
        styles.chip,
        compact && styles.compact,
        {
          borderColor: active ? tokens.accent : tokens.border,
          backgroundColor: active ? tokens.accent : 'transparent',
          opacity: disabled ? 0.22 : pressed ? 0.85 : 1,
          transform: [{ scale: pressed && !disabled && !reducedMotion ? 0.94 : 1 }],
        },
      ]}
    >
      <Text style={[styles.label, { color: active ? '#fff' : tokens.textMuted }]}>{label}</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  chip: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 9999,
    borderWidth: 1.5,
    minHeight: 44,
    justifyContent: 'center',
  },
  compact: { paddingVertical: 7, paddingHorizontal: 12 },
  label: {
    fontSize: 14,
    fontWeight: '500',
  },
})
