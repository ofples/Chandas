import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { useAppReducedMotion } from '../../theme/ThemeContext'
import { type ReactNode, useEffect, useId, useRef } from 'react'
import { Animated, KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTheme } from '../../theme/ThemeContext'
import { useKeyboardVisible } from '../../hooks/use-keyboard-visible'
import { SheetTextButton } from './SheetTextButton'
import { FadedVerticalScrollView } from './FadedVerticalScrollView'
import { SheetFeedbackOverlay, useFeedbackSheetRegistration } from './feedback-layer'
import { ContextualHelp, HelpToggleButton, useSetupHelp } from './inline-help'
import { useSheetSnap, type SheetSnap } from './use-sheet-snap'

if (Platform.OS === 'web' && typeof document !== 'undefined' && !document.getElementById('chandas-hide-web-scrollbars')) {
  const style = document.createElement('style')
  style.id = 'chandas-hide-web-scrollbars'
  style.textContent = 'html * { scrollbar-width: none !important; -ms-overflow-style: none !important; } html *::-webkit-scrollbar { display: none !important; width: 0 !important; height: 0 !important; }'
  document.head.appendChild(style)
}

interface Props {
  visible: boolean
  title: ReactNode
  accessibilityTitle?: string
  eyebrow?: string
  onClose: () => void
  onBack?: () => void
  leadingAction?: SheetHeaderAction
  trailingAction?: SheetHeaderAction
  help?: ReactNode
  presentationKey?: string
  pinnedContent?: ReactNode
  children: ReactNode
  scroll?: boolean
  footer?: ReactNode
  minHeight?: number
  compactTop?: boolean
  initialSnap?: SheetSnap
  partialHeightFraction?: number
}

interface SheetHeaderAction {
  label: string
  onPress: () => void
  accessibilityLabel?: string
  disabled?: boolean
  tone?: 'accent' | 'muted' | 'danger'
}

