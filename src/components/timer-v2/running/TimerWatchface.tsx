import { Fragment, useEffect, useMemo, useRef } from 'react'
import { Animated as RNAnimated, Pressable, StyleSheet, Text, View } from 'react-native'
import Svg, { Circle } from 'react-native-svg'
import Animated, { FadeIn, useReducedMotion } from 'react-native-reanimated'
import type { TimerProgram } from '../../../types'
import type { TimelinePosition } from '../../../lib/timeline'
import { cueSegmentProgress } from '../../../lib/timeline'
import { subBellColorValue } from '../../../lib/subBellColors'
import { patternDurationSeconds, trackSelectedOffsetsSeconds } from '../../../lib/timerV2'
import { useTheme } from '../../../theme/ThemeContext'

export interface TimerWatchfaceModel {
  mainLabel: string
  mainCaption?: string
  nextLabel?: string
  nextName?: string
  nextTime?: string
  nextColor?: string
  muted: boolean
  runtimeMuted: boolean
}

interface Props {
  program: TimerProgram
  position: TimelinePosition | null
  progress: number
  eventPulse: number
  size: number
  model: TimerWatchfaceModel
  presentation?: 'running-screen' | 'floating-overlay'
  flashOnMount?: boolean
  accessibilityLabel: string
  onPress?: () => void
  onLongPress?: () => void
}

export function TimerWatchface({ program, position, progress, eventPulse, size, model, presentation = 'running-screen', flashOnMount = false, accessibilityLabel, onPress, onLongPress }: Props) {
  const { tokens } = useTheme()
  const reducedMotion = useReducedMotion()
  const compact = presentation === 'floating-overlay'
  return <Pressable
    onPress={onPress}
    onLongPress={onLongPress}
    delayLongPress={500}
    style={({ pressed }) => [styles.ringWrap, { width: size, height: size, transform: [{ scale: pressed && !reducedMotion ? 0.985 : 1 }] }]}
    accessibilityRole="button"
    accessibilityLabel={accessibilityLabel}
  >
    <TimerWatchfaceRings size={size} progress={progress} position={position} program={program} muted={model.muted} eventPulse={eventPulse} edgeToEdge={presentation === 'floating-overlay'} flashOnMount={flashOnMount} />
    <View style={[styles.center, compact && styles.centerCompact, { opacity: model.runtimeMuted ? 0.72 : 1, pointerEvents: 'none' }]}>
      <Text style={[styles.mainTime, compact && styles.mainTimeCompact, { color: tokens.text }]} adjustsFontSizeToFit numberOfLines={1}>{model.mainLabel}</Text>
      {model.mainCaption ? <Text numberOfLines={1} style={[styles.mainCaption, compact && styles.mainCaptionCompact, { color: tokens.textMuted }]}>{model.mainCaption}</Text> : null}
      {model.nextName ? <Animated.View key={`${model.nextLabel ?? ''}:${model.nextName}`} entering={FadeIn.duration(reducedMotion ? 80 : 180)} style={[styles.nextCue, compact && styles.nextCueCompact]}>
        {model.nextLabel ? <Text style={[styles.nextLabel, { color: tokens.textMuted }]}>{model.nextLabel}</Text> : null}
        <Text numberOfLines={1} style={[styles.nextCueName, compact && styles.nextCueNameCompact, { color: model.nextColor ?? tokens.text }]}>{model.nextName}</Text>
        {model.nextTime ? <Text style={[styles.nextCueTime, compact && styles.nextCueTimeCompact, { color: tokens.textMuted }]}>{model.nextTime}</Text> : null}
      </Animated.View> : null}
    </View>
    {model.muted ? <View style={[styles.slash, { width: size * 0.72, backgroundColor: tokens.accent, pointerEvents: 'none' }]} /> : null}
  </Pressable>
}

