import { Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native'
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
    <View style={[styles.screen, { backgroundColor: tokens.bg, paddingTop: insets.top }]}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 132 }]}
        showsVerticalScrollIndicator={false}
      >
        <Pressable
          onPress={onDismiss}
          style={[styles.ringWrap, { width: ringSize, height: ringSize }]}
          accessibilityRole="button"
          accessibilityLabel="Dismiss alarm"
        >
          <FlashingTimerCircle size={ringSize} color={tokens.accent} continuous duration={2_400} />
        </Pressable>
      </ScrollView>
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
  scroll: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  ringWrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
})
