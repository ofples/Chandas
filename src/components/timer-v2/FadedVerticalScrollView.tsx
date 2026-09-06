import { useCallback, useState, type ReactNode } from 'react'
import { ScrollView, StyleSheet, View, type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent, type ScrollViewProps } from 'react-native'
import Animated, { FadeIn, FadeOut, useReducedMotion } from 'react-native-reanimated'
import { ScrollEdgeFade } from './ScrollEdgeFade'

interface Props extends Omit<ScrollViewProps, 'horizontal' | 'showsVerticalScrollIndicator'> {
  children: ReactNode
  fadeColor: string
}

/** A vertical scroller that gently marks only the edges with hidden content. */
export function FadedVerticalScrollView({ children, fadeColor, style, contentContainerStyle, onLayout, onContentSizeChange, onScroll, ...props }: Props) {
  const reducedMotion = useReducedMotion()
  const [viewportHeight, setViewportHeight] = useState(0)
  const [contentHeight, setContentHeight] = useState(0)
  const [offset, setOffset] = useState(0)
  const overflow = contentHeight > viewportHeight + 2
  const showTop = overflow && offset > 2
  const showBottom = overflow && offset + viewportHeight < contentHeight - 2

  const handleLayout = useCallback((event: LayoutChangeEvent) => {
    setViewportHeight(event.nativeEvent.layout.height)
    onLayout?.(event)
  }, [onLayout])
  const handleContentSizeChange = useCallback((width: number, height: number) => {
    setContentHeight(height)
    onContentSizeChange?.(width, height)
  }, [onContentSizeChange])
  const handleScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    setOffset(Math.max(0, event.nativeEvent.contentOffset.y))
    onScroll?.(event)
  }, [onScroll])

  const enter = reducedMotion ? undefined : FadeIn.duration(110)
  const exit = reducedMotion ? undefined : FadeOut.duration(90)
  return <View style={[styles.wrap, style]} onLayout={handleLayout}>
    <ScrollView
      {...props}
      showsVerticalScrollIndicator={false}
      onScroll={handleScroll}
      scrollEventThrottle={16}
      onContentSizeChange={handleContentSizeChange}
      contentContainerStyle={contentContainerStyle}
      style={styles.scroll}
    >
      {children}
    </ScrollView>
    {showTop ? <Animated.View pointerEvents="none" entering={enter} exiting={exit} style={StyleSheet.absoluteFill}><ScrollEdgeFade color={fadeColor} side="top" /></Animated.View> : null}
    {showBottom ? <Animated.View pointerEvents="none" entering={enter} exiting={exit} style={StyleSheet.absoluteFill}><ScrollEdgeFade color={fadeColor} side="bottom" /></Animated.View> : null}
  </View>
}

const styles = StyleSheet.create({
  wrap: { flexShrink: 1, minHeight: 0, position: 'relative' },
  scroll: { flexShrink: 1, minHeight: 0 },
})
