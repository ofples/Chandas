import { useCallback, useEffect, useRef } from 'react'
import { BackHandler, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native'
import { useTheme } from '../theme/ThemeContext'
import { FlashingTimerCircle } from '../components/FlashingTimerCircle'
import { tapHaptic } from '../lib/haptics'

interface Props {
  onDismiss: () => void
}

export function AlarmRingingScreen({ onDismiss }: Props) {
  const { tokens } = useTheme()
  const { width } = useWindowDimensions()
  const ringSize = Math.min(width * 0.78, 320)
  const dismissing = useRef(false)
  const dismiss = useCallback(() => {
    if (dismissing.current) return
    dismissing.current = true
    tapHaptic()
    onDismiss()
  }, [onDismiss])

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      dismiss()
      return true
    })
    return () => subscription.remove()
  }, [dismiss])

  return (
    <Pressable
      onPress={dismiss}
      style={[styles.screen, { backgroundColor: tokens.bg }]}
      accessibilityRole="button"
      accessibilityLabel="Dismiss alarm"
      accessibilityHint="Tap anywhere to dismiss the alarm"
      accessibilityViewIsModal
    >
      <View style={styles.content} pointerEvents="none">
        <View style={[styles.ringWrap, { width: ringSize, height: ringSize }]}>
          <FlashingTimerCircle size={ringSize} color={tokens.accent} continuous duration={2_400} />
        </View>
      </View>
    </Pressable>
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
  },
  ringWrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
})
