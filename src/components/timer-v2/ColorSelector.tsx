import { useAppReducedMotion } from '../../theme/ThemeContext'
import { useState, type ReactNode } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { selectionHaptic } from '../../lib/haptics'
import Animated, { FadeIn, LinearTransition } from 'react-native-reanimated'
import type { SubBellColorId } from '../../types'
import { SUB_BELL_COLORS, subBellColorValue } from '../../lib/subBellColors'
import { useTheme } from '../../theme/ThemeContext'
import { FadedHorizontalScrollView } from './FadedHorizontalScrollView'

interface Props {
  value: SubBellColorId
  onChange: (value: SubBellColorId) => void
  label?: string
  detail?: string
  trailing?: ReactNode
  accessibilityLabel?: string
}

/** Collapsed color swatch that expands its shared one-line palette in place. */
export function ColorSelector({ value, onChange, label = 'Color', detail, trailing, accessibilityLabel = 'Color' }: Props) {
  const { tokens, theme } = useTheme()
  const eink = theme === 'eink'
  const reducedMotion = useAppReducedMotion()
  const [expanded, setExpanded] = useState(false)
  const current = SUB_BELL_COLORS.find(option => option.id === value) ?? SUB_BELL_COLORS[0]
  return <Animated.View layout={reducedMotion ? undefined : LinearTransition.duration(170)} style={styles.block}>
    <View style={styles.summary}>
      <Pressable onPress={() => { setExpanded(open => !open); selectionHaptic() }} style={styles.summaryButton} accessibilityRole="button" accessibilityLabel={`${accessibilityLabel}, ${current.label}`} accessibilityState={{ expanded }}>
        {label ? <View style={styles.copy}><Text style={[styles.label, { color: tokens.text }]}>{label}</Text>{detail ? <Text numberOfLines={1} style={[styles.detail, { color: tokens.textMuted }]}>{detail}</Text> : null}</View> : <View style={styles.copy} />}
        <View style={[styles.currentChoice, { borderColor: eink ? tokens.border : expanded ? current.value : tokens.border }]}><View style={[styles.currentSwatch, { backgroundColor: eink ? subBellColorValue(current.id, 0, true) : current.value }]} /></View>
      </Pressable>
      {trailing}
    </View>
    {expanded ? <Animated.View entering={reducedMotion ? undefined : FadeIn.duration(130)}>
      <FadedHorizontalScrollView fadeColor={tokens.surface} selectedIndex={SUB_BELL_COLORS.findIndex(option => option.id === value)} itemCount={SUB_BELL_COLORS.length} selectionKey={`${expanded}:${value}`} contentContainerStyle={styles.rail} accessibilityRole="radiogroup" accessibilityLabel={accessibilityLabel}>
      {SUB_BELL_COLORS.map(option => {
        const selected = value === option.id
        const swatchColor = eink ? subBellColorValue(option.id, 0, true) : option.value
        const checkColor = eink && Number.parseInt(swatchColor.slice(1, 3), 16) >= 128 ? tokens.text : '#fff'
        return <Pressable key={option.id} onPress={() => { onChange(option.id); selectionHaptic() }} accessibilityRole="radio" accessibilityLabel={option.label} accessibilityState={{ selected }} style={({ pressed }) => [styles.choice, { borderColor: eink ? tokens.border : selected ? option.value : 'transparent', backgroundColor: eink && selected ? tokens.surfaceHi : 'transparent', opacity: pressed && !eink ? 0.72 : 1, transform: [{ scale: pressed && !reducedMotion ? 0.92 : 1 }] }]}>
          <View style={[styles.swatch, { backgroundColor: swatchColor }]} />
          {selected ? <Text style={[styles.check, { color: checkColor }]}>✓</Text> : null}
        </Pressable>
      })}
      </FadedHorizontalScrollView>
    </Animated.View> : null}
  </Animated.View>
}

const styles = StyleSheet.create({
  block: { gap: 9, overflow: 'hidden' },
  summary: { minHeight: 46, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  summaryButton: { flex: 1, minWidth: 0, minHeight: 46, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  copy: { flex: 1, minWidth: 0, gap: 3 },
  label: { fontSize: 14, fontWeight: '700' },
  detail: { fontSize: 12, lineHeight: 17 },
  currentChoice: { width: 36, height: 36, borderWidth: 1.5, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  currentSwatch: { width: 22, height: 22, borderRadius: 11 },
  rail: { gap: 8, paddingRight: 20, paddingVertical: 2 },
  choice: { width: 42, height: 42, borderWidth: 1.5, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  swatch: { width: 24, height: 24, borderRadius: 12 },
  check: { position: 'absolute', color: '#fff', fontSize: 13, fontWeight: '900' },
})
