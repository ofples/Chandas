import { TourTarget, useGuidedTour } from '../components/timer-v2/guided-tour'
import { useAppReducedMotion } from '../theme/ThemeContext'
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, Animated as RNAnimated, AppState, Platform, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Slider from '@react-native-community/slider'
import Svg, { Circle, Line } from 'react-native-svg'
import Animated, { FadeIn, FadeInDown, FadeOut } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type { AlarmBehavior, AppTimerSettings, CueSettings, ProgramPreset, RuntimeTimerProgram, UnifiedTimerProgram, RunningControlId } from '../types'
import { enabledRunningControls } from '../lib/running-controls'
import { formatCountdown } from '../lib/snapLogic'
import type { UnifiedTimerConfig } from '../lib/unified-config-state'
import type { TimelineCueCandidate, TimelinePosition } from '../lib/timeline'
import { cueSegmentProgress, currentStepDurationMs, hasFollowingStep, programCycleDurationMs } from '../lib/timeline'
import { unifiedCueIdentity } from '../lib/unified-timeline'
import { AlarmIcon, ClockIcon, ConfigurationIcon, FocusIcon, MixerIcon, RestartIcon, TimerTransportIcon, VolumeIcon } from '../components/Icons'
import { BottomSheet } from '../components/timer-v2/BottomSheet'
import { ClockSnapSelector } from '../components/timer-v2/ClockSnapSelector'
import { TimerHelpSheet } from '../components/timer-v2/TimerHelpSheet'
import { SoundName } from '../components/timer-v2/SoundName'
import type { RuntimeMuteState } from '../lib/runtimeV2'
import { useTheme } from '../theme/ThemeContext'
import { ChandasTimerService, isNativeServiceAvailable } from '../native/ChandasTimerService'
import { GentleNotice } from '../components/timer-v2/experience-feedback'
import { formatDuration } from '../components/timer-v2/run-length-config'
import { subBellColorValue } from '../lib/subBellColors'
import { SheetTextButton } from '../components/timer-v2/SheetTextButton'
import { selectionHaptic, tapHaptic } from '../lib/haptics'
import { TimerMuteControls } from '../components/timer-v2/running/TimerMuteControls'
import { ScrollEdgeFade } from '../components/timer-v2/ScrollEdgeFade'
import { formatCompactDurationSeconds, patternDurationSeconds, sequenceStepDurationSeconds, randomTrackOffsetsSeconds } from '../lib/timerV2'
import { formatEventLocalTime, type CueMuteSuggestion } from '../lib/upcoming-events'
import { SettingsButton } from './UnifiedTimerConfigScreen'
import { TimerWatchface, type TimerWatchfaceModel } from '../components/timer-v2/running/TimerWatchface'
import { TimerControlButton } from '../components/timer-v2/running/TimerControlButton'
import { IOSIntegrationStatus } from '../components/timer-v2/IOSIntegrationStatus'

const DIAL_HOLD_MS = 500

interface Props {
  onOpenConfigurations?: () => void
  onOpenSettings?: () => void
  runId?: string
  enterDirection?: number
  runPage?: { index: number; count: number; move: (delta: number) => boolean; adjacent: Array<{
    id: string; direction: number; program: UnifiedTimerProgram; position: TimelinePosition | null; progress: number;
    countdown: string; muted: boolean; paused: boolean
  }> }
  program: RuntimeTimerProgram
  mainCountdown: string
  nextCueCountdown: string
  nextCueLabel: string
  progress: number
  position: TimelinePosition | null
  eventPulse: number
  activeHoursPaused: boolean
  activeHoursResumeAt: number
  nextAudibleAt: number
  nextAudibleLabel: string
  runEndsAt: number
  runRemainingMs: number
  runProgress: number
  mute: RuntimeMuteState
  alarmBehavior: AlarmBehavior
  realigning: boolean
  isPaused: boolean
  isAlarmRinging: boolean
  onSetPaused: (paused: boolean) => boolean
  onSkipStep: (direction: 'next' | 'previous' | number) => boolean
  onSeekStep: (fraction: number) => boolean
  onStop: () => void
  onRestartUnsynced: () => void
  onSnapToClock: (offsetMinutes: number) => Promise<boolean>
  onPressAlarm: () => void
  onToggleCurrentStepAlarm: (stepId: string) => void
  onMuteForIterations: (count: number) => void
  onMuteForSeconds: (seconds: number) => void
  onMuteUntil: (deadline: number) => void
  getMuteSuggestions: (now: number, limit?: number) => CueMuteSuggestion[]
  onClearMute: () => void
  secondPrecision: boolean
  masterVolume: number
  onMasterVolumeChange: (value: number) => void
  onCueVolumeChange: (cueId: string, volume: number) => void
  controlSettings: Pick<AppTimerSettings, 'advancedModeEnabled' | 'runningControlIds'> & { scrubbingEnabled?: boolean }
  onChangeRunningControlIds: (id: RunningControlId, enabled: boolean) => void
  focusEnabled: boolean
  focusActive: boolean
  focusPolicyAccess: boolean
  focusReason: string
  onToggleFocus: () => void
  onOpenFocusSettings: () => void
  configurations: Array<ProgramPreset | UnifiedTimerConfig>
  activeConfigurationId?: string
  configurationName?: string
  onSelectConfiguration: (presetId: string) => Promise<boolean>
  externalPanel?: 'clock' | 'sound' | null
  onExternalPanelConsumed?: () => void
}

