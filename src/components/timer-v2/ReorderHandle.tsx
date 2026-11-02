import { useEffect, useMemo, useRef } from 'react'
import { PanResponder, StyleSheet, Text } from 'react-native'
import { mediumHaptic, selectionHaptic, tapHaptic } from '../../lib/haptics'
import Animated, { useAnimatedStyle, useSharedValue, type SharedValue } from 'react-native-reanimated'
import { useTheme } from '../../theme/ThemeContext'

interface Props {
  index: number
  itemCount: number
  rowHeight?: number
  onMove: (from: number, to: number) => void
  onPreviewChange?: (from: number, to: number, rowHeight: number) => void
  onPreviewEnd?: () => void
  label: string
  /** When supplied, the caller applies this value to the whole row. */
  rowTranslation?: SharedValue<number>
  onDragStateChange?: (dragging: boolean) => void
  /** Programmatically scrolls the containing list and returns the applied delta. */
  onAutoScroll?: (pageY: number, canMoveEarlier: boolean, canMoveLater: boolean) => number
}

/**
 * Dedicated immediate drag target with insertion previews and accessible movement.
 * The rest of the card/page remains available to the surrounding ScrollView.
 */
export function ReorderHandle({ index, itemCount, rowHeight = 72, onMove, onPreviewChange, onPreviewEnd, label, rowTranslation, onDragStateChange, onAutoScroll }: Props) {
  const { tokens } = useTheme()
  const internalTranslation = useSharedValue(0)
  const translation = rowTranslation ?? internalTranslation
  const originRef = useRef(index)
  const latestTargetRef = useRef(index)
  const latestGestureDyRef = useRef(0)
  const latestPageYRef = useRef<number | null>(null)
  const accumulatedScrollRef = useRef(0)
  const autoScrollFrameRef = useRef<number | null>(null)
  const gestureActiveRef = useRef(false)

  const stopAutoScroll = () => {
    if (autoScrollFrameRef.current !== null) cancelAnimationFrame(autoScrollFrameRef.current)
    autoScrollFrameRef.current = null
  }

  const updateDragPosition = () => {
    const minimum = -originRef.current * rowHeight
    const maximum = (itemCount - 1 - originRef.current) * rowHeight
    const requested = latestGestureDyRef.current + accumulatedScrollRef.current
    const boundedDy = Math.max(minimum, Math.min(maximum, requested))
    translation.value = boundedDy
    const target = Math.max(0, Math.min(itemCount - 1, originRef.current + Math.round(boundedDy / rowHeight)))
    if (target !== latestTargetRef.current) {
      latestTargetRef.current = target
      onPreviewChange?.(originRef.current, target, rowHeight)
      selectionHaptic()
    }
  }

  const startAutoScroll = () => {
    if (!onAutoScroll || autoScrollFrameRef.current !== null) return
    const tick = () => {
      const pageY = latestPageYRef.current
      if (pageY !== null) {
        const applied = onAutoScroll(pageY, latestTargetRef.current > 0, latestTargetRef.current < itemCount - 1)
        if (applied !== 0) {
          accumulatedScrollRef.current += applied
          updateDragPosition()
        }
      }
      autoScrollFrameRef.current = requestAnimationFrame(tick)
    }
    autoScrollFrameRef.current = requestAnimationFrame(tick)
  }

  const finishDrag = (commit: boolean) => {
    if (!gestureActiveRef.current) return
    gestureActiveRef.current = false
    stopAutoScroll()
    const origin = originRef.current
    const target = latestTargetRef.current
    const moved = commit && target !== origin
    // Commit on release. Keep the parent-owned translation at the destination
    // through the data commit; the card ignores it after preview ends. Resetting
    // it in this event would briefly put the row back in its old slot.
    translation.value = moved && rowTranslation ? (target - origin) * rowHeight : 0
    if (!moved) onPreviewChange?.(origin, origin, rowHeight)
    if (moved) { onMove(origin, target); tapHaptic() }
    onPreviewEnd?.()
    onDragStateChange?.(false)
  }

  const responder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => itemCount > 1,
    onStartShouldSetPanResponderCapture: () => itemCount > 1,
    onPanResponderGrant: (_, gesture) => {
      originRef.current = index
      latestTargetRef.current = index
      latestGestureDyRef.current = 0
      latestPageYRef.current = gesture.moveY || null
      accumulatedScrollRef.current = 0
      gestureActiveRef.current = true
      translation.value = 0
      onPreviewChange?.(index, index, rowHeight)
      onDragStateChange?.(true)
      startAutoScroll()
      mediumHaptic()
    },
    onPanResponderMove: (_, gesture) => {
      latestGestureDyRef.current = gesture.dy
      latestPageYRef.current = gesture.moveY || null
      updateDragPosition()
    },
    onPanResponderRelease: () => finishDrag(true),
    onPanResponderTerminate: () => finishDrag(false),
    onPanResponderTerminationRequest: () => false,
    onShouldBlockNativeResponder: () => true,
  }), [index, itemCount, onAutoScroll, onDragStateChange, onMove, onPreviewChange, onPreviewEnd, rowHeight, translation])

  useEffect(() => () => stopAutoScroll(), [])

  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ translateY: rowTranslation ? 0 : translation.value }] }))

  const adjust = (direction: 'increment' | 'decrement') => {
    const target = Math.max(0, Math.min(itemCount - 1, index + (direction === 'increment' ? 1 : -1)))
    if (target !== index) {
      selectionHaptic()
      onMove(index, target)
    }
  }

  return (
    <Animated.View
      {...responder.panHandlers}
      style={[styles.handle, animatedStyle, { backgroundColor: tokens.surfaceHi }]}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={label}
      accessibilityHint="Drag this handle to reorder. Swipe elsewhere on the card to scroll."
      accessibilityValue={{ text: `${index + 1} of ${itemCount}` }}
      accessibilityActions={[{ name: 'increment', label: 'Move later' }, { name: 'decrement', label: 'Move earlier' }]}
      onAccessibilityAction={event => adjust(event.nativeEvent.actionName as 'increment' | 'decrement')}
    >
      <Text selectable={false} style={[styles.glyph, { color: tokens.textMuted }]}>⠿</Text>
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  handle: { width: 44, height: 44, borderRadius: 11, alignItems: 'center', justifyContent: 'center', zIndex: 10 },
  glyph: { fontSize: 20, lineHeight: 21 },
})
