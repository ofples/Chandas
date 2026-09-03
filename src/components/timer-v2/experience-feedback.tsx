import { useEffect } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'
import Animated, { FadeIn, FadeInDown, FadeOut, useReducedMotion } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTheme } from '../../theme/ThemeContext'

export type AppNoticeTone = 'info' | 'success' | 'attention'

export interface AppNotice {
  id: string
  title: string
  message?: string
  tone?: AppNoticeTone
  actionLabel?: string
  onAction?: () => void
  persistent?: boolean
}

interface FeedbackBannerProps {
  notice: AppNotice | null
  onDismiss: () => void
}

/** A calm, non-blocking replacement for recoverable system alerts. */
export function FeedbackBanner({ notice, onDismiss }: FeedbackBannerProps) {
  const { tokens } = useTheme()
  const insets = useSafeAreaInsets()
  const reducedMotion = useReducedMotion()

  useEffect(() => {
    if (!notice || notice.persistent) return
    const timeout = setTimeout(onDismiss, notice.actionLabel ? 6_500 : 4_200)
    return () => clearTimeout(timeout)
  }, [notice, onDismiss])

  if (!notice) return null
  const marker = notice.tone === 'success' ? '✓' : notice.tone === 'attention' ? '!' : 'i'
  const markerColor = notice.tone === 'success' ? tokens.positive : notice.tone === 'attention' ? tokens.warm : tokens.accent

  return (
    <View pointerEvents="box-none" style={[styles.bannerLayer, { paddingTop: insets.top + 10 }]}>
      <Animated.View
        key={notice.id}
        entering={reducedMotion ? FadeIn.duration(120) : FadeInDown.duration(220)}
        exiting={FadeOut.duration(reducedMotion ? 80 : 160)}
        style={[styles.banner, { backgroundColor: tokens.surface, borderColor: tokens.border }]}
        accessibilityRole="alert"
        accessibilityLiveRegion="polite"
      >
        <View style={[styles.marker, { borderColor: markerColor, backgroundColor: tokens.surfaceHi }]}>
          <Text style={[styles.markerText, { color: markerColor }]}>{marker}</Text>
        </View>
        <View style={styles.bannerCopy}>
          <Text selectable style={[styles.bannerTitle, { color: tokens.text }]}>{notice.title}</Text>
          {notice.message ? <Text selectable style={[styles.bannerMessage, { color: tokens.textMuted }]}>{notice.message}</Text> : null}
        </View>
        {notice.actionLabel && notice.onAction ? (
          <Pressable
            onPress={() => { notice.onAction?.(); onDismiss() }}
            accessibilityRole="button"
            style={({ pressed }) => [styles.bannerAction, { borderColor: tokens.accent, opacity: pressed ? 0.68 : 1 }]}
          >
            <Text style={[styles.bannerActionText, { color: tokens.accent }]}>{notice.actionLabel}</Text>
          </Pressable>
        ) : null}
        <Pressable hitSlop={10} onPress={onDismiss} accessibilityRole="button" accessibilityLabel="Dismiss message" style={styles.dismiss}>
          <Text style={[styles.dismissText, { color: tokens.textMuted }]}>×</Text>
        </Pressable>
      </Animated.View>
    </View>
  )
}

export function GentleNotice({ title, message, tone = 'info' }: Pick<AppNotice, 'title' | 'message' | 'tone'>) {
  const { tokens } = useTheme()
  const reducedMotion = useReducedMotion()
  const marker = tone === 'success' ? '✓' : tone === 'attention' ? '!' : 'i'
  const markerColor = tone === 'success' ? tokens.positive : tone === 'attention' ? tokens.warm : tokens.accent
  return (
    <Animated.View
      entering={FadeIn.duration(reducedMotion ? 80 : 180)}
      exiting={FadeOut.duration(reducedMotion ? 80 : 140)}
      style={[styles.inline, { borderColor: tokens.border, backgroundColor: tokens.surfaceHi }]}
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
    >
      <Text style={[styles.inlineMarker, { color: markerColor }]}>{marker}</Text>
      <View style={styles.bannerCopy}>
        <Text selectable style={[styles.inlineTitle, { color: tokens.text }]}>{title}</Text>
        {message ? <Text selectable style={[styles.bannerMessage, { color: tokens.textMuted }]}>{message}</Text> : null}
      </View>
    </Animated.View>
  )
}

interface AppLoadingScreenProps {
  backgroundColor: string
  accentColor: string
  textColor: string
  message?: string
}

export function AppLoadingScreen({ backgroundColor, accentColor, textColor, message = 'Restoring your rhythm…' }: AppLoadingScreenProps) {
  const reducedMotion = useReducedMotion()
  return (
    <View style={[styles.loading, { backgroundColor }]} accessibilityRole="progressbar" accessibilityLabel={message}>
      <Animated.View entering={FadeIn.duration(reducedMotion ? 80 : 260)} style={styles.loadingContent}>
        <View style={[styles.loadingMark, { borderColor: accentColor }]}>
          <ActivityIndicator color={accentColor} size="small" />
        </View>
        <Text style={[styles.loadingBrand, { color: textColor }]}>CHANDAS</Text>
        <Text style={[styles.loadingMessage, { color: textColor }]}>{message}</Text>
      </Animated.View>
    </View>
  )
}

const styles = StyleSheet.create({
  bannerLayer: { position: 'absolute', zIndex: 1000, left: 12, right: 12, top: 0, alignItems: 'center' },
  banner: { width: '100%', maxWidth: 560, minHeight: 64, borderWidth: 1.5, borderRadius: 18, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 10, boxShadow: '0 8px 28px rgba(0,0,0,0.22)' },
  marker: { width: 30, height: 30, borderWidth: 1.5, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  markerText: { fontSize: 13, fontWeight: '900' },
  bannerCopy: { flex: 1, minWidth: 0, gap: 2 },
  bannerTitle: { fontSize: 13, lineHeight: 18, fontWeight: '800' },
  bannerMessage: { fontSize: 11, lineHeight: 16 },
  bannerAction: { minHeight: 38, justifyContent: 'center', paddingHorizontal: 10, borderWidth: 1.5, borderRadius: 9999 },
  bannerActionText: { fontSize: 11, fontWeight: '800' },
  dismiss: { width: 30, height: 38, alignItems: 'center', justifyContent: 'center' },
  dismissText: { fontSize: 21, lineHeight: 23, fontWeight: '400' },
  inline: { borderWidth: 1, borderRadius: 13, padding: 12, flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  inlineMarker: { width: 18, paddingTop: 1, textAlign: 'center', fontSize: 12, fontWeight: '900' },
  inlineTitle: { fontSize: 12, lineHeight: 17, fontWeight: '700' },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  loadingContent: { alignItems: 'center', gap: 10, padding: 24 },
  loadingMark: { width: 56, height: 56, borderWidth: 1.5, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
  loadingBrand: { fontSize: 11, fontWeight: '800', letterSpacing: 2, opacity: 0.9 },
  loadingMessage: { fontSize: 12, opacity: 0.55 },
})