export function TimerV2RunningScreen(props: Props) {
  const tour = useGuidedTour()
  const { tokens, theme } = useTheme()
  const insets = useSafeAreaInsets()
  const { width, height } = useWindowDimensions()
  const reducedMotion = useAppReducedMotion()
  const [mixerOpen, setMixerOpen] = useState(false)
  const [snapOpen, setSnapOpen] = useState(false)
  useEffect(() => {
    if (!props.externalPanel) return
    if (props.externalPanel === 'clock') setSnapOpen(true)
    else setMixerOpen(true)
    props.onExternalPanelConsumed?.()
  }, [props.externalPanel, props.onExternalPanelConsumed])
  const [helpOpen, setHelpOpen] = useState(false)
  const [configurationPickerOpen, setConfigurationPickerOpen] = useState(false)
  const [selectingConfiguration, setSelectingConfiguration] = useState<string | null>(null)
  const [tooltip, setTooltip] = useState<string | null>(null)
  const [controlsVisible, setControlsVisible] = useState(true)
  useEffect(() => { if (tour?.step === 'controls' || tour?.step === 'stop') setControlsVisible(true) }, [tour?.step])
  const lastNonzeroVolume = useRef(props.masterVolume > 0 ? props.masterVolume : 0.8)
  const volumeRun = useRef(props.runId)
  useEffect(() => {
    if (volumeRun.current !== props.runId) lastNonzeroVolume.current = 0.8
    volumeRun.current = props.runId
    if (props.masterVolume > 0) lastNonzeroVolume.current = props.masterVolume
  }, [props.masterVolume, props.runId])
  const tooltipTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const helpLongPressed = useRef(false)
  // Reserve room for the header, step strip, transport and fixed bottom controls.
  // A screen-height-only cap lets the footer cover Pause on shorter phones.
  const verticalRoom = height - insets.top - insets.bottom
  const size = Math.min(width * 0.79, 342, Math.max(132, verticalRoom - 400))
  const ringRadius = size * 83 / 200
  const ringTop = Math.max(10, Math.min(height * 0.47 - size / 2 - insets.top - 102, verticalRoom - size - 400))
  const [scrub, setScrub] = useState<number | null>(null)
  const runtimeMuted = props.mute.mutedUntil > Date.now() || Boolean(props.mute.iteration)
  const muted = props.masterVolume <= 0 || runtimeMuted
  const mutedUntil = Math.max(props.mute.mutedUntil, props.mute.iteration?.endsAt ?? 0)
  const hasResume = props.activeHoursResumeAt > 0
  const resumeDate = new Date(props.activeHoursResumeAt)
  const endsBeforeResume = props.activeHoursPaused && props.runEndsAt > 0 && props.runEndsAt <= props.activeHoursResumeAt
  const mainLabel = endsBeforeResume
    ? formatDuration(Math.ceil(props.runRemainingMs / 1_000))
    : props.activeHoursPaused && hasResume
      ? `${String(resumeDate.getHours()).padStart(2, '0')}:${String(resumeDate.getMinutes()).padStart(2, '0')}`
      : props.activeHoursPaused
        ? 'No active time'
      : props.mainCountdown
  const nextAudibleSummary = props.nextAudibleAt > Date.now()
    ? `${props.nextAudibleLabel} · ${formatEventLocalTime(props.nextAudibleAt)}`
    : null
  const unified = props.program.mode === 'unified'
  const steps = props.program.mode === 'unified' || props.program.mode === 'sequence' ? props.program.steps : []
  const multiStep = props.program.mode === 'sequence' || (unified && steps.length > 1)
  const sequenceIndex = multiStep ? props.position?.currentStepIndex ?? 0 : 0
  const currentStep = multiStep ? steps[sequenceIndex] : null
  const stepDuration = currentStepDurationMs(props.program, sequenceIndex)
  const stepIdentity = `${props.runId}:${props.position?.anchor}:${props.position?.cycleIndex}:${sequenceIndex}`
  const runningControls = enabledRunningControls(props.controlSettings)
  const scrubbingEnabled = props.controlSettings.scrubbingEnabled !== false
  const noMainInterval = props.program.mode === 'unified' && !!props.program.noMainInterval
  const canScrub = !noMainInterval && scrubbingEnabled && controlsVisible && stepDuration > 0 && !props.isAlarmRinging && !props.realigning && !props.activeHoursPaused
  const oneStepUnified = unified && steps.length === 1
  const followsStep = hasFollowingStep(props.program, props.position, props.runEndsAt)
  const nextCueColor = nextTrackColor(props.program, props.position?.nextEvent?.winner, theme === 'eink', tokens.accent)
  const enhancedClockAlignmentSupported = !isNativeServiceAvailable || ChandasTimerService.getCapabilities()?.supportsProgramClockAlignment === true
  const cycleDurationSeconds = programCycleDurationMs(props.program) / 1_000
  const clockAlignmentAvailable = !noMainInterval && (props.program.mode === 'pattern' || oneStepUnified
    ? cycleDurationSeconds % 60 === 0 || enhancedClockAlignmentSupported
    : enhancedClockAlignmentSupported)
  const showNextCue = !noMainInterval && !props.activeHoursPaused && (props.program.mode === 'pattern' || oneStepUnified) && props.position?.nextEvent?.boundary !== 'pattern-main'
  const watchfaceModel: TimerWatchfaceModel = {
    mainLabel: scrub === null ? mainLabel : formatCountdown(stepDuration * (1 - scrub)),
    mainCaption: props.isPaused ? 'Paused' : endsBeforeResume ? 'Session ends quietly' : props.activeHoursPaused ? (hasResume ? 'Quiet until' : 'Schedule is quiet') : noMainInterval ? props.nextCueLabel || 'No upcoming bells' : undefined,
    nextLabel: props.activeHoursPaused && nextAudibleSummary ? 'NEXT AUDIBLE' : undefined,
    nextName: props.activeHoursPaused && nextAudibleSummary ? nextAudibleSummary : showNextCue ? props.nextCueLabel : undefined,
    nextTime: showNextCue ? props.nextCueCountdown : undefined,
    nextColor: showNextCue ? nextCueColor : tokens.text,
    muted,
    runtimeMuted,
  }

  const dismissTooltip = () => {
    if (tooltipTimer.current) clearTimeout(tooltipTimer.current)
    tooltipTimer.current = null
    setTooltip(null)
  }
  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => { if (state !== 'active') dismissTooltip() })
    return () => { subscription.remove(); if (tooltipTimer.current) clearTimeout(tooltipTimer.current) }
  }, [])
  const showTooltip = (message: string) => {
    if (tooltipTimer.current) clearTimeout(tooltipTimer.current)
    setTooltip(message)
    tooltipTimer.current = setTimeout(() => setTooltip(null), 2800)
    selectionHaptic()
  }

  const focusPaused = props.focusReason === 'paused-by-android'
  const revealControls = () => { setControlsVisible(true); if (tooltip) dismissTooltip() }
  const clearMuteFromTimer = () => {
    if (props.masterVolume <= 0) props.onMasterVolumeChange(lastNonzeroVolume.current)
    props.onClearMute()
    revealControls()
  }
  const lastSwipe = useRef(0)
  const pressTimerSurface = () => {
    if (props.isAlarmRinging || Date.now() - lastSwipe.current < 160) return
    if (runtimeMuted || props.masterVolume <= 0) clearMuteFromTimer()
    else if (controlsVisible) setControlsVisible(false)
    else revealControls()
  }
  const travel = useRef(new RNAnimated.Value(0)).current
  const paging = useRef(false)
  const animation = useRef<RNAnimated.CompositeAnimation | null>(null)
  const nativeAnimation = Platform.OS !== 'web'
  useLayoutEffect(() => {
    travel.setValue(reducedMotion ? 0 : (props.enterDirection ?? 0) * width * 0.38)
    if (props.enterDirection && !reducedMotion) {
      animation.current = RNAnimated.timing(travel, { toValue: 0, duration: 200, useNativeDriver: nativeAnimation })
      animation.current.start()
    }
    return () => animation.current?.stop()
  }, [nativeAnimation, props.runId, props.enterDirection, reducedMotion, travel, width])

  const page = props.runPage
  const canMove = (delta: number) => page && page.index + delta >= 0 && page.index + delta < page.count
  const settleTravel = () => {
    animation.current = RNAnimated.timing(travel, { toValue: 0, duration: reducedMotion ? 0 : 160, useNativeDriver: nativeAnimation })
    animation.current.start()
  }
  const movePage = (delta: number) => {
    if (!page || !canMove(delta) || paging.current) return
    if (reducedMotion) { page.move(delta); return }
    paging.current = true
    animation.current = RNAnimated.timing(travel, { toValue: -delta * width * 0.62, duration: 150, useNativeDriver: nativeAnimation })
    animation.current.start(({ finished }) => {
      paging.current = false
      if (finished && !page.move(delta)) settleTravel()
    })
  }
  const actions = {
    canSwipe: () => !!page && !paging.current,
    update: (dx: number) => {
      if (!reducedMotion) travel.setValue(canMove(dx < 0 ? 1 : -1) ? Math.sign(dx) * Math.min(Math.abs(dx), width * 0.62) : dx * 0.18)
    },
    finish: (dx: number) => {
      const delta = dx < 0 ? 1 : -1
      if (Math.abs(dx) >= 48 && canMove(delta)) movePage(delta)
      else settleTravel()
    },
  }
  const gestureActions = useRef(actions)
  gestureActions.current = actions
  const scrubState = useRef({ canScrub, progress: 0, identity: stepIdentity, duration: stepDuration, seek: props.onSeekStep })
  scrubState.current = { canScrub, progress: props.position?.stepProgress ?? props.progress, identity: stepIdentity, duration: stepDuration, seek: props.onSeekStep }
  const touch = useRef<{ ring: boolean; activated: boolean; angle: number; turns: number; initial: number; fraction: number; tick: number; identity: string } | null>(null)
  const armScrub = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (armScrub.current) clearTimeout(armScrub.current) }, [])
  const openConfigurations = useRef(props.onOpenConfigurations)
  openConfigurations.current = props.onOpenConfigurations
  const canOpenConfigurations = !!props.onOpenConfigurations
  const pullStart = useRef<{ at: number; eligible: boolean } | null>(null)
  const pullDown = useMemo(() => Gesture.Pan().enabled(canOpenConfigurations).maxPointers(1)
    .activeOffsetY(24).failOffsetY(-16).failOffsetX([-24, 24]).runOnJS(true)
    .onBegin(() => { pullStart.current = { at: Date.now(), eligible: false } })
    .onStart(() => {
      const start = pullStart.current
      if (start) start.eligible = Date.now() - start.at < DIAL_HOLD_MS && !touch.current?.activated
    })
    .onEnd((event, success) => {
      if (success && pullStart.current?.eligible && event.translationY > 56 && event.translationY > Math.abs(event.translationX) * 1.5) {
        lastSwipe.current = Date.now()
        openConfigurations.current?.()
      }
    })
    .onFinalize(() => { pullStart.current = null }), [canOpenConfigurations])
  const scrollGesture = useMemo(() => Gesture.Native().simultaneousWithExternalGesture(pullDown), [pullDown])
  const swipeEnabled = !!page
  const stageGesture = useMemo(() => Gesture.Pan().enabled(swipeEnabled || canScrub).simultaneousWithExternalGesture(pullDown).blocksExternalGesture(scrollGesture).minDistance(7).maxPointers(1).runOnJS(true)
    .onBegin(event => {
      const x = event.x - width / 2
      const y = event.y - size / 2
      const state = scrubState.current
      const ring = state.canScrub && Math.abs(Math.hypot(x, y) - ringRadius) <= 24
      if (!ring && !gestureActions.current.canSwipe()) return
      const initial = state.progress
      const active = { ring, activated: false, angle: Math.atan2(y, x), turns: 0, initial, fraction: initial, tick: Math.floor(initial * 24), identity: state.identity }
      touch.current = active
      if (ring) {
        armScrub.current = setTimeout(() => {
          armScrub.current = null
          const latest = scrubState.current
          if (touch.current !== active || !latest.canScrub || latest.identity !== active.identity) return
          active.activated = true
          // Anchor to the timer's progress; the contact angle only measures rotation.
          active.initial = active.fraction = latest.progress
          active.tick = Math.floor(active.fraction * 24)
          lastSwipe.current = Date.now()
          selectionHaptic()
          setScrub(active.fraction)
        }, DIAL_HOLD_MS)
      }
    })
    .onUpdate(event => {
      const active = touch.current
      if (!active) return
      if (!active.ring) {
        if (!active.activated && Math.abs(event.translationY) > 14 && Math.abs(event.translationY) > Math.abs(event.translationX)) {
          touch.current = null
          return
        }
        active.activated ||= Math.abs(event.translationX) > 18
        if (active.activated && gestureActions.current.canSwipe()) gestureActions.current.update(event.translationX)
        return
      }
      if (!active.activated) {
        if (armScrub.current) clearTimeout(armScrub.current)
        armScrub.current = null
        return
      }
      const state = scrubState.current
      if (!state.canScrub || state.identity !== active.identity) { setScrub(null); return }
      const angle = Math.atan2(event.y - size / 2, event.x - width / 2)
      const delta = angle - active.angle
      active.angle = angle
      active.turns += (delta > Math.PI ? delta - 2 * Math.PI : delta < -Math.PI ? delta + 2 * Math.PI : delta) / (2 * Math.PI)
      const endLimit = 1 - Math.min(1_000, state.duration / 2) / state.duration
      active.fraction = Math.max(0, Math.min(endLimit, active.initial + active.turns))
      const tick = Math.floor(active.fraction * 24)
      if (tick !== active.tick) { active.tick = tick; selectionHaptic() }
      setScrub(active.fraction)
    })
    .onEnd((event, success) => {
      const active = touch.current
      lastSwipe.current = Date.now()
      if (active?.ring) {
        const state = scrubState.current
        if (success && active.activated && state.canScrub && state.identity === active.identity && Math.abs(active.fraction - active.initial) > 0.002) state.seek(active.fraction)
      } else if (active?.activated && gestureActions.current.canSwipe()) gestureActions.current.finish(success ? event.translationX : 0)
    })
    .onFinalize(() => {
      if (armScrub.current) clearTimeout(armScrub.current)
      armScrub.current = null
      if (touch.current?.activated) lastSwipe.current = Date.now()
      touch.current = null
      setScrub(null)
    }), [swipeEnabled, canScrub, width, size, ringRadius, pullDown, scrollGesture])
  const titleShift = travel.interpolate({ inputRange: [-width, 0, width], outputRange: [-14, 0, 14], extrapolate: 'clamp' })
  const titleOpacity = travel.interpolate({ inputRange: [-width / 2, 0, width / 2], outputRange: [0, 1, 0], extrapolate: 'clamp' })
  return <GestureDetector gesture={pullDown} touchAction="pan-x"><View testID="running-screen" style={[styles.screen, { backgroundColor: tokens.bg, paddingTop: insets.top }]}>
    <GestureDetector gesture={scrollGesture}><ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 140 }]}>
      <View testID="running-header" style={styles.topline}>
      <View pointerEvents={controlsVisible ? 'auto' : 'none'} importantForAccessibility={controlsVisible ? 'auto' : 'no-hide-descendants'} accessibilityElementsHidden={!controlsVisible} style={[styles.headerContent, { opacity: controlsVisible ? 1 : 0 }]}>
        <Pressable disabled={!!props.onOpenConfigurations || props.configurations.length === 0} onPress={() => setConfigurationPickerOpen(true)} style={styles.configurationTitle} accessibilityRole={!props.onOpenConfigurations && props.configurations.length ? 'button' : undefined} accessibilityLabel={!props.onOpenConfigurations && props.configurations.length ? 'Switch or manage configurations' : undefined}>
          <RNAnimated.View style={[styles.configurationNameRow, { opacity: titleOpacity, transform: [{ translateY: titleShift }] }]}>
            <Text numberOfLines={1} style={[styles.stepTitle, { color: tokens.text }]}>{props.configurationName ?? (props.program.mode === 'pattern' ? props.program.label : props.program.mode === 'unified' && !multiStep ? props.program.steps[0]?.label ?? 'Timer' : 'Timer')}</Text>
            {!props.onOpenConfigurations && props.configurations.length ? <Text accessible={false} style={[styles.configurationChevron, { color: tokens.text }]}>›</Text> : null}
          </RNAnimated.View>
        </Pressable>
        <View style={styles.topRight}>{props.onOpenConfigurations ? <Pressable accessibilityRole="button" accessibilityLabel="Configurations" onPress={props.onOpenConfigurations} style={[styles.helpButton, { borderColor: tokens.border }]}><ConfigurationIcon color={tokens.text} /></Pressable> : null}{props.realigning ? <Animated.View entering={FadeIn.duration(120)} exiting={FadeOut.duration(100)} style={styles.syncing}><ActivityIndicator size="small" color={tokens.accent} /><Text style={[styles.focusStatus, { color: tokens.textMuted }]}>UPDATING</Text></Animated.View> : null}{focusPaused ? <Animated.Text entering={FadeIn.duration(160)} exiting={FadeOut.duration(120)} style={[styles.focusStatus, { color: tokens.warm }]}>FOCUS PAUSED</Animated.Text> : null}<Pressable hitSlop={7} onPressIn={() => { helpLongPressed.current = false }} onLongPress={() => { helpLongPressed.current = true; showTooltip('Open Timer help') }} onPressOut={() => setTimeout(() => { helpLongPressed.current = false }, 0)} onPress={() => { if (!helpLongPressed.current) { tapHaptic(); setHelpOpen(true) } }} style={({ pressed }) => [styles.helpButton, { borderColor: tokens.border, transform: [{ scale: pressed && !reducedMotion ? 0.94 : 1 }] }]} accessibilityRole="button" accessibilityLabel="Timer help"><Text style={[styles.helpGlyph, { color: tokens.text }]}>?</Text></Pressable>{props.onOpenSettings ? <SettingsButton onPress={props.onOpenSettings} /> : null}</View>
      </View>{Platform.OS === 'ios' ? <View importantForAccessibility={controlsVisible ? 'auto' : 'no-hide-descendants'} accessibilityElementsHidden={!controlsVisible} style={{ height: 20, justifyContent: 'center', opacity: controlsVisible ? 1 : 0 }}><IOSIntegrationStatus compact /></View> : null}</View>

      <View style={[styles.runPager, { opacity: controlsVisible && page ? 1 : 0 }]} pointerEvents={controlsVisible && page ? 'auto' : 'none'}>
        {controlsVisible && page ? <>
          <Pressable accessibilityRole="button" accessibilityLabel="Previous running timer" disabled={page.index === 0} onPress={() => movePage(-1)} hitSlop={8}><Text style={[styles.runPageLabel, { color: page.index === 0 ? tokens.textMuted : tokens.text }]}>‹</Text></Pressable>
          <Text style={[styles.runPageLabel, { color: tokens.textMuted }]}>{page.index + 1} of {page.count}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Next running timer" disabled={page.index === page.count - 1} onPress={() => movePage(1)} hitSlop={8}><Text style={[styles.runPageLabel, { color: page.index === page.count - 1 ? tokens.textMuted : tokens.text }]}>›</Text></Pressable>
        </> : null}
      </View>
      <View style={[styles.watchArea, { marginTop: Platform.OS === 'ios' ? Math.max(0, ringTop - 20) : ringTop }]}>
        <GestureDetector gesture={stageGesture} touchAction="none">
          <View testID="running-timer-stage" style={[styles.watchViewport, { height: size }]}>
            <RNAnimated.View style={{ alignItems: 'center', width: '100%', height: size, transform: [{ translateX: travel }] }}>
              {!reducedMotion && page?.adjacent.map(run => <View key={run.id} testID="adjacent-watchface" pointerEvents="none" importantForAccessibility="no-hide-descendants" accessibilityElementsHidden style={[styles.adjacentRing, { width: size, left: (width - size) / 2 + run.direction * width }]}>
                <TimerWatchface size={size} program={run.program} position={run.position} progress={run.progress} eventPulse={0} model={{ mainLabel: run.countdown, mainCaption: run.paused ? 'Paused' : undefined, muted: run.muted, runtimeMuted: run.muted }} accessibilityLabel="" />
              </View>)}
              <TimerWatchface testID="running-watchface" program={props.program} position={scrub !== null && props.position ? { ...props.position, stepProgress: scrub } : props.position} progress={scrub ?? (unified ? props.position?.stepProgress ?? props.progress : props.progress)} scrubbing={scrub !== null} eventPulse={props.eventPulse} size={size} model={watchfaceModel} onPress={pressTimerSurface} accessibilityLabel={muted ? 'Muted timer. Tap to unmute.' : controlsVisible ? 'Hide timer controls' : 'Show timer controls'} />
              {scrub !== null ? <View pointerEvents="none" style={styles.scrubMarker}><Svg width={size} height={size}><Circle cx={size / 2 + ringRadius * Math.sin(scrub * 2 * Math.PI)} cy={size / 2 - ringRadius * Math.cos(scrub * 2 * Math.PI)} r={5} fill={tokens.text} /></Svg></View> : null}
            </RNAnimated.View>
          </View>
        </GestureDetector>
        {multiStep && currentStep ? <RunningStepStrip steps={steps} index={sequenceIndex} position={props.position} program={props.program} endsAt={props.runEndsAt} identity={stepIdentity} pullDown={pullDown} scrollGesture={scrollGesture} scrubbingEnabled={scrubbingEnabled} enabled={controlsVisible && !props.isAlarmRinging && !props.realigning} onSelect={props.onSkipStep} /> : <View style={{ height: 40 }} />}
        <View style={styles.underTimer}>
          <View pointerEvents={controlsVisible ? 'auto' : 'none'} importantForAccessibility={controlsVisible ? 'auto' : 'no-hide-descendants'} accessibilityElementsHidden={!controlsVisible} style={[styles.transport, { opacity: controlsVisible ? 1 : 0 }]}>
            {multiStep ? <TimerControlButton size={48} label="Previous step" tooltip="Skip to previous step" disabled={props.isAlarmRinging || props.realigning || (sequenceIndex === 0 && props.position?.cycleIndex === 0 && props.runEndsAt > 0)} onPress={() => props.onSkipStep('previous')}><TimerTransportIcon kind="previous" color={tokens.accent} /></TimerControlButton> : null}
            <TourTarget id="tour-controls"><TimerControlButton size={48} label={props.isPaused ? 'Resume timer' : 'Pause timer'} tooltip={props.isPaused ? 'Resume timer' : 'Pause timer'} active={props.isPaused} disabled={props.isAlarmRinging || props.realigning} onPress={() => props.onSetPaused(!props.isPaused)}><TimerTransportIcon kind={props.isPaused ? 'play' : 'pause'} color={tokens.accent} /></TimerControlButton></TourTarget>
            {multiStep ? <TimerControlButton size={48} label={!followsStep ? 'Finish run' : 'Next step'} tooltip="Skip to next step" disabled={props.isAlarmRinging || props.realigning} onPress={() => props.onSkipStep('next')}><TimerTransportIcon kind="next" color={tokens.accent} /></TimerControlButton> : null}
          </View>
          {controlsVisible ? <View style={styles.statusSlot}>
            {props.runEndsAt > 0 ? <Animated.View entering={FadeIn.duration(150)} style={styles.runProgressBlock}>
              <BoundedRunBar width={Math.min(size * 0.82, 286)} progress={props.runProgress} segments={props.program.runPolicy.kind === 'cycles' ? props.program.runPolicy.cycleCount : 1} muted={runtimeMuted} />
              <Text style={[styles.runStatus, { color: tokens.textMuted }]}>Ends in {formatDuration(Math.ceil(props.runRemainingMs / 1_000))}</Text>
            </Animated.View> : null}
            {controlsVisible && runtimeMuted ? <Text accessibilityLabel={`Muted until ${formatEventLocalTime(mutedUntil)}. Tap the timer to unmute.`} style={[styles.nextAudibleStatus, { color: tokens.text, fontSize: 13, lineHeight: 18 }]}>Muted until {formatEventLocalTime(mutedUntil)}</Text> : null}
          </View> : null}
        </View>
      </View>
    </ScrollView></GestureDetector>

    {controlsVisible ? <Animated.View entering={reducedMotion ? undefined : FadeIn.duration(160)} exiting={reducedMotion ? undefined : FadeOut.duration(120)} style={[styles.bottom, { backgroundColor: tokens.bg, paddingBottom: insets.bottom + 17 }]}>
      <View pointerEvents="none" style={styles.bottomFade}><ScrollEdgeFade color={tokens.bg} side="bottom" /></View>
      <View style={styles.controls}>
        {runningControls.has('restart') ? <TimerControlButton size={48} label="Reset timer" tooltip={props.program.alignment.kind === 'local-clock' ? 'Turn off clock alignment and restart the timer now' : 'Restart the timer from the beginning and resume'} disabled={props.realigning} onPress={props.onRestartUnsynced} onTooltip={showTooltip}><RestartIcon color={tokens.accent} /></TimerControlButton> : null}
        {clockAlignmentAvailable && runningControls.has('clock') ? <TimerControlButton size={48} label="Snap to clock" tooltip="Snap the repeating cycle to the clock" active={props.program.alignment.kind === 'local-clock'} disabled={props.realigning} onPress={() => setSnapOpen(true)} onTooltip={showTooltip}><ClockIcon color={tokens.accent} /></TimerControlButton> : null}
        {!noMainInterval && runningControls.has('alarm') && (props.program.mode === 'pattern' || oneStepUnified) ? <TimerControlButton size={48} label={props.alarmBehavior === 'locked' ? 'Alarm locked' : props.alarmBehavior === 'once' ? 'Next main gong alarm' : 'Alarm off'} tooltip="Tap once to enable the alarm at the end of the current main interval. Tap twice to enable it for every main interval." active={props.alarmBehavior !== 'off'} badge={props.alarmBehavior === 'locked' ? '∞' : props.alarmBehavior === 'once' ? '1' : undefined} onPress={props.onPressAlarm} onTooltip={showTooltip}><AlarmIcon color={props.alarmBehavior !== 'off' ? tokens.accent : tokens.textMuted} /></TimerControlButton> : null}
        {runningControls.has('stepAlarm') && multiStep && currentStep ? <TimerControlButton size={48} label={`${stepAlarmEnabled(currentStep) ? 'Turn off' : 'Turn on'} alarm for ${currentStep.label}`} tooltip="Toggle the alarm at this step's end, including future rounds of this run." active={stepAlarmEnabled(currentStep)} onPress={() => props.onToggleCurrentStepAlarm(currentStep.id)} onTooltip={showTooltip}><AlarmIcon color={stepAlarmEnabled(currentStep) ? tokens.accent : tokens.textMuted} /></TimerControlButton> : null}
        {runningControls.has('focus') && Platform.OS === 'android' ? <TimerControlButton size={48} label="Chandas Focus" tooltip={!props.focusPolicyAccess ? 'Set up Android Do Not Disturb access' : focusPaused ? 'Chandas Focus was paused in Android settings' : props.focusEnabled ? 'Turn off Chandas Focus automation' : 'Let Chandas manage its own Do Not Disturb rule'} active={props.focusEnabled && props.focusPolicyAccess && !focusPaused} onPress={!props.focusPolicyAccess || props.focusReason === 'rule-disabled' ? props.onOpenFocusSettings : props.onToggleFocus} onTooltip={showTooltip}><FocusIcon color={props.focusEnabled && props.focusPolicyAccess && !focusPaused ? tokens.accent : tokens.textMuted} /></TimerControlButton> : null}
        <View style={styles.spacer} />
        {runningControls.has('sound') ? <TimerControlButton size={48} label="Sound and mute" tooltip="Open volume, mixer and mute controls" active={mixerOpen || muted} onPress={() => setMixerOpen(true)} onTooltip={showTooltip}><VolumeIcon muted={muted} color={mixerOpen || muted ? tokens.accent : tokens.textMuted} /></TimerControlButton> : null}
      </View>
      <TourTarget id="tour-stop" style={{ width: '100%', maxWidth: 480 }}><Pressable onPress={() => { tapHaptic(); props.onStop(); tour?.advance('stop') }} style={[styles.stop, { borderColor: tokens.border, backgroundColor: tokens.surfaceHi }]} accessibilityRole="button"><Text style={[styles.stopText, { color: theme === 'eink' ? tokens.text : tokens.textMuted }]}>Stop</Text></Pressable></TourTarget>
    </Animated.View> : <><Pressable onPress={pressTimerSurface} style={styles.revealSurface} accessibilityRole="button" accessibilityLabel={muted ? 'Muted timer. Tap to unmute.' : 'Show timer controls'} accessibilityHint={muted ? 'Clears the timer mute and keeps timer controls visible' : 'Shows the hidden timer controls'} /><Text pointerEvents="none" style={[styles.revealHint, { color: tokens.textMuted }]}>{muted ? 'Tap anywhere to unmute' : 'Tap to show controls'}</Text></>}

    {props.focusActive ? <Animated.View entering={reducedMotion ? undefined : FadeIn.duration(180)} exiting={reducedMotion ? undefined : FadeOut.duration(140)} pointerEvents="none" style={[styles.focusBorder, { borderColor: tokens.accent }]} /> : null}
    <RunningMixerSheet visible={mixerOpen} onClose={() => setMixerOpen(false)} program={props.program} masterVolume={props.masterVolume} onMasterVolumeChange={props.onMasterVolumeChange} onCueVolumeChange={props.onCueVolumeChange} mute={props.mute} muted={muted} onMuteIterations={noMainInterval ? undefined : props.onMuteForIterations} onClearMute={clearMuteFromTimer} secondPrecision={props.secondPrecision} onMuteForSeconds={props.onMuteForSeconds} onMuteUntil={props.onMuteUntil} getSuggestions={props.getMuteSuggestions} />
    <SnapSheet visible={snapOpen} cycleDurationSeconds={cycleDurationSeconds} current={props.program.alignment.kind === 'local-clock' ? props.program.alignment.offsetMinutes : null} onSelect={props.onSnapToClock} onClose={() => setSnapOpen(false)} />
    <ConfigurationPickerSheet visible={configurationPickerOpen} configurations={props.configurations} activeId={props.activeConfigurationId} selectingId={selectingConfiguration} onClose={() => setConfigurationPickerOpen(false)} onSelect={async id => { setSelectingConfiguration(id); try { if (await props.onSelectConfiguration(id)) setConfigurationPickerOpen(false) } finally { setSelectingConfiguration(null) } }} />
    <TimerHelpSheet
      visible={helpOpen}
      mode={noMainInterval ? 'bells' : multiStep ? 'sequence' : 'pattern'}
      controlSettings={props.controlSettings}
      onRunningControlIdsChange={props.onChangeRunningControlIds}
      onClose={() => setHelpOpen(false)}
    />
    {tooltip ? <Animated.View entering={reducedMotion ? undefined : FadeInDown.duration(160)} exiting={reducedMotion ? undefined : FadeOut.duration(130)} style={[styles.tooltip, { backgroundColor: tokens.surfaceHi, borderColor: tokens.border, pointerEvents: 'none' }]}><Text style={[styles.tooltipText, { color: tokens.text }]}>{tooltip}</Text></Animated.View> : null}
  </View></GestureDetector>
}

