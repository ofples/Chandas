import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTheme } from '../theme/ThemeContext'
import { FlashingTimerCircle } from '../components/FlashingTimerCircle'

interface Props {
  onDismiss: () => void
}

export function AlarmRingingScreen({ onDismiss }: Props) {
  const { tokens } = useTheme()
  const insets = useSafeAreaInsets()
  const { width } = useWindowDimensions()
  const ringSize = Math.min(width * 0.78, 320)

  return (
    <View
      style={[styles.screen, { backgroundColor: tokens.bg, paddingTop: insets.top }]}
      accessibilityViewIsModal
    >
      <View style={[styles.content, { paddingBottom: insets.bottom + 104 }]} pointerEvents="none">
        <View style={[styles.ringWrap, { width: ringSize, height: ringSize }]}>
          <FlashingTimerCircle size={ringSize} color={tokens.accent} continuous duration={2_400} />
          <View style={styles.copy}>
            <Text style={[styles.eyebrow, { color: tokens.textMuted }]}>ALARM</Text>
            <Text accessibilityRole="header" accessibilityLiveRegion="assertive" style={[styles.title, { color: tokens.text }]}>Main interval complete</Text>
          </View>
        </View>
      </View>

      <View style={[styles.bottom, { backgroundColor: tokens.bg, paddingBottom: insets.bottom + 20 }]}>
        <View style={styles.bottomInner}>
          <Pressable
            onPress={onDismiss}
            style={({ pressed }) => [
              styles.dismissBtn,
              {
                backgroundColor: tokens.surfaceHi,
                borderColor: tokens.border,
                transform: [{ scale: pressed ? 0.97 : 1 }],
              },
            ]}
            accessibilityRole="button"
            accessibilityLabel="Dismiss alarm"
          >
            <Text style={[styles.dismissLabel, { color: tokens.textMuted }]}>Dismiss</Text>
          </Pressable>
        </View>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 100,
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  ringWrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  copy: { alignItems: 'center', gap: 7, zIndex: 1, paddingHorizontal: 28 },
  eyebrow: { fontSize: 11, fontWeight: '800', letterSpacing: 1.5 },
  title: { fontSize: 23, lineHeight: 29, fontWeight: '700', textAlign: 'center' },
  bottom: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  bottomInner: {
    width: '100%',
    maxWidth: 420,
  },
  dismissBtn: {
    width: '100%',
    borderWidth: 1.5,
    borderRadius: 9999,
    paddingVertical: 16,
    alignItems: 'center',
  },
  dismissLabel: {
    fontSize: 15,
    fontWeight: '600',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
})
