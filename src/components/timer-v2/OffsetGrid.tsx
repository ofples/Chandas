import { useMemo, useState } from 'react'
import { LayoutChangeEvent, Pressable, StyleSheet, Text, View } from 'react-native'
import { useReducedMotion } from 'react-native-reanimated'
import { useTheme } from '../../theme/ThemeContext'
import { selectionHaptic } from '../../lib/haptics'

const GAP = 8
const MIN_CELL = 52

interface Props {
  offsets: number[]
  selected: number[]
  onChange: (offsets: number[]) => void
}

/** A deterministic tap-to-toggle minute grid. It deliberately never captures scrolling gestures. */
export function OffsetGrid({ offsets, selected, onChange }: Props) {
  const { tokens } = useTheme()
  const reducedMotion = useReducedMotion()
  const [width, setWidth] = useState(0)
  const renderedSelection = useMemo(() => new Set(selected), [selected])

  const columns = Math.max(1, Math.floor((width + GAP) / (MIN_CELL + GAP)))
  const cellWidth = width > 0 ? (width - GAP * (columns - 1)) / columns : MIN_CELL
  const onLayout = (event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width)
  const toggle = (offset: number) => {
    const next = new Set(selected)
    if (next.has(offset)) next.delete(offset); else next.add(offset)
    selectionHaptic()
    onChange(offsets.filter(value => next.has(value)))
  }

  return (
    <View onLayout={onLayout} style={styles.grid} accessible={false}>
      {offsets.map(offset => {
        // Render from props so external Clear all / Select all / cadence changes
        // are visible immediately; the ref exists only for an in-flight paint.
        const active = renderedSelection.has(offset)
        return (
          <Pressable
            key={offset}
            style={({ pressed }) => [styles.cell, { width: cellWidth, height: 48, borderColor: active ? tokens.accent : tokens.border, backgroundColor: active ? tokens.accentGlow : 'transparent', opacity: pressed ? 0.78 : 1, transform: [{ scale: pressed && !reducedMotion ? 0.96 : 1 }] }]}
            accessible
            accessibilityRole="button"
            accessibilityLabel={`${offset} minutes after start, ${active ? 'selected' : 'not selected'}`}
            accessibilityState={{ selected: active }}
            onPress={() => toggle(offset)}
          >
            <Text style={[styles.minute, { color: active ? tokens.text : tokens.textMuted }]}>{offset}m</Text>
            <Text style={[styles.status, { color: tokens.textDisabled }]}>{active ? 'on' : 'off'}</Text>
          </Pressable>
        )
      })}
    </View>
  )
}

const styles = StyleSheet.create({
  grid: { width: '100%', flexDirection: 'row', flexWrap: 'wrap', gap: GAP },
  cell: { borderWidth: 1.5, borderRadius: 10, justifyContent: 'center', alignItems: 'center', gap: 2 },
  minute: { fontFamily: 'JetBrainsMono-Regular', fontSize: 12 },
  status: { fontSize: 8, fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase' },
})
