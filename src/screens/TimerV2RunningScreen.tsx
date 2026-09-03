import { Fragment, type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { Animated, AppState, Modal, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native'
import Slider from '@react-native-community/slider'
import Svg, { Circle } from 'react-native-svg'
import * as Haptics from 'expo-haptics'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type { AlarmBehavior, CueSettings, PatternProgram, TimerProgram } from '../types'
import type { TimelinePosition } from '../lib/timeline'
import { AlarmIcon, BellIcon, ClockIcon, FocusIcon, RestartIcon } from '../components/Icons'
import { Chip } from '../components/Chip'
import { CustomMinutePicker } from '../components/CustomMinutePicker'
import { BottomSheet } from '../components/timer-v2/BottomSheet'
import { TimerHelpSheet } from '../components/timer-v2/TimerHelpSheet'
import { SoundName } from '../components/timer-v2/SoundName'
import type { RuntimeMuteState } from '../lib/runtimeV2'
import { soundTitle } from '../lib/soundLibrary'
import { useTheme } from '../theme/ThemeContext'
import { ChandasTimerService } from '../native/ChandasTimerService'

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
  mute: RuntimeMuteState
  alarmBehavior: AlarmBehavior
  onStop: () => void
  onRestartUnsynced: () => void
  onSnapToClock: (offsetMinutes: number) => void
  onPressAlarm: () => void
  onMuteForIterations: (count: number) => void
  onMuteForMinutes: (minutes: number) => void
  onClearMute: () => void
  masterVolume: number
  onMasterVolumeChange: (value: number) => void
  onCueVolumeChange: (cueId: string, volume: number) => void
  focusEnabled: boolean
  focusActive: boolean
  focusPolicyAccess: boolean
  focusReason: string
  onToggleFocus: () => void
  onOpenFocusSettings: () => void
}

export function TimerV2RunningScreen(props: Props) {
  const { tokens } = useTheme()
  const insets = useSafeAreaInsets()
  const { width } = useWindowDimensions()
  const [mixerOpen, setMixerOpen] = useState(false)
  const [customMute, setCustomMute] = useState(false)
  const [snapOpen, setSnapOpen] = useState(false)
  const [customSnap, setCustomSnap] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [tooltip, setTooltip] = useState<string | null>(null)
  const tooltipTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const helpLongPressed = useRef(false)
  const size = Math.min(width * 0.79, 342)
  const muted = props.masterVolume <= 0 || props.mute.mutedUntil > Date.now() || Boolean(props.mute.iteration)
  const resumeDate = new Date(props.activeHoursResumeAt)
  const mainLabel = props.activeHoursPaused ? `${String(resumeDate.getHours()).padStart(2, '0')}:${String(resumeDate.getMinutes()).padStart(2, '0')}` : props.mainCountdown
  const sequenceIndex = props.program.mode === 'sequence' ? props.position?.currentStepIndex ?? 0 : 0
  const currentStep = props.program.mode === 'sequence' ? props.program.steps[sequenceIndex] : null
  const nextStep = props.program.mode === 'sequence' ? props.program.steps[(sequenceIndex + 1) % props.program.steps.length] : null

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
    void Haptics.selectionAsync().catch(() => undefined)
  }

  const focusPaused = props.focusReason === 'paused-by-android'
  return <View onTouchStart={() => { if (tooltip) dismissTooltip() }} style={[styles.screen, { backgroundColor: tokens.bg, paddingTop: insets.top }]}>
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 140 }]}>
      <View style={styles.topline}>
        <View><Text style={[styles.mode, { color: tokens.textMuted }]}>{props.program.mode === 'pattern' ? 'MAIN + SUB-BELLS' : 'SEQUENCE / SETS'}</Text>{props.program.mode === 'sequence' && currentStep ? <Text numberOfLines={1} style={[styles.stepTitle, { color: tokens.text }]}>{currentStep.label}</Text> : null}</View>
        <View style={styles.topRight}>{props.focusActive || focusPaused ? <Text style={[styles.focusStatus, { color: tokens.accent }]}>{focusPaused ? 'FOCUS PAUSED' : 'FOCUS ON'}</Text> : null}<Pressable hitSlop={7} onPressIn={() => { helpLongPressed.current = false }} onLongPress={() => { helpLongPressed.current = true; showTooltip('Open Timer help') }} onPressOut={() => setTimeout(() => { helpLongPressed.current = false }, 0)} onPress={() => { if (!helpLongPressed.current) setHelpOpen(true) }} style={[styles.helpButton, { borderColor: tokens.border }]} accessibilityLabel="Timer help"><Text style={[styles.helpGlyph, { color: tokens.accent }]}>?</Text></Pressable></View>
      </View>

      <Pressable onPress={muted ? props.onClearMute : undefined} style={[styles.ringWrap, { width: size, height: size }]} accessibilityRole={muted ? 'button' : undefined} accessibilityLabel={muted ? 'Clear timer mute' : undefined}>
        <TimerRings size={size} progress={props.progress} position={props.position} program={props.program} muted={muted} eventPulse={props.eventPulse} />
        <View pointerEvents="none" style={styles.center}>
          <Text style={[styles.mainTime, { color: tokens.text }]} adjustsFontSizeToFit numberOfLines={1}>{mainLabel}</Text>
          <Text style={[styles.mainCaption, { color: tokens.textMuted }]}>{props.activeHoursPaused ? 'Resumes' : props.program.mode === 'pattern' ? 'until main gong' : `step ${sequenceIndex + 1} of ${props.program.steps.length}`}</Text>
          {!props.activeHoursPaused && props.program.mode === 'pattern' && props.position?.nextEvent.boundary !== 'pattern-main' ? <View style={styles.nextCue}><Text numberOfLines={1} style={[styles.nextCueName, { color: tokens.accent }]}>{props.nextCueLabel}</Text><Text style={[styles.nextCueTime, { color: tokens.textMuted }]}>{props.nextCueCountdown}</Text></View> : null}
          {!props.activeHoursPaused && props.program.mode === 'sequence' && nextStep ? <View style={styles.nextCue}><Text style={[styles.nextLabel, { color: tokens.textMuted }]}>NEXT</Text><Text numberOfLines={1} style={[styles.nextCueName, { color: tokens.accent }]}>{nextStep.label} · {nextStep.durationMinutes}m</Text></View> : null}
        </View>
        {muted ? <View pointerEvents="none" style={[styles.slash, { width: size * 0.72, backgroundColor: tokens.accent }]} /> : null}
      </Pressable>
      {props.mute.iteration ? <Text style={[styles.muteStatus, { color: tokens.textMuted }]}>Muted until the final selected {props.program.mode === 'pattern' ? 'main gong' : 'cycle boundary'} · tap the rings to clear</Text> : props.mute.mutedUntil > Date.now() ? <Text style={[styles.muteStatus, { color: tokens.textMuted }]}>Muted until {new Date(props.mute.mutedUntil).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · tap the rings to clear</Text> : null}
    </ScrollView>

    <View style={[styles.bottom, { backgroundColor: tokens.bg, paddingBottom: insets.bottom + 17 }]}>
      <View style={styles.controls}>
        <ControlButton label="Restart from now" tooltip="Restart now and use elapsed timing" onPress={props.onRestartUnsynced} onTooltip={showTooltip}><RestartIcon color={tokens.accent} /></ControlButton>
        {props.program.mode === 'pattern' ? <ControlButton label="Align to clock" tooltip={props.program.alignment.kind === 'local-clock' ? `Clock aligned at :${String(props.program.alignment.offsetMinutes).padStart(2, '0')}` : 'Align the pattern to local clock time'} active={props.program.alignment.kind === 'local-clock'} onPress={() => setSnapOpen(true)} onTooltip={showTooltip}><ClockIcon color={tokens.accent} /></ControlButton> : null}
        {props.program.mode === 'pattern' ? <ControlButton label={props.alarmBehavior === 'locked' ? 'Alarm locked' : props.alarmBehavior === 'once' ? 'Next main gong alarm' : 'Alarm off'} tooltip="Tap once for the next main gong; tap twice quickly to lock it for every main gong" active={props.alarmBehavior !== 'off'} badge={props.alarmBehavior === 'locked' ? '∞' : props.alarmBehavior === 'once' ? '1' : undefined} onPress={props.onPressAlarm} onTooltip={showTooltip}><AlarmIcon color={props.alarmBehavior !== 'off' ? tokens.accent : tokens.textMuted} /></ControlButton> : null}
        <ControlButton label="Chandas Focus" tooltip={!props.focusPolicyAccess ? 'Focus needs Android Do Not Disturb access' : focusPaused ? 'Chandas Focus was paused in Android settings' : props.focusEnabled ? 'Turn off Chandas Focus automation' : 'Let Chandas manage its own DND rule'} active={props.focusEnabled} badge={props.focusEnabled && (!props.focusPolicyAccess || focusPaused) ? '!' : undefined} onPress={props.onToggleFocus} onTooltip={showTooltip}><FocusIcon color={props.focusEnabled ? tokens.accent : tokens.textMuted} /></ControlButton>
        <View style={styles.spacer} />
        <ControlButton label="Mixer and mute" tooltip="Open cue levels and mute controls" active={mixerOpen || muted} onPress={() => setMixerOpen(true)} onTooltip={showTooltip}><BellIcon muted={muted} color={mixerOpen || muted ? tokens.accent : tokens.textMuted} /></ControlButton>
      </View>
      <Pressable onPress={props.onStop} style={[styles.stop, { borderColor: tokens.border, backgroundColor: tokens.surfaceHi }]} accessibilityRole="button"><Text style={[styles.stopText, { color: tokens.textMuted }]}>Stop</Text></Pressable>
    </View>

    <RunningMixerSheet visible={mixerOpen} onClose={() => setMixerOpen(false)} program={props.program} masterVolume={props.masterVolume} onMasterVolumeChange={props.onMasterVolumeChange} onCueVolumeChange={props.onCueVolumeChange} mute={props.mute} onMuteIterations={props.onMuteForIterations} onClearMute={props.onClearMute} onCustom={() => { setMixerOpen(false); setCustomMute(true) }} />
    <SnapSheet visible={snapOpen} current={props.program.mode === 'pattern' && props.program.alignment.kind === 'local-clock' ? props.program.alignment.offsetMinutes : null} onSelect={offset => { props.onSnapToClock(offset); setSnapOpen(false) }} onCustom={() => { setSnapOpen(false); setCustomSnap(true) }} onClose={() => setSnapOpen(false)} />
    {customMute ? <CustomMinutePicker title="Mute duration" initial={15} min={1} max={1440} onConfirm={minutes => { props.onMuteForMinutes(minutes); setCustomMute(false) }} onClose={() => setCustomMute(false)} /> : null}
    {customSnap ? <CustomMinutePicker title="Clock offset" initial={0} min={0} max={59} onConfirm={offset => { props.onSnapToClock(offset); setCustomSnap(false) }} onClose={() => setCustomSnap(false)} /> : null}
    <TimerHelpSheet visible={helpOpen} onClose={() => setHelpOpen(false)} onOpenFocusSettings={props.onOpenFocusSettings} />
    {tooltip ? <View pointerEvents="none" style={[styles.tooltip, { backgroundColor: tokens.surfaceHi, borderColor: tokens.border }]}><Text style={[styles.tooltipText, { color: tokens.text }]}>{tooltip}</Text></View> : null}
  </View>
}

