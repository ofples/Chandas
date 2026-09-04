import type { ReactNode } from 'react'
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTheme } from '../../theme/ThemeContext'

interface Props {
  visible: boolean
  title: ReactNode
  accessibilityTitle?: string
  eyebrow?: string
  onClose: () => void
  onBack?: () => void
  children: ReactNode
  scroll?: boolean
  footer?: ReactNode
}

/** Shared, keyboard-safe sheet used by every Timer v2 secondary flow. */
export function BottomSheet({ visible, title, accessibilityTitle, eyebrow, onClose, onBack, children, scroll = true, footer }: Props) {
  const { tokens } = useTheme()
  const insets = useSafeAreaInsets()
  const body = scroll
    ? <ScrollView style={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={styles.body}>{children}</ScrollView>
    : <View style={styles.body}>{children}</View>

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.backdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessible={false} accessibilityRole="button" accessibilityLabel="Close sheet" />
          <View
            style={[styles.sheet, { backgroundColor: tokens.surface, borderColor: tokens.border, paddingBottom: Math.max(insets.bottom, 16) }]}
            accessible={false}
            accessibilityViewIsModal
          >
            <View style={[styles.grabber, { backgroundColor: tokens.textDisabled }]} />
            <View style={styles.header}>
              {onBack ? <Pressable onPress={onBack} hitSlop={10} accessibilityRole="button" accessibilityLabel="Back"><Text style={[styles.back, { color: tokens.accent }]}>‹ Back</Text></Pressable> : null}
              <View style={styles.heading}>
                {eyebrow ? <Text style={[styles.eyebrow, { color: tokens.textMuted }]}>{eyebrow}</Text> : null}
                {typeof title === 'string' ? <Text style={[styles.title, { color: tokens.text }]}>{title}</Text> : title}
              </View>
              <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel={`Close ${accessibilityTitle ?? (typeof title === 'string' ? title : 'sheet')}`}>
                <Text style={[styles.done, { color: tokens.accent }]}>Done</Text>
              </Pressable>
            </View>
            {body}
            {footer}
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  )
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  scroll: { flexShrink: 1 },
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.58)' },
  sheet: { width: '100%', maxWidth: 680, maxHeight: '92%', minHeight: 220, alignSelf: 'center', borderWidth: 1.5, borderBottomWidth: 0, borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingHorizontal: 20, paddingTop: 10, gap: 16 },
  grabber: { width: 36, height: 4, borderRadius: 2, alignSelf: 'center', opacity: 0.55 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 16 },
  heading: { flex: 1, gap: 3 },
  eyebrow: { fontSize: 11, fontWeight: '700', letterSpacing: 1.35 },
  title: { fontSize: 20, fontWeight: '700' },
  done: { fontSize: 13, fontWeight: '700' },
  back: { fontSize: 13, fontWeight: '700' },
  body: { gap: 14, paddingBottom: 8 },
})
