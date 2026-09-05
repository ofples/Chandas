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

export function MixerIcon({ color }: { color: string }) {
  return (
    <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
      <Line x1={4} y1={6} x2={20} y2={6} stroke={color} strokeWidth={1.8} strokeLinecap="round" />
      <Circle cx={9} cy={6} r={2} fill={color} />
      <Line x1={4} y1={12} x2={20} y2={12} stroke={color} strokeWidth={1.8} strokeLinecap="round" />
      <Circle cx={15} cy={12} r={2} fill={color} />
      <Line x1={4} y1={18} x2={20} y2={18} stroke={color} strokeWidth={1.8} strokeLinecap="round" />
      <Circle cx={11} cy={18} r={2} fill={color} />
    </Svg>
  )
}

export function LightbulbIcon({ color }: { color: string }) {
  return (
    <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
      <Path d="M9 18h6M10 22h4M8.2 14.8A7 7 0 1 1 15.8 14.8C14.7 15.6 14.2 16.3 14 18h-4c-.2-1.7-.7-2.4-1.8-3.2Z" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  )
}

// Circular-arrow "restart" icon — used when unsyncing from the clock.
export function RestartIcon({ color }: { color: string }) {
  return (
    <Svg width={15} height={15} viewBox="0 0 24 24" fill="none">
      <Path d="M1 4v6h6" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"
        stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  )
}

// Clock-face icon — used to snap the timer to the wall clock.
export function ClockIcon({ color }: { color: string }) {
  return (
    <Svg width={15} height={15} viewBox="0 0 24 24" fill="none">
      <Circle cx={12} cy={12} r={9} stroke={color} strokeWidth={2} />
      <Path d="M12 7v5l3.5 2" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  )
}

// Alarm-clock icon — used to toggle alarm mode.
export function AlarmIcon({ color, size = 16 }: { color: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx={12} cy={13} r={8} stroke={color} strokeWidth={2} />
      <Path d="M12 9v4l2.5 1.5" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M5 3 2 6M19 3l3 3" stroke={color} strokeWidth={2} strokeLinecap="round" />
    </Svg>
  )
}

export function FocusIcon({ color }: { color: string }) {
  return (
    <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
      <Circle cx={12} cy={12} r={3} stroke={color} strokeWidth={2} />
      <Path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 2-2v-3"
        stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  )
}

export function ChevronIcon({ up, color }: { up: boolean; color: string }) {
  return (
    <Svg width={14} height={14} viewBox="0 0 24 24" fill="none">
      <Path
        d={up ? 'm18 15-6-6-6 6' : 'm6 9 6 6 6-6'}
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  )
}

export function TrashIcon({ color, size = 18 }: { color: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  )
}