function TimerRings({ size, progress, position, program, muted, eventPulse }: { size: number; progress: number; position: TimelinePosition | null; program: TimerProgram; muted: boolean; eventPulse: number }) {
  const { tokens } = useTheme()
  const flash = useRef(new Animated.Value(0)).current
  const lastPulse = useRef(eventPulse)
  useEffect(() => {
    if (eventPulse <= 0 || eventPulse === lastPulse.current) return
    lastPulse.current = eventPulse
    flash.setValue(0.7)
    Animated.timing(flash, { toValue: 0, duration: 650, useNativeDriver: true }).start()
  }, [eventPulse, flash])
  const ringProgress = useMemo(() => {
    if (program.mode === 'sequence') return [position?.stepProgress ?? progress]
    const elapsedMinutes = Math.max(0, Math.min(program.mainMinutes, progress * program.mainMinutes))
    return [progress, ...program.tracks.filter(track => track.enabled && track.selectedOffsetsMinutes.length > 0).map(track => trackProgress(track.selectedOffsetsMinutes, program.mainMinutes, elapsedMinutes))]
  }, [position?.stepProgress, program, progress])
  const center = 100
  return <View style={StyleSheet.absoluteFill}>
    <Animated.View pointerEvents="none" style={[styles.flash, { width: size, height: size, borderRadius: size / 2, backgroundColor: tokens.accent, opacity: flash }]} />
    <Svg width={size} height={size} viewBox="0 0 200 200" style={styles.svg}>
      {ringProgress.map((value, index) => {
        const radius = 83 - index * 10.5
        const circumference = Math.PI * 2 * radius
        const width = index === 0 ? 3 : 2
        return <Fragment key={index}><Circle cx={center} cy={center} r={radius} fill="none" stroke={index === 0 ? tokens.surfaceHi : tokens.border} strokeWidth={width} /><Circle cx={center} cy={center} r={radius} fill="none" stroke={tokens.accent} strokeWidth={width} strokeLinecap="round" strokeDasharray={`${circumference}, ${circumference}`} strokeDashoffset={circumference * (1 - value)} transform="rotate(-90 100 100)" opacity={muted ? 0.3 : Math.max(0.35, 1 - index * 0.12)} /></Fragment>
      })}
    </Svg>
  </View>
}

