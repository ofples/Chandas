import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Animated, KeyboardAvoidingView, Modal, PanResponder, Platform, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useAppReducedMotion, useTheme } from '../theme/ThemeContext'

interface Props {
  visible: boolean
  title: string
  onClose: () => void
  onBack?: () => void
  children: ReactNode
  footer?: ReactNode
  initialSnap?: 'partial' | 'full'
  testID?: string
  showTitle?: boolean
  pinnedContent?: ReactNode
  presentationKey?: string
}

/** Experimental only: content scroll and handle drag deliberately have separate owners. */
export function PrototypeSheet({ visible, title, onClose, onBack, children, footer, initialSnap = 'partial', testID, showTitle = true, pinnedContent, presentationKey }: Props) {
  const { tokens } = useTheme()
  const reducedMotion = useAppReducedMotion()
  const { height: windowHeight } = useWindowDimensions()
  const insets = useSafeAreaInsets()
  const [snap, setSnap] = useState(initialSnap)
  const fullHeight = Math.max(260, windowHeight - insets.top - 18)
  const partialHeight = Math.min(fullHeight, Math.max(340, Math.round(windowHeight * 0.64)))
  const height = useRef(new Animated.Value(partialHeight)).current
  const dragStart = useRef(partialHeight)
  const currentHeight = useRef(partialHeight)
  const scroll = useRef<ScrollView>(null)
  const latest = useRef({ snap, fullHeight, partialHeight, reducedMotion, onClose })
  latest.current = { snap, fullHeight, partialHeight, reducedMotion, onClose }

  const moveTo = (next: 'partial' | 'full') => {
    setSnap(next)
    const settings = latest.current
    const target = next === 'full' ? settings.fullHeight : settings.partialHeight
    currentHeight.current = target
    if (settings.reducedMotion) height.setValue(target)
    else Animated.timing(height, { toValue: target, duration: 180, useNativeDriver: false }).start()
  }

  useEffect(() => {
    if (!visible) return
    setSnap(initialSnap)
    const target = initialSnap === 'full' ? fullHeight : partialHeight
    height.setValue(target)
    currentHeight.current = target
  }, [visible, initialSnap, fullHeight, partialHeight, height])

  useEffect(() => {
    if (!visible) return
    const frame = requestAnimationFrame(() => scroll.current?.scrollTo({ y: 0, animated: false }))
    return () => cancelAnimationFrame(frame)
  }, [visible, presentationKey])

  const responder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dy) > 7 && Math.abs(gesture.dy) > Math.abs(gesture.dx),
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: () => { height.stopAnimation(value => { dragStart.current = value }) },
    onPanResponderMove: (_, gesture) => {
      const next = Math.min(latest.current.fullHeight, Math.max(120, dragStart.current - gesture.dy))
      height.setValue(next)
      currentHeight.current = next
    },
    onPanResponderRelease: (_, gesture) => {
      const settings = latest.current
      if (settings.snap === 'partial' && (gesture.dy > 120 || (gesture.dy > 35 && gesture.vy > 0.9))) settings.onClose()
      else if (gesture.dy < -45 || gesture.vy < -0.8) moveTo('full')
      else if (gesture.dy > 55 || gesture.vy > 0.8) moveTo('partial')
      else moveTo(settings.snap)
    },
    onPanResponderTerminate: () => moveTo(latest.current.snap),
  }), [height])

  return <Modal visible={visible} transparent animationType="none" onRequestClose={onBack ?? onClose} statusBarTranslucent>
    <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : Platform.OS === 'android' ? 'height' : undefined}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Dismiss editor" />
        <Animated.View testID={testID} accessibilityViewIsModal style={[styles.sheet, { height, maxHeight: '100%', backgroundColor: tokens.surface, borderColor: tokens.border, paddingBottom: Math.max(12, insets.bottom) }]}>
          <View {...responder.panHandlers} style={styles.dragArea} accessible accessibilityRole="adjustable" accessibilityLabel={`${title} sheet height`} accessibilityValue={{ text: snap === 'full' ? 'Expanded' : 'Partial' }} accessibilityActions={[{ name: 'increment', label: 'Expand sheet' }, { name: 'decrement', label: 'Collapse sheet' }, { name: 'escape', label: 'Close sheet' }]} onAccessibilityAction={event => {
            if (event.nativeEvent.actionName === 'increment') moveTo('full')
            else if (event.nativeEvent.actionName === 'decrement') moveTo('partial')
            else onClose()
          }}>
            <View style={[styles.handle, { backgroundColor: tokens.textMuted }]} />
          </View>
          <View style={styles.toolbar}>
            {onBack ? <Pressable accessibilityRole="button" accessibilityLabel="Back to previous editor" onPress={onBack} style={styles.action}><Text style={{ color: tokens.accent }}>‹ Back</Text></Pressable> : <View style={styles.action} />}
            <View style={styles.toolbarActions}>
              <Pressable accessibilityRole="button" accessibilityLabel={snap === 'full' ? 'Collapse sheet' : 'Expand sheet'} onPress={() => moveTo(snap === 'full' ? 'partial' : 'full')} style={styles.action}><Text style={{ color: tokens.textMuted }}>{snap === 'full' ? 'Collapse' : 'Expand'}</Text></Pressable>
              <Pressable accessibilityRole="button" onPress={onBack ?? onClose} accessibilityLabel={`Done editing ${title}`} style={styles.action}><Text style={{ color: tokens.accent }}>Done</Text></Pressable>
            </View>
          </View>
          {showTitle ? <Text accessibilityRole="header" style={[styles.title, { color: tokens.text }]}>{title}</Text> : null}
          {pinnedContent ? <View style={{ paddingHorizontal: 22, paddingBottom: 8 }}>{pinnedContent}</View> : null}
          <ScrollView ref={scroll} style={styles.scroll} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled" keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'} showsVerticalScrollIndicator>
            {children}
          </ScrollView>
          {footer ? <View style={[styles.footer, { borderTopColor: tokens.border }]}>{footer}</View> : null}
        </Animated.View>
      </View>
    </KeyboardAvoidingView>
  </Modal>
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet: { width: '100%', maxWidth: 680, alignSelf: 'center', borderTopLeftRadius: 24, borderTopRightRadius: 24, borderWidth: 1, borderBottomWidth: 0, overflow: 'hidden' },
  dragArea: { minHeight: 30, alignItems: 'center', justifyContent: 'center' },
  handle: { width: 38, height: 4, borderRadius: 4, opacity: 0.55 },
  toolbar: { paddingHorizontal: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  toolbarActions: { flexDirection: 'row', gap: 10 },
  action: { minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 23, fontWeight: '500', paddingHorizontal: 22, paddingBottom: 16 },
  scroll: { flex: 1 },
  body: { paddingHorizontal: 22, paddingBottom: 22, gap: 16 },
  footer: { paddingHorizontal: 22, paddingTop: 12, borderTopWidth: 1 },
})
