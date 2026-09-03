import { useEffect, useRef } from 'react'
import { Animated, Pressable, StyleSheet } from 'react-native'
import { useReducedMotion } from 'react-native-reanimated'
import { useTheme } from '../theme/ThemeContext'

interface Props {
  value: boolean
  onChange: (v: boolean) => void
  accessibilityLabel?: string
}

// Pill toggle switch — ported from legacy-web .toggle/.toggle-track/.toggle-thumb.
export function Toggle({ value, onChange, accessibilityLabel }: Props) {
  const { tokens } = useTheme()
  const reducedMotion = useReducedMotion()
  const anim = useRef(new Animated.Value(value ? 1 : 0)).current

  useEffect(() => {
    Animated.timing(anim, {
      toValue: value ? 1 : 0,
      duration: reducedMotion ? 0 : 200,
      useNativeDriver: false,
    }).start()
  }, [value, anim, reducedMotion])

  const trackColor = anim.interpolate({
    inputRange: [0, 1],
    outputRange: [tokens.surfaceHi, tokens.accent],
  })
  const thumbColor = anim.interpolate({
    inputRange: [0, 1],
    outputRange: [tokens.textMuted, '#fff'],
  })
  const thumbTranslate = anim.interpolate({
    inputRange: [0, 1],
    outputRange: [3, 21],
  })

  return (
    <Pressable
      onPress={() => onChange(!value)}
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
      accessibilityLabel={accessibilityLabel}
      hitSlop={8}
    >
      <Animated.View style={[styles.track, { backgroundColor: trackColor, borderColor: value ? tokens.accent : tokens.border }]}>
        <Animated.View style={[styles.thumb, { backgroundColor: thumbColor, transform: [{ translateX: thumbTranslate }] }]} />
      </Animated.View>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  track: {
    width: 44,
    height: 26,
    borderRadius: 9999,
    borderWidth: 1.5,
    justifyContent: 'center',
  },
  thumb: {
    position: 'absolute',
    top: 3,
    width: 18,
    height: 18,
    borderRadius: 9,
  },
})
