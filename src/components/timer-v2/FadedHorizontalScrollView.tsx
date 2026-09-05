import { useCallback, useState, type ReactNode } from 'react'
import { ScrollView, StyleSheet, View, type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent, type ScrollViewProps } from 'react-native'
import Animated, { FadeIn, FadeOut, useReducedMotion } from 'react-native-reanimated'
import { ScrollEdgeFade } from './ScrollEdgeFade'

interface Props extends Omit<ScrollViewProps, 'horizontal' | 'showsHorizontalScrollIndicator' | 'onScroll'> {
  children: ReactNode
  fadeColor: string
}

/** Shared horizontal rail with edge-aware continuation scrims. */
export function FadedHorizontalScrollView({ children, fadeColor, style, contentContainerStyle, onLayout, onContentSizeChange, ...props }: Props) {
  const reducedMotion = useReducedMotion()
  const [viewportWidth, setViewportWidth] = useState(0)
  const [contentWidth, setContentWidth] = useState(0)
  const [offset, setOffset] = useState(0)
  const overflow = contentWidth > viewportWidth + 2
  const showLeft = overflow && offset > 2
  const showRight = overflow && offset + viewportWidth < contentWidth - 2
  const handleLayout = useCallback((event: LayoutChangeEvent) => {
    setViewportWidth(event.nativeEvent.layout.width)
    onLayout?.(event)
  }, [onLayout])
  const handleContentSizeChange = useCallback((width: number, height: number) => {
    setContentWidth(width)
    onContentSizeChange?.(width, height)
  }, [onContentSizeChange])
  const handleScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    setOffset(Math.max(0, event.nativeEvent.contentOffset.x))
  }, [])

  const transition = reducedMotion ? undefined : FadeIn.duration(110)
  const exit = reducedMotion ? undefined : FadeOut.duration(90)
  return <View style={[styles.wrap, style]} onLayout={handleLayout}>
    <ScrollView
      {...props}
      horizontal
      showsHorizontalScrollIndicator={false}
      onScroll={handleScroll}
      scrollEventThrottle={16}
      onContentSizeChange={handleContentSizeChange}
      contentContainerStyle={contentContainerStyle}
      style={styles.scroll}
    >
      {children}
    </ScrollView>
    {showLeft ? <Animated.View pointerEvents="none" entering={transition} exiting={exit} style={StyleSheet.absoluteFill}><ScrollEdgeFade color={fadeColor} side="left" /></Animated.View> : null}
    {showRight ? <Animated.View pointerEvents="none" entering={transition} exiting={exit} style={StyleSheet.absoluteFill}><ScrollEdgeFade color={fadeColor} side="right" /></Animated.View> : null}
  </View>
}

const styles = StyleSheet.create({
  wrap: { minWidth: 0, position: 'relative' },
  scroll: { flex: 1, minWidth: 0 },
})
