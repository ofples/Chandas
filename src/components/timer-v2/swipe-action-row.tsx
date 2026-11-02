import { useCallback, useMemo, useRef, type ReactNode } from 'react'
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated'
import Svg, { Rect } from 'react-native-svg'
import { scheduleOnRN } from 'react-native-worklets'
import { selectionHaptic } from '../../lib/haptics'
import { useAppReducedMotion, useTheme } from '../../theme/ThemeContext'
import { TrashIcon } from '../Icons'

export interface SwipeActionRowProps {
  children: ReactNode | ((canPress: () => boolean) => ReactNode)
  /** Starts the app-owned delete confirmation. The row remains until its parent removes it. */
  onDelete?: () => void | Promise<void>
  /** Duplicates the row immediately after the swipe settles. */
  onDuplicate?: () => void
  accessibilityLabel?: string
  testID?: string
}

const ACTIVATION_DISTANCE = 12
const FAIL_VERTICAL_DISTANCE = 14
const HORIZONTAL_AXIS_DOMINANCE = 1.4

function swipeThreshold(width: number): number {
  return Math.max(80, Math.min(width * 0.3, 120))
}

function DuplicateIcon({ color }: { color: string }) {
  return <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
    <Rect x={8} y={4} width={12} height={14} rx={2} stroke={color} strokeWidth={1.8} />
    <Rect x={4} y={8} width={12} height={14} rx={2} fill="none" stroke={color} strokeWidth={1.8} />
  </Svg>
}