/** Shared, keyboard-safe sheet used by every Timer v2 secondary flow. */
export function BottomSheet({ visible, title, accessibilityTitle, eyebrow, onClose, onBack, leadingAction, trailingAction, help, presentationKey, pinnedContent, children, scroll = true, footer, minHeight, compactTop = false, initialSnap = 'partial', partialHeightFraction }: Props) {
  const { tokens, theme } = useTheme()
  const insets = useSafeAreaInsets()
  const { height: windowHeight } = useWindowDimensions()
  const keyboardVisible = useKeyboardVisible(visible)
  const reducedMotion = useAppReducedMotion()
  const setupHelp = useSetupHelp()
  const sheetId = useId()
  const setSheetVisible = useFeedbackSheetRegistration()
  const sheet = useSheetSnap({ visible, initialSnap, onClose: onBack ?? onClose, windowHeight, topInset: insets.top, minHeight: minHeight ?? styles.sheet.minHeight, partialMinHeight: minHeight ?? 220, partialHeightFraction, maxHeightFraction: 0.92, topMargin: 18, reducedMotion })
  useEffect(() => {
    setSheetVisible?.(sheetId, visible)
    return () => setSheetVisible?.(sheetId, false)
  }, [setSheetVisible, sheetId, visible])
  const presentation = { title, accessibilityTitle, eyebrow, onClose, onBack, leadingAction, trailingAction, help, presentationKey, pinnedContent, children, scroll, footer, minHeight, compactTop }
  const lastVisiblePresentation = useRef(presentation)
  useEffect(() => {
    if (visible) lastVisiblePresentation.current = presentation
  }, [visible, title, accessibilityTitle, eyebrow, onClose, onBack, leadingAction, trailingAction, help, presentationKey, pinnedContent, children, scroll, footer, minHeight, compactTop])
  const presented = visible ? presentation : lastVisiblePresentation.current
  const scrollResetKey = presented.presentationKey === undefined ? visible : `${visible ? 'open' : 'closed'}:${presented.presentationKey}`
  const body = presented.scroll
    ? <FadedVerticalScrollView fadeColor={tokens.surface} resetKey={scrollResetKey} style={styles.scroll} keyboardShouldPersistTaps="never" keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'} contentContainerStyle={styles.body}>{presented.children}</FadedVerticalScrollView>
    : <View style={styles.body}>{presented.children}</View>

  return (
    <Modal visible={visible} transparent animationType={Platform.OS === 'web' || theme === 'eink' ? 'none' : 'fade'} onRequestClose={presented.onBack ?? presented.onClose} statusBarTranslucent>
      <GestureHandlerRootView style={styles.fill}><KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : Platform.OS === 'android' ? 'height' : undefined}>
        <View style={[styles.backdrop, theme === 'eink' && { backgroundColor: tokens.bg }]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={presented.onBack ?? presented.onClose} accessible={false} accessibilityRole="button" accessibilityLabel="Close sheet" />
          <Animated.View
            style={[styles.sheet, { height: sheet.height, maxHeight: '92%', backgroundColor: tokens.surface, borderColor: tokens.border, paddingBottom: keyboardVisible ? 8 : Math.max(insets.bottom, 16), minHeight: presented.minHeight ?? styles.sheet.minHeight }]}
            accessible={false}
            accessibilityViewIsModal
          >
            <View {...sheet.panHandlers} style={styles.dragArea} accessible accessibilityRole="adjustable" accessibilityLabel={`${presented.accessibilityTitle ?? (typeof presented.title === 'string' ? presented.title : 'Sheet')} sheet height`} accessibilityValue={{ text: sheet.snap === 'full' ? 'Expanded' : 'Partial' }} accessibilityActions={[{ name: 'increment', label: 'Expand sheet' }, { name: 'decrement', label: 'Collapse sheet' }, { name: 'escape', label: 'Close sheet' }]} onAccessibilityAction={event => sheet.onAccessibilityAction(event.nativeEvent.actionName)}>
              <View style={[styles.handle, { backgroundColor: tokens.textMuted }]} />
            </View>
            {presented.leadingAction || presented.trailingAction || (setupHelp.visible && setupHelp.onChange) ? <View style={[styles.actions, presented.compactTop && styles.compactActions]}>
              {presented.leadingAction ? <SheetTextButton {...presented.leadingAction} /> : <View style={styles.actionSpacer} />}
              <View style={styles.trailingActions}>
                {presented.trailingAction ? <SheetTextButton {...presented.trailingAction} /> : null}
                {setupHelp.visible && setupHelp.onChange ? <HelpToggleButton active onPress={() => setupHelp.onChange?.(false)} /> : null}
              </View>
            </View> : null}
            <View style={styles.header}>
              <View style={styles.heading}>
                {presented.eyebrow ? <Text style={[styles.eyebrow, { color: tokens.textMuted }]}>{presented.eyebrow}</Text> : null}
                {typeof presented.title === 'string' ? <Text style={[styles.title, { color: tokens.text }]}>{presented.title}</Text> : presented.title}
              </View>
            </View>
            <ContextualHelp>{presented.help}</ContextualHelp>
            {presented.pinnedContent}
            {body}
            {presented.footer}
          </Animated.View>
          <SheetFeedbackOverlay sheetId={sheetId} />
        </View>
      </KeyboardAvoidingView></GestureHandlerRootView>
    </Modal>
  )
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  scroll: { flex: 1, flexShrink: 1 },
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.58)' },
  sheet: { width: '100%', maxWidth: 680, maxHeight: '92%', minHeight: 220, alignSelf: 'center', borderWidth: 1.5, borderBottomWidth: 0, borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingHorizontal: 20, paddingTop: 16, gap: 16 },
  dragArea: { minHeight: 24, alignItems: 'center', justifyContent: 'center', marginTop: -8, marginBottom: -8 },
  handle: { width: 38, height: 4, borderRadius: 4, opacity: 0.55 },
  actions: { minHeight: 32, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  compactActions: { marginBottom: -10 },
  trailingActions: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  actionSpacer: { width: 44 },
  header: { minHeight: 40, justifyContent: 'center', paddingBottom: 4 },
  heading: { flex: 1, gap: 3 },
  eyebrow: { fontSize: 11, lineHeight: 16, fontWeight: '600' },
  title: { fontSize: 20, fontWeight: '700' },
  body: { gap: 14, paddingBottom: 8 },
})
