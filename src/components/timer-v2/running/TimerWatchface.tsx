import { useAppReducedMotion } from '../../../theme/ThemeContext'
import { Fragment, useEffect, useMemo, useRef } from 'react'
import { Animated as RNAnimated, Platform, Pressable, StyleSheet, Text, View } from 'react-native'
import Svg, { Circle } from 'react-native-svg'
import Animated, { FadeIn } from 'react-native-reanimated'
import type { RuntimeTimerProgram, UnifiedSubBellTrack } from '../../../types'
import type { TimelinePosition } from '../../../lib/timeline'
import { cueSegmentProgress } from '../../../lib/timeline'
import { subBellColorValue, timerIdentityColor } from '../../../lib/subBellColors'
import { patternDurationSeconds, randomTrackOffsetsSeconds, trackEventOffsetsSeconds } from '../../../lib/timerV2'
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
  program: RuntimeTimerProgram
  position: TimelinePosition | null
  progress: number
  eventPulse: number
  scrubbing?: boolean
  size: number
  model: TimerWatchfaceModel
  presentation?: 'running-screen' | 'floating-overlay'
  flashOnMount?: boolean
  accessibilityLabel: string
  testID?: string
  onPress?: () => void
  onLongPress?: () => void
}

export function TimerWatchface({ program, position, progress, eventPulse, scrubbing, size, model, presentation = 'running-screen', flashOnMount = false, accessibilityLabel, testID, onPress, onLongPress }: Props) {
  const { tokens, theme } = useTheme()
  const accent = program.mode === 'unified' && theme !== 'eink' ? subBellColorValue(timerIdentityColor(program.steps[0].id), 0) : tokens.accent
  const reducedMotion = useAppReducedMotion()
  const compact = presentation === 'floating-overlay'
  return <Pressable
    testID={testID}
    onPress={event => { event.stopPropagation(); onPress?.() }}
    onLongPress={onLongPress}
    delayLongPress={500}
    style={({ pressed }) => [styles.ringWrap, { width: size, height: size, transform: [{ scale: pressed && !reducedMotion ? 0.985 : 1 }] }]}
    accessibilityRole="button"
    accessibilityLabel={accessibilityLabel}
  >
    <TimerWatchfaceRings size={size} progress={progress} position={position} program={program} muted={model.muted} eventPulse={eventPulse} edgeToEdge={presentation === 'floating-overlay'} flashOnMount={flashOnMount} scrubbing={scrubbing} />
    <View style={[styles.center, compact && styles.centerCompact, { opacity: theme !== 'eink' && model.runtimeMuted ? 0.72 : 1, pointerEvents: 'none' }]}>
      <Text style={[styles.mainTime, compact && styles.mainTimeCompact, { color: tokens.text }]} adjustsFontSizeToFit numberOfLines={1}>{model.mainLabel}</Text>
      {model.mainCaption ? <Text numberOfLines={1} style={[styles.mainCaption, compact && styles.mainCaptionCompact, { color: tokens.textMuted }]}>{model.mainCaption}</Text> : null}
      {model.nextName ? <Animated.View key={`${model.nextLabel ?? ''}:${model.nextName}`} entering={reducedMotion ? undefined : FadeIn.duration(180)} style={[styles.nextCue, compact && styles.nextCueCompact]}>
        {model.nextLabel ? <Text style={[styles.nextLabel, { color: tokens.textMuted }]}>{model.nextLabel}</Text> : null}
        <Text numberOfLines={1} style={[styles.nextCueName, compact && styles.nextCueNameCompact, { color: theme === 'eink' ? tokens.text : model.nextColor ?? tokens.text }]}>{model.nextName}</Text>
        {model.nextTime ? <Text style={[styles.nextCueTime, compact && styles.nextCueTimeCompact, { color: tokens.textMuted }]}>{model.nextTime}</Text> : null}
      </Animated.View> : null}
    </View>
    {model.muted ? <View style={[styles.slash, { width: size * 0.72, backgroundColor: accent, pointerEvents: 'none' }]} /> : null}
  </Pressable>
}

