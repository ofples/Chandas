import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import * as Haptics from 'expo-haptics'
import { useReducedMotion } from 'react-native-reanimated'
import type { SubBellColorId } from '../../types'
import { SUB_BELL_COLORS } from '../../lib/subBellColors'
import { useTheme } from '../../theme/ThemeContext'

interface Props {
  value: SubBellColorId
  onChange: (value: SubBellColorId) => void
  label?: string
  accessibilityLabel?: string
}

/** Shared one-line color rail used for both UI accents and sub-bells. */
export function ColorSelector({ value, onChange, label = 'COLOR', accessibilityLabel = 'Color' }: Props) {
  const { tokens } = useTheme()
  const reducedMotion = useReducedMotion()
  return <View style={styles.block}>
    {label ? <Text style={[styles.label, { color: tokens.textMuted }]}>{label}</Text> : null}
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.rail} accessibilityRole="radiogroup" accessibilityLabel={accessibilityLabel}>
      {SUB_BELL_COLORS.map(option => {
        const selected = value === option.id
        return <Pressable key={option.id} onPress={() => { onChange(option.id); void Haptics.selectionAsync().catch(() => undefined) }} accessibilityRole="radio" accessibilityLabel={option.label} accessibilityState={{ selected }} style={({ pressed }) => [styles.choice, { borderColor: selected ? option.value : tokens.border, opacity: pressed ? 0.72 : 1, transform: [{ scale: pressed && !reducedMotion ? 0.92 : 1 }] }]}>
          <View style={[styles.swatch, { backgroundColor: option.value }]} />
          {selected ? <Text style={styles.check}>✓</Text> : null}
        </Pressable>
      })}
    </ScrollView>
  </View>
}

const styles = StyleSheet.create({
  block: { gap: 8 },
  label: { fontSize: 11, fontWeight: '700', letterSpacing: 1.4 },
  rail: { gap: 9, paddingRight: 20, paddingVertical: 2 },
  choice: { width: 42, height: 42, borderWidth: 1.5, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  swatch: { width: 24, height: 24, borderRadius: 12 },
  check: { position: 'absolute', color: '#fff', fontSize: 13, fontWeight: '900' },
})