export function TimerWatchfaceRings({ size, progress, position, program, muted, eventPulse, edgeToEdge = false, flashOnMount = false }: { size: number; progress: number; position: TimelinePosition | null; program: TimerProgram; muted: boolean; eventPulse: number; edgeToEdge?: boolean; flashOnMount?: boolean }) {
  const { tokens } = useTheme()
  const reducedMotion = useReducedMotion()
  const flash = useRef(new RNAnimated.Value(0)).current
  const lastPulse = useRef(eventPulse)
  useEffect(() => {
    if (eventPulse <= 0 || eventPulse === lastPulse.current) return
    lastPulse.current = eventPulse
    flash.setValue(0.7)
    RNAnimated.timing(flash, { toValue: 0, duration: 650, useNativeDriver: true }).start()
  }, [eventPulse, flash])
  useEffect(() => {
    if (!flashOnMount) return
    flash.setValue(0.7)
    RNAnimated.timing(flash, { toValue: 0, duration: 650, useNativeDriver: true }).start()
  }, [flash, flashOnMount])
  const rings = useMemo(() => {
    if (program.mode === 'sequence') return [{ progress: position?.stepProgress ?? progress, stroke: tokens.accent, background: tokens.surfaceHi, backgroundOpacity: 1 }]
    const mainSeconds = patternDurationSeconds(program)
    const elapsedSeconds = Math.max(0, Math.min(mainSeconds, progress * mainSeconds))
    const activeTracks = (program.subBellsEnabled ? program.tracks : []).filter(track => track.enabled && track.showOnWatchFace !== false && trackSelectedOffsetsSeconds(track).length > 0)
    return [
      { progress, stroke: tokens.accent, background: tokens.surfaceHi, backgroundOpacity: 1 },
      ...activeTracks.map((track, index) => {
        const stroke = subBellColorValue(track.color, index)
        return { progress: cueSegmentProgress(trackSelectedOffsetsSeconds(track), mainSeconds, elapsedSeconds), stroke, background: stroke, backgroundOpacity: 0.17 }
      }),
    ]
  }, [position?.stepProgress, program, progress, tokens.accent, tokens.surfaceHi])
  return <View style={StyleSheet.absoluteFill}>
    <RNAnimated.View style={[styles.flash, { width: size, height: size, borderRadius: size / 2, backgroundColor: tokens.accent, opacity: flash, pointerEvents: 'none' }]} />
    <Svg width={size} height={size} viewBox="0 0 200 200" style={styles.svg}>
      {rings.map((ring, index) => {
        const radius = (edgeToEdge ? 96 : 83) - index * 7
        return <Fragment key={index}><Circle cx={100} cy={100} r={radius} fill="none" stroke={ring.background} strokeOpacity={ring.backgroundOpacity} strokeWidth={3} /><SmoothProgressCircle radius={radius} progress={ring.progress} stroke={ring.stroke} strokeWidth={3} opacity={muted ? 0.3 : Math.max(0.52, 1 - index * 0.08)} reducedMotion={reducedMotion} /></Fragment>
      })}
    </Svg>
  </View>
}

const AnimatedCircle = RNAnimated.createAnimatedComponent(Circle)

function SmoothProgressCircle({ radius, progress, stroke, strokeWidth, opacity, reducedMotion }: { radius: number; progress: number; stroke: string; strokeWidth: number; opacity: number; reducedMotion: boolean }) {
  const circumference = Math.PI * 2 * radius
  const animatedProgress = useRef(new RNAnimated.Value(progress)).current
  useEffect(() => {
    if (reducedMotion) animatedProgress.setValue(progress)
    else RNAnimated.timing(animatedProgress, { toValue: progress, duration: 320, useNativeDriver: false }).start()
  }, [animatedProgress, progress, reducedMotion])
  return <AnimatedCircle cx={100} cy={100} r={radius} fill="none" stroke={stroke} strokeWidth={strokeWidth} strokeLinecap="round" strokeDasharray={`${circumference}, ${circumference}`} strokeDashoffset={animatedProgress.interpolate({ inputRange: [0, 1], outputRange: [circumference, 0] })} transform="rotate(-90 100 100)" opacity={opacity} />
}

const styles = StyleSheet.create({
  ringWrap: { alignItems: 'center', justifyContent: 'center' },
  svg: { position: 'absolute' },
  flash: { position: 'absolute' },
  center: { alignItems: 'center', gap: 5, maxWidth: '69%' },
  centerCompact: { maxWidth: '72%', gap: 3 },
  mainTime: { width: '100%', textAlign: 'center', fontFamily: 'JetBrainsMono-Light', fontSize: 55, fontVariant: ['tabular-nums'] },
  mainTimeCompact: { fontSize: 42 },
  mainCaption: { fontSize: 10, letterSpacing: 1.05, textTransform: 'uppercase' },
  mainCaptionCompact: { fontSize: 8 },
  nextCue: { marginTop: 11, alignItems: 'center', gap: 2, maxWidth: '100%' },
  nextCueCompact: { marginTop: 6 },
  nextCueName: { fontSize: 13, fontWeight: '700' },
  nextCueNameCompact: { fontSize: 11 },
  nextCueTime: { fontFamily: 'JetBrainsMono-Regular', fontSize: 12 },
  nextCueTimeCompact: { fontSize: 10 },
  nextLabel: { fontSize: 8, letterSpacing: 1.1, fontWeight: '800' },
  slash: { position: 'absolute', height: 4, borderRadius: 3, transform: [{ rotate: '-45deg' }] },
})
