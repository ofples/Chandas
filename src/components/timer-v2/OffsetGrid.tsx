import { useEffect, useMemo, useRef, useState } from 'react'
import { LayoutChangeEvent, StyleSheet, Text, View } from 'react-native'
import * as Haptics from 'expo-haptics'
import { useTheme } from '../../theme/ThemeContext'

const GAP = 8
const MIN_CELL = 52

interface Props {
  offsets: number[]
  selected: number[]
  onChange: (offsets: number[]) => void
  conflicts?: ReadonlyMap<number, { winner: string; isWinner: boolean }>
}

/** Tap or paint over a deterministic minute grid; the initial cell decides select vs clear. */
export function OffsetGrid({ offsets, selected, onChange, conflicts = new Map() }: Props) {
  const { tokens } = useTheme()
  const [width, setWidth] = useState(0)
  const selectionRef = useRef(new Set(selected))
  const paintRef = useRef<{ selecting: boolean; last?: number } | null>(null)
  useEffect(() => { selectionRef.current = new Set(selected) }, [selected])

  const columns = Math.max(1, Math.floor((width + GAP) / (MIN_CELL + GAP)))
  const cellWidth = width > 0 ? (width - GAP * (columns - 1)) / columns : MIN_CELL
  const cellHeight = 48

  const offsetAt = (x: number, y: number): number | undefined => {
    if (x < 0 || y < 0 || width <= 0) return undefined
    const column = Math.floor(x / (cellWidth + GAP))
    const row = Math.floor(y / (cellHeight + GAP))
    if (column >= columns || x - column * (cellWidth + GAP) > cellWidth || y - row * (cellHeight + GAP) > cellHeight) return undefined
    return offsets[row * columns + column]
  }

  const paint = (offset: number | undefined) => {
    const paintState = paintRef.current
    if (offset === undefined || !paintState || paintState.last === offset) return
    paintState.last = offset
    const next = new Set(selectionRef.current)
    if (paintState.selecting) next.add(offset)
    else next.delete(offset)
    selectionRef.current = next
    onChange(offsets.filter(value => next.has(value)))
    void Haptics.selectionAsync().catch(() => undefined)
  }

  const handlers = useMemo(() => ({
    onStartShouldSetResponder: () => true,
    onMoveShouldSetResponder: () => true,
    onResponderGrant: (event: { nativeEvent: { locationX: number; locationY: number } }) => {
      const offset = offsetAt(event.nativeEvent.locationX, event.nativeEvent.locationY)
      paintRef.current = { selecting: offset === undefined ? true : !selectionRef.current.has(offset) }
      paint(offset)
    },
    onResponderMove: (event: { nativeEvent: { locationX: number; locationY: number } }) => paint(offsetAt(event.nativeEvent.locationX, event.nativeEvent.locationY)),
    onResponderRelease: () => { paintRef.current = null },
    onResponderTerminate: () => { paintRef.current = null },
    onResponderTerminationRequest: () => false,
  // Geometry deliberately rebuilds the responder map after layout changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [cellWidth, columns, offsets, width])

  const onLayout = (event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width)
  const toggleAccessible = (offset: number) => {
    const next = new Set(selectionRef.current)
    if (next.has(offset)) next.delete(offset); else next.add(offset)
    selectionRef.current = next
    onChange(offsets.filter(value => next.has(value)))
  }

  return (
    <View onLayout={onLayout} {...handlers} style={styles.grid} accessibilityLabel="Cue positions. Tap or drag to select.">
      {offsets.map(offset => {
        const active = selectionRef.current.has(offset)
        const conflict = conflicts.get(offset)
        return (
          <View
            key={offset}
            style={[styles.cell, { width: cellWidth, height: cellHeight, borderColor: active ? tokens.accent : tokens.border, backgroundColor: active ? tokens.accentGlow : 'transparent' }]}
            accessible
            accessibilityRole="button"
            accessibilityLabel={`${offset} minutes after start${conflict ? `, overlap, ${conflict.isWinner ? 'wins' : `loses to ${conflict.winner}`}` : ''}`}
            accessibilityState={{ selected: active }}
            onAccessibilityTap={() => toggleAccessible(offset)}
          >
            <Text style={[styles.minute, { color: active ? tokens.text : tokens.textMuted }]}>{offset}m</Text>
            <Text style={[styles.status, { color: conflict ? tokens.accent : tokens.textDisabled }]}>{conflict ? conflict.isWinner ? 'wins' : 'overlap' : active ? 'on' : 'off'}</Text>
          </View>
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
