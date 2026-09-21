import { type ReactNode, useEffect, useId, useRef } from 'react'
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native'
import Animated, { FadeInDown, useReducedMotion } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTheme } from '../../theme/ThemeContext'
import { useKeyboardVisible } from '../../hooks/use-keyboard-visible'
import { SheetTextButton } from './SheetTextButton'
import { FadedVerticalScrollView } from './FadedVerticalScrollView'
import { SheetFeedbackOverlay, useFeedbackSheetRegistration } from './feedback-layer'
import { ContextualHelp, HelpToggleButton, useSetupHelp } from './inline-help'

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
}

interface SheetHeaderAction {
  label: string
  onPress: () => void
  accessibilityLabel?: string
  disabled?: boolean
  tone?: 'accent' | 'muted' | 'danger'
}

/** Shared, keyboard-safe sheet used by every Timer v2 secondary flow. */
export function BottomSheet({ visible, title, accessibilityTitle, eyebrow, onClose, onBack, leadingAction, trailingAction, help, presentationKey, pinnedContent, children, scroll = true, footer }: Props) {
  const { tokens } = useTheme()
  const insets = useSafeAreaInsets()
  const keyboardVisible = useKeyboardVisible(visible)
  const reducedMotion = useReducedMotion()
  const setupHelp = useSetupHelp()
  const sheetId = useId()
  const setSheetVisible = useFeedbackSheetRegistration()
  useEffect(() => {
    setSheetVisible?.(sheetId, visible)
    return () => setSheetVisible?.(sheetId, false)
  }, [setSheetVisible, sheetId, visible])
  const presentation = { title, accessibilityTitle, eyebrow, onClose, onBack, leadingAction, trailingAction, help, presentationKey, pinnedContent, children, scroll, footer }
  const lastVisiblePresentation = useRef(presentation)
  useEffect(() => {
    if (visible) lastVisiblePresentation.current = presentation
  }, [visible, title, accessibilityTitle, eyebrow, onClose, onBack, leadingAction, trailingAction, help, presentationKey, pinnedContent, children, scroll, footer])
  const presented = visible ? presentation : lastVisiblePresentation.current
  const scrollResetKey = presented.presentationKey === undefined ? visible : `${visible ? 'open' : 'closed'}:${presented.presentationKey}`
  const body = presented.scroll
    ? <FadedVerticalScrollView fadeColor={tokens.surface} resetKey={scrollResetKey} style={styles.scroll} keyboardShouldPersistTaps="never" keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'} contentContainerStyle={styles.body}>{presented.children}</FadedVerticalScrollView>
    : <View style={styles.body}>{presented.children}</View>

  return (
    <Modal visible={visible} transparent animationType={Platform.OS === 'web' ? 'none' : 'fade'} onRequestClose={presented.onBack ?? presented.onClose} statusBarTranslucent>
      <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : Platform.OS === 'android' ? 'height' : undefined}>
        <View style={styles.backdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={presented.onClose} accessible={false} accessibilityRole="button" accessibilityLabel="Close sheet" />
          <Animated.View
            entering={Platform.OS === 'web' ? FadeInDown.duration(reducedMotion ? 80 : 180) : undefined}
            style={[styles.sheet, { backgroundColor: tokens.surface, borderColor: tokens.border, paddingBottom: keyboardVisible ? 8 : Math.max(insets.bottom, 16) }]}
            accessible={false}
            accessibilityViewIsModal
          >
            <View style={styles.actions}>
              {presented.leadingAction
                ? <SheetTextButton {...presented.leadingAction} />
                : <View style={styles.actionSpacer} />}
              <View style={styles.trailingActions}>
                {presented.trailingAction
                  ? <SheetTextButton {...presented.trailingAction} />
                  : <SheetTextButton label="Done" onPress={presented.onBack ?? presented.onClose} accessibilityLabel={`${presented.onBack ? 'Finish editing' : 'Close'} ${presented.accessibilityTitle ?? (typeof presented.title === 'string' ? presented.title : 'sheet')}`} />}
                {setupHelp.visible && setupHelp.onChange ? <HelpToggleButton active onPress={() => setupHelp.onChange?.(false)} /> : null}
              </View>
            </View>
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
      </KeyboardAvoidingView>
    </Modal>
  )
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  scroll: { flexShrink: 1 },
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.58)' },
  sheet: { width: '100%', maxWidth: 680, maxHeight: '92%', minHeight: 220, alignSelf: 'center', borderWidth: 1.5, borderBottomWidth: 0, borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingHorizontal: 20, paddingTop: 16, gap: 16 },
  actions: { minHeight: 32, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  trailingActions: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  actionSpacer: { width: 44 },
  header: { minHeight: 40, justifyContent: 'center', paddingBottom: 4 },
  heading: { flex: 1, gap: 3 },
  eyebrow: { fontSize: 11, lineHeight: 16, fontWeight: '600' },
  title: { fontSize: 20, fontWeight: '700' },
  body: { gap: 14, paddingBottom: 8 },
})
