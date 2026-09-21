import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { ScrollView, StyleSheet, View, type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent, type ScrollViewProps } from 'react-native'
import Animated, { FadeIn, FadeOut, useReducedMotion } from 'react-native-reanimated'
import { ScrollEdgeFade } from './ScrollEdgeFade'

interface Props extends Omit<ScrollViewProps, 'horizontal' | 'showsVerticalScrollIndicator'> {
  children: ReactNode
  fadeColor: string
  resetKey?: unknown
}

/** A vertical scroller that gently marks only the edges with hidden content. */
export function FadedVerticalScrollView({ children, fadeColor, resetKey, style, contentContainerStyle, onLayout, onContentSizeChange, onScroll, onScrollBeginDrag, ...props }: Props) {
  const reducedMotion = useReducedMotion()
  const scrollRef = useRef<ScrollView>(null)
  const [viewportHeight, setViewportHeight] = useState(0)
  const [contentHeight, setContentHeight] = useState(0)
  const [offset, setOffset] = useState(0)
  const [userHasScrolled, setUserHasScrolled] = useState(false)
  const overflow = contentHeight > viewportHeight + 2
  const showTop = overflow && userHasScrolled && offset > 2
  const showBottom = overflow && offset + viewportHeight < contentHeight - 2

  useLayoutEffect(() => {
    setOffset(0)
    setUserHasScrolled(false)
    scrollRef.current?.scrollTo({ y: 0, animated: false })
    requestAnimationFrame(() => scrollRef.current?.scrollTo({ y: 0, animated: false }))
  }, [resetKey])

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
  const handleScrollBeginDrag = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    setUserHasScrolled(true)
    onScrollBeginDrag?.(event)
  }, [onScrollBeginDrag])

  const enter = reducedMotion ? undefined : FadeIn.duration(110)
  const exit = reducedMotion ? undefined : FadeOut.duration(90)
  return <View style={[styles.wrap, style]} onLayout={handleLayout}>
    <ScrollView
      ref={scrollRef}
      {...props}
      showsVerticalScrollIndicator={false}
      onScroll={handleScroll}
      onScrollBeginDrag={handleScrollBeginDrag}
      scrollEventThrottle={16}
      onContentSizeChange={handleContentSizeChange}
      contentContainerStyle={contentContainerStyle}
      style={styles.scroll}
    >
      {children}
    </ScrollView>
    {showTop ? <Animated.View pointerEvents="none" entering={enter} exiting={exit} style={StyleSheet.absoluteFill}><ScrollEdgeFade color={fadeColor} side="top" size={20} /></Animated.View> : null}
    {showBottom ? <Animated.View pointerEvents="none" entering={enter} exiting={exit} style={StyleSheet.absoluteFill}><ScrollEdgeFade color={fadeColor} side="bottom" size={20} /></Animated.View> : null}
  </View>
}

const styles = StyleSheet.create({
  wrap: { flexShrink: 1, minHeight: 0, position: 'relative' },
  scroll: { flexShrink: 1, minHeight: 0 },
})