function RunningStepStrip({ steps, index, position, program, endsAt, identity, pullDown, scrollGesture, scrubbingEnabled, enabled, onSelect }: {
  pullDown: ReturnType<typeof Gesture.Pan>;
  scrollGesture: ReturnType<typeof Gesture.Native>;
  steps: { id: string; label: string }[]; index: number; position: TimelinePosition | null; program: RuntimeTimerProgram; endsAt: number; identity: string; scrubbingEnabled: boolean; enabled: boolean; onSelect: (distance: number) => boolean
}) {
  const { tokens } = useTheme()
  const [selected, setSelected] = useState(0)
  const travel = useRef(new RNAnimated.Value(0)).current
  const detent = useRef(0)
  const heldStep = useRef<string | null>(null)
  const lastDrag = useRef(0)
  const slot = 94
  const count = steps.length
  const cycle = position?.cycleIndex ?? 0
  const back = endsAt > 0 && cycle === 0 ? index : count - 1
  let forward = 0
  if (position) {
    let targetAt = position.anchor + cycle * programCycleDurationMs(program)
    for (let i = 0; i <= index; i++) targetAt += currentStepDurationMs(program, i)
    while (forward < count - 1 && (endsAt <= 0 || targetAt < endsAt)) {
      forward++
      targetAt += currentStepDurationMs(program, (index + forward) % count)
    }
  }
  const limits = useRef({ back, forward, onSelect, identity })
  limits.current = { back, forward, onSelect, identity }
  const gesture = useMemo(() => Gesture.Pan().enabled(enabled && scrubbingEnabled).simultaneousWithExternalGesture(pullDown).blocksExternalGesture(scrollGesture).activateAfterLongPress(DIAL_HOLD_MS).maxPointers(1).runOnJS(true)
    .onStart(() => { heldStep.current = limits.current.identity; selectionHaptic() })
    .onUpdate(({ translationX }) => {
      if (heldStep.current !== limits.current.identity) return
      const turns = -translationX / slot
      const { back: min, forward: max } = limits.current
      const next = Math.max(-min, Math.min(max, Math.sign(turns) * Math.floor(Math.abs(turns) + 0.42)))
      if (next !== detent.current) { detent.current = next; setSelected(next); selectionHaptic() }
      travel.setValue(Math.max(-slot / 4, Math.min(slot / 4, -(turns - next) * slot * 0.36)))
    })
    .onEnd((_, success) => {
      if (success && detent.current && heldStep.current === limits.current.identity) limits.current.onSelect(detent.current)
    })
    .onFinalize(() => {
      if (heldStep.current !== null) lastDrag.current = Date.now()
      heldStep.current = null
      detent.current = 0
      setSelected(0)
      travel.setValue(0)
    }), [enabled, scrubbingEnabled, travel, pullDown, scrollGesture])
  return <GestureDetector gesture={gesture} touchAction="pan-y">
    <View testID="running-step-strip" style={styles.stepStrip}>
      <RNAnimated.View style={{ flexDirection: 'row', justifyContent: 'center', transform: [{ translateX: travel }] }}>
        {[-1, 0, 1].map(offset => {
          const distance = selected + offset
          const step = distance >= -back && distance <= forward ? steps[(index + distance + count) % count] : undefined
          const label = <Text numberOfLines={1} accessibilityLabel={offset === 0 ? `Current step, ${step?.label}` : undefined} style={[styles.stepStripLabel, { color: offset === 0 ? (selected ? tokens.accent : tokens.text) : tokens.textMuted }]}>{step?.label}</Text>
          const style = [styles.stepStripItem, { width: slot }]
          return step && offset !== 0
            ? <Pressable key={offset} style={style} disabled={!enabled || selected !== 0} accessibilityRole="button" accessibilityLabel={`Skip to ${step.label}, ${offset < 0 ? 'previous step' : 'next step'}`} onPress={() => { if (heldStep.current === null && Date.now() - lastDrag.current > 180 && onSelect(distance)) selectionHaptic() }}>{label}</Pressable>
            : <View key={offset} style={style}>{label}</View>
        })}
      </RNAnimated.View>
      <View pointerEvents="none" style={StyleSheet.absoluteFill}><ScrollEdgeFade side="left" color={tokens.bg} /><ScrollEdgeFade side="right" color={tokens.bg} /></View>
    </View>
  </GestureDetector>
}

