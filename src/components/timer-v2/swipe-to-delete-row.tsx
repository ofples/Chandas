import { useAppReducedMotion } from '../../theme/ThemeContext'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Animated, { FadeOut, LinearTransition, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated'
import { scheduleOnRN } from 'react-native-worklets'
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
  const reducedMotion = useAppReducedMotion()
  const translateX = useSharedValue(0)
  const opacity = useSharedValue(1)
  const openValue = useSharedValue(false)
  const gestureStart = useSharedValue(0)
  const rowId = useRef(Symbol('swipe-row'))
  const openRef = useRef(false)
  const widthRef = useRef(320)
  const [open, setOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const settle = (open: boolean) => {
    openRef.current = open
    openValue.value = open
    setOpen(open)
    if (open) {
      if (activeRow && activeRow.id !== rowId.current) activeRow.close()
      activeRow = { id: rowId.current, close: () => settle(false) }
    } else if (activeRow?.id === rowId.current) {
      activeRow = null
    }
    translateX.value = reducedMotion ? (open ? -REVEAL_WIDTH : 0) : withTiming(open ? -REVEAL_WIDTH : 0, { duration: 170 })
  }
  useEffect(() => () => {
    if (activeRow?.id === rowId.current) activeRow = null
  }, [])
  useEffect(() => {
    if (disabled && openRef.current) settle(false)
  }, [disabled])
  const panGesture = useMemo(() => Gesture.Pan()
    .enabled(!disabled)
    .activeOffsetX([-9, 9])
    .failOffsetY([-12, 12])
    .onStart(() => {
      gestureStart.value = openValue.value ? -REVEAL_WIDTH : 0
    })
    .onUpdate(event => {
      translateX.value = Math.max(-REVEAL_WIDTH, Math.min(0, gestureStart.value + event.translationX))
    })
    .onEnd(event => {
      const startedOpen = gestureStart.value < 0
      const shouldOpen = startedOpen
        ? !(event.translationX > 12 || event.velocityX > 150 || translateX.value > -REVEAL_WIDTH * 0.85)
        : event.velocityX < -350 || translateX.value < -REVEAL_WIDTH * 0.48
      scheduleOnRN(settle, shouldOpen)
    })
    .onFinalize((_event, success) => {
      if (!success) translateX.value = reducedMotion ? (openValue.value ? -REVEAL_WIDTH : 0) : withTiming(openValue.value ? -REVEAL_WIDTH : 0, { duration: 170 })
    }), [disabled, reducedMotion])

  const rowStyle = useAnimatedStyle(() => ({ opacity: opacity.value, transform: [{ translateX: translateX.value }] }))
  const remove = () => {
    if (deleting) return
    setDeleting(true)
    selectionHaptic()
    opacity.value = reducedMotion ? 0 : withTiming(0, { duration: 140 })
    translateX.value = reducedMotion ? -widthRef.current : withTiming(-widthRef.current, { duration: 180 })
    setTimeout(onDelete, reducedMotion ? 0 : 170)
  }

  if (disabled) return <>{children}</>
  return <Animated.View
    layout={reducedMotion ? undefined : LinearTransition.duration(170)}
    exiting={reducedMotion ? undefined : FadeOut.duration(130)}
    onLayout={event => { widthRef.current = event.nativeEvent.layout.width }}
    style={styles.clip}
  >
    <View style={[styles.actionLayer, { backgroundColor: tokens.surface }]}>
      <Pressable onPress={remove} disabled={deleting} style={({ pressed }) => [styles.deleteButton, { backgroundColor: tokens.warmGlow, opacity: pressed ? 0.66 : 1 }]} accessibilityRole="button" accessibilityLabel={accessibilityLabel}>
        <Text style={[styles.deleteText, { color: tokens.warm }]}>Delete</Text>
      </Pressable>
    </View>
    <GestureDetector gesture={panGesture}>
      <Animated.View style={[{ backgroundColor: tokens.surface }, rowStyle]} onTouchStart={() => {
        if (activeRow && activeRow.id !== rowId.current) activeRow.close()
      }}>
        {children}
        {open ? <Pressable style={StyleSheet.absoluteFill} onPressIn={() => settle(false)} accessibilityRole="button" accessibilityLabel="Close delete action" /> : null}
      </Animated.View>
    </GestureDetector>
  </Animated.View>
}

const styles = StyleSheet.create({
  clip: { overflow: 'hidden' },
  actionLayer: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, alignItems: 'flex-end', justifyContent: 'center' },
  deleteButton: { width: ACTION_WIDTH, height: '100%', minHeight: 52, alignItems: 'center', justifyContent: 'center' },
  deleteText: { fontSize: 12, fontWeight: '700' },
})
