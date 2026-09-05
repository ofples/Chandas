import { useId } from 'react'
import { StyleSheet } from 'react-native'
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg'

/** A non-interactive hint that horizontally scrolling choices continue beyond an edge. */
export function ScrollEdgeFade({ color, side }: { color: string; side: 'left' | 'right' }) {
  const gradientId = `choice-edge-fade-${side}-${useId().replace(/:/g, '')}`
  return <Svg pointerEvents="none" width={34} height="100%" style={[styles.fade, side === 'left' ? styles.left : styles.right]}>
    <Defs>
      <LinearGradient id={gradientId} x1="0" y1="0" x2="1" y2="0">
        <Stop offset="0" stopColor={color} stopOpacity={side === 'left' ? 1 : 0} />
        <Stop offset="0.45" stopColor={color} stopOpacity={0.76} />
        <Stop offset="1" stopColor={color} stopOpacity={side === 'left' ? 0 : 1} />
      </LinearGradient>
    </Defs>
    <Rect x="0" y="0" width="34" height="100%" fill={`url(#${gradientId})`} />
  </Svg>
}

const styles = StyleSheet.create({
  // The slight overlap avoids a one-pixel compositing seam at the clipped edge.
  fade: { position: 'absolute', top: 0, bottom: 0 },
  left: { left: -2 },
  right: { right: -2 },
})
