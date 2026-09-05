import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native'
import { useReducedMotion } from 'react-native-reanimated'
import { useTheme } from '../../theme/ThemeContext'
import { selectionHaptic } from '../../lib/haptics'

interface Segment<T extends string> {
  value: T
  label: string
}

export function SegmentedControl<T extends string>({ items, value, onChange, accessibilityLabel, style }: {
  items: readonly Segment<T>[]
  value: T
  onChange: (value: T) => void
  accessibilityLabel: string
  style?: StyleProp<ViewStyle>
}) {
  const { tokens } = useTheme()
  const reducedMotion = useReducedMotion()
  return <View style={[styles.control, { borderColor: tokens.border }, style]} accessibilityRole="tablist" accessibilityLabel={accessibilityLabel}>
    {items.map(item => {
      const selected = item.value === value
      return <Pressable
        key={item.value}
        onPress={() => { if (!selected) selectionHaptic(); onChange(item.value) }}
        accessibilityRole="tab"
        accessibilityState={{ selected }}
        style={({ pressed }) => [styles.segment, selected && { backgroundColor: tokens.accent }, { opacity: pressed ? 0.78 : 1, transform: [{ scale: pressed && !reducedMotion ? 0.985 : 1 }] }]}
      ><Text style={[styles.label, { color: selected ? '#fff' : tokens.textMuted }]}>{item.label}</Text></Pressable>
    })}
  </View>
}

const styles = StyleSheet.create({
  control: { flexDirection: 'row', borderWidth: 1.5, borderRadius: 14, padding: 3, gap: 3 },
  segment: { flex: 1, minHeight: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
  label: { fontSize: 12, fontWeight: '700' },
})