function BoundedRunBar({ width, progress, segments, muted }: { width: number; progress: number; segments: number; muted: boolean }) {
  const { tokens } = useTheme()
  const reducedMotion = useAppReducedMotion()
  const strokeWidth = 5
  const count = Number.isFinite(segments) && segments > 1 && segments <= 12 ? Math.round(segments) : 1
  const normalized = Math.max(0, Math.min(1, progress))
  const animatedProgress = useRef(new RNAnimated.Value(normalized)).current

  useEffect(() => {
    if (reducedMotion) {
      animatedProgress.setValue(normalized)
      return
    }
    RNAnimated.timing(animatedProgress, { toValue: normalized, duration: 320, useNativeDriver: false }).start()
  }, [animatedProgress, normalized, reducedMotion])

  const inset = strokeWidth / 2
  const span = (width - strokeWidth) / count
  const gap = count > 1 ? Math.min(6, span * 0.22) : 0
  return <View accessibilityRole="progressbar" accessibilityLabel="Overall run progress" accessibilityValue={{ min: 0, max: 100, now: Math.round(normalized * 100) }}>
    <Svg width={width} height={12}>
      {Array.from({ length: count }, (_, index) => {
        const start = inset + index * span + (index > 0 ? gap / 2 : 0)
        const end = inset + (index + 1) * span - (index < count - 1 ? gap / 2 : 0)
        const localProgress = animatedProgress.interpolate({ inputRange: [index / count, (index + 1) / count], outputRange: [0, 1], extrapolate: 'clamp' })
        const startedOpacity = animatedProgress.interpolate({ inputRange: [index / count, Math.min(1, index / count + 0.0001)], outputRange: [0, muted ? 0.5 : 1], extrapolate: 'clamp' })
        const animatedEnd = RNAnimated.add(start, RNAnimated.multiply(localProgress, end - start))
        return <Fragment key={index}>
          <Line x1={start} y1={6} x2={end} y2={6} stroke={tokens.surfaceHi} strokeWidth={strokeWidth} strokeLinecap="round" />
          <AnimatedLine x1={start} y1={6} x2={animatedEnd} y2={6} stroke={tokens.accent} strokeWidth={strokeWidth} strokeLinecap="round" opacity={startedOpacity} />
        </Fragment>
      })}
    </Svg>
  </View>
}

