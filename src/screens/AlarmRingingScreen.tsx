import { useCallback } from 'react'
import { Modal, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native'
import { useTheme } from '../theme/ThemeContext'
import { FlashingTimerCircle } from '../components/FlashingTimerCircle'
import { tapHaptic } from '../lib/haptics'

interface Props {
  name?: string
  onDismiss: () => void
}

export function AlarmRingingScreen({ name, onDismiss }: Props) {
  const { tokens } = useTheme()
  const { width } = useWindowDimensions()
  const ringSize = Math.min(width * 0.78, 320)
  const dismiss = useCallback(() => {
    tapHaptic()
    onDismiss()
  }, [onDismiss])

  return (
    <Modal visible transparent animationType="none" statusBarTranslucent onRequestClose={dismiss}>
      <Pressable
        onPress={dismiss}
        style={[styles.screen, { backgroundColor: tokens.bg }]}
        accessibilityRole="button"
        accessibilityLabel={name ? `Dismiss ${name} alarm` : 'Dismiss alarm'}
        accessibilityHint="Tap anywhere to dismiss the alarm"
        accessibilityViewIsModal
      >
        <View style={styles.content} pointerEvents="none">
          <View style={[styles.ringWrap, { width: ringSize, height: ringSize }]}>
            <FlashingTimerCircle size={ringSize} color={tokens.accent} continuous duration={2_400} />
          </View>
          {name && <Text numberOfLines={1} style={[styles.name, { color: tokens.text }]}>{name}</Text>}
        </View>
      </Pressable>
    </Modal>
  )
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  name: { marginTop: 20, maxWidth: '84%', fontSize: 16 },
  ringWrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
})
