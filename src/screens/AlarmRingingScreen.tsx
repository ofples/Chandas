import { useEffect, useRef } from 'react'
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTheme } from '../theme/ThemeContext'
import { AlarmIcon } from '../components/Icons'

interface Props {
  onDismiss: () => void
}

// Full-screen alarm overlay — shown whenever the native service (or the JS
// fallback) reports it's ringing. Covers whatever screen is underneath, the
// same way a real alarm clock takes over until dismissed.
export function AlarmRingingScreen({ onDismiss }: Props) {
  const { tokens } = useTheme()
  const insets = useSafeAreaInsets()
  const pulse = useRef(new Animated.Value(0)).current

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 600, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 600, useNativeDriver: true }),
      ])
    )
    loop.start()
    return () => loop.stop()
  }, [pulse])

  const scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.15] })

  return (
    <View
      style={[
        styles.screen,
        { backgroundColor: tokens.bg, paddingTop: Math.max(insets.top, 24), paddingBottom: Math.max(insets.bottom, 24) },
      ]}
    >
      <View style={styles.center}>
        <Animated.View style={[styles.iconWrap, { borderColor: tokens.accent, transform: [{ scale }] }]}>
          <AlarmIcon color={tokens.accent} size={40} />
        </Animated.View>
        <Text style={[styles.title, { color: tokens.text }]}>Time's up</Text>
        <Text style={[styles.subtitle, { color: tokens.textMuted }]}>Alarm mode is ringing</Text>
      </View>

      <Pressable
        onPress={onDismiss}
        style={({ pressed }) => [
          styles.dismissBtn,
          { backgroundColor: tokens.accent, transform: [{ scale: pressed ? 0.97 : 1 }] },
        ]}
      >
        <Text style={styles.dismissLabel}>Dismiss</Text>
      </Pressable>
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
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
  },
  iconWrap: {
    width: 96,
    height: 96,
    borderRadius: 48,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 28,
    fontWeight: '600',
  },
  subtitle: {
    fontSize: 14,
  },
  dismissBtn: {
    width: '100%',
    maxWidth: 420,
    paddingVertical: 18,
    borderRadius: 9999,
    alignItems: 'center',
  },
  dismissLabel: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
})
