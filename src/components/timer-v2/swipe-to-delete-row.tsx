import { useMemo, useRef, useState, type ReactNode } from 'react'
import { PanResponder, Pressable, StyleSheet, View } from 'react-native'
import Animated, { FadeOut, LinearTransition, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated'
import { TrashIcon } from '../Icons'
import { useTheme } from '../../theme/ThemeContext'
import { selectionHaptic } from '../../lib/haptics'

const ACTION_WIDTH = 68

interface Props {
  children: ReactNode
  onDelete: () => void
  accessibilityLabel: string
  disabled?: boolean
}

/** A scroll-friendly list row that reveals one destructive action with a left swipe. */
export function SwipeToDeleteRow({ children, onDelete, accessibilityLabel, disabled = false }: Props) {
  const { tokens } = useTheme()
  const reducedMotion = useReducedMotion()
  const translateX = useSharedValue(0)
  const opacity = useSharedValue(1)
  const openRef = useRef(false)
  const gestureStartRef = useRef(0)
  const widthRef = useRef(320)
  const [deleting, setDeleting] = useState(false)

  const settle = (open: boolean) => {
    openRef.current = open
    translateX.value = withTiming(open ? -ACTION_WIDTH : 0, { duration: reducedMotion ? 70 : 170 })
  }
  const panResponder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_event, gesture) => !disabled && Math.abs(gesture.dx) > 9 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.25,
    onPanResponderGrant: () => { gestureStartRef.current = openRef.current ? -ACTION_WIDTH : 0 },
    onPanResponderMove: (_event, gesture) => {
      translateX.value = Math.max(-ACTION_WIDTH, Math.min(0, gestureStartRef.current + gesture.dx))
    },
    onPanResponderRelease: (_event, gesture) => settle(gesture.vx < -0.35 || translateX.value < -ACTION_WIDTH * 0.48),
    onPanResponderTerminate: () => settle(openRef.current),
  }), [disabled, reducedMotion])

  const rowStyle = useAnimatedStyle(() => ({ opacity: opacity.value, transform: [{ translateX: translateX.value }] }))
  const remove = () => {
    if (deleting) return
    setDeleting(true)
    selectionHaptic()
    opacity.value = withTiming(0, { duration: reducedMotion ? 60 : 140 })
    translateX.value = withTiming(-widthRef.current, { duration: reducedMotion ? 70 : 180 })
    setTimeout(onDelete, reducedMotion ? 70 : 170)
  }

  if (disabled) return <>{children}</>
  return <Animated.View
    layout={reducedMotion ? undefined : LinearTransition.duration(170)}
    exiting={FadeOut.duration(reducedMotion ? 60 : 130)}
    onLayout={event => { widthRef.current = event.nativeEvent.layout.width }}
    style={styles.clip}
  >
    <View style={styles.actionLayer}>
      <Pressable onPress={remove} disabled={deleting} style={({ pressed }) => [styles.deleteButton, { backgroundColor: tokens.warm, opacity: pressed ? 0.72 : 1 }]} accessibilityRole="button" accessibilityLabel={accessibilityLabel}>
        <TrashIcon color="#fff" />
      </Pressable>
    </View>
    <Animated.View style={[{ backgroundColor: tokens.surface }, rowStyle]} {...panResponder.panHandlers}>{children}</Animated.View>
  </Animated.View>
}

const styles = StyleSheet.create({
  clip: { overflow: 'hidden' },
  actionLayer: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, alignItems: 'flex-end', justifyContent: 'center' },
  deleteButton: { width: ACTION_WIDTH, height: '100%', minHeight: 52, alignItems: 'center', justifyContent: 'center' },
})
