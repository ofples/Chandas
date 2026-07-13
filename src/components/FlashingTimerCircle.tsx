import { useEffect, useRef } from 'react'
import { Animated, StyleSheet } from 'react-native'
import Svg, { Circle } from 'react-native-svg'

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

const AnimatedCircle = Animated.createAnimatedComponent(Circle)

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

  return (
    <Svg
      pointerEvents="none"
      width={size}
      height={size}
      viewBox={`0 0 ${TIMER_CIRCLE_VIEW} ${TIMER_CIRCLE_VIEW}`}
      style={styles.circle}
    >
      <AnimatedCircle
        cx={TIMER_CIRCLE_CENTER}
        cy={TIMER_CIRCLE_CENTER}
        r={TIMER_CIRCLE_RADIUS}
        fill={fill}
        opacity={opacity}
      />
    </Svg>
  )
}

const styles = StyleSheet.create({
  circle: {
    position: 'absolute',
  },
})
