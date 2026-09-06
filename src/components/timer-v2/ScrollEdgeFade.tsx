import { useId } from 'react'
import { StyleSheet } from 'react-native'
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg'

/** A non-interactive hint that scrollable content continues beyond an edge. */
export function ScrollEdgeFade({ color, side }: { color: string; side: 'left' | 'right' | 'top' | 'bottom' }) {
  const gradientId = `choice-edge-fade-${side}-${useId().replace(/:/g, '')}`
  const vertical = side === 'top' || side === 'bottom'
  const startsOpaque = side === 'left' || side === 'top'
  return <Svg pointerEvents="none" width={vertical ? '100%' : 34} height={vertical ? 34 : '100%'} style={[styles.fade, styles[side]]}>
    <Defs>
      <LinearGradient id={gradientId} x1="0" y1="0" x2={vertical ? '0' : '1'} y2={vertical ? '1' : '0'}>
        <Stop offset="0" stopColor={color} stopOpacity={startsOpaque ? 1 : 0} />
        <Stop offset="0.45" stopColor={color} stopOpacity={0.76} />
        <Stop offset="1" stopColor={color} stopOpacity={startsOpaque ? 0 : 1} />
      </LinearGradient>
    </Defs>
    <Rect x="0" y="0" width={vertical ? '100%' : 34} height={vertical ? 34 : '100%'} fill={`url(#${gradientId})`} />
  </Svg>
}

const styles = StyleSheet.create({
  // The slight overlap avoids a one-pixel compositing seam at the clipped edge.
  fade: { position: 'absolute', top: 0, bottom: 0 },
  left: { left: -2 },
  right: { right: -2 },
  top: { left: 0, right: 0, top: -2 },
  bottom: { left: 0, right: 0, bottom: -2 },
})
