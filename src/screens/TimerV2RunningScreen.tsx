import { useAppReducedMotion } from '../theme/ThemeContext'
import { Fragment, useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Animated as RNAnimated, AppState, Platform, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native'
import Slider from '@react-native-community/slider'
import Svg, { Line } from 'react-native-svg'
import Animated, { FadeIn, FadeInDown, FadeOut, ZoomIn } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type { AlarmBehavior, CueSettings, ProgramPreset, TimerProgram } from '../types'
import type { TimelinePosition } from '../lib/timeline'
import { cueSegmentProgress, programCycleDurationMs } from '../lib/timeline'
import { AlarmIcon, ClockIcon, FocusIcon, MixerIcon, RestartIcon, VolumeIcon } from '../components/Icons'
import { Chip } from '../components/Chip'
import { CustomMinutePicker } from '../components/CustomMinutePicker'
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
import { SheetSectionTitle } from '../components/timer-v2/SheetSectionTitle'
import { ScrollEdgeFade } from '../components/timer-v2/ScrollEdgeFade'
import { formatCompactDurationSeconds, patternDurationSeconds, sequenceStepDurationSeconds } from '../lib/timerV2'
import { formatCountdown } from '../lib/snapLogic'
import { formatEventLocalTime } from '../lib/upcoming-events'
import { TimerWatchface, type TimerWatchfaceModel } from '../components/timer-v2/running/TimerWatchface'
import { TimerControlButton } from '../components/timer-v2/running/TimerControlButton'

interface Props {
  program: TimerProgram
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
  onStop: () => void
  onRestartUnsynced: () => void
  onSnapToClock: (offsetMinutes: number) => Promise<boolean>
  onPressAlarm: () => void
  onMuteForIterations: (count: number) => void
  onMuteForSeconds: (seconds: number) => void
  onClearMute: () => void
  secondPrecision: boolean
  masterVolume: number
  onMasterVolumeChange: (value: number) => void
  onCueVolumeChange: (cueId: string, volume: number) => void
  showAdvancedControls: boolean
  onShowAdvancedControls: () => void
  focusEnabled: boolean
  focusActive: boolean
  focusPolicyAccess: boolean
  focusReason: string
  onToggleFocus: () => void
  onOpenFocusSettings: () => void
  configurations: ProgramPreset[]
  activeConfigurationId?: string
  configurationName?: string
  onSelectConfiguration: (presetId: string) => Promise<boolean>
  externalPanel?: 'clock' | 'sound' | null
  onExternalPanelConsumed?: () => void
}

export function TimerV2RunningScreen(props: Props) {
  const { tokens, theme } = useTheme()
  const insets = useSafeAreaInsets()
  const { width } = useWindowDimensions()
  const reducedMotion = useAppReducedMotion()
  const [mixerOpen, setMixerOpen] = useState(false)
  const [customMute, setCustomMute] = useState(false)
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
  const tooltipTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const helpLongPressed = useRef(false)
  const size = Math.min(width * 0.79, 342)
  const runtimeMuted = props.mute.mutedUntil > Date.now() || Boolean(props.mute.iteration)
  const muted = props.masterVolume <= 0 || runtimeMuted
  const muteEndsAt = props.mute.iteration?.endsAt ?? props.mute.mutedUntil
  const muteStatus = runtimeMuted
    ? muteEndsAt > Date.now()
      ? `Muted for another ${formatCountdown(muteEndsAt - Date.now())} · tap to clear`
      : 'Muted, tap to clear'
    : props.masterVolume <= 0
      ? 'Volume 0% · open sound controls'
      : null
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
  const sequenceIndex = props.program.mode === 'sequence' ? props.position?.currentStepIndex ?? 0 : 0
  const sequenceLength = props.program.mode === 'sequence' ? props.program.steps.length : 0
  const currentStep = props.program.mode === 'sequence' ? props.program.steps[sequenceIndex] : null
  const nextStep = props.program.mode === 'sequence' && !props.position?.nextEvent?.completesRun ? props.program.steps[(sequenceIndex + 1) % props.program.steps.length] : null
  const nextCueColor = props.program.mode === 'pattern'
    ? subBellColorValue(props.program.tracks.find(track => track.id === props.position?.nextEvent?.winner.cueId)?.color, Math.max(0, props.program.tracks.findIndex(track => track.id === props.position?.nextEvent?.winner.cueId)), theme === 'eink')
    : tokens.accent
  const enhancedClockAlignmentSupported = !isNativeServiceAvailable || ChandasTimerService.getCapabilities()?.supportsProgramClockAlignment === true
  const clockAlignmentAvailable = props.program.mode === 'pattern'
    ? patternDurationSeconds(props.program) % 60 === 0 || enhancedClockAlignmentSupported
    : enhancedClockAlignmentSupported
  const cycleDurationSeconds = programCycleDurationMs(props.program) / 1_000
  const watchfaceModel: TimerWatchfaceModel = {
    mainLabel,
    mainCaption: endsBeforeResume ? 'session ends quietly' : props.activeHoursPaused ? (hasResume ? 'Quiet until' : 'Schedule is quiet') : props.program.mode === 'sequence' ? `step ${sequenceIndex + 1} of ${sequenceLength}` : undefined,
    nextLabel: props.activeHoursPaused && nextAudibleSummary ? 'NEXT AUDIBLE' : !props.activeHoursPaused && props.program.mode === 'sequence' && nextStep ? 'NEXT' : undefined,
    nextName: props.activeHoursPaused && nextAudibleSummary
      ? nextAudibleSummary
      : !props.activeHoursPaused && props.program.mode === 'pattern' && props.position?.nextEvent?.boundary !== 'pattern-main'
        ? props.nextCueLabel
        : !props.activeHoursPaused && props.program.mode === 'sequence' && nextStep
          ? `${nextStep.label} · ${formatCompactDurationSeconds(sequenceStepDurationSeconds(nextStep))}`
          : undefined,
    nextTime: !props.activeHoursPaused && props.program.mode === 'pattern' && props.position?.nextEvent?.boundary !== 'pattern-main' ? props.nextCueCountdown : undefined,
    nextColor: !props.activeHoursPaused && props.program.mode === 'pattern' ? nextCueColor : tokens.text,
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
  return <View style={[styles.screen, { backgroundColor: tokens.bg, paddingTop: insets.top }]}>
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 140 }]}>
      <Animated.View pointerEvents={controlsVisible ? 'auto' : 'none'} importantForAccessibility={controlsVisible ? 'auto' : 'no-hide-descendants'} accessibilityElementsHidden={!controlsVisible} style={[styles.topline, { opacity: controlsVisible ? 1 : 0 }]}>
        <Pressable disabled={props.configurations.length === 0} onPress={() => setConfigurationPickerOpen(true)} style={styles.configurationTitle} accessibilityRole={props.configurations.length ? 'button' : undefined} accessibilityLabel={props.configurations.length ? 'Switch saved configuration' : undefined}><View style={styles.configurationCopy}><View style={styles.configurationNameRow}><Text numberOfLines={1} style={[styles.stepTitle, { color: tokens.text }]}>{props.configurationName ?? (props.program.mode === 'pattern' ? props.program.label : 'Sequence')}</Text>{props.configurations.length ? <Text accessible={false} style={[styles.configurationChevron, { color: tokens.accent }]}>›</Text> : null}</View>{props.program.mode === 'sequence' && currentStep ? <Text numberOfLines={1} style={[styles.configurationStep, { color: tokens.textMuted }]}>{currentStep.label}</Text> : null}</View></Pressable>
        <View style={styles.topRight}>{props.realigning ? <Animated.View entering={FadeIn.duration(120)} exiting={FadeOut.duration(100)} style={styles.syncing}><ActivityIndicator size="small" color={tokens.accent} /><Text style={[styles.focusStatus, { color: tokens.textMuted }]}>UPDATING</Text></Animated.View> : null}{focusPaused ? <Animated.Text entering={FadeIn.duration(160)} exiting={FadeOut.duration(120)} style={[styles.focusStatus, { color: tokens.warm }]}>FOCUS PAUSED</Animated.Text> : null}<Pressable hitSlop={7} onPressIn={() => { helpLongPressed.current = false }} onLongPress={() => { helpLongPressed.current = true; showTooltip('Open Timer help') }} onPressOut={() => setTimeout(() => { helpLongPressed.current = false }, 0)} onPress={() => { if (!helpLongPressed.current) { tapHaptic(); setHelpOpen(true) } }} style={({ pressed }) => [styles.helpButton, { borderColor: tokens.border, transform: [{ scale: pressed && !reducedMotion ? 0.94 : 1 }] }]} accessibilityRole="button" accessibilityLabel="Timer help"><Text style={[styles.helpGlyph, { color: tokens.accent }]}>?</Text></Pressable></View>
      </Animated.View>

      <Pressable onPress={() => { if (controlsVisible) setControlsVisible(false) }} accessibilityRole="button" accessibilityLabel={controlsVisible ? 'Hide timer controls' : 'Show timer controls'} accessibilityHint={controlsVisible ? 'Hides timer controls and leaves the running timer visible' : 'Shows timer controls'} style={[styles.visualStage, { minHeight: size + 112 }]}>
        <View style={[styles.timerStack, { height: size + 92 }]}>
        <Animated.View entering={reducedMotion ? undefined : ZoomIn.duration(260)}>
          <TimerWatchface program={props.program} position={props.position} progress={props.progress} eventPulse={props.eventPulse} size={size} model={watchfaceModel} onPress={() => setControlsVisible(value => !value)} accessibilityLabel={controlsVisible ? 'Hide timer controls' : 'Show timer controls'} />
        </Animated.View>
        {controlsVisible ? <View style={[styles.statusSlot, { top: size + 10 }]}>
          {props.runEndsAt > 0 ? <Animated.View entering={FadeIn.duration(150)} style={styles.runProgressBlock}>
            <BoundedRunBar width={Math.min(size * 0.82, 286)} progress={props.runProgress} segments={props.program.runPolicy.kind === 'cycles' ? props.program.runPolicy.cycleCount : 1} muted={runtimeMuted} />
            <Text style={[styles.runStatus, { color: tokens.textMuted }]}>Ends in {formatDuration(Math.ceil(props.runRemainingMs / 1_000))}</Text>
          </Animated.View> : null}
          {controlsVisible && muteStatus ? <Pressable onPress={runtimeMuted ? props.onClearMute : undefined} accessibilityRole={runtimeMuted ? 'button' : undefined} accessibilityLabel={runtimeMuted ? 'Clear timer mute' : undefined}><Animated.Text entering={FadeIn.duration(150)} exiting={FadeOut.duration(120)} style={[styles.muteStatus, { color: tokens.textMuted }]}>{muteStatus}</Animated.Text></Pressable> : null}
          {controlsVisible && runtimeMuted && nextAudibleSummary ? <Text style={[styles.nextAudibleStatus, { color: tokens.textMuted }]}>Next audible · {nextAudibleSummary}</Text> : null}
        </View> : null}
        </View>
      </Pressable>
    </ScrollView>

    {controlsVisible ? <Animated.View entering={reducedMotion ? undefined : FadeIn.duration(160)} exiting={reducedMotion ? undefined : FadeOut.duration(120)} style={[styles.bottom, { backgroundColor: tokens.bg, paddingBottom: insets.bottom + 17 }]}>
      <View pointerEvents="none" style={styles.bottomFade}><ScrollEdgeFade color={tokens.bg} side="bottom" /></View>
      <View style={styles.controls}>
        <TimerControlButton label="Reset interval" tooltip={props.program.alignment.kind === 'local-clock' ? 'Unsnap from clock and reset the cycle' : 'Reset the cycle'} disabled={props.realigning} onPress={props.onRestartUnsynced} onTooltip={showTooltip}><RestartIcon color={tokens.accent} /></TimerControlButton>
        {clockAlignmentAvailable ? <TimerControlButton label="Snap to clock" tooltip="Snap the repeating cycle to the clock" active={props.program.alignment.kind === 'local-clock'} disabled={props.realigning} onPress={() => setSnapOpen(true)} onTooltip={showTooltip}><ClockIcon color={tokens.accent} /></TimerControlButton> : null}
        {props.showAdvancedControls && props.program.mode === 'pattern' ? <TimerControlButton label={props.alarmBehavior === 'locked' ? 'Alarm locked' : props.alarmBehavior === 'once' ? 'Next main gong alarm' : 'Alarm off'} tooltip="Tap once to enable the alarm at the end of the current main interval. Tap twice to enable it for every main interval." active={props.alarmBehavior !== 'off'} badge={props.alarmBehavior === 'locked' ? '∞' : props.alarmBehavior === 'once' ? '1' : undefined} onPress={props.onPressAlarm} onTooltip={showTooltip}><AlarmIcon color={props.alarmBehavior !== 'off' ? tokens.accent : tokens.textMuted} /></TimerControlButton> : null}
        {props.showAdvancedControls && Platform.OS === 'android' ? <TimerControlButton label="Chandas Focus" tooltip={!props.focusPolicyAccess ? 'Set up Android Do Not Disturb access' : focusPaused ? 'Chandas Focus was paused in Android settings' : props.focusEnabled ? 'Turn off Chandas Focus automation' : 'Let Chandas manage its own Do Not Disturb rule'} active={props.focusEnabled && props.focusPolicyAccess && !focusPaused} onPress={!props.focusPolicyAccess || props.focusReason === 'rule-disabled' ? props.onOpenFocusSettings : props.onToggleFocus} onTooltip={showTooltip}><FocusIcon color={props.focusEnabled && props.focusPolicyAccess && !focusPaused ? tokens.accent : tokens.textMuted} /></TimerControlButton> : null}
        <View style={styles.spacer} />
        <TimerControlButton label="Sound and mute" tooltip="Open volume, mixer and mute controls" active={mixerOpen || muted} onPress={() => setMixerOpen(true)} onTooltip={showTooltip}><VolumeIcon muted={muted} color={mixerOpen || muted ? tokens.accent : tokens.textMuted} /></TimerControlButton>
      </View>
      <Pressable onPress={() => { tapHaptic(); props.onStop() }} style={[styles.stop, { borderColor: tokens.border, backgroundColor: tokens.surfaceHi }]} accessibilityRole="button"><Text style={[styles.stopText, { color: theme === 'eink' ? tokens.text : tokens.textMuted }]}>Stop</Text></Pressable>
    </Animated.View> : <><Pressable onPress={revealControls} style={styles.revealSurface} accessibilityRole="button" accessibilityLabel="Show timer controls" accessibilityHint="Shows the hidden timer controls" /><Text pointerEvents="none" style={[styles.revealHint, { color: tokens.textMuted }]}>Tap to show controls</Text></>}

    {props.focusActive ? <Animated.View entering={reducedMotion ? undefined : FadeIn.duration(180)} exiting={reducedMotion ? undefined : FadeOut.duration(140)} pointerEvents="none" style={[styles.focusBorder, { borderColor: tokens.accent }]} /> : null}
    <RunningMixerSheet visible={mixerOpen} onClose={() => setMixerOpen(false)} program={props.program} masterVolume={props.masterVolume} onMasterVolumeChange={props.onMasterVolumeChange} onCueVolumeChange={props.onCueVolumeChange} mute={props.mute} onMuteIterations={props.onMuteForIterations} onClearMute={props.onClearMute} onCustom={() => { setMixerOpen(false); setCustomMute(true) }} />
    <SnapSheet visible={snapOpen} cycleDurationSeconds={cycleDurationSeconds} current={props.program.alignment.kind === 'local-clock' ? props.program.alignment.offsetMinutes : null} onSelect={props.onSnapToClock} onClose={() => setSnapOpen(false)} />
    <ConfigurationPickerSheet visible={configurationPickerOpen} configurations={props.configurations} activeId={props.activeConfigurationId} selectingId={selectingConfiguration} onClose={() => setConfigurationPickerOpen(false)} onSelect={async id => { setSelectingConfiguration(id); try { if (await props.onSelectConfiguration(id)) setConfigurationPickerOpen(false) } finally { setSelectingConfiguration(null) } }} />
    {customMute ? <CustomMinutePicker title="Mute duration" initial={15} initialSeconds={15 * 60} secondPrecision={props.secondPrecision} min={1} max={1440} minSeconds={1} maxSeconds={86_400} onConfirm={minutes => { props.onMuteForSeconds(minutes * 60); setCustomMute(false) }} onConfirmSeconds={seconds => { props.onMuteForSeconds(seconds); setCustomMute(false) }} onClose={() => setCustomMute(false)} /> : null}
    <TimerHelpSheet
      visible={helpOpen}
      mode={props.program.mode}
      clockAlignmentVisible={clockAlignmentAvailable}
      advancedModeEnabled={props.showAdvancedControls}
      onShowAdvanced={props.onShowAdvancedControls}
      onClose={() => setHelpOpen(false)}
      onOpenFocusSettings={props.onOpenFocusSettings}
    />
    {tooltip ? <Animated.View entering={reducedMotion ? undefined : FadeInDown.duration(160)} exiting={reducedMotion ? undefined : FadeOut.duration(130)} style={[styles.tooltip, { backgroundColor: tokens.surfaceHi, borderColor: tokens.border, pointerEvents: 'none' }]}><Text style={[styles.tooltipText, { color: tokens.text }]}>{tooltip}</Text></Animated.View> : null}
  </View>
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

