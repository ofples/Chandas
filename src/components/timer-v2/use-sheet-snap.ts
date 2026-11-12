import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Animated, PanResponder } from 'react-native'

export type SheetSnap = 'partial' | 'full'

interface UseSheetSnapOptions {
  visible: boolean
  initialSnap: SheetSnap
  onClose: () => void
  windowHeight: number
  topInset: number
  minHeight: number
  partialMinHeight: number
  partialHeightFraction?: number
  maxHeightFraction?: number
  topMargin?: number
  reducedMotion: boolean
}

/** Shared handle-only drag and snap behavior for all timer sheets. */
export function useSheetSnap({
  visible, initialSnap, onClose, windowHeight, topInset, minHeight, partialMinHeight,
  partialHeightFraction = 0.64, maxHeightFraction = 1, topMargin = 18, reducedMotion,
}: UseSheetSnapOptions) {
  const fullHeight = Math.max(0, Math.min(Math.max(minHeight, windowHeight * maxHeightFraction), windowHeight - topInset - topMargin))
  const partialHeight = Math.min(fullHeight, Math.max(minHeight, partialMinHeight, Math.round(windowHeight * partialHeightFraction)))
  const [snap, setSnap] = useState<SheetSnap>(initialSnap)
  const snapRef = useRef<SheetSnap>(initialSnap)
  const height = useRef(new Animated.Value(initialSnap === 'full' ? fullHeight : partialHeight)).current
  const dragStart = useRef(initialSnap === 'full' ? fullHeight : partialHeight)
  const latest = useRef({ snap: initialSnap, fullHeight, partialHeight, reducedMotion, onClose })
  latest.current = { snap: snapRef.current, fullHeight, partialHeight, reducedMotion, onClose }

  const moveTo = useCallback((next: SheetSnap) => {
    snapRef.current = next
    setSnap(next)
    const settings = latest.current
    const target = next === 'full' ? settings.fullHeight : settings.partialHeight
    if (settings.reducedMotion) {
      height.setValue(target)
    } else {
      Animated.timing(height, { toValue: target, duration: 180, useNativeDriver: false }).start()
    }
  }, [height])

  const wasVisible = useRef(false)
  const previousInitialSnap = useRef(initialSnap)
  useEffect(() => {
    if (!visible) { wasVisible.current = false; return }
    const next = !wasVisible.current || previousInitialSnap.current !== initialSnap ? initialSnap : snapRef.current
    wasVisible.current = true
    previousInitialSnap.current = initialSnap
    snapRef.current = next
    setSnap(next)
    const target = next === 'full' ? fullHeight : partialHeight
    height.setValue(target)
    dragStart.current = target
  }, [visible, initialSnap, fullHeight, partialHeight, height])

  const panResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dy) > 7 && Math.abs(gesture.dy) > Math.abs(gesture.dx),
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: () => { height.stopAnimation(value => { dragStart.current = value }) },
    onPanResponderMove: (_, gesture) => {
      const settings = latest.current
      const next = Math.min(settings.fullHeight, Math.max(120, dragStart.current - gesture.dy))
      height.setValue(next)
    },
    onPanResponderRelease: (_, gesture) => {
      const settings = latest.current
      if (Math.abs(gesture.dy) < 7 && Math.abs(gesture.dx) < 7) { moveTo(settings.snap === 'full' ? 'partial' : 'full'); return }
      if (settings.snap === 'partial' && (gesture.dy > 120 || (gesture.dy > 35 && gesture.vy > 0.9))) settings.onClose()
      else if (gesture.dy < -45 || gesture.vy < -0.8) moveTo('full')
      else if (gesture.dy > 55 || gesture.vy > 0.8) moveTo('partial')
      else moveTo(settings.snap)
    },
    onPanResponderTerminate: () => moveTo(latest.current.snap),
  }), [height, moveTo])

  const onAccessibilityAction = useCallback((actionName: string) => {
    if (actionName === 'increment') moveTo('full')
    else if (actionName === 'decrement') moveTo('partial')
    else latest.current.onClose()
  }, [moveTo])

  return {
    snap,
    height,
    panHandlers: panResponder.panHandlers,
    moveTo,
    onAccessibilityAction,
  }
}
