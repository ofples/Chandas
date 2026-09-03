import { useMemo, useRef } from 'react'
import { Animated, PanResponder, StyleSheet, Text } from 'react-native'
import * as Haptics from 'expo-haptics'
import { useTheme } from '../../theme/ThemeContext'

interface Props {
  index: number
  itemCount: number
  rowHeight?: number
  onMove: (from: number, to: number) => void
  label: string
}

/** Drag handle that can cross several fixed-height rows, with an accessible increment/decrement fallback. */
export function ReorderHandle({ index, itemCount, rowHeight = 72, onMove, label }: Props) {
  const { tokens } = useTheme()
  const translation = useRef(new Animated.Value(0)).current
  const originRef = useRef(index)
  const latestTargetRef = useRef(index)
  const responder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => itemCount > 1,
    onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dy) > 4,
    onPanResponderGrant: () => {
      originRef.current = index
      latestTargetRef.current = index
      translation.setValue(0)
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined)
    },
    onPanResponderMove: (_, gesture) => {
      translation.setValue(gesture.dy)
      const target = Math.max(0, Math.min(itemCount - 1, originRef.current + Math.round(gesture.dy / rowHeight)))
      if (target !== latestTargetRef.current) {
        latestTargetRef.current = target
        void Haptics.selectionAsync().catch(() => undefined)
      }
    },
    onPanResponderRelease: () => {
      const target = latestTargetRef.current
      Animated.spring(translation, { toValue: 0, useNativeDriver: true, speed: 24, bounciness: 4 }).start()
      if (target !== originRef.current) onMove(originRef.current, target)
    },
    onPanResponderTerminate: () => Animated.spring(translation, { toValue: 0, useNativeDriver: true }).start(),
  }), [index, itemCount, onMove, rowHeight, translation])

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
      style={[styles.handle, { transform: [{ translateY: translation }], backgroundColor: tokens.surfaceHi }]}
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
  handle: { width: 34, height: 38, borderRadius: 10, alignItems: 'center', justifyContent: 'center', zIndex: 10 },
  glyph: { fontSize: 20, lineHeight: 21 },
})