function RunningMixerSheet({ visible, onClose, program, masterVolume, onMasterVolumeChange, onCueVolumeChange, mute, onMuteIterations, onClearMute, onCustom }: { visible: boolean; onClose: () => void; program: TimerProgram; masterVolume: number; onMasterVolumeChange: (value: number) => void; onCueVolumeChange: (cueId: string, value: number) => void; mute: RuntimeMuteState; onMuteIterations: (count: number) => void; onClearMute: () => void; onCustom: () => void }) {
  const { tokens } = useTheme()
  const reducedMotion = useAppReducedMotion()
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [channelsOpen, setChannelsOpen] = useState(false)
  useEffect(() => { if (!visible) setChannelsOpen(false) }, [visible])
  const muted = Boolean(mute.iteration) || mute.mutedUntil > Date.now()
  const channels: { id: string; title: string; cue: CueSettings }[] = program.mode === 'pattern' ? [{ id: 'main', title: 'Main gong', cue: program.mainCue }, ...program.tracks.map(track => ({ id: track.id, title: track.label, cue: track }))] : program.steps.map((step, index) => ({ id: step.id, title: `${index + 1}. ${step.label}`, cue: step }))
  if (program.runPolicy.kind !== 'continuous' && program.completionCue) channels.push({ id: '__chandas_completion__', title: 'Final gong', cue: program.completionCue })
  const preview = async (title: string, cue: CueSettings) => {
    setPreviewError(null)
    try {
      if (!await ChandasTimerService.previewSound(cue.sound, masterVolume * cue.volume)) setPreviewError(`${title} could not be opened. The timer will use its safe fallback.`)
    } catch {
      setPreviewError('The preview stayed quiet. Your live timer was not changed.')
    }
  }
  const channel = ({ id, title, cue }: typeof channels[number]) => <View key={id} style={styles.channel}><View style={styles.channelLabel}><Text numberOfLines={1} style={[styles.channelTitle, { color: tokens.text }]}>{title}</Text><SoundName sound={cue.sound} style={styles.channelSound} /></View><View style={styles.channelControl}><Slider style={styles.channelSlider} minimumValue={0} maximumValue={1} step={0.05} value={cue.volume} onValueChange={value => onCueVolumeChange(id, value)} minimumTrackTintColor={tokens.accent} maximumTrackTintColor={tokens.surfaceHi} thumbTintColor={tokens.accent} accessibilityLabel={`${title} volume`} accessibilityValue={{ min: 0, max: 100, now: Math.round(cue.volume * 100), text: `${Math.round(cue.volume * 100)} percent` }} /><Pressable hitSlop={7} onPress={() => void preview(title, cue)} style={[styles.previewMini, { borderColor: tokens.border }]} accessibilityRole="button" accessibilityLabel={`Preview ${title}`}><Text style={[styles.previewGlyph, { color: tokens.accent }]}>▶</Text></Pressable></View></View>
  const close = () => { ChandasTimerService.stopSoundPreview(); setPreviewError(null); onClose() }
  const masterControl = <View style={styles.masterBlock}><Text style={[styles.channelTitle, { color: tokens.text }]}>Volume</Text><View style={styles.channelControl}><Slider style={styles.masterSlider} minimumValue={0} maximumValue={1} step={0.05} value={masterVolume} onValueChange={onMasterVolumeChange} minimumTrackTintColor={tokens.accent} maximumTrackTintColor={tokens.surfaceHi} thumbTintColor={tokens.accent} accessibilityLabel="Volume" accessibilityValue={{ min: 0, max: 100, now: Math.round(masterVolume * 100), text: `${Math.round(masterVolume * 100)} percent` }} /><Pressable hitSlop={7} onPress={() => { tapHaptic(); setChannelsOpen(value => !value) }} style={({ pressed }) => [styles.mixerButton, { borderColor: channelsOpen ? tokens.accent : tokens.border, backgroundColor: channelsOpen || pressed ? tokens.accentGlow : 'transparent', transform: [{ scale: pressed && !reducedMotion ? 0.92 : 1 }] }]} accessibilityRole="button" accessibilityLabel={channelsOpen ? 'Hide mixer' : 'Open mixer'} accessibilityState={{ expanded: channelsOpen }}><MixerIcon color={tokens.accent} /></Pressable></View></View>
  return <BottomSheet visible={visible} title="Sound & mute" onClose={close} pinnedContent={masterControl}>
    {previewError ? <GentleNotice title="Preview stayed quiet" message={previewError} tone="attention" /> : null}
    {channelsOpen ? <Animated.View entering={reducedMotion ? undefined : FadeIn.duration(140)} exiting={reducedMotion ? undefined : FadeOut.duration(100)} style={styles.channels}><View style={[styles.divider, { backgroundColor: tokens.border }]} />{channels.map(channel)}</Animated.View> : null}
    <SheetSectionTitle>Mute for</SheetSectionTitle>
    <View style={styles.muteRow}>{[1, 2, 3].map(count => <Chip key={count} label={`${count}×`} active={mute.iteration?.iterations === count} onPress={() => onMuteIterations(count)} />)}<Chip label="Minutes…" active={mute.mutedUntil > Date.now()} onPress={onCustom} /></View>
    {muted ? <SheetTextButton label="Clear mute" onPress={onClearMute} /> : null}
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
  return <BottomSheet visible={visible} title="Snap to clock" onClose={close} scroll={false}>
    <View style={styles.snapStatus}><Text style={[styles.sheetHelp, { color: tokens.textMuted }]}>{applying ? `Aligning to :${String(selected ?? 0).padStart(2, '0')}…` : current === null ? 'No clock phase is selected. Choose where each repeating cycle lands on the clock.' : 'Choose where each repeating cycle lands on the clock.'}</Text>{applying ? <ActivityIndicator size="small" color={tokens.accent} /> : null}</View>
    {error ? <GentleNotice title="Alignment stayed unchanged" message="The timer is still running on its previous rhythm. You can try again." tone="attention" /> : null}
    <ClockSnapSelector cycleDurationSeconds={cycleDurationSeconds} value={selected} onChange={offset => void select(offset)} disabled={applying} />
  </BottomSheet>
}

