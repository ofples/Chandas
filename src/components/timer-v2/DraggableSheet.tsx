import { useEffect, useRef, type ReactNode } from 'react'
import { Animated, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native'
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
  testID?: string
  showTitle?: boolean
  pinnedContent?: ReactNode
  presentationKey?: string
}

/** Shared production sheet with independent content-scroll and handle-drag ownership. */
export function DraggableSheet({ visible, title, onClose, onBack, children, footer, initialSnap = 'partial', testID, showTitle = true, pinnedContent, presentationKey }: DraggableSheetProps) {
  const { tokens } = useTheme()
  const reducedMotion = useAppReducedMotion()
  const { height: windowHeight } = useWindowDimensions()
  const insets = useSafeAreaInsets()
  const scroll = useRef<ScrollView>(null)
  const sheet = useSheetSnap({ visible, initialSnap, onClose: onBack ?? onClose, windowHeight, topInset: insets.top, minHeight: 260, partialMinHeight: 340, reducedMotion })

  useEffect(() => {
    if (!visible) return
    const frame = requestAnimationFrame(() => scroll.current?.scrollTo({ y: 0, animated: false }))
    return () => cancelAnimationFrame(frame)
  }, [visible, presentationKey])

  return <Modal visible={visible} transparent animationType="none" onRequestClose={onBack ?? onClose} statusBarTranslucent>
    <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : Platform.OS === 'android' ? 'height' : undefined}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onBack ?? onClose} accessibilityLabel="Dismiss editor" />
        <Animated.View testID={testID} accessibilityViewIsModal style={[styles.sheet, { height: sheet.height, maxHeight: '100%', backgroundColor: tokens.surface, borderColor: tokens.border, paddingBottom: Math.max(12, insets.bottom) }]}>
          <View {...sheet.panHandlers} style={styles.dragArea} accessible accessibilityRole="adjustable" accessibilityLabel={`${title} sheet height`} accessibilityValue={{ text: sheet.snap === 'full' ? 'Expanded' : 'Partial' }} accessibilityActions={[{ name: 'increment', label: 'Expand sheet' }, { name: 'decrement', label: 'Collapse sheet' }, { name: 'escape', label: 'Close sheet' }]} onAccessibilityAction={event => sheet.onAccessibilityAction(event.nativeEvent.actionName)}>
            <View style={[styles.handle, { backgroundColor: tokens.textMuted }]} />
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
  title: { fontSize: 23, fontWeight: '500', paddingHorizontal: 22, paddingBottom: 16 },
  scroll: { flex: 1 },
  body: { paddingHorizontal: 22, paddingBottom: 22, gap: 16 },
  footer: { paddingHorizontal: 22, paddingTop: 12, borderTopWidth: 1 },
})
