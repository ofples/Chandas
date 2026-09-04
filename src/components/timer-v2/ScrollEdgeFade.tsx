import { useId } from 'react'
import { StyleSheet } from 'react-native'
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg'

/** A non-interactive hint that horizontally scrolling choices continue beneath a fixed trailing action. */
export function ScrollEdgeFade({ color }: { color: string }) {
  const gradientId = `choice-edge-fade-${useId().replace(/:/g, '')}`
  return <Svg pointerEvents="none" width={34} height="100%" style={styles.fade}>
    <Defs>
      <LinearGradient id={gradientId} x1="0" y1="0" x2="1" y2="0">
        <Stop offset="0" stopColor={color} stopOpacity={0} />
        <Stop offset="0.55" stopColor={color} stopOpacity={0.76} />
        <Stop offset="1" stopColor={color} stopOpacity={1} />
      </LinearGradient>
    </Defs>
    <Rect x="0" y="0" width="34" height="100%" fill={`url(#${gradientId})`} />
  </Svg>
}

const styles = StyleSheet.create({
  // The slight overlap avoids a one-pixel compositing seam at the clipped edge.
  fade: { position: 'absolute', top: 0, right: -2, bottom: 0 },
})
