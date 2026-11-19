import { GuidedTourOverlay, TourSurface, useGuidedTour } from './guided-tour'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Animated, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StatusBar, StyleSheet, Text, useWindowDimensions, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useAppReducedMotion, useTheme } from '../../theme/ThemeContext'
import { useSheetSnap } from './use-sheet-snap'

export interface DraggableSheetProps {
  visible: boolean
  title: string
  onClose: () => void
  onBack?: () => void
  children: ReactNode
  footer?: ReactNode
  initialSnap?: 'partial' | 'full'
  partialHeightFraction?: number
  presentation?: 'bottom' | 'center'
  testID?: string
  showTitle?: boolean
  titleAction?: ReactNode
  pinnedContent?: ReactNode
  fitContent?: boolean
  presentationKey?: string
  /** Keeps this content area's position while switching between keyed sections. */
  scrollKey?: string
}

/** Shared production sheet with independent content-scroll and handle-drag ownership. */
export function DraggableSheet({ visible, title, onClose, onBack, children, footer, initialSnap = 'partial', partialHeightFraction = 0.64, presentation = 'bottom', testID, showTitle = true, titleAction, pinnedContent, presentationKey, scrollKey, fitContent }: DraggableSheetProps) {
  const { tokens } = useTheme()
  const tour = useGuidedTour()
  const tourScope = `sheet:${testID ?? title}`
  const reducedMotion = useAppReducedMotion()
  const { height: windowHeight } = useWindowDimensions()
  const insets = useSafeAreaInsets()
  const topInset = Math.max(insets.top, Platform.OS === 'android' ? StatusBar.currentHeight ?? 0 : 0)
  const topMargin = 18
  const scroll = useRef<ScrollView>(null)
  const [contentHeight, setContentHeight] = useState(0)
  const [headerHeight, setHeaderHeight] = useState(0)
  const [footerHeight, setFooterHeight] = useState(0)
  const exitProgress = useRef(new Animated.Value(1)).current
  const closeRequested = useRef(false)
  const requestClose = useCallback(() => {
    if (closeRequested.current) return
    closeRequested.current = true
    if (reducedMotion) { (onBack ?? onClose)(); return }
    Animated.timing(exitProgress, { toValue: 1, duration: 120, useNativeDriver: false }).start(({ finished }) => {
      if (finished) (onBack ?? onClose)()
    })
  }, [exitProgress, onBack, onClose, reducedMotion])
  useEffect(() => {
    if (!visible) return
    closeRequested.current = false
    exitProgress.setValue(reducedMotion ? 0 : 1)
    if (!reducedMotion) {
      const frame = requestAnimationFrame(() => Animated.timing(exitProgress, { toValue: 0, duration: 160, useNativeDriver: false }).start())
      return () => cancelAnimationFrame(frame)
    }
  }, [visible, presentationKey, scrollKey, exitProgress, reducedMotion])
  const fittedFraction = contentHeight > 0 && (fitContent || presentation === 'center')
    ? Math.min(partialHeightFraction, (contentHeight + (fitContent ? headerHeight + footerHeight + 2 : showTitle ? 74 : 30) + Math.max(12, insets.bottom)) / windowHeight)
    : partialHeightFraction
  const scrollPositions = useRef(new Map<string, number>())
  const activeScrollKey = useRef(scrollKey)
  const resetKey = scrollKey === undefined ? presentationKey : scrollKey
  const minHeight = fitContent ? 128 : presentation === 'center' ? 220 : 260
  const sheet = useSheetSnap({ visible, initialSnap, onClose: requestClose, windowHeight, topInset, minHeight, partialMinHeight: minHeight, partialHeightFraction: fittedFraction, maxHeightFraction: presentation === 'center' ? 0.94 : 1, topMargin, reducedMotion })

  useEffect(() => {
    if (!visible) return
    activeScrollKey.current = scrollKey
    const target = scrollKey === undefined ? 0 : (scrollPositions.current.get(scrollKey) ?? 0)
    const frame = requestAnimationFrame(() => scroll.current?.scrollTo({ y: target, animated: false }))
    return () => cancelAnimationFrame(frame)
  }, [visible, scrollKey, resetKey])

  const rememberScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const key = activeScrollKey.current
    if (key !== undefined) scrollPositions.current.set(key, Math.max(0, event.nativeEvent.contentOffset.y))
  }

  return <TourSurface id={tourScope} active={visible}><Modal visible={visible} transparent animationType="none" onRequestClose={() => tour?.step ? tour.dismiss(false) : requestClose()} statusBarTranslucent>
    <GestureHandlerRootView style={styles.fill}><KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={[styles.backdrop, { paddingTop: topInset + topMargin }, presentation === 'center' && sheet.snap !== 'full' && { justifyContent: 'center', paddingHorizontal: 16 }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={() => tour?.step ? tour.dismiss(false) : requestClose()} accessibilityLabel="Dismiss editor" />
        <Animated.View testID={testID} accessibilityViewIsModal style={[styles.sheet, presentation === 'center' && sheet.snap !== 'full' && { borderRadius: 24, borderBottomWidth: 1 }, sheet.snap === 'full' && { maxWidth: '100%' }, { opacity: exitProgress.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }), transform: [{ translateY: exitProgress.interpolate({ inputRange: [0, 1], outputRange: [0, 22] }) }], height: sheet.height, maxHeight: '100%', flexShrink: 1, backgroundColor: tokens.surface, borderColor: tokens.border, paddingBottom: Math.max(12, insets.bottom) }]}>
          <View onLayout={fitContent ? event => setHeaderHeight(event.nativeEvent.layout.height) : undefined}>
            <View {...sheet.panHandlers} style={styles.dragArea} accessible accessibilityRole="adjustable" accessibilityLabel={`${title} sheet height`} accessibilityValue={{ text: sheet.snap === 'full' ? 'Expanded' : 'Partial' }} accessibilityActions={[{ name: 'increment', label: 'Expand sheet' }, { name: 'decrement', label: 'Collapse sheet' }, { name: 'escape', label: 'Close sheet' }]} onAccessibilityAction={event => sheet.onAccessibilityAction(event.nativeEvent.actionName)}>
              <View style={[styles.handle, { backgroundColor: tokens.textMuted }]} />
            </View>
            {showTitle ? <View style={{ flexDirection: 'row', alignItems: 'center' }}><View {...sheet.panHandlers} style={{ flex: 1 }}><Text accessibilityRole="header" style={[styles.title, { color: tokens.text }]}>{title}</Text></View>{titleAction ? <View style={{ paddingRight: 22, paddingBottom: 16 }}>{titleAction}</View> : null}</View> : null}
            {pinnedContent ? <View style={{ paddingHorizontal: 22, paddingBottom: 8 }}>{pinnedContent}</View> : null}
          </View>
          <ScrollView ref={scroll} onContentSizeChange={(_width, height) => { if (fitContent || presentation === 'center') setContentHeight(height) }} style={styles.scroll} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled" keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'} showsVerticalScrollIndicator={false} onScroll={rememberScroll} scrollEventThrottle={16}>
            {children}
          </ScrollView>
          {footer ? <View onLayout={fitContent ? event => setFooterHeight(event.nativeEvent.layout.height) : undefined} style={[styles.footer, { borderTopColor: tokens.border }]}>{footer}</View> : null}
        </Animated.View>
      </View>
    </KeyboardAvoidingView><GuidedTourOverlay scope={tourScope} /></GestureHandlerRootView>
  </Modal></TourSurface>
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet: { width: '100%', maxWidth: 680, alignSelf: 'center', borderTopLeftRadius: 24, borderTopRightRadius: 24, borderWidth: 1, borderBottomWidth: 0, overflow: 'hidden' },
  dragArea: { minHeight: 30, alignItems: 'center', justifyContent: 'center' },
  handle: { width: 38, height: 4, borderRadius: 4, opacity: 0.55 },
  title: { fontSize: 23, fontWeight: '500', paddingHorizontal: 22, paddingBottom: 16 },
  scroll: { flex: 1 },
  body: { paddingHorizontal: 22, paddingBottom: 22, gap: 16 },
  footer: { paddingHorizontal: 22, paddingTop: 12, borderTopWidth: 1 },
})