export function TimerWatchfaceRings({ size, progress, position, program, muted, eventPulse, edgeToEdge = false, flashOnMount = false, card = false, trackColor, scrubbing = false }: { size: number; progress: number; position: TimelinePosition | null; program: RuntimeTimerProgram; muted: boolean; eventPulse: number; edgeToEdge?: boolean; flashOnMount?: boolean; card?: boolean; trackColor?: string; scrubbing?: boolean }) {
  const { tokens, theme } = useTheme()
  const accent = program.mode === 'unified' && theme !== 'eink' ? subBellColorValue(timerIdentityColor(program.steps[0].id), 0) : tokens.accent
  const reducedMotion = useAppReducedMotion()
  const flash = useRef(new RNAnimated.Value(0)).current
  const lastPulse = useRef(eventPulse)
  useEffect(() => {
    if (reducedMotion || eventPulse <= 0 || eventPulse === lastPulse.current) return
    lastPulse.current = eventPulse
    flash.setValue(0.7)
    RNAnimated.timing(flash, { toValue: 0, duration: 650, useNativeDriver: Platform.OS !== 'web' }).start()
  }, [eventPulse, flash, reducedMotion])
  useEffect(() => {
    if (reducedMotion || !flashOnMount) return
    flash.setValue(0.7)
    RNAnimated.timing(flash, { toValue: 0, duration: 650, useNativeDriver: Platform.OS !== 'web' }).start()
  }, [flash, flashOnMount, reducedMotion])
  // Cue positions change with the program or cycle, but not with each visible
  // countdown second. Keep random offset generation out of the display tick.
  const patternTracks = useMemo(() => {
    if (program.mode === 'pattern') {
      if (!program.subBellsEnabled) return []
      const mainSeconds = patternDurationSeconds(program)
      return program.tracks.flatMap((track, index) => {
        if (!track.enabled || track.showOnWatchFace === false) return []
        const offsets = trackEventOffsetsSeconds(track, mainSeconds, position?.cycleIndex ?? 0, position?.randomSeed ?? 0)
        return offsets.length > 0 ? [{ track, index, offsets }] : []
      })
    }
    if (program.mode !== 'unified' || program.noMainInterval) return []
    const step = program.steps[position?.currentStepIndex ?? 0]
    if (!step?.subBellsEnabled) return []
    const mainSeconds = step.durationSeconds
    return step.subBellTracks.flatMap((track, index) => {
      if (!track.enabled || !track.showOnWatchFace) return []
      const offsets = unifiedTrackOffsets(track, mainSeconds, position?.cycleIndex ?? 0, position?.randomSeed ?? 0)
      return offsets.length > 0 ? [{ track, index, offsets }] : []
    })
  }, [program, position?.cycleIndex, position?.currentStepIndex, position?.randomSeed])
  const rings = useMemo(() => {
    if (program.mode === 'sequence') return [{ progress: position?.stepProgress ?? progress, stroke: accent, background: trackColor ?? tokens.surfaceHi, backgroundOpacity: 1 }]
    const mainSeconds = program.mode === 'pattern' ? patternDurationSeconds(program) : program.steps[position?.currentStepIndex ?? 0]?.durationSeconds ?? 1
    const stepProgress = program.mode === 'unified' ? position?.stepProgress ?? progress : progress
    const elapsedSeconds = Math.max(0, Math.min(mainSeconds, stepProgress * mainSeconds))
    return [
      { progress: stepProgress, stroke: accent, background: trackColor ?? tokens.surfaceHi, backgroundOpacity: 1 },
      ...patternTracks.map(({ track, index, offsets }) => {
        const stroke = subBellColorValue(track.color, index, theme === 'eink')
        return { progress: cueSegmentProgress(offsets, mainSeconds, elapsedSeconds), stroke, background: stroke, backgroundOpacity: 0.17 }
      }),
    ]
  }, [position?.currentStepIndex, position?.stepProgress, program, progress, accent, trackColor, tokens.surfaceHi, patternTracks])
  return <View style={StyleSheet.absoluteFill}>
    {theme !== 'eink' ? <RNAnimated.View style={[styles.flash, { width: size, height: size, borderRadius: size / 2, backgroundColor: accent, opacity: flash, pointerEvents: 'none' }]} /> : null}
    <Svg width={size} height={size} viewBox="0 0 200 200" style={styles.svg}>
      {rings.map((ring, index) => {
        const radius = (card ? 44 * 200 / 112 : edgeToEdge ? 96 : 83) - index * 7
        const strokeWidth = card ? 3 * 200 / 112 : 3
        return <Fragment key={index}><Circle cx={100} cy={100} r={radius} fill="none" stroke={ring.background} strokeOpacity={theme === 'eink' ? 1 : ring.backgroundOpacity} strokeWidth={strokeWidth} /><SmoothProgressCircle radius={radius} progress={ring.progress} stroke={ring.stroke} strokeWidth={strokeWidth} opacity={theme === 'eink' ? 1 : muted ? 0.3 : Math.max(0.52, 1 - index * 0.08)} reducedMotion={reducedMotion || scrubbing} /></Fragment>
      })}
    </Svg>
  </View>
}

function unifiedTrackOffsets(track: UnifiedSubBellTrack, durationSeconds: number, roundIndex: number, randomSeed: number): number[] {
  const offsets = track.repeatEnabled ? [...track.selectedOffsetsSeconds] : []
  if (track.randomRepeat) offsets.push(...randomTrackOffsetsSeconds(track.id, track.randomRepeat, durationSeconds, roundIndex, randomSeed))
  if (track.afterStartSeconds !== undefined) offsets.push(track.afterStartSeconds)
  if (track.beforeEndSeconds !== undefined) offsets.push(durationSeconds - track.beforeEndSeconds)
  return [...new Set(offsets.filter(value => Number.isSafeInteger(value) && value > 0 && value < durationSeconds))].sort((left, right) => left - right)
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
  mainCaption: { fontSize: 13 },
  mainCaptionCompact: { fontSize: 8 },
  nextCue: { marginTop: 11, alignItems: 'center', gap: 2, maxWidth: '100%' },
  nextCueCompact: { marginTop: 6 },
  nextCueName: { fontSize: 13 },
  nextCueNameCompact: { fontSize: 11 },
  nextCueTime: { fontVariant: ['tabular-nums'], fontSize: 13 },
  nextCueTimeCompact: { fontSize: 10 },
  nextLabel: { fontSize: 13 },
  slash: { position: 'absolute', height: 4, borderRadius: 3, transform: [{ rotate: '-45deg' }] },
})
