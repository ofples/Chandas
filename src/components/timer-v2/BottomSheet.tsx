import { type ReactNode, useEffect, useId } from 'react'
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTheme } from '../../theme/ThemeContext'
import { useKeyboardVisible } from '../../hooks/use-keyboard-visible'
import { SheetTextButton } from './SheetTextButton'
import { FadedVerticalScrollView } from './FadedVerticalScrollView'
import { SheetFeedbackOverlay, useFeedbackSheetRegistration } from './feedback-layer'

interface Props {
  visible: boolean
  title: ReactNode
  accessibilityTitle?: string
  eyebrow?: string
  onClose: () => void
  onBack?: () => void
  leadingAction?: SheetHeaderAction
  trailingAction?: SheetHeaderAction
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
export function BottomSheet({ visible, title, accessibilityTitle, eyebrow, onClose, onBack, leadingAction, trailingAction, children, scroll = true, footer }: Props) {
  const { tokens } = useTheme()
  const insets = useSafeAreaInsets()
  const keyboardVisible = useKeyboardVisible(visible)
  const sheetId = useId()
  const setSheetVisible = useFeedbackSheetRegistration()
  useEffect(() => {
    setSheetVisible?.(sheetId, visible)
    return () => setSheetVisible?.(sheetId, false)
  }, [setSheetVisible, sheetId, visible])
  const body = scroll
    ? <FadedVerticalScrollView fadeColor={tokens.surface} resetKey={visible} style={styles.scroll} keyboardShouldPersistTaps="never" keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'} contentContainerStyle={styles.body}>{children}</FadedVerticalScrollView>
    : <View style={styles.body}>{children}</View>

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onBack ?? onClose} statusBarTranslucent>
      <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : Platform.OS === 'android' ? 'height' : undefined}>
        <View style={styles.backdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessible={false} accessibilityRole="button" accessibilityLabel="Close sheet" />
          <View
            style={[styles.sheet, { backgroundColor: tokens.surface, borderColor: tokens.border, paddingBottom: keyboardVisible ? 8 : Math.max(insets.bottom, 16) }]}
            accessible={false}
            accessibilityViewIsModal
          >
            <View style={styles.actions}>
              {leadingAction
                ? <SheetTextButton {...leadingAction} />
                : onBack
                  ? <SheetTextButton label="‹ Back" onPress={onBack} accessibilityLabel="Back" />
                  : <View style={styles.actionSpacer} />}
              {trailingAction
                ? <SheetTextButton {...trailingAction} />
                : <SheetTextButton label="Done" onPress={onClose} accessibilityLabel={`Close ${accessibilityTitle ?? (typeof title === 'string' ? title : 'sheet')}`} />}
            </View>
            <View style={styles.header}>
              <View style={styles.heading}>
                {eyebrow ? <Text style={[styles.eyebrow, { color: tokens.textMuted }]}>{eyebrow}</Text> : null}
                {typeof title === 'string' ? <Text style={[styles.title, { color: tokens.text }]}>{title}</Text> : title}
              </View>
            </View>
            {body}
            {footer}
          </View>
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
  actionSpacer: { width: 44 },
  header: { minHeight: 40, justifyContent: 'center', paddingBottom: 4 },
  heading: { flex: 1, gap: 3 },
  eyebrow: { fontSize: 11, lineHeight: 16, fontWeight: '600' },
  title: { fontSize: 20, fontWeight: '700' },
  body: { gap: 14, paddingBottom: 8 },
})
