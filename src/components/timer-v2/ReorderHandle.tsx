import { useEffect, useMemo, useRef } from 'react'
import { PanResponder, StyleSheet, Text } from 'react-native'
import * as Haptics from 'expo-haptics'
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated'
import { useTheme } from '../../theme/ThemeContext'
import { reorderGestureIntent } from '../../lib/reorder-preview'

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
 * Delayed drag handle with insertion previews and an accessible increment/decrement fallback.
 * A swipe before the hold delay is deliberately left to the surrounding ScrollView.
 */
export function ReorderHandle({ index, itemCount, rowHeight = 72, onMove, onPreviewChange, onPreviewEnd, label, rowTranslation, onDragStateChange, onAutoScroll }: Props) {
  const { tokens } = useTheme()
  const reducedMotion = useReducedMotion()
  const internalTranslation = useSharedValue(0)
  const translation = rowTranslation ?? internalTranslation
  const originRef = useRef(index)
  const latestTargetRef = useRef(index)
  const pressStartedAtRef = useRef(0)
  const scrollGestureRef = useRef(false)
  const latestGestureDyRef = useRef(0)
  const latestPageYRef = useRef<number | null>(null)
  const accumulatedScrollRef = useRef(0)
  const autoScrollFrameRef = useRef<number | null>(null)

  const stopAutoScroll = () => {
    if (autoScrollFrameRef.current !== null) cancelAnimationFrame(autoScrollFrameRef.current)
    autoScrollFrameRef.current = null
  }

  const clearPress = () => {
    pressStartedAtRef.current = 0
    scrollGestureRef.current = false
  }

  const beginPress = () => {
    pressStartedAtRef.current = Date.now()
    scrollGestureRef.current = false
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
      void Haptics.selectionAsync().catch(() => undefined)
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

  const shouldActivate = (_: unknown, gesture: { dx: number; dy: number }) => {
    if (pressStartedAtRef.current === 0) beginPress()
    const distance = Math.hypot(gesture.dx, gesture.dy)
    const intent = reorderGestureIntent(Date.now() - pressStartedAtRef.current, distance, scrollGestureRef.current, itemCount)
    if (intent === 'scroll') scrollGestureRef.current = true
    return intent === 'drag'
  }

  const finishDrag = (commit: boolean) => {
    stopAutoScroll()
    const origin = originRef.current
    const target = latestTargetRef.current
    translation.value = reducedMotion ? 0 : withTiming(0, { duration: 110 })
    onPreviewEnd?.()
    onDragStateChange?.(false)
    clearPress()
    if (commit && target !== origin) {
      onMove(origin, target)
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined)
    }
  }

  const responder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => { beginPress(); return false },
    onStartShouldSetPanResponderCapture: () => { beginPress(); return false },
    onMoveShouldSetPanResponder: shouldActivate,
    onMoveShouldSetPanResponderCapture: shouldActivate,
    onPanResponderGrant: (_, gesture) => {
      originRef.current = index
      latestTargetRef.current = index
      latestGestureDyRef.current = 0
      latestPageYRef.current = gesture.moveY || null
      accumulatedScrollRef.current = 0
      translation.value = 0
      onPreviewChange?.(index, index, rowHeight)
      onDragStateChange?.(true)
      startAutoScroll()
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined)
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
  }), [index, itemCount, onAutoScroll, onDragStateChange, onMove, onPreviewChange, onPreviewEnd, reducedMotion, rowHeight, translation])

  useEffect(() => () => stopAutoScroll(), [])

  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ translateY: rowTranslation ? 0 : translation.value }] }))

  const adjust = (direction: 'increment' | 'decrement') => {
    const target = Math.max(0, Math.min(itemCount - 1, index + (direction === 'increment' ? 1 : -1)))
    if (target !== index) {
      void Haptics.selectionAsync().catch(() => undefined)
      onMove(index, target)
    }
  }

  return (
    <Animated.View
      {...responder.panHandlers}
      onTouchStart={beginPress}
      onTouchEnd={clearPress}
      onTouchCancel={clearPress}
      style={[styles.handle, animatedStyle, { backgroundColor: tokens.surfaceHi }]}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={label}
      accessibilityHint="Touch and hold, then drag. Swipe the page normally to scroll."
      accessibilityValue={{ text: `${index + 1} of ${itemCount}` }}
      accessibilityActions={[{ name: 'increment', label: 'Move later' }, { name: 'decrement', label: 'Move earlier' }]}
      onAccessibilityAction={event => adjust(event.nativeEvent.actionName as 'increment' | 'decrement')}
    >
      <Text style={[styles.glyph, { color: tokens.textMuted }]}>⠿</Text>
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  handle: { width: 44, height: 44, borderRadius: 11, alignItems: 'center', justifyContent: 'center', zIndex: 10 },
  glyph: { fontSize: 20, lineHeight: 21 },
})
