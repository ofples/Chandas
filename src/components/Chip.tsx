import { Pressable, StyleSheet, Text } from 'react-native'
import { useTheme } from '../theme/ThemeContext'

interface Props {
  label: string
  active: boolean
  disabled?: boolean
  onPress: () => void
}

// Pill chip — ported from legacy-web .chip / .chip.active.
export function Chip({ label, active, disabled, onPress }: Props) {
  const { tokens } = useTheme()
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.chip,
        {
          borderColor: active ? tokens.accent : tokens.border,
          backgroundColor: active ? tokens.accent : 'transparent',
          opacity: disabled ? 0.22 : pressed ? 0.85 : 1,
          transform: [{ scale: pressed && !disabled ? 0.94 : 1 }],
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
  },
  label: {
    fontSize: 14,
    fontWeight: '500',
  },
})
