import { useEffect, useMemo, useRef, useState } from 'react'
import { LayoutChangeEvent, PanResponder, Pressable, StyleSheet, Text, View } from 'react-native'
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
  const offsetsRef = useRef(offsets)
  const onChangeRef = useRef(onChange)
  const paintRef = useRef<{ selecting?: boolean; last?: number } | null>(null)
  offsetsRef.current = offsets
  onChangeRef.current = onChange
  useEffect(() => { selectionRef.current = new Set(selected) }, [selected])
  const renderedSelection = useMemo(() => new Set(selected), [selected])

  const columns = Math.max(1, Math.floor((width + GAP) / (MIN_CELL + GAP)))
  const cellWidth = width > 0 ? (width - GAP * (columns - 1)) / columns : MIN_CELL
  const cellHeight = 48
  const offsetsKey = offsets.join(',')

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
    if (paintState.selecting === undefined) paintState.selecting = !selectionRef.current.has(offset)
    const next = new Set(selectionRef.current)
    if (paintState.selecting) next.add(offset)
    else next.delete(offset)
    selectionRef.current = next
    onChangeRef.current(offsetsRef.current.filter(value => next.has(value)))
    void Haptics.selectionAsync().catch(() => undefined)
  }

  const responder = useMemo(() => PanResponder.create({
    // Vertical swipes remain available to the sheet for long (up to 239-cell)
    // grids. Deliberate horizontal/diagonal movement enters paint mode.
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dx) > 5 && Math.abs(gesture.dx) >= Math.abs(gesture.dy) * 0.65,
    onPanResponderGrant: (event: { nativeEvent: { locationX: number; locationY: number } }) => {
      const offset = offsetAt(event.nativeEvent.locationX, event.nativeEvent.locationY)
      paintRef.current = {}
      paint(offset)
    },
    onPanResponderMove: (event: { nativeEvent: { locationX: number; locationY: number } }) => paint(offsetAt(event.nativeEvent.locationX, event.nativeEvent.locationY)),
    onPanResponderRelease: () => { paintRef.current = null },
    onPanResponderTerminate: () => { paintRef.current = null },
  // Geometry deliberately rebuilds the responder map after layout changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [cellWidth, columns, offsetsKey, width])

  const onLayout = (event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width)
  const toggleAccessible = (offset: number) => {
    const next = new Set(selectionRef.current)
    if (next.has(offset)) next.delete(offset); else next.add(offset)
    selectionRef.current = next
    onChangeRef.current(offsetsRef.current.filter(value => next.has(value)))
  }

  return (
    <View onLayout={onLayout} {...responder.panHandlers} style={styles.grid} accessible={false}>
      {offsets.map(offset => {
        // Render from props so external Clear all / Select all / cadence changes
        // are visible immediately; the ref exists only for an in-flight paint.
        const active = renderedSelection.has(offset)
        const conflict = conflicts.get(offset)
        return (
          <Pressable
            key={offset}
            style={[styles.cell, { width: cellWidth, height: cellHeight, borderColor: active ? tokens.accent : tokens.border, backgroundColor: active && (!conflict || conflict.isWinner) ? tokens.accentGlow : 'transparent' }]}
            accessible
            accessibilityRole="button"
            accessibilityLabel={`${offset} minutes after start${conflict ? `, overlap, ${conflict.isWinner ? 'wins' : `loses to ${conflict.winner}`}` : ''}`}
            accessibilityState={{ selected: active }}
            onPress={() => { toggleAccessible(offset); void Haptics.selectionAsync().catch(() => undefined) }}
          >
            <Text style={[styles.minute, { color: active ? tokens.text : tokens.textMuted }]}>{offset}m</Text>
            <Text style={[styles.status, { color: conflict ? tokens.accent : tokens.textDisabled }]}>{conflict ? conflict.isWinner ? 'wins' : 'overlap' : active ? 'on' : 'off'}</Text>
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
