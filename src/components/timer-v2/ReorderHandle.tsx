import { useMemo, useRef } from 'react'
import { Animated, PanResponder, StyleSheet, Text } from 'react-native'
import * as Haptics from 'expo-haptics'
import { useReducedMotion } from 'react-native-reanimated'
import { useTheme } from '../../theme/ThemeContext'

interface Props {
  index: number
  itemCount: number
  rowHeight?: number
  onMove: (from: number, to: number) => void
  label: string
  /** When supplied, the caller applies this value to the whole row. */
  rowTranslation?: Animated.Value
  onDragStateChange?: (dragging: boolean) => void
}

/** Drag handle that can cross several fixed-height rows, with an accessible increment/decrement fallback. */
export function ReorderHandle({ index, itemCount, rowHeight = 72, onMove, label, rowTranslation, onDragStateChange }: Props) {
  const { tokens } = useTheme()
  const reducedMotion = useReducedMotion()
  const internalTranslation = useRef(new Animated.Value(0)).current
  const translation = rowTranslation ?? internalTranslation
  const originRef = useRef(index)
  const latestTargetRef = useRef(index)
  const responder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => itemCount > 1,
    onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dy) > 4,
    onPanResponderGrant: () => {
      originRef.current = index
      latestTargetRef.current = index
      translation.setValue(0)
      onDragStateChange?.(true)
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined)
    },
    onPanResponderMove: (_, gesture) => {
      const minimum = -originRef.current * rowHeight
      const maximum = (itemCount - 1 - originRef.current) * rowHeight
      const boundedDy = Math.max(minimum, Math.min(maximum, gesture.dy))
      translation.setValue(boundedDy)
      const target = Math.max(0, Math.min(itemCount - 1, originRef.current + Math.round(boundedDy / rowHeight)))
      if (target !== latestTargetRef.current) {
        latestTargetRef.current = target
        void Haptics.selectionAsync().catch(() => undefined)
      }
    },
    onPanResponderRelease: () => {
      const target = latestTargetRef.current
      translation.setValue(0)
      if (target !== originRef.current) {
        onMove(originRef.current, target)
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined)
      }
      onDragStateChange?.(false)
    },
    onPanResponderTerminate: () => {
      if (reducedMotion) translation.setValue(0)
      else Animated.spring(translation, { toValue: 0, useNativeDriver: true }).start()
      onDragStateChange?.(false)
    },
  }), [index, itemCount, onDragStateChange, onMove, reducedMotion, rowHeight, translation])

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
      style={[styles.handle, !rowTranslation && { transform: [{ translateY: translation }] }, { backgroundColor: tokens.surfaceHi }]}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={label}
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