function trackProgress(offsets: number[], mainMinutes: number, elapsed: number): number {
  const selected = [...offsets].sort((left, right) => left - right)
  const next = selected.find(offset => offset > elapsed) ?? selected[0] + mainMinutes
  const previous = [...selected].reverse().find(offset => offset <= elapsed) ?? selected[selected.length - 1] - mainMinutes
  return Math.max(0, Math.min(1, (elapsed - previous) / (next - previous)))
}

function ControlButton({ children, label, tooltip, active = false, badge, onPress, onTooltip }: { children: ReactNode; label: string; tooltip: string; active?: boolean; badge?: string; onPress: () => void; onTooltip: (message: string) => void }) {
  const { tokens } = useTheme()
  const longPressed = useRef(false)
  return <Pressable onPressIn={() => { longPressed.current = false }} onLongPress={() => { longPressed.current = true; onTooltip(tooltip) }} delayLongPress={450} onPressOut={() => setTimeout(() => { longPressed.current = false }, 0)} onPress={() => { if (!longPressed.current) onPress() }} accessibilityRole="button" accessibilityLabel={label} accessibilityHint={tooltip} style={({ pressed }) => [styles.iconButton, { borderColor: active ? tokens.accent : tokens.border, backgroundColor: active ? tokens.accentGlow : 'transparent', opacity: pressed ? 0.72 : 1 }]}>{children}{badge ? <View style={[styles.badge, { backgroundColor: tokens.accent }]}><Text style={styles.badgeText}>{badge}</Text></View> : null}</Pressable>
}

