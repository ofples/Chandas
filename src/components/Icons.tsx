// Icons ported 1:1 from legacy-web (inline SVG) using react-native-svg.
import Svg, { Circle, Line, Path } from 'react-native-svg'

export function ThemeIcon({ dark, color }: { dark: boolean; color: string }) {
  if (dark) {
    // Sun icon — tap to go light
    return (
      <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
        <Circle cx={12} cy={12} r={5} stroke={color} strokeWidth={2} />
        <Line x1={12} y1={2} x2={12} y2={4} stroke={color} strokeWidth={2} strokeLinecap="round" />
        <Line x1={12} y1={20} x2={12} y2={22} stroke={color} strokeWidth={2} strokeLinecap="round" />
        <Line x1={2} y1={12} x2={4} y2={12} stroke={color} strokeWidth={2} strokeLinecap="round" />
        <Line x1={20} y1={12} x2={22} y2={12} stroke={color} strokeWidth={2} strokeLinecap="round" />
        <Line x1={4.22} y1={4.22} x2={5.64} y2={5.64} stroke={color} strokeWidth={2} strokeLinecap="round" />
        <Line x1={18.36} y1={18.36} x2={19.78} y2={19.78} stroke={color} strokeWidth={2} strokeLinecap="round" />
        <Line x1={4.22} y1={19.78} x2={5.64} y2={18.36} stroke={color} strokeWidth={2} strokeLinecap="round" />
        <Line x1={18.36} y1={5.64} x2={19.78} y2={4.22} stroke={color} strokeWidth={2} strokeLinecap="round" />
      </Svg>
    )
  }
  // Moon icon — tap to go dark
  return (
    <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
      <Path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"
        stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  )
}

export function BellIcon({ on, muted, color }: { on?: boolean; muted?: boolean; color: string }) {
  const slashed = muted ?? !on
  return (
    <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
      <Path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"
        stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M13.73 21a2 2 0 0 1-3.46 0"
        stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      {slashed && (
        <Line x1={2} y1={2} x2={22} y2={22} stroke={color} strokeWidth={2} strokeLinecap="round" />
      )}
    </Svg>
  )
}

export function VolumeIcon({ level, muted, color }: { level?: number; muted?: boolean; color: string }) {
  if (level !== undefined) {
    // Config-screen style volume icon (level-based)
    return (
      <Svg width={16} height={16} viewBox="0 0 16 16" fill="none">
        <Path d="M2 5.5h2.5L8 2.5v11L4.5 10.5H2z" fill={color} opacity={level === 0 ? 0.3 : 1} />
        {level > 0 && (
          <Path d="M10 5a4 4 0 0 1 0 6" stroke={color} strokeWidth={1.4} strokeLinecap="round" fill="none" />
        )}
        {level > 0.5 && (
          <Path d="M11.5 3a7 7 0 0 1 0 10" stroke={color} strokeWidth={1.4} strokeLinecap="round" fill="none" opacity={0.5} />
        )}
      </Svg>
    )
  }
  // Running-screen style volume icon (muted-based)
  return (
    <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
      <Path d="M11 5L6 9H2v6h4l5 4V5z" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      {muted ? (
        <Path d="M23 9l-6 6M17 9l6 6" stroke={color} strokeWidth={2} strokeLinecap="round" />
      ) : (
        <>
          <Path d="M15.54 8.46a5 5 0 0 1 0 7.07" stroke={color} strokeWidth={2} strokeLinecap="round" />
          <Path d="M19.07 4.93a10 10 0 0 1 0 14.14" stroke={color} strokeWidth={2} strokeLinecap="round" />
        </>
      )}
    </Svg>
  )
}

export function NoteIcon({ color }: { color: string }) {
  return (
    <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
      <Path d="M9 18V5l12-2v13" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      <Circle cx={6} cy={18} r={3} stroke={color} strokeWidth={2} />
      <Circle cx={18} cy={16} r={3} stroke={color} strokeWidth={2} />
    </Svg>
  )
}
