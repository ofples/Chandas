import { useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import * as Haptics from 'expo-haptics'
import Animated, { FadeInDown, FadeOut, LinearTransition, useReducedMotion } from 'react-native-reanimated'
import type { SubBellColorId } from '../../types'
import { SUB_BELL_COLORS } from '../../lib/subBellColors'
import { useTheme } from '../../theme/ThemeContext'

interface Props {
  value: SubBellColorId
  onChange: (value: SubBellColorId) => void
  label?: string
  accessibilityLabel?: string
}

/** Collapsed color swatch that expands its shared one-line palette in place. */
export function ColorSelector({ value, onChange, label = 'Color', accessibilityLabel = 'Color' }: Props) {
  const { tokens } = useTheme()
  const reducedMotion = useReducedMotion()
  const [expanded, setExpanded] = useState(false)
  const current = SUB_BELL_COLORS.find(option => option.id === value) ?? SUB_BELL_COLORS[0]
  return <Animated.View layout={reducedMotion ? undefined : LinearTransition.duration(170)} style={styles.block}>
    <Pressable onPress={() => { setExpanded(open => !open); void Haptics.selectionAsync().catch(() => undefined) }} style={styles.summary} accessibilityRole="button" accessibilityLabel={`${accessibilityLabel}, ${current.label}`} accessibilityState={{ expanded }}>
      {label ? <Text style={[styles.label, { color: tokens.text }]}>{label}</Text> : <View />}
      <View style={[styles.currentChoice, { borderColor: expanded ? current.value : tokens.border }]}><View style={[styles.currentSwatch, { backgroundColor: current.value }]} /></View>
    </Pressable>
    {expanded ? <Animated.View entering={FadeInDown.duration(reducedMotion ? 70 : 150)} exiting={FadeOut.duration(reducedMotion ? 60 : 100)}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.rail} accessibilityRole="radiogroup" accessibilityLabel={accessibilityLabel}>
      {SUB_BELL_COLORS.map(option => {
        const selected = value === option.id
        return <Pressable key={option.id} onPress={() => { onChange(option.id); void Haptics.selectionAsync().catch(() => undefined) }} accessibilityRole="radio" accessibilityLabel={option.label} accessibilityState={{ selected }} style={({ pressed }) => [styles.choice, { borderColor: selected ? option.value : 'transparent', opacity: pressed ? 0.72 : 1, transform: [{ scale: pressed && !reducedMotion ? 0.92 : 1 }] }]}>
          <View style={[styles.swatch, { backgroundColor: option.value }]} />
          {selected ? <Text style={styles.check}>✓</Text> : null}
        </Pressable>
      })}
      </ScrollView>
    </Animated.View> : null}
  </Animated.View>
}

const styles = StyleSheet.create({
  block: { gap: 9 },
  summary: { minHeight: 46, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  label: { fontSize: 14, fontWeight: '700' },
  currentChoice: { width: 36, height: 36, borderWidth: 1.5, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  currentSwatch: { width: 22, height: 22, borderRadius: 11 },
  rail: { gap: 8, paddingRight: 20, paddingVertical: 2 },
  choice: { width: 42, height: 42, borderWidth: 1.5, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  swatch: { width: 24, height: 24, borderRadius: 12 },
  check: { position: 'absolute', color: '#fff', fontSize: 13, fontWeight: '900' },
})