function RunningMixerSheet({ visible, onClose, program, masterVolume, onMasterVolumeChange, onCueVolumeChange, mute, onMuteIterations, onClearMute, onCustom }: { visible: boolean; onClose: () => void; program: TimerProgram; masterVolume: number; onMasterVolumeChange: (value: number) => void; onCueVolumeChange: (cueId: string, value: number) => void; mute: RuntimeMuteState; onMuteIterations: (count: number) => void; onClearMute: () => void; onCustom: () => void }) {
  const { tokens } = useTheme()
  const muted = Boolean(mute.iteration) || mute.mutedUntil > Date.now()
  const channels: { id: string; title: string; cue: CueSettings }[] = program.mode === 'pattern' ? [{ id: 'main', title: 'Main gong', cue: program.mainCue }, ...program.tracks.map(track => ({ id: track.id, title: `${track.cadenceMinutes}m · ${soundTitle(track.sound)}`, cue: track }))] : program.steps.map((step, index) => ({ id: step.id, title: `${index + 1}. ${step.label}`, cue: step }))
  const channel = ({ id, title, cue }: typeof channels[number]) => <View key={id} style={styles.channel}><View style={styles.channelLabel}><Text numberOfLines={1} style={[styles.channelTitle, { color: tokens.text }]}>{title}</Text><SoundName sound={cue.sound} style={styles.channelSound} /></View><Pressable hitSlop={7} onPress={() => void ChandasTimerService.previewSound(cue.sound, masterVolume * cue.volume)} style={[styles.previewMini, { borderColor: tokens.border }]} accessibilityLabel={`Preview ${title}`}><Text style={[styles.previewGlyph, { color: tokens.accent }]}>▶</Text></Pressable><Slider style={styles.channelSlider} minimumValue={0} maximumValue={1} step={0.05} value={cue.volume} onValueChange={value => onCueVolumeChange(id, value)} minimumTrackTintColor={tokens.accent} maximumTrackTintColor={tokens.surfaceHi} thumbTintColor={tokens.accent} accessibilityLabel={`${title} volume`} accessibilityValue={{ min: 0, max: 100, now: Math.round(cue.volume * 100), text: `${Math.round(cue.volume * 100)} percent` }} /><Text style={[styles.channelValue, { color: tokens.text }]}>{Math.round(cue.volume * 100)}</Text></View>
  const close = () => { ChandasTimerService.stopSoundPreview(); onClose() }
  return <BottomSheet visible={visible} eyebrow="ALARM STREAM" title="Mixer & mute" onClose={close}>
    <Text style={[styles.sheetHelp, { color: tokens.textMuted }]}>Levels stay intact when muted. Final output also follows your phone’s Alarm volume.</Text>
    <View style={styles.channel}><View style={styles.channelLabel}><Text style={[styles.channelTitle, { color: tokens.text }]}>Master</Text><Text style={[styles.channelSound, { color: tokens.textMuted }]}>All timer sounds</Text></View><Slider style={styles.channelSlider} minimumValue={0} maximumValue={1} step={0.05} value={masterVolume} onValueChange={onMasterVolumeChange} minimumTrackTintColor={tokens.accent} maximumTrackTintColor={tokens.surfaceHi} thumbTintColor={tokens.accent} accessibilityLabel="Master volume" accessibilityValue={{ min: 0, max: 100, now: Math.round(masterVolume * 100), text: `${Math.round(masterVolume * 100)} percent` }} /><Text style={[styles.channelValue, { color: tokens.text }]}>{Math.round(masterVolume * 100)}</Text></View>
    <View style={[styles.divider, { backgroundColor: tokens.border }]} />
    {channels.map(channel)}
    <Text style={[styles.mode, { color: tokens.textMuted }]}>MUTE FOR</Text>
    <Text style={[styles.sheetHelp, { color: tokens.textMuted }]}>Cycle mute keeps the last selected main or cycle boundary audible.</Text>
    <View style={styles.muteRow}>{[1, 2, 3].map(count => <Chip key={count} label={`${count}×`} active={mute.iteration?.iterations === count} onPress={() => onMuteIterations(count)} />)}<Chip label="Minutes…" active={mute.mutedUntil > Date.now()} onPress={onCustom} /></View>
    {muted ? <Pressable onPress={onClearMute} style={[styles.clearMute, { borderColor: tokens.accent }]}><Text style={[styles.clearText, { color: tokens.accent }]}>Clear mute</Text></Pressable> : null}
  </BottomSheet>
}