const AnimatedLine = RNAnimated.createAnimatedComponent(Line)

function RunningMixerSheet({ visible, onClose, program, masterVolume, onMasterVolumeChange, onCueVolumeChange, mute, muted, onMuteIterations, onClearMute, secondPrecision, onMuteForSeconds, onMuteUntil, getSuggestions }: { visible: boolean; onClose: () => void; program: RuntimeTimerProgram; masterVolume: number; onMasterVolumeChange: (value: number) => void; onCueVolumeChange: (cueId: string, value: number) => void; mute: RuntimeMuteState; muted: boolean; onMuteIterations?: (count: number) => void; onClearMute: () => void; secondPrecision: boolean; onMuteForSeconds: (seconds: number) => void; onMuteUntil: (deadline: number) => void; getSuggestions: (now: number, limit?: number) => CueMuteSuggestion[] }) {
  const { tokens } = useTheme()
  const reducedMotion = useAppReducedMotion()
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [channelsOpen, setChannelsOpen] = useState(false)
  useEffect(() => { if (!visible) setChannelsOpen(false) }, [visible])
  const channels: { id: string; title: string; cue: CueSettings }[] = program.mode === 'pattern'
    ? [{ id: 'main', title: 'Main gong', cue: program.mainCue }, ...program.tracks.map(track => ({ id: track.id, title: track.label, cue: track }))]
    : program.mode === 'sequence'
      ? program.steps.map((step, index) => ({ id: step.id, title: `${index + 1}. ${step.label}`, cue: step }))
      : program.steps.flatMap((step, index) => [
        ...(program.noMainInterval ? [] : [{ id: unifiedCueIdentity(step.id), title: `${index + 1}. ${step.label}`, cue: step.endCue }]),
        ...step.subBellTracks.map(track => ({ id: unifiedCueIdentity(step.id, track.id), title: `${index + 1}. ${track.label}`, cue: track })),
      ])
  if (program.runPolicy.kind !== 'continuous' && program.completionCue) channels.push({ id: '__chandas_completion__', title: 'End gong', cue: program.completionCue })
  const preview = async (title: string, cue: CueSettings) => {
    setPreviewError(null)
    try {
      if (!await ChandasTimerService.previewSound(cue.sound, masterVolume * cue.volume)) setPreviewError(`${title} could not be opened. The timer will use its safe fallback.`)
    } catch {
      setPreviewError('The preview stayed quiet. Your live timer was not changed.')
    }
  }
  const channel = ({ id, title, cue }: typeof channels[number]) => <View key={id} style={styles.channel}><View style={styles.channelLabel}><Text numberOfLines={1} style={[styles.channelTitle, { color: tokens.text }]}>{title}</Text><SoundName cue={cue} style={styles.channelSound} /></View><View style={styles.channelControl}><Slider style={styles.channelSlider} minimumValue={0} maximumValue={1} step={0.05} value={cue.volume} onValueChange={value => onCueVolumeChange(id, value)} minimumTrackTintColor={tokens.accent} maximumTrackTintColor={tokens.surfaceHi} thumbTintColor={tokens.accent} accessibilityLabel={`${title} volume`} accessibilityValue={{ min: 0, max: 100, now: Math.round(cue.volume * 100), text: `${Math.round(cue.volume * 100)} percent` }} /><Pressable hitSlop={7} onPress={() => void preview(title, cue)} style={[styles.previewMini, { borderColor: tokens.border }]} accessibilityRole="button" accessibilityLabel={`Preview ${title}`}><Text style={[styles.previewGlyph, { color: tokens.accent }]}>▶</Text></Pressable></View></View>
  const close = () => { ChandasTimerService.stopSoundPreview(); setPreviewError(null); onClose() }
  const masterControl = <View style={styles.masterBlock}><Text style={[styles.channelTitle, { color: tokens.text }]}>Volume</Text><View style={styles.channelControl}><Slider style={styles.masterSlider} minimumValue={0} maximumValue={1} step={0.05} value={masterVolume} onValueChange={onMasterVolumeChange} minimumTrackTintColor={tokens.accent} maximumTrackTintColor={tokens.surfaceHi} thumbTintColor={tokens.accent} accessibilityLabel="Volume" accessibilityValue={{ min: 0, max: 100, now: Math.round(masterVolume * 100), text: `${Math.round(masterVolume * 100)} percent` }} /><Pressable hitSlop={7} onPress={() => { tapHaptic(); setChannelsOpen(value => !value) }} style={({ pressed }) => [styles.mixerButton, { borderColor: channelsOpen ? tokens.accent : tokens.border, backgroundColor: channelsOpen || pressed ? tokens.accentGlow : 'transparent', transform: [{ scale: pressed && !reducedMotion ? 0.92 : 1 }] }]} accessibilityRole="button" accessibilityLabel={channelsOpen ? 'Hide mixer' : 'Open mixer'} accessibilityState={{ expanded: channelsOpen }}><MixerIcon color={tokens.accent} /></Pressable></View></View>
  return <BottomSheet visible={visible} title="Sound & mute" fitContent onClose={close} pinnedContent={masterControl}>
    {previewError ? <GentleNotice title="Preview stayed quiet" message={previewError} tone="attention" /> : null}
    {channelsOpen ? <Animated.View entering={reducedMotion ? undefined : FadeIn.duration(140)} exiting={reducedMotion ? undefined : FadeOut.duration(100)} style={styles.channels}><View style={[styles.divider, { backgroundColor: tokens.border }]} />{channels.map(channel)}</Animated.View> : null}
    {visible ? <TimerMuteControls muted={muted} timedUntil={Math.max(mute.mutedUntil, mute.iteration?.endsAt ?? 0)} iterationCount={mute.iteration?.iterations} getSuggestions={getSuggestions} secondPrecision={secondPrecision} onMuteIterations={onMuteIterations} onMuteForSeconds={onMuteForSeconds} onMuteUntil={onMuteUntil} onClearMute={onClearMute} /> : null}
  </BottomSheet>
}