function ConfigurationPickerSheet({ visible, configurations, activeId, selectingId, onSelect, onClose }: { visible: boolean; configurations: ProgramPreset[]; activeId?: string; selectingId: string | null; onSelect: (id: string) => Promise<void>; onClose: () => void }) {
  const { tokens } = useTheme()
  return <BottomSheet visible={visible} title="Switch configuration" help="Switching begins this saved timer from now. Only configurations marked Show while running appear here." onClose={onClose}>
    {configurations.map(preset => <Pressable key={preset.id} disabled={Boolean(selectingId)} onPress={() => void onSelect(preset.id)} style={[styles.configurationRow, { borderColor: preset.id === activeId ? tokens.accent : tokens.border, backgroundColor: preset.id === activeId ? tokens.accentGlow : 'transparent', opacity: selectingId && selectingId !== preset.id ? 0.45 : 1 }]} accessibilityRole="button" accessibilityState={{ selected: preset.id === activeId, busy: selectingId === preset.id }} accessibilityLabel={`Switch to ${preset.name}`}><View style={styles.configurationCopy}><Text numberOfLines={1} style={[styles.channelTitle, { color: tokens.text }]}>{preset.name}</Text><Text numberOfLines={2} style={[styles.channelSound, { color: tokens.textMuted }]}>{runningConfigurationDescription(preset)}</Text></View>{selectingId === preset.id ? <ActivityIndicator size="small" color={tokens.accent} /> : preset.id === activeId ? <Text style={[styles.configurationCurrent, { color: tokens.accent }]}>CURRENT</Text> : null}</Pressable>)}
  </BottomSheet>
}

