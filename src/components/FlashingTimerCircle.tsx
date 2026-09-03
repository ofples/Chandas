import { useEffect, useRef } from 'react'
import { Animated, StyleSheet } from 'react-native'

export const TIMER_CIRCLE_VIEW = 300
export const TIMER_CIRCLE_CENTER = TIMER_CIRCLE_VIEW / 2
export const TIMER_CIRCLE_RADIUS = 130

interface Props {
  size: number
  color: string
  continuous?: boolean
  trigger?: number
  flashes?: number
  duration?: number
}

export function FlashingTimerCircle({
  size,
  color,
  continuous = false,
  trigger = 0,
  flashes = 1,
  duration = 600,
}: Props) {
  const progress = useRef(new Animated.Value(0)).current

  useEffect(() => {
    progress.stopAnimation()
    progress.setValue(0)

    if (continuous) {
      const loop = Animated.loop(
        Animated.timing(progress, {
          toValue: 1,
          duration,
          useNativeDriver: false,
        })
      )
      loop.start()
      return () => loop.stop()
    }

    if (trigger === 0) return

    const sequence = Animated.sequence(
      Array.from({ length: Math.max(1, flashes) }).flatMap(() => [
        Animated.timing(progress, {
          toValue: 1,
          duration,
          useNativeDriver: false,
        }),
        Animated.timing(progress, {
          toValue: 0,
          duration: 0,
          useNativeDriver: false,
        }),
      ])
    )
    sequence.start()
    return () => sequence.stop()
  }, [continuous, duration, flashes, progress, trigger])

  const fill = progress.interpolate({
    inputRange: [0, 0.33, 0.66, 1],
    outputRange: [color, color, '#ffffff', color],
  })
  const opacity = progress.interpolate({
    inputRange: continuous ? [0, 0.33, 0.66, 1] : [0, 0.01, 0.33, 0.66, 0.99, 1],
    outputRange: continuous ? [0.5, 1, 1, 0.5] : [0, 0.5, 1, 1, 0.5, 0],
  })
  const diameter = size * (TIMER_CIRCLE_RADIUS * 2 / TIMER_CIRCLE_VIEW)
  const inset = (size - diameter) / 2

  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.circle, {
        top: inset,
        left: inset,
        width: diameter,
        height: diameter,
        borderRadius: diameter / 2,
        backgroundColor: fill,
        opacity,
      }]}
    />
  )
}

const styles = StyleSheet.create({
  circle: {
    position: 'absolute',
  },
})