function SnapSheet({ visible, cycleDurationSeconds, current, onSelect, onClose }: { visible: boolean; cycleDurationSeconds: number; current: number | null; onSelect: (offset: number) => Promise<boolean>; onClose: () => void }) {
  const { tokens } = useTheme()
  const [applying, setApplying] = useState(false)
  const [selected, setSelected] = useState<number | null>(current)
  const [error, setError] = useState(false)
  useEffect(() => {
    if (!visible) return
    setSelected(current)
    setError(false)
    setApplying(false)
  }, [current, visible])
  const select = async (offset: number) => {
    if (applying) return
    setSelected(offset)
    setError(false)
    setApplying(true)
    try {
      if (await onSelect(offset)) onClose()
      else {
        setSelected(current)
        setError(true)
      }
    } catch {
      setSelected(current)
      setError(true)
    } finally {
      setApplying(false)
    }
  }
  const close = () => { if (!applying) onClose() }
  return <BottomSheet visible={visible} fitContent title="Snap to clock" onClose={close} scroll={false}>
    <View style={styles.snapStatus}><Text style={[styles.sheetHelp, { color: tokens.textMuted }]}>{applying ? `Aligning to :${String(selected ?? 0).padStart(2, '0')}…` : current === null ? 'No clock phase is selected. Choose where each repeating cycle lands on the clock.' : 'Choose where each repeating cycle lands on the clock.'}</Text>{applying ? <ActivityIndicator size="small" color={tokens.accent} /> : null}</View>
    {error ? <GentleNotice title="Alignment stayed unchanged" message="The timer is still running on its previous rhythm. You can try again." tone="attention" /> : null}
    <ClockSnapSelector cycleDurationSeconds={cycleDurationSeconds} value={selected} onChange={offset => void select(offset)} disabled={applying} />
  </BottomSheet>
}