function runningConfigurationDescription(preset: ProgramPreset): string {
  const base = preset.program.mode === 'pattern'
    ? `Cycle · ${formatCompactDurationSeconds(patternDurationSeconds(preset.program))}`
    : `Sequence · ${preset.program.steps.length} ${preset.program.steps.length === 1 ? 'step' : 'steps'}`
  if (!preset.settings) return `${base} · keeps current settings`
  if (!preset.settings?.availability.enabled) return `${base} · schedule off`
  const active = preset.settings.availability.weeklyWindows.filter(window => window.enabled && window.days !== 0 && window.behavior !== 'mute').length
  const quiet = preset.settings.availability.weeklyWindows.filter(window => window.enabled && window.days !== 0 && window.behavior === 'mute').length
  return `${base} · ${active} active ${active === 1 ? 'range' : 'ranges'}${quiet ? ` · ${quiet} quiet` : ''}`
}

const styles = StyleSheet.create({
  screen: { flex: 1 }, content: { flexGrow: 1, alignItems: 'center', paddingHorizontal: 20, paddingTop: 28 }, revealSurface: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, zIndex: 90 }, revealHint: { position: 'absolute', zIndex: 91, bottom: 28, alignSelf: 'center', fontSize: 11, letterSpacing: 0.7 },
  topline: { width: '100%', maxWidth: 480, minHeight: 40, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }, configurationTitle: { flex: 1, minWidth: 0, minHeight: 40, justifyContent: 'center' }, configurationNameRow: { alignSelf: 'flex-start', maxWidth: '100%', flexDirection: 'row', alignItems: 'center', gap: 5 }, configurationChevron: { flexShrink: 0, width: 18, textAlign: 'center', fontSize: 22, lineHeight: 24, fontWeight: '300' }, mode: { fontSize: 10, letterSpacing: 1.25, fontWeight: '800' }, stepTitle: { flexShrink: 1, fontSize: 17, fontWeight: '700' }, configurationStep: { fontSize: 11, fontWeight: '600' }, topRight: { flexDirection: 'row', alignItems: 'center', gap: 10 }, syncing: { flexDirection: 'row', alignItems: 'center', gap: 6 }, focusStatus: { fontSize: 9, letterSpacing: 1.1, fontWeight: '800' }, helpButton: { width: 40, height: 40, borderWidth: 1.5, borderRadius: 20, alignItems: 'center', justifyContent: 'center' }, helpGlyph: { fontSize: 16, fontWeight: '800' },
  visualStage: { flex: 1, width: '100%', alignItems: 'center', justifyContent: 'center', paddingVertical: 14 }, timerStack: { width: '100%', alignItems: 'center' }, ringWrap: { alignItems: 'center', justifyContent: 'center' }, svg: { position: 'absolute' }, flash: { position: 'absolute' }, center: { alignItems: 'center', gap: 5, maxWidth: '69%' }, mainTime: { width: '100%', textAlign: 'center', fontFamily: 'JetBrainsMono-Light', fontSize: 55, fontVariant: ['tabular-nums'] }, mainCaption: { fontSize: 10, letterSpacing: 1.05, textTransform: 'uppercase' }, nextCue: { marginTop: 11, alignItems: 'center', gap: 2, maxWidth: '100%' }, nextCueName: { fontSize: 13, fontWeight: '700' }, nextCueTime: { fontFamily: 'JetBrainsMono-Regular', fontSize: 12 }, nextLabel: { fontSize: 8, letterSpacing: 1.1, fontWeight: '800' }, slash: { position: 'absolute', height: 4, borderRadius: 3, transform: [{ rotate: '-45deg' }] }, statusSlot: { position: 'absolute', left: 0, right: 0, minHeight: 74, alignItems: 'center', gap: 6 }, runProgressBlock: { alignItems: 'center', gap: 4 }, muteStatus: { maxWidth: 330, fontSize: 12, lineHeight: 17, textAlign: 'center' }, nextAudibleStatus: { maxWidth: 330, fontSize: 10, lineHeight: 15, textAlign: 'center' }, runStatus: { fontSize: 13, lineHeight: 18, textAlign: 'center', fontVariant: ['tabular-nums'] }, focusBorder: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, borderWidth: 3, zIndex: 100 },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 20, alignItems: 'center' }, bottomFade: { position: 'absolute', top: -34, left: 0, right: 0, height: 34 }, controls: { width: '100%', maxWidth: 480, flexDirection: 'row', gap: 8, marginBottom: 10 }, spacer: { flex: 1 }, iconButton: { width: 40, height: 40, borderWidth: 1.5, borderRadius: 20, alignItems: 'center', justifyContent: 'center' }, badge: { position: 'absolute', right: -2, top: -3, minWidth: 14, height: 14, borderRadius: 7, paddingHorizontal: 3, alignItems: 'center', justifyContent: 'center' }, badgeText: { color: '#fff', fontSize: 8, fontWeight: '900' }, stop: { width: '100%', maxWidth: 480, borderWidth: 1.5, paddingVertical: 16, borderRadius: 99, alignItems: 'center' }, stopText: { fontSize: 14, textTransform: 'uppercase', letterSpacing: 1.1, fontWeight: '800' },
  channel: { minHeight: 78, gap: 3, paddingVertical: 5 }, masterBlock: { gap: 3 }, masterSlider: { flex: 1, height: 38 }, channelLabel: { gap: 2 }, channelControl: { minHeight: 40, flexDirection: 'row', alignItems: 'center', gap: 8 }, channelTitle: { fontSize: 13, fontWeight: '700' }, channelSound: { fontSize: 10 }, channelSlider: { flex: 1, height: 38 }, divider: { height: 1 }, sheetHelp: { flex: 1, fontSize: 12, lineHeight: 18 }, snapStatus: { minHeight: 24, flexDirection: 'row', alignItems: 'center', gap: 10 }, muteRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  channels: { gap: 2 },
  previewMini: { width: 30, height: 30, borderWidth: 1, borderRadius: 15, alignItems: 'center', justifyContent: 'center' }, previewGlyph: { fontSize: 9 },
  mixerButton: { width: 36, height: 36, borderWidth: 1, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  configurationRow: { minHeight: 61, borderWidth: 1.5, borderRadius: 13, paddingHorizontal: 13, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 10 }, configurationCopy: { flex: 1, minWidth: 0, gap: 3 }, configurationCurrent: { fontSize: 9, letterSpacing: 1, fontWeight: '800' },
  tooltip: { position: 'absolute', bottom: 126, alignSelf: 'center', maxWidth: '82%', paddingVertical: 10, paddingHorizontal: 14, borderRadius: 12, borderWidth: 1.5 }, tooltipText: { fontSize: 12, lineHeight: 17, textAlign: 'center' },
})