function SnapSheet({ visible, current, onSelect, onCustom, onClose }: { visible: boolean; current: number | null; onSelect: (offset: number) => void; onCustom: () => void; onClose: () => void }) {
  const { tokens } = useTheme()
  return <BottomSheet visible={visible} eyebrow="LOCAL CLOCK" title="Align pattern" onClose={onClose} scroll={false}>
    <Text style={[styles.sheetHelp, { color: tokens.textMuted }]}>Choose the minute offset that anchors each repeating main interval. Timezone and daylight-saving changes keep this local rhythm.</Text>
    <View style={styles.muteRow}>{[0, 10, 15].map(offset => <Chip key={offset} label={`:${String(offset).padStart(2, '0')}`} active={current === offset} onPress={() => onSelect(offset)} />)}<Chip label={current !== null && ![0, 10, 15].includes(current) ? `:${String(current).padStart(2, '0')}` : 'Custom'} active={current !== null && ![0, 10, 15].includes(current)} onPress={onCustom} /></View>
  </BottomSheet>
}

const styles = StyleSheet.create({
  screen: { flex: 1 }, content: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20, gap: 18 },
  topline: { width: '100%', maxWidth: 480, minHeight: 42, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }, mode: { fontSize: 10, letterSpacing: 1.25, fontWeight: '800' }, stepTitle: { maxWidth: 240, marginTop: 3, fontSize: 17, fontWeight: '700' }, topRight: { flexDirection: 'row', alignItems: 'center', gap: 10 }, focusStatus: { fontSize: 9, letterSpacing: 1.1, fontWeight: '800' }, helpButton: { width: 30, height: 30, borderWidth: 1.5, borderRadius: 15, alignItems: 'center', justifyContent: 'center' }, helpGlyph: { fontSize: 14, fontWeight: '800' },
  ringWrap: { alignItems: 'center', justifyContent: 'center' }, svg: { position: 'absolute' }, flash: { position: 'absolute' }, center: { alignItems: 'center', gap: 5, maxWidth: '69%' }, mainTime: { width: '100%', textAlign: 'center', fontFamily: 'JetBrainsMono-Light', fontSize: 55, fontVariant: ['tabular-nums'] }, mainCaption: { fontSize: 10, letterSpacing: 1.05, textTransform: 'uppercase' }, nextCue: { marginTop: 11, alignItems: 'center', gap: 2, maxWidth: '100%' }, nextCueName: { fontSize: 13, fontWeight: '700' }, nextCueTime: { fontFamily: 'JetBrainsMono-Regular', fontSize: 12 }, nextLabel: { fontSize: 8, letterSpacing: 1.1, fontWeight: '800' }, slash: { position: 'absolute', height: 4, borderRadius: 3, transform: [{ rotate: '-45deg' }] }, muteStatus: { maxWidth: 330, fontSize: 11, lineHeight: 16, textAlign: 'center' },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 20, alignItems: 'center' }, controls: { width: '100%', maxWidth: 480, flexDirection: 'row', gap: 8, marginBottom: 10 }, spacer: { flex: 1 }, iconButton: { width: 40, height: 40, borderWidth: 1.5, borderRadius: 20, alignItems: 'center', justifyContent: 'center' }, badge: { position: 'absolute', right: -2, top: -3, minWidth: 14, height: 14, borderRadius: 7, paddingHorizontal: 3, alignItems: 'center', justifyContent: 'center' }, badgeText: { color: '#fff', fontSize: 8, fontWeight: '900' }, stop: { width: '100%', maxWidth: 480, borderWidth: 1.5, paddingVertical: 16, borderRadius: 99, alignItems: 'center' }, stopText: { fontSize: 14, textTransform: 'uppercase', letterSpacing: 1.1, fontWeight: '800' },
  channel: { minHeight: 50, flexDirection: 'row', alignItems: 'center', gap: 8 }, channelLabel: { width: 114, gap: 2 }, channelTitle: { fontSize: 13, fontWeight: '700' }, channelSound: { fontSize: 10 }, channelSlider: { flex: 1, height: 34 }, channelValue: { width: 28, fontFamily: 'JetBrainsMono-Regular', fontSize: 10, textAlign: 'right' }, divider: { height: 1 }, sheetHelp: { fontSize: 12, lineHeight: 18 }, muteRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, clearMute: { alignSelf: 'flex-start', paddingHorizontal: 13, paddingVertical: 9, borderWidth: 1.5, borderRadius: 99 }, clearText: { fontSize: 12, fontWeight: '700' },
  previewMini: { width: 30, height: 30, borderWidth: 1, borderRadius: 15, alignItems: 'center', justifyContent: 'center' }, previewGlyph: { fontSize: 9 },
  tooltip: { position: 'absolute', bottom: 126, alignSelf: 'center', maxWidth: '82%', paddingVertical: 10, paddingHorizontal: 14, borderRadius: 12, borderWidth: 1.5 }, tooltipText: { fontSize: 12, lineHeight: 17, textAlign: 'center' },
})