function ConfigurationPickerSheet({ visible, configurations, activeId, selectingId, onSelect, onClose }: { visible: boolean; configurations: Array<ProgramPreset | UnifiedTimerConfig>; activeId?: string; selectingId: string | null; onSelect: (id: string) => Promise<void>; onClose: () => void }) {
  const { tokens } = useTheme()
  return <BottomSheet visible={visible} title="Switch configuration" help="Switching begins this saved timer from now. Only configurations marked Show while running appear here." onClose={onClose}>
    {configurations.map(preset => <Pressable key={preset.id} disabled={Boolean(selectingId)} onPress={() => void onSelect(preset.id)} style={[styles.configurationRow, { borderColor: preset.id === activeId ? tokens.accent : tokens.border, backgroundColor: preset.id === activeId ? tokens.accentGlow : 'transparent', opacity: selectingId && selectingId !== preset.id ? 0.45 : 1 }]} accessibilityRole="button" accessibilityState={{ selected: preset.id === activeId, busy: selectingId === preset.id }} accessibilityLabel={`Switch to ${preset.name}`}><View style={styles.configurationCopy}><Text numberOfLines={1} style={[styles.channelTitle, { color: tokens.text }]}>{preset.name}</Text><Text numberOfLines={2} style={[styles.channelSound, { color: tokens.textMuted }]}>{runningConfigurationDescription(preset)}</Text></View>{selectingId === preset.id ? <ActivityIndicator size="small" color={tokens.accent} /> : preset.id === activeId ? <Text style={[styles.configurationCurrent, { color: tokens.accent }]}>CURRENT</Text> : null}</Pressable>)}
  </BottomSheet>
}

function runningConfigurationDescription(preset: ProgramPreset | UnifiedTimerConfig): string {
  const base = preset.program.mode === 'pattern'
    ? `Cycle · ${formatCompactDurationSeconds(patternDurationSeconds(preset.program))}`
    : preset.program.mode === 'sequence'
      ? `Sequence · ${preset.program.steps.length} ${preset.program.steps.length === 1 ? 'step' : 'steps'}`
      : `Timer · ${preset.program.steps.length} ${preset.program.steps.length === 1 ? 'step' : 'steps'}`
  if (!preset.settings) return `${base} · keeps current settings`
  if (!preset.settings?.availability.enabled) return `${base} · schedule off`
  const active = preset.settings.availability.weeklyWindows.filter(window => window.enabled && window.days !== 0 && window.behavior !== 'mute').length
  const quiet = preset.settings.availability.weeklyWindows.filter(window => window.enabled && window.days !== 0 && window.behavior === 'mute').length
  return `${base} · ${active} active ${active === 1 ? 'range' : 'ranges'}${quiet ? ` · ${quiet} quiet` : ''}`
}

