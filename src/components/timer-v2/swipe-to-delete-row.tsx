import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { PanResponder, Pressable, StyleSheet, Text, View } from 'react-native'
import Animated, { FadeOut, LinearTransition, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated'
import { useTheme } from '../../theme/ThemeContext'
import { selectionHaptic } from '../../lib/haptics'

const ACTION_WIDTH = 78
const REVEAL_WIDTH = ACTION_WIDTH + 10

let activeRow: { id: symbol; close: () => void } | null = null

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
  const rowId = useRef(Symbol('swipe-row'))
  const openRef = useRef(false)
  const gestureStartedOpenRef = useRef(false)
  const gestureStartRef = useRef(0)
  const widthRef = useRef(320)
  const [open, setOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const settle = (open: boolean) => {
    openRef.current = open
    setOpen(open)
    if (open) {
      if (activeRow && activeRow.id !== rowId.current) activeRow.close()
      activeRow = { id: rowId.current, close: () => settle(false) }
    } else if (activeRow?.id === rowId.current) {
      activeRow = null
    }
    translateX.value = withTiming(open ? -REVEAL_WIDTH : 0, { duration: reducedMotion ? 70 : 170 })
  }
  useEffect(() => () => {
    if (activeRow?.id === rowId.current) activeRow = null
  }, [])
  useEffect(() => {
    if (disabled && openRef.current) settle(false)
  }, [disabled])
  const panResponder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_event, gesture) => !disabled && Math.abs(gesture.dx) > 9 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.25,
    onPanResponderGrant: () => {
      gestureStartedOpenRef.current = openRef.current
      gestureStartRef.current = openRef.current ? -REVEAL_WIDTH : 0
    },
    onPanResponderMove: (_event, gesture) => {
      translateX.value = Math.max(-REVEAL_WIDTH, Math.min(0, gestureStartRef.current + gesture.dx))
    },
    onPanResponderRelease: (_event, gesture) => {
      if (gestureStartedOpenRef.current) {
        settle(!(gesture.dx > 12 || gesture.vx > 0.15 || translateX.value > -REVEAL_WIDTH * 0.85))
        return
      }
      settle(gesture.vx < -0.35 || translateX.value < -REVEAL_WIDTH * 0.48)
    },
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
    <View style={[styles.actionLayer, { backgroundColor: tokens.surface }]}>
      <Pressable onPress={remove} disabled={deleting} style={({ pressed }) => [styles.deleteButton, { backgroundColor: tokens.warmGlow, opacity: pressed ? 0.66 : 1 }]} accessibilityRole="button" accessibilityLabel={accessibilityLabel}>
        <Text style={[styles.deleteText, { color: tokens.warm }]}>Delete</Text>
      </Pressable>
    </View>
    <Animated.View style={[{ backgroundColor: tokens.surface }, rowStyle]} onTouchStart={() => {
      if (activeRow && activeRow.id !== rowId.current) activeRow.close()
    }} {...panResponder.panHandlers}>
      {children}
      {open ? <Pressable style={StyleSheet.absoluteFill} onPressIn={() => settle(false)} accessibilityRole="button" accessibilityLabel="Close delete action" /> : null}
    </Animated.View>
  </Animated.View>
}

const styles = StyleSheet.create({
  clip: { overflow: 'hidden' },
  actionLayer: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, alignItems: 'flex-end', justifyContent: 'center' },
  deleteButton: { width: ACTION_WIDTH, height: '100%', minHeight: 52, alignItems: 'center', justifyContent: 'center' },
  deleteText: { fontSize: 12, fontWeight: '700' },
})