/** A horizontal, distance-triggered row gesture that leaves confirmation to the caller. */
export function SwipeActionRow({ children, onDelete, onDuplicate, accessibilityLabel, testID }: SwipeActionRowProps) {
  const { tokens, theme } = useTheme()
  const reducedMotion = useAppReducedMotion()
  const translateX = useSharedValue(0)
  const threshold = useSharedValue(80)
  const pendingAction = useSharedValue(false)
  const latestActions = useRef({ onDelete, onDuplicate })
  latestActions.current = { onDelete, onDuplicate }
  const gestureActiveRef = useRef(false)
  const suppressionUntilRef = useRef(0)
  const hasDelete = Boolean(onDelete)
  const hasDuplicate = Boolean(onDuplicate)

  const markGestureStarted = useCallback(() => {
    gestureActiveRef.current = true
    suppressionUntilRef.current = Date.now() + 400
  }, [])
  const refreshSuppression = useCallback(() => {
    suppressionUntilRef.current = Date.now() + 400
  }, [])
  const markGestureFinalized = useCallback(() => {
    if (!gestureActiveRef.current) return
    gestureActiveRef.current = false
    suppressionUntilRef.current = Date.now() + 400
  }, [])
  const canPress = useCallback(() => !gestureActiveRef.current && Date.now() >= suppressionUntilRef.current, [])
  const invokeAction = useCallback((action: 'delete' | 'duplicate') => {
    selectionHaptic()
    if (action === 'delete') {
      try {
        void Promise.resolve(latestActions.current.onDelete?.()).catch(() => undefined)
      } catch { /* Parent owns confirmation and any resulting feedback. */ }
    } else {
      latestActions.current.onDuplicate?.()
    }
  }, [])

  const onLayout = (event: LayoutChangeEvent) => {
    threshold.value = swipeThreshold(event.nativeEvent.layout.width)
  }

  const pan = useMemo(() => Gesture.Pan()
    .enabled(hasDelete || hasDuplicate)
    .activeOffsetX([-ACTIVATION_DISTANCE, ACTIVATION_DISTANCE])
    .failOffsetY([-FAIL_VERTICAL_DISTANCE, FAIL_VERTICAL_DISTANCE])
    .onStart(() => {
      pendingAction.value = false
      scheduleOnRN(markGestureStarted)
    })
    .onUpdate(event => {
      // Keep vertical-dominant movement available to a containing scroll view.
      if (Math.abs(event.translationX) >= Math.abs(event.translationY) * HORIZONTAL_AXIS_DOMINANCE) {
        translateX.value = Math.max(-160, Math.min(160, event.translationX))
      }
    })
    .onEnd((event, success) => {
      if (!success) { pendingAction.value = false; translateX.value = reducedMotion ? 0 : withTiming(0, { duration: 140 }); return }
      scheduleOnRN(refreshSuppression)
      const horizontalDominates = Math.abs(event.translationX) >= Math.abs(event.translationY) * HORIZONTAL_AXIS_DOMINANCE
      const direction = horizontalDominates && event.translationX <= -threshold.value && hasDelete
        ? 'delete'
        : horizontalDominates && event.translationX >= threshold.value && hasDuplicate
          ? 'duplicate'
          : null
      if (!direction) {
        translateX.value = reducedMotion ? 0 : withTiming(0, { duration: 140 })
        return
      }

      pendingAction.value = true
      if (reducedMotion) {
        translateX.value = 0
        pendingAction.value = false
        scheduleOnRN(invokeAction, direction)
        return
      }
      translateX.value = withTiming(0, { duration: 140 }, finished => {
        if (finished) {
          pendingAction.value = false
          scheduleOnRN(invokeAction, direction)
        }
      })
    })
    .onFinalize((_event, success) => {
      if (!success) pendingAction.value = false
      scheduleOnRN(markGestureFinalized)
      if (!pendingAction.value) translateX.value = reducedMotion ? 0 : withTiming(0, { duration: 140 })
    }), [hasDelete, hasDuplicate, reducedMotion, markGestureStarted, refreshSuppression, markGestureFinalized, invokeAction, pendingAction, threshold, translateX])

  const rowStyle = useAnimatedStyle(() => ({ transform: [{ translateX: translateX.value }] }))
  const deleteCueStyle = useAnimatedStyle(() => {
    const progress = Math.min(1, Math.max(0, -translateX.value / threshold.value))
    return { opacity: progress, transform: [{ scale: 0.8 + progress * 0.2 }] }
  })
  const duplicateCueStyle = useAnimatedStyle(() => {
    const progress = Math.min(1, Math.max(0, translateX.value / threshold.value))
    return { opacity: progress, transform: [{ scale: 0.8 + progress * 0.2 }] }
  })

  const content = typeof children === 'function' ? children(canPress) : children

  return <Animated.View testID={testID} onLayout={onLayout} style={[styles.clip, { backgroundColor: tokens.surface }]}>
    <View pointerEvents="none" style={styles.actionLayer} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {onDuplicate ? <View style={[styles.actionSlot, styles.leftSlot, { backgroundColor: theme === 'eink' ? tokens.surfaceHi : tokens.accentGlow }]}>
        <Animated.View style={duplicateCueStyle}><DuplicateIcon color={tokens.accent} /></Animated.View>
      </View> : null}
      {onDelete ? <View style={[styles.actionSlot, styles.rightSlot, { backgroundColor: theme === 'eink' ? tokens.surfaceHi : tokens.warmGlow }]}>
        <Animated.View style={deleteCueStyle}><TrashIcon color={tokens.warm} size={20} /></Animated.View>
      </View> : null}
    </View>
    <GestureDetector gesture={pan}>
      <Animated.View style={[styles.row, { backgroundColor: tokens.surface }, rowStyle]}>
        {content}
      </Animated.View>
    </GestureDetector>
  </Animated.View>
}

const styles = StyleSheet.create({
  clip: { overflow: 'hidden', position: 'relative', borderRadius: 16 },
  actionLayer: { ...StyleSheet.absoluteFill, flexDirection: 'row', justifyContent: 'space-between' },
  actionSlot: { width: 64, alignItems: 'center', justifyContent: 'center' },
  leftSlot: { alignSelf: 'stretch' },
  rightSlot: { alignSelf: 'stretch' },
  row: { position: 'relative' },
})