function stepAlarmEnabled(step: { alarmEnabled?: boolean; endAlarmEnabled?: boolean }): boolean {
  return step.endAlarmEnabled === true || step.alarmEnabled === true
}

function nextTrackColor(program: RuntimeTimerProgram, winner: TimelineCueCandidate | undefined, eink: boolean, fallback: string): string {
  if (!winner) return fallback
  if (program.mode === 'pattern') {
    const index = program.tracks.findIndex(track => track.id === winner.cueId)
    return subBellColorValue(program.tracks[index]?.color, Math.max(0, index), eink)
  }
  if (program.mode === 'unified' && winner.trackId) {
    const step = program.steps.find(value => value.id === winner.stepId)
    const index = step?.subBellTracks.findIndex(track => track.id === winner.trackId) ?? -1
    return subBellColorValue(index >= 0 ? step?.subBellTracks[index]?.color : undefined, Math.max(0, index), eink)
  }
  return fallback
}

const styles = StyleSheet.create({
  adjacentRing: { position: 'absolute', top: 0 },
  watchArea: { justifyContent: 'flex-start', alignItems: 'center', alignSelf: 'stretch' },
  scrubMarker: { position: 'absolute', top: 0 },
  watchViewport: { width: '100%', overflow: 'hidden' },
  underTimer: { width: '100%', minHeight: 120, alignItems: 'center', gap: 6 },
  stepStrip: { width: '100%', maxWidth: 340, alignSelf: 'center', position: 'relative', marginBottom: 10 },
  stepStripItem: { height: 44, justifyContent: 'center', paddingHorizontal: 4 },
  stepStripLabel: { fontSize: 13, textAlign: 'center' },
  runPager: { flexDirection: 'row', alignItems: 'center', gap: 16, height: 32 },
  runPageLabel: { fontSize: 13 },
  transport: { width: '100%', height: 52, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 22, zIndex: 2 },
  screen: { flex: 1, overflow: 'hidden' }, content: { flexGrow: 1, alignItems: 'center', paddingTop: 22 }, revealSurface: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, zIndex: 90 }, revealHint: { position: 'absolute', zIndex: 91, bottom: 28, alignSelf: 'center', fontSize: 13 },
  topline: { width: '100%', maxWidth: 520, paddingHorizontal: 20 }, headerContent: { minHeight: 48, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 }, configurationTitle: { flex: 1, minWidth: 0, minHeight: 40, justifyContent: 'center' }, configurationNameRow: { alignSelf: 'flex-start', maxWidth: '100%', flexDirection: 'row', alignItems: 'center', gap: 5 }, configurationChevron: { flexShrink: 0, width: 18, textAlign: 'center', fontSize: 22, lineHeight: 24, fontWeight: '300' }, mode: { fontSize: 10, letterSpacing: 1.25, fontWeight: '800' }, stepTitle: { flexShrink: 1, fontSize: 21 }, topRight: { flexDirection: 'row', alignItems: 'center', gap: 10 }, syncing: { flexDirection: 'row', alignItems: 'center', gap: 6 }, focusStatus: { fontSize: 13 }, helpButton: { width: 40, height: 40, borderWidth: 1.5, borderRadius: 20, alignItems: 'center', justifyContent: 'center' }, helpGlyph: { fontSize: 16, fontWeight: '800' },
  visualStage: { flex: 1, width: '100%', alignItems: 'center', justifyContent: 'center', paddingVertical: 14 }, timerStack: { width: '100%', alignItems: 'center' }, ringWrap: { alignItems: 'center', justifyContent: 'center' }, svg: { position: 'absolute' }, flash: { position: 'absolute' }, center: { alignItems: 'center', gap: 5, maxWidth: '69%' }, mainTime: { width: '100%', textAlign: 'center', fontFamily: 'JetBrainsMono-Light', fontSize: 55, fontVariant: ['tabular-nums'] }, mainCaption: { fontSize: 10, letterSpacing: 1.05, textTransform: 'uppercase' }, nextCue: { marginTop: 11, alignItems: 'center', gap: 2, maxWidth: '100%' }, nextCueName: { fontSize: 13, fontWeight: '700' }, nextCueTime: { fontFamily: 'JetBrainsMono-Regular', fontSize: 12 }, nextLabel: { fontSize: 8, letterSpacing: 1.1, fontWeight: '800' }, slash: { position: 'absolute', height: 4, borderRadius: 3, transform: [{ rotate: '-45deg' }] }, statusSlot: { width: '100%', alignItems: 'center', gap: 6 }, runProgressBlock: { alignItems: 'center', gap: 4 }, nextAudibleStatus: { maxWidth: 330, textAlign: 'center' }, runStatus: { fontSize: 13, lineHeight: 18, textAlign: 'center', fontVariant: ['tabular-nums'] }, focusBorder: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, borderWidth: 3, zIndex: 100 },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 20, alignItems: 'center' }, bottomFade: { position: 'absolute', top: -34, left: 0, right: 0, height: 34 }, controls: { width: '100%', maxWidth: 480, flexDirection: 'row', gap: 8, marginBottom: 10 }, spacer: { flex: 1 }, iconButton: { width: 40, height: 40, borderWidth: 1.5, borderRadius: 20, alignItems: 'center', justifyContent: 'center' }, badge: { position: 'absolute', right: -2, top: -3, minWidth: 14, height: 14, borderRadius: 7, paddingHorizontal: 3, alignItems: 'center', justifyContent: 'center' }, badgeText: { color: '#fff', fontSize: 8, fontWeight: '900' }, stop: { width: '100%', maxWidth: 480, borderWidth: 1.5, paddingVertical: 16, borderRadius: 99, alignItems: 'center' }, stopText: { fontSize: 13 },
  channel: { minHeight: 78, gap: 3, paddingVertical: 5 }, masterBlock: { gap: 3 }, masterSlider: { flex: 1, height: 38 }, channelLabel: { gap: 2 }, channelControl: { minHeight: 40, flexDirection: 'row', alignItems: 'center', gap: 8 }, channelTitle: { fontSize: 13, fontWeight: '700' }, channelSound: { fontSize: 10 }, channelSlider: { flex: 1, height: 38 }, divider: { height: 1 }, sheetHelp: { flex: 1, fontSize: 12, lineHeight: 18 }, snapStatus: { minHeight: 24, flexDirection: 'row', alignItems: 'center', gap: 10 }, muteRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, clearMuteButton: { minHeight: 50, borderWidth: 1.5, borderRadius: 14, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 18 }, clearMuteText: { fontSize: 15, lineHeight: 20, fontWeight: '700' },
  channels: { gap: 2 },
  previewMini: { width: 30, height: 30, borderWidth: 1, borderRadius: 15, alignItems: 'center', justifyContent: 'center' }, previewGlyph: { fontSize: 9 },
  mixerButton: { width: 36, height: 36, borderWidth: 1, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  configurationRow: { minHeight: 61, borderWidth: 1.5, borderRadius: 13, paddingHorizontal: 13, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 10 }, configurationCopy: { flex: 1, minWidth: 0, gap: 3 }, configurationCurrent: { fontSize: 9, letterSpacing: 1, fontWeight: '800' },
  tooltip: { position: 'absolute', bottom: 126, alignSelf: 'center', maxWidth: '82%', paddingVertical: 10, paddingHorizontal: 14, borderRadius: 12, borderWidth: 1.5 }, tooltipText: { fontSize: 12, lineHeight: 17, textAlign: 'center' },
})
