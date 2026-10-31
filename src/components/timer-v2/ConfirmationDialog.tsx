import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { Keyboard, Modal, Pressable, StyleSheet, Text, View } from 'react-native'
import { useTheme } from '../../theme/ThemeContext'

export interface ConfirmationOptions {
  title: string
  message: string
  confirmLabel: string
  cancelLabel?: string
  destructive?: boolean
}

type ConfirmationRequest = ConfirmationOptions & { id: number }
export type Confirm = (options: ConfirmationOptions) => Promise<boolean>

const ConfirmationContext = createContext<Confirm | null>(null)

/** A single app-owned confirmation surface, including when a sheet is open. */
export function ConfirmationProvider({ children }: { children: ReactNode }) {
  const { tokens, theme } = useTheme()
  const [request, setRequest] = useState<ConfirmationRequest | null>(null)
  const pending = useRef<((accepted: boolean) => void) | null>(null)
  const nextId = useRef(0)

  const finish = useCallback((accepted: boolean) => {
    const resolve = pending.current
    pending.current = null
    setRequest(null)
    resolve?.(accepted)
  }, [])
  useEffect(() => () => {
    pending.current?.(false)
    pending.current = null
  }, [])
  const confirm = useCallback<Confirm>(options => {
    if (pending.current) return Promise.resolve(false)
    Keyboard.dismiss()
    return new Promise<boolean>(resolve => {
      pending.current = resolve
      setRequest({ ...options, id: ++nextId.current })
    })
  }, [])

  return <ConfirmationContext.Provider value={confirm}>
    {children}
    {request ? <Modal visible transparent animationType={theme === 'eink' ? 'none' : 'fade'} onRequestClose={() => finish(false)} statusBarTranslucent accessibilityViewIsModal>
      <View style={[styles.backdrop, { backgroundColor: theme === 'eink' ? tokens.bg : 'rgba(0,0,0,0.58)' }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={() => finish(false)} accessibilityLabel="Cancel confirmation" />
        {request ? <View key={request.id} style={[styles.dialog, { backgroundColor: tokens.surface, borderColor: tokens.border }]} accessibilityRole="alert">
          <Text style={[styles.title, { color: tokens.text }]}>{request.title}</Text>
          <Text style={[styles.message, { color: tokens.textMuted }]}>{request.message}</Text>
          <View style={styles.actions}>
            <Pressable onPress={() => finish(false)} accessibilityRole="button" style={[styles.action, { borderColor: tokens.border }]}><Text style={[styles.actionText, { color: tokens.text }]}>{request.cancelLabel ?? 'Cancel'}</Text></Pressable>
            <Pressable onPress={() => finish(true)} accessibilityRole="button" style={[styles.action, { borderColor: tokens.border, backgroundColor: request.destructive && theme !== 'eink' ? tokens.warmGlow : tokens.accent }]}><Text style={[styles.actionText, { color: request.destructive && theme !== 'eink' ? tokens.warm : '#fff' }]}>{request.confirmLabel}</Text></Pressable>
          </View>
        </View> : null}
      </View>
    </Modal> : null}
  </ConfirmationContext.Provider>
}

export function useConfirmation(): Confirm {
  const context = useContext(ConfirmationContext)
  if (!context) throw new Error('useConfirmation must be used inside ConfirmationProvider')
  return context
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, padding: 24, justifyContent: 'center', alignItems: 'center' },
  dialog: { width: '100%', maxWidth: 420, padding: 22, borderWidth: 1.5, borderRadius: 20, gap: 14 },
  title: { fontSize: 20, fontWeight: '800' },
  message: { fontSize: 14, lineHeight: 21 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', flexWrap: 'wrap', gap: 10, marginTop: 6 },
  action: { minHeight: 44, minWidth: 88, paddingHorizontal: 16, borderRadius: 22, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  actionText: { fontSize: 13, fontWeight: '700' },
})
