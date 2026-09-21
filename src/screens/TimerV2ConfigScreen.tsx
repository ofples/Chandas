import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import Slider from '@react-native-community/slider'
import Reanimated, { FadeIn, FadeInDown, FadeOut, LinearTransition, interpolate, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type { CueSettings, PatternTrack, SoundRef, TimerMode, TimerV2State } from '../types'
import type { NativeFocusState } from '../native/ChandasTimerService'
import { Toggle } from '../components/Toggle'
import { BottomSheet } from '../components/timer-v2/BottomSheet'
import { AddRowButton } from '../components/timer-v2/AddRowButton'
import { ClockSnapSelector } from '../components/timer-v2/ClockSnapSelector'
import { DurationSelector } from '../components/timer-v2/DurationSelector'
import { OffsetGrid } from '../components/timer-v2/OffsetGrid'
import { PresetLibrarySheet } from '../components/timer-v2/PresetLibrarySheet'
import { ReorderHandle } from '../components/timer-v2/ReorderHandle'
import { SoundPickerSheet } from '../components/timer-v2/SoundPickerSheet'
import { SoundName } from '../components/timer-v2/SoundName'
import { RunLengthConfig } from '../components/timer-v2/run-length-config'
import { ScheduleConfig } from '../components/timer-v2/schedule-config'
import { ScheduleTimelinePreview } from '../components/timer-v2/ScheduleTimelinePreview'
import { SegmentedControl } from '../components/timer-v2/SegmentedControl'
import { HapticsSheet } from '../components/timer-v2/haptics-sheet'
import {
  addPatternTrack, addSequenceStep, chooseProgramMode, duplicateSequenceStep, patchPatternTrack, patchSequenceStep,
  patchCompletionCue, removePatternTrack, removeSequenceStep, reorderSequenceSteps, setCompletionCueEnabled, setPatternSubBellsEnabled,
  setTrackCadence, setTrackCadenceSeconds, setTrackOffsetsSeconds, updatePattern, updatePatternMainDurationSeconds, updateSequence,
} from '../lib/programActions'
import { soundTitle } from '../lib/soundLibrary'
import { MAX_VISIBLE_PATTERN_OFFSETS, formatCompactDurationSeconds, patternDurationSeconds, sequenceStepDurationSeconds, trackCadenceSeconds, trackSelectedOffsetsSeconds, validOffsetsForCadenceSeconds } from '../lib/timerV2'
import { useTheme } from '../theme/ThemeContext'
import { useSoundAvailability } from '../hooks/use-sound-availability'
import { hapticFeedbackAvailable, mediumHaptic, selectionHaptic, setAppHapticsEnabled, tapHaptic } from '../lib/haptics'
import { ChandasTimerService, isNativeServiceAvailable } from '../native/ChandasTimerService'
import { GentleNotice, type AppNotice } from '../components/timer-v2/experience-feedback'
import { hasAvailableTime } from '../lib/activeHours'
import { EyeIcon, LightbulbIcon, MixerIcon } from '../components/Icons'
import { edgeAutoScrollStep, previewIndexForItem, previewOffsetForItem, type ReorderPreview } from '../lib/reorder-preview'
import { normalizeSubBellColor, subBellColorValue } from '../lib/subBellColors'
import { ColorSelector } from '../components/timer-v2/ColorSelector'
import { SheetTextButton } from '../components/timer-v2/SheetTextButton'
import { SwipeToDeleteRow } from '../components/timer-v2/swipe-to-delete-row'
import { advancedRevealState, shouldRevealAdvanced } from '../lib/advanced-reveal'
import { useKeyboardVisible } from '../hooks/use-keyboard-visible'
import { ScrollEdgeFade } from '../components/timer-v2/ScrollEdgeFade'
import { HelpToggleButton, InlineHelp, SetupHelpProvider } from '../components/timer-v2/inline-help'
import { useHasVisibleSheet } from '../components/timer-v2/feedback-layer'

const MAIN_PRESETS = [5, 10, 15, 30, 45, 60] as const
const STEP_PRESETS = [1, 2, 3, 5, 10, 15, 20, 25, 30, 45, 60] as const
const CADENCE_PRESETS = [1, 2, 3, 5, 10, 15, 20, 30] as const
const MODE_CHOICES = [{ value: 'pattern', label: 'Cycle' }, { value: 'sequence', label: 'Sequence' }] as const
const ADVANCED_PULL_DISTANCE = 112
const ADVANCED_REVEAL_THRESHOLD = 0.82

type CueTarget = { kind: 'main' } | { kind: 'alarm' } | { kind: 'track'; id: string } | { kind: 'step'; id: string } | { kind: 'completion'; mode: TimerMode }

interface Props {
  state: TimerV2State
  onChange: (state: TimerV2State) => void
  onStart: () => void
  starting: boolean
  focusState: NativeFocusState
  onFocusAutomationChange: (enabled: boolean) => void
  onOpenFocusSettings: () => void
  onOpenFocusRuleSettings: () => void
  androidAccess: { exactAlarms: boolean; fullScreenAlarms: boolean; callMute: boolean; notifications: boolean; checking: boolean; pending: 'call-mute' | 'notifications' | null }
  onOpenExactAlarmSettings: () => void
  onOpenFullScreenIntentSettings: () => void
  onRequestCallMuteAccess: () => void
  onRequestNotificationAccess: () => void
  onFeedback: (notice: Omit<AppNotice, 'id'>) => void
}

export function TimerV2ConfigScreen({ state, onChange, onStart, starting, focusState, onFocusAutomationChange, onOpenFocusSettings, onOpenFocusRuleSettings, androidAccess, onOpenExactAlarmSettings, onOpenFullScreenIntentSettings, onRequestCallMuteAccess, onRequestNotificationAccess, onFeedback }: Props) {
  const { tokens, theme, toggleTheme, accentColor, setAccentColor } = useTheme()
  const insets = useSafeAreaInsets()
  const [cueTarget, setCueTarget] = useState<CueTarget | null>(null)
  const [trackId, setTrackId] = useState<string | null>(null)
  const [subBellsOpen, setSubBellsOpen] = useState(false)
  const [presetsOpen, setPresetsOpen] = useState(false)
  const [mixerOpen, setMixerOpen] = useState(false)
  const [scheduleOpen, setScheduleOpen] = useState(false)
  const [systemAccessOpen, setSystemAccessOpen] = useState(false)
  const [hapticsOpen, setHapticsOpen] = useState(false)
  const [inlineHelpVisible, setInlineHelpVisible] = useState(false)
  const [sequenceReordering, setSequenceReordering] = useState(false)
  const scrollRef = useRef<ScrollView>(null)
  const scrollOffsetRef = useRef(0)
  const scrollContentHeightRef = useRef(0)
  const scrollViewportRef = useRef({ top: 0, height: 0 })
  const advancedPullProgressRef = useRef(0)
  const advancedPullThresholdRef = useRef(false)
  const advancedRevealArmedRef = useRef(true)
  const advancedCollapsePendingRef = useRef(false)
  const advancedRevealProgress = useSharedValue(0)
  const reducedMotion = useReducedMotion()
  const keyboardVisible = useKeyboardVisible()
  const hasVisibleSheet = useHasVisibleSheet()
  const program = state.workingPrograms[state.workingPrograms.selectedMode]
  const settings = state.settings
  const nativeCapabilities = ChandasTimerService.getCapabilities()
  const alarmSoundSupported = !isNativeServiceAvailable || nativeCapabilities?.supportsAlarmSound === true
  const hapticsSupported = hapticFeedbackAvailable() && (!isNativeServiceAvailable || nativeCapabilities?.supportsHapticProfiles === true)
  const secondPrecisionSupported = !isNativeServiceAvailable || nativeCapabilities?.supportsSecondPrecision === true
  const subBellSecondPrecisionSupported = !isNativeServiceAvailable || nativeCapabilities?.supportsSubBellSecondPrecision === true
  const programClockAlignmentSupported = !isNativeServiceAvailable || nativeCapabilities?.supportsProgramClockAlignment === true

  const changeSettings = (patch: Partial<typeof settings>) => onChange({ ...state, settings: { ...settings, ...patch } })
  const cue = cueTarget ? cueForTarget(state, cueTarget) : null
  const soundPickerVisible = cue !== null
  const cueTitle = cueTarget?.kind === 'main' ? 'Main gong' : cueTarget?.kind === 'alarm' ? 'Alarm sound' : cueTarget?.kind === 'track' ? 'Sub-bell sound' : cueTarget?.kind === 'step' ? 'Step sound' : cueTarget?.kind === 'completion' ? 'Final gong' : ''
  const patchCue = (patch: Partial<CueSettings>) => {
    if (!cueTarget) return
    if (cueTarget.kind === 'main') onChange(updatePattern(state, value => ({ ...value, mainCue: { ...value.mainCue, ...patch } })))
    else if (cueTarget.kind === 'alarm') {
      changeSettings({
        ...(patch.sound ? { alarmSound: patch.sound } : {}),
        ...(typeof patch.volume === 'number' ? { alarmVolume: patch.volume } : {}),
      })
    }
    else if (cueTarget.kind === 'track') onChange(patchPatternTrack(state, cueTarget.id, patch))
    else if (cueTarget.kind === 'step') onChange(patchSequenceStep(state, cueTarget.id, patch))
    else onChange(patchCompletionCue(state, cueTarget.mode, patch))
  }
  const addTrack = () => onChange(addPatternTrack(state))
  const addStep = () => onChange(addSequenceStep(state))
  const validToStart = program.runPolicy.kind !== 'continuous' || hasAvailableTime(settings.availability)
  const exactTimingNeedsSetup = Platform.OS === 'android' && !androidAccess.checking && !androidAccess.exactAlarms
  const advancedRevealStyle = useAnimatedStyle(() => ({
    opacity: interpolate(advancedRevealProgress.value, [0, 0.7, 1], [0.38, 0.72, 1], 'clamp'),
    transform: [
      { translateY: interpolate(advancedRevealProgress.value, [0, 1], [0, ADVANCED_PULL_DISTANCE * 0.68], 'clamp') },
      { scale: interpolate(advancedRevealProgress.value, [0, 1], [0.985, 1.025], 'clamp') },
    ],
  }))
  const advancedRevealIndicatorStyle = useAnimatedStyle(() => ({
    opacity: interpolate(advancedRevealProgress.value, [0, 0.55, 1], [0, 0.14, 0.55], 'clamp'),
    transform: [{ scaleX: interpolate(advancedRevealProgress.value, [0, 1], [0.15, 1], 'clamp') }],
  }))
  const resetAdvancedPull = (animated = true) => {
    advancedPullProgressRef.current = 0
    advancedPullThresholdRef.current = false
    advancedRevealProgress.value = animated ? withTiming(0, { duration: reducedMotion ? 60 : 150 }) : 0
  }
  const setAdvancedMode = (enabled: boolean) => {
    tapHaptic()
    resetAdvancedPull(false)
    advancedRevealArmedRef.current = false
    advancedCollapsePendingRef.current = !enabled
    changeSettings({ advancedModeEnabled: enabled })
  }
  const revealMetrics = (offsetY = scrollOffsetRef.current) => advancedRevealState({
    contentHeight: scrollContentHeightRef.current,
    viewportHeight: scrollViewportRef.current.height,
    offsetY,
    pullDistance: ADVANCED_PULL_DISTANCE,
  })
  const handleScroll = (offsetY: number) => {
    scrollOffsetRef.current = offsetY
    if (settings.advancedModeEnabled || !advancedRevealArmedRef.current) return
    const { progress } = revealMetrics(offsetY)
    advancedPullProgressRef.current = progress
    advancedRevealProgress.value = progress
    const reachedThreshold = shouldRevealAdvanced(progress, ADVANCED_REVEAL_THRESHOLD)
    if (reachedThreshold && !advancedPullThresholdRef.current) mediumHaptic()
    advancedPullThresholdRef.current = reachedThreshold
  }
  const finishAdvancedPull = () => {
    if (settings.advancedModeEnabled || !advancedRevealArmedRef.current) return
    if (advancedPullProgressRef.current <= 0) return
    const shouldReveal = shouldRevealAdvanced(advancedPullProgressRef.current, ADVANCED_REVEAL_THRESHOLD)
    if (shouldReveal) {
      advancedRevealArmedRef.current = false
      resetAdvancedPull(false)
      changeSettings({ advancedModeEnabled: true })
      return
    }
    const { restOffset } = revealMetrics()
    scrollOffsetRef.current = restOffset
    scrollRef.current?.scrollTo({ y: restOffset, animated: !reducedMotion })
    resetAdvancedPull()
  }
  const handleScrollContentSize = (height: number) => {
    scrollContentHeightRef.current = height
    if (!advancedCollapsePendingRef.current || settings.advancedModeEnabled) return
    advancedCollapsePendingRef.current = false
    const { restOffset } = revealMetrics()
    scrollOffsetRef.current = restOffset
    scrollRef.current?.scrollTo({ y: restOffset, animated: false })
    resetAdvancedPull(false)
    requestAnimationFrame(() => {
      advancedRevealArmedRef.current = true
    })
  }
  const selectMode = (mode: 'pattern' | 'sequence') => {
    if (state.workingPrograms.selectedMode === mode) return
    onChange(chooseProgramMode(state, mode))
  }
  const handleSequenceReordering = useCallback((active: boolean) => {
    setSequenceReordering(active)
  }, [])
  const autoScrollSequence = useCallback((pageY: number, canMoveEarlier: boolean, canMoveLater: boolean) => {
    const { top, height } = scrollViewportRef.current
    if (height <= 0) return 0
    const edgeSize = Math.min(64, Math.max(48, height * 0.12))
    const bottom = top + height - Math.min(76, height * 0.12)
    const delta = edgeAutoScrollStep(pageY, top, bottom, edgeSize, canMoveEarlier, canMoveLater)
    if (delta === 0) return 0
    const maximum = Math.max(0, scrollContentHeightRef.current - height)
    const next = Math.max(0, Math.min(maximum, scrollOffsetRef.current + delta))
    const applied = next - scrollOffsetRef.current
    if (applied !== 0) {
      scrollOffsetRef.current = next
      scrollRef.current?.scrollTo({ y: next, animated: false })
    }
    return applied
  }, [])

  return (
    <SetupHelpProvider visible={inlineHelpVisible} onChange={setInlineHelpVisible}>
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : Platform.OS === 'android' ? 'height' : undefined} style={[styles.screen, { backgroundColor: tokens.bg }]}>
      <ScrollView
        ref={scrollRef}
        scrollEnabled={!sequenceReordering}
        overScrollMode="never"
        onLayout={event => { scrollViewportRef.current = { top: event.nativeEvent.layout.y, height: event.nativeEvent.layout.height } }}
        onContentSizeChange={(_width, height) => handleScrollContentSize(height)}
        onScroll={event => handleScroll(event.nativeEvent.contentOffset.y)}
        onScrollBeginDrag={() => {
          if (!settings.advancedModeEnabled && !advancedCollapsePendingRef.current) advancedRevealArmedRef.current = true
        }}
        onScrollEndDrag={finishAdvancedPull}
        onMomentumScrollEnd={finishAdvancedPull}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="never"
        keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
        contentContainerStyle={[styles.content, { paddingTop: insets.top + (inlineHelpVisible ? 66 : 22), paddingBottom: (keyboardVisible ? 76 : insets.bottom + 116) + (settings.advancedModeEnabled ? 0 : ADVANCED_PULL_DISTANCE) }]}
      >
        <SegmentedControl items={MODE_CHOICES} value={state.workingPrograms.selectedMode} onChange={selectMode} accessibilityLabel="Timer mode" />

        <Reanimated.View key={program.mode} entering={FadeIn.duration(reducedMotion ? 80 : 180)} exiting={FadeOut.duration(reducedMotion ? 70 : 120)} style={styles.modeContent}>
          {program.mode === 'pattern' ? <PatternEditor state={state} onChange={onChange} enhancedClockAlignmentSupported={programClockAlignmentSupported} onOpenSubBells={() => setSubBellsOpen(true)} showHelp={inlineHelpVisible} onToggleHelp={() => setInlineHelpVisible(visible => !visible)} /> : <SequenceEditor state={state} onChange={onChange} clockAlignmentSupported={programClockAlignmentSupported} soundPickerVisible={soundPickerVisible && cueTarget?.kind === 'step'} onEditCue={setCueTarget} onAdd={addStep} showHelp={inlineHelpVisible} onToggleHelp={() => setInlineHelpVisible(visible => !visible)} onReorderingChange={handleSequenceReordering} onAutoScroll={autoScrollSequence} />}
        </Reanimated.View>

        <View style={styles.section}>
          <VolumeControl label="Volume" value={settings.masterVolume} onChange={masterVolume => changeSettings({ masterVolume })} onOpenMixer={() => setMixerOpen(true)} />
          <InlineHelp visible={inlineHelpVisible}>Sets the overall timer volume. Open the mixer to adjust and preview each sound separately.</InlineHelp>
          {program.mode === 'pattern' ? <CueRow title="Main gong" detail={soundTitle(program.mainCue.sound)} sound={program.mainCue.sound} onPress={() => setCueTarget({ kind: 'main' })} /> : null}
          {program.mode === 'pattern' ? <InlineHelp visible={inlineHelpVisible}>The main gong sounds when each main interval finishes.</InlineHelp> : null}
          <CompletionCueControls state={state} onChange={onChange} onEditCue={setCueTarget} onFeedback={onFeedback} />
        </View>

        {!settings.advancedModeEnabled ? <View style={styles.advancedReveal}>
          <Reanimated.View style={[styles.advancedRevealPrompt, advancedRevealStyle]}>
            <Pressable onPress={() => setAdvancedMode(true)} style={({ pressed }) => [styles.advancedRevealPressable, { opacity: pressed ? 0.72 : 1 }]} accessibilityRole="button" accessibilityLabel="Show advanced settings" accessibilityHint="Tap, or pull upward past the end of the page">
              <Text style={[styles.advancedRevealTitle, { color: tokens.text }]}>Show advanced</Text>
              <Reanimated.View pointerEvents="none" style={[styles.advancedRevealIndicator, { backgroundColor: tokens.text }, advancedRevealIndicatorStyle]} />
            </Pressable>
          </Reanimated.View>
        </View> : <View style={styles.advancedSection}>
          {program.mode === 'pattern' && alarmSoundSupported ? <CueRow title="Alarm sound" detail={soundTitle(settings.alarmSound)} sound={settings.alarmSound} onPress={() => setCueTarget({ kind: 'alarm' })} /> : null}
          {program.mode === 'pattern' && alarmSoundSupported ? <InlineHelp visible={inlineHelpVisible}>Choose what plays when you arm the alarm from the running timer.</InlineHelp> : null}

          {program.runPolicy.kind === 'continuous' ? <View style={styles.section}>
            <View style={styles.settingRow}><Pressable style={styles.flex} onPress={() => { tapHaptic(); setScheduleOpen(true) }} accessibilityRole="button" accessibilityLabel="Edit schedule"><Text style={[styles.rowTitle, { color: tokens.text }]}>Schedule</Text><Text numberOfLines={1} style={[styles.helper, { color: tokens.textMuted }]}>{settings.availability.enabled ? `${settings.availability.weeklyWindows.filter(window => window.enabled && window.days !== 0).length} active time ranges` : 'Limit bells to chosen active times.'}</Text></Pressable><Toggle value={settings.availability.enabled} onChange={enabled => changeSettings({ availability: { ...settings.availability, enabled } })} accessibilityLabel="Timer schedule" /></View>
            <InlineHelp visible={inlineHelpVisible}>Choose the days and times when a continuous timer is allowed to sound.</InlineHelp>
            {settings.availability.enabled ? <Reanimated.View entering={FadeInDown.duration(reducedMotion ? 80 : 160)} exiting={FadeOut.duration(reducedMotion ? 70 : 110)}><ScheduleTimelinePreview value={settings.availability} onPress={() => setScheduleOpen(true)} /></Reanimated.View> : null}
          </View> : null}

          <ActionRow title="Configurations" detail={state.workingPrograms.sourcePreset?.deleted ? 'Working copy · source removed' : state.workingPrograms.sourcePreset ? `Loaded from ${state.workingPrograms.sourcePreset.name}` : 'Working copy'} onPress={() => setPresetsOpen(true)} accessibilityLabel="Open saved configurations" />
          <InlineHelp visible={inlineHelpVisible}>Save the current setup for later, or load a saved setup as a new working copy.</InlineHelp>

          <ColorSelector label="Appearance" detail="Choose a calm color and canvas." value={accentColor} onChange={setAccentColor} accessibilityLabel="Primary interface color" trailing={<Pressable hitSlop={8} onPress={() => { tapHaptic(); toggleTheme() }} style={({ pressed }) => [styles.roundIcon, { borderColor: tokens.border, backgroundColor: pressed ? tokens.accentGlow : 'transparent', opacity: pressed ? 0.72 : 1 }]} accessibilityRole="button" accessibilityLabel={`Use ${theme === 'dark' ? 'light' : 'dark'} appearance`}><LightbulbIcon color={tokens.accent} /></Pressable>} />
          <InlineHelp visible={inlineHelpVisible}>Tap the color dot to reveal the palette. The lightbulb switches between light and dark appearance.</InlineHelp>

          {secondPrecisionSupported ? <View style={styles.settingRow}><View style={styles.flex}><Text style={[styles.rowTitle, { color: tokens.text }]}>Second precision</Text><Text numberOfLines={1} style={[styles.helper, { color: tokens.textMuted }]}>{settings.secondPrecisionEnabled ? 'Seconds are available in custom durations.' : 'Keep duration setup minute-first.'}</Text></View><Toggle value={settings.secondPrecisionEnabled} onChange={secondPrecisionEnabled => changeSettings({ secondPrecisionEnabled })} accessibilityLabel="Second precision" /></View> : null}
          {secondPrecisionSupported ? <InlineHelp visible={inlineHelpVisible}>Turn this on when an interval needs to be set more precisely than whole minutes.</InlineHelp> : null}

          {hapticsSupported ? <View style={styles.settingRow}><Pressable style={styles.flex} onPress={() => { tapHaptic(); setHapticsOpen(true) }} accessibilityRole="button" accessibilityLabel="Configure haptics"><Text style={[styles.rowTitle, { color: tokens.text }]}>Haptics</Text><Text numberOfLines={1} style={[styles.helper, { color: tokens.textMuted }]}>{settings.haptics.enabled ? 'Patterns for timer cues and alarm.' : 'Off · patterns preserved'}</Text></Pressable><Toggle value={settings.haptics.enabled} onChange={enabled => { setAppHapticsEnabled(enabled); changeSettings({ haptics: { ...settings.haptics, enabled } }) }} accessibilityLabel="Haptics" /></View> : null}
          {hapticsSupported ? <InlineHelp visible={inlineHelpVisible}>Choose how main gongs, sub-bells, and alarms feel, or turn vibration off completely.</InlineHelp> : null}

          {Platform.OS === 'android' ? <FocusControl state={focusState} enabled={settings.focusAutomationEnabled} onChange={onFocusAutomationChange} onResume={() => { onFocusAutomationChange(false); onFocusAutomationChange(true) }} onOpenAccessSettings={onOpenFocusSettings} onOpenRuleSettings={onOpenFocusRuleSettings} /> : null}
          {Platform.OS === 'android' ? <InlineHelp visible={inlineHelpVisible}>Chandas Focus can manage its own Do Not Disturb rule while the timer runs.</InlineHelp> : null}

          {Platform.OS === 'android' ? <ActionRow title="System integrations" detail={androidAccessSummary(androidAccess)} onPress={() => setSystemAccessOpen(true)} /> : null}
          {Platform.OS === 'android' ? <InlineHelp visible={inlineHelpVisible}>Manage Android access for precise timing, calls, alarms, and the running notification.</InlineHelp> : null}

          <Pressable onPress={() => setAdvancedMode(false)} style={styles.hideAdvanced} accessibilityRole="button" accessibilityLabel="Hide advanced settings"><Text style={[styles.link, { color: tokens.accent }]}>Hide advanced</Text></Pressable>
        </View>}
      </ScrollView>

      {inlineHelpVisible && !hasVisibleSheet ? <Reanimated.View entering={FadeInDown.duration(reducedMotion ? 70 : 150)} exiting={FadeOut.duration(reducedMotion ? 60 : 100)} style={[styles.pinnedHelp, { top: insets.top + 12 }]}><HelpToggleButton active onPress={() => setInlineHelpVisible(false)} /></Reanimated.View> : null}

      <View style={[styles.bottom, { backgroundColor: tokens.bg, paddingBottom: keyboardVisible ? 6 : insets.bottom + 16 }]}>
        <View pointerEvents="none" style={styles.bottomFade}><ScrollEdgeFade color={tokens.bg} side="bottom" /></View>
        <Pressable disabled={!validToStart || starting} onPress={() => { tapHaptic(); onStart() }} style={({ pressed }) => [styles.start, { backgroundColor: tokens.accent, opacity: !validToStart || starting ? 0.48 : pressed ? 0.76 : 1, transform: [{ scale: pressed && !starting && !reducedMotion ? 0.985 : 1 }] }]} accessibilityRole="button" accessibilityState={{ disabled: !validToStart || starting, busy: starting }}>
          {starting ? <ActivityIndicator color="#fff" size="small" /> : null}
          <Text style={styles.startText}>{starting ? 'Anchoring timer…' : !validToStart ? 'Add an active time' : exactTimingNeedsSetup ? 'Set up exact timing' : 'Start timer'}</Text>
        </Pressable>
      </View>

      <SubBellFlowSheet visible={subBellsOpen && !soundPickerVisible} state={state} trackId={trackId} secondPrecision={settings.secondPrecisionEnabled && subBellSecondPrecisionSupported} onChange={onChange} onEditTrack={setTrackId} onEditCue={() => { if (trackId) setCueTarget({ kind: 'track', id: trackId }) }} onAdd={addTrack} onBack={() => setTrackId(null)} onClose={() => { setTrackId(null); setSubBellsOpen(false) }} onFeedback={onFeedback} />
      <MixerSheet visible={mixerOpen && !soundPickerVisible} state={state} onChange={onChange} onEditCue={setCueTarget} onClose={() => setMixerOpen(false)} onFeedback={onFeedback} />
      {cue ? <SoundPickerSheet visible={soundPickerVisible} title={cueTitle} cue={cue} masterVolume={settings.masterVolume} onChange={patchCue} onBack={trackId || cueTarget?.kind === 'step' || mixerOpen ? () => setCueTarget(null) : undefined} onClose={() => setCueTarget(null)} onFeedback={onFeedback} /> : null}
      <BottomSheet visible={scheduleOpen} title="Schedule" help="Add one or more weekly time ranges. A continuous timer stays quiet outside them and resumes automatically when the next active range begins." onClose={() => setScheduleOpen(false)}><ScheduleConfig showHeading={false} showEnabledControl={false} value={settings.availability} onChange={availability => changeSettings({ availability })} /></BottomSheet>
      {Platform.OS === 'android' ? <BottomSheet visible={systemAccessOpen} title="System integrations" help="These optional Android permissions keep timing reliable with the screen off, silence cues during calls, and show useful running controls." onClose={() => setSystemAccessOpen(false)}><SystemAccessPanel access={androidAccess} settings={settings} onChangeSettings={changeSettings} onOpenExactAlarmSettings={onOpenExactAlarmSettings} onOpenFullScreenIntentSettings={onOpenFullScreenIntentSettings} onRequestCallMuteAccess={onRequestCallMuteAccess} onRequestNotificationAccess={onRequestNotificationAccess} /></BottomSheet> : null}
      {hapticsSupported ? <HapticsSheet visible={hapticsOpen} value={settings.haptics} onChange={haptics => changeSettings({ haptics })} onClose={() => setHapticsOpen(false)} /> : null}
      <PresetLibrarySheet visible={presetsOpen} state={state} onChange={onChange} onClose={() => setPresetsOpen(false)} onFeedback={onFeedback} />
    </KeyboardAvoidingView>
    </SetupHelpProvider>
  )
}

function SystemAccessPanel({ access, settings, onChangeSettings, onOpenExactAlarmSettings, onOpenFullScreenIntentSettings, onRequestCallMuteAccess, onRequestNotificationAccess }: { access: Props['androidAccess']; settings: TimerV2State['settings']; onChangeSettings: (patch: Partial<TimerV2State['settings']>) => void; onOpenExactAlarmSettings: () => void; onOpenFullScreenIntentSettings: () => void; onRequestCallMuteAccess: () => void; onRequestNotificationAccess: () => void }) {
  const { tokens } = useTheme()
  const capabilities = ChandasTimerService.getCapabilities()
  const liveCountdownSupported = capabilities?.supportsLiveCountdown === true
  const dualCountdownSupported = capabilities?.supportsDualLiveCountdown === true
  const toggleCallMute = (enabled: boolean) => {
    onChangeSettings({ muteDuringCallsEnabled: enabled })
    if (enabled && !access.callMute) onRequestCallMuteAccess()
  }
  const toggleNotifications = (enabled: boolean) => {
    onChangeSettings({ notificationsEnabled: enabled })
    if (enabled && !access.notifications) onRequestNotificationAccess()
  }
  const toggleLiveCountdown = (enabled: boolean) => {
    onChangeSettings({ liveCountdownEnabled: enabled, ...(enabled ? { notificationsEnabled: true } : {}) })
    if (enabled && !access.notifications) onRequestNotificationAccess()
  }
  return <View style={styles.accessPanel}>
    {!access.exactAlarms ? <><View style={styles.accessRow}><View style={styles.flex}><Text style={[styles.rowTitle, { color: tokens.text }]}>Exact timing</Text><Text style={[styles.helper, { color: tokens.warm }]}>Needed for precise timing with the screen off.</Text></View><SheetTextButton label="Set up" tone="danger" onPress={onOpenExactAlarmSettings} /></View><View style={[styles.divider, { backgroundColor: tokens.border }]} /></> : null}
    {!access.fullScreenAlarms ? <><View style={styles.accessRow}><View style={styles.flex}><Text style={[styles.rowTitle, { color: tokens.text }]}>Full-screen alarms</Text><Text style={[styles.helper, { color: tokens.warm }]}>Allow alarms to open over the lock screen.</Text></View><SheetTextButton label="Set up" tone="danger" onPress={onOpenFullScreenIntentSettings} /></View><View style={[styles.divider, { backgroundColor: tokens.border }]} /></> : null}
    <PermissionToggleRow title="Mute during calls" detail={access.callMute ? 'Keeps timer cues quiet during calls.' : 'Optional phone-state access.'} value={settings.muteDuringCallsEnabled && access.callMute} pending={access.pending === 'call-mute'} checking={access.checking} onChange={toggleCallMute} />
    <View style={[styles.divider, { backgroundColor: tokens.border }]} />
    <PermissionToggleRow title="Timer notifications" detail={access.notifications ? 'Shows running status and controls.' : 'Optional notification access.'} value={settings.notificationsEnabled && access.notifications} pending={access.pending === 'notifications'} checking={access.checking} onChange={toggleNotifications} />
    {liveCountdownSupported ? <><View style={[styles.divider, { backgroundColor: tokens.border }]} /><PermissionToggleRow title={dualCountdownSupported ? 'Timer countdown' : 'Next cue countdown'} detail={!settings.notificationsEnabled || !access.notifications ? 'Requires timer notifications.' : dualCountdownSupported ? 'Shows the next cue and run finish when available.' : 'Notification and supported status bars.'} value={settings.liveCountdownEnabled} pending={false} checking={access.checking} onChange={toggleLiveCountdown} /></> : null}
  </View>
}

function PermissionToggleRow({ title, detail, value, pending, checking, onChange }: { title: string; detail: string; value: boolean; pending: boolean; checking: boolean; onChange: (enabled: boolean) => void }) {
  const { tokens } = useTheme()
  return <Reanimated.View layout={LinearTransition.duration(150)} style={styles.accessRow}><View style={styles.flex}><Text style={[styles.rowTitle, { color: tokens.text }]}>{title}</Text><Text style={[styles.helper, { color: tokens.textMuted }]}>{pending ? 'Waiting for Android…' : checking ? 'Checking…' : detail}</Text></View>{pending ? <ActivityIndicator color={tokens.accent} size="small" /> : <Toggle value={value} onChange={onChange} accessibilityLabel={title} />}</Reanimated.View>
}

function androidAccessSummary(access: Props['androidAccess']): string {
  if (access.checking) return 'Checking permissions…'
  if (!access.exactAlarms) return 'Exact timing needs setup'
  if (!access.fullScreenAlarms) return 'Full-screen alarms need setup'
  return 'Timing, notifications and call mute'
}

function ProgramRunLength({ state, mode, onChange, showHelp }: { state: TimerV2State; mode: 'pattern' | 'sequence'; onChange: (state: TimerV2State) => void; showHelp: boolean }) {
  if (mode === 'pattern') {
    const program = state.workingPrograms.pattern
    return <View style={styles.section}><RunLengthConfig mode="pattern" value={program.runPolicy} cycleDurationSeconds={patternDurationSeconds(program)} secondPrecision={state.settings.secondPrecisionEnabled} onChange={runPolicy => onChange(updatePattern(state, value => ({ ...value, runPolicy })))} /><InlineHelp visible={showHelp}>Choose Continuous for an open-ended timer, Cycles for a set number of main intervals, or Duration for an exact total time.</InlineHelp></View>
  }
  const program = state.workingPrograms.sequence
  return <View style={styles.section}><RunLengthConfig mode="sequence" value={program.runPolicy} cycleDurationSeconds={program.steps.reduce((sum, step) => sum + sequenceStepDurationSeconds(step), 0)} secondPrecision={state.settings.secondPrecisionEnabled} onChange={runPolicy => onChange({ ...state, workingPrograms: { ...state.workingPrograms, sequence: { ...program, runPolicy } } })} /><InlineHelp visible={showHelp}>Choose Continuous to repeat until stopped, Cycles for a set number of full rounds, or Duration for an exact total time.</InlineHelp></View>
}

function CompletionCueControls({ state, onChange, onEditCue, onFeedback }: { state: TimerV2State; onChange: (state: TimerV2State) => void; onEditCue: (target: CueTarget) => void; onFeedback: Props['onFeedback'] }) {
  const { tokens } = useTheme()
  const reducedMotion = useReducedMotion()
  const mode = state.workingPrograms.selectedMode
  const program = state.workingPrograms[mode]
  if (program.runPolicy.kind === 'continuous') return null
  const cue = program.completionCue
  const preview = async () => {
    if (!cue) return
    try {
      if (!await ChandasTimerService.previewSound(cue.sound, state.settings.masterVolume * cue.volume)) {
        onFeedback({ title: 'Preview stayed quiet', message: 'The final gong could not be opened. Its safe fallback will still be used.', tone: 'attention' })
      }
    } catch {
      onFeedback({ title: 'Preview stayed quiet', message: 'Nothing changed. Try another sound or check the phone’s Alarm volume.', tone: 'attention' })
    }
  }
  return <Reanimated.View layout={LinearTransition.duration(reducedMotion ? 80 : 160)}>
    <View style={styles.settingRow}>
      <View style={styles.flex}><Text style={[styles.rowTitle, { color: tokens.text }]}>Custom final gong</Text><Text style={[styles.helper, { color: tokens.textMuted }]}>Use a different sound when this run finishes.</Text></View>
      <Toggle value={cue !== null} onChange={enabled => onChange(setCompletionCueEnabled(state, mode, enabled))} accessibilityLabel="Custom final gong" />
    </View>
    {cue ? <Reanimated.View entering={FadeInDown.duration(reducedMotion ? 80 : 150)} exiting={FadeOut.duration(reducedMotion ? 70 : 100)} style={styles.completionCueControls}>
      <VolumeControl label="Final gong volume" value={cue.volume} onChange={volume => onChange(patchCompletionCue(state, mode, { volume }))} onPreview={() => void preview()} />
      <CueRow title="Final gong" detail={soundTitle(cue.sound)} sound={cue.sound} onPress={() => onEditCue({ kind: 'completion', mode })} />
    </Reanimated.View> : null}
  </Reanimated.View>
}

function PatternEditor({ state, onChange, enhancedClockAlignmentSupported, onOpenSubBells, showHelp, onToggleHelp }: { state: TimerV2State; onChange: (state: TimerV2State) => void; enhancedClockAlignmentSupported: boolean; onOpenSubBells: () => void; showHelp: boolean; onToggleHelp: () => void }) {
  const { tokens } = useTheme()
  const program = state.workingPrograms.pattern
  const snapOffset = program.alignment.kind === 'local-clock' ? program.alignment.offsetMinutes : 0
  const activeTracks = program.tracks.filter(track => track.enabled)
  const cueCount = activeTracks.reduce((count, track) => count + trackSelectedOffsetsSeconds(track).length, 0)
  const durationSeconds = patternDurationSeconds(program)
  const clockAlignmentAvailable = durationSeconds % 60 === 0 || enhancedClockAlignmentSupported
  const changeDurationSeconds = (seconds: number) => changeMainDurationSeconds(state, seconds, next => {
    const compatible = !enhancedClockAlignmentSupported && seconds % 60 !== 0
      ? updatePattern(next, value => ({ ...value, alignment: { kind: 'elapsed' } }))
      : next
    onChange(compatible)
  })
  return <>
    <View style={styles.section}>
      <View style={styles.titleWithHelp}><EditableTitle value={program.label} onCommit={label => onChange(updatePattern(state, value => ({ ...value, label, labelIsCustom: true })))} accessibilityLabel="cycle name" />{!showHelp ? <HelpToggleButton active={false} onPress={onToggleHelp} /> : null}</View>
      <InlineHelp visible={showHelp}>The timer counts down, sounds the gong, then starts the next cycle. Tap the name to rename it.</InlineHelp>
      <Text style={[styles.rowTitle, { color: tokens.text }]}>Main interval</Text>
      <InlineHelp visible={showHelp}>Choose how much time passes between main gongs.</InlineHelp>
      <DurationSelector value={program.mainMinutes} valueSeconds={durationSeconds} secondPrecision={state.settings.secondPrecisionEnabled} presets={MAIN_PRESETS} fadeColor={tokens.bg} onChange={minutes => changeMainMinutes(state, minutes, onChange)} onChangeSeconds={changeDurationSeconds} />
      <ProgramRunLength state={state} mode="pattern" onChange={onChange} showHelp={showHelp} />
      <View style={styles.settingRow}><View style={styles.flex}><Text style={[styles.rowTitle, { color: tokens.text }]}>Align to clock</Text><Text numberOfLines={1} style={[styles.helper, { color: tokens.textMuted }]}>{clockAlignmentAvailable ? 'Keep intervals on a wall-clock rhythm.' : 'Available in the next app build.'}</Text></View><Toggle disabled={!clockAlignmentAvailable} value={clockAlignmentAvailable && program.alignment.kind === 'local-clock'} onChange={enabled => onChange(updatePattern(state, value => ({ ...value, alignment: enabled ? { kind: 'local-clock', offsetMinutes: 0 } : { kind: 'elapsed' } })))} accessibilityLabel="Align pattern to clock" /></View>
      <InlineHelp visible={showHelp}>Turn this on when you want each cycle to land on familiar clock marks instead of simply starting from now.</InlineHelp>
      {clockAlignmentAvailable && program.alignment.kind === 'local-clock' ? <ClockSnapSelector cycleDurationSeconds={durationSeconds} value={snapOffset} compact fadeColor={tokens.bg} onChange={offsetMinutes => onChange(updatePattern(state, value => ({ ...value, alignment: { kind: 'local-clock', offsetMinutes } })))} /> : null}
    </View>

    <View style={styles.section}>
      <View style={styles.settingRow}><Pressable style={styles.flex} onPress={() => { tapHaptic(); onOpenSubBells() }} accessibilityRole="button" accessibilityLabel="Configure sub-bells"><Text style={[styles.rowTitle, { color: tokens.text }]}>Sub Bells</Text><Text numberOfLines={1} style={[styles.helper, { color: tokens.textMuted }]}>{program.tracks.length === 0 ? 'No sub-bells yet' : `${program.subBellsEnabled ? activeTracks.length : 0} active · ${program.subBellsEnabled ? cueCount : 0} selected`}</Text></Pressable><Toggle value={program.subBellsEnabled} onChange={enabled => onChange(setPatternSubBellsEnabled(state, enabled))} accessibilityLabel="Sub-bells" /></View>
      <InlineHelp visible={showHelp}>Add smaller cues inside the main interval—for example, a reminder five minutes before the main gong.</InlineHelp>
      {program.subBellsEnabled ? <Reanimated.View entering={FadeInDown.duration(180)} exiting={FadeOut.duration(120)} style={styles.subBellBody}>
        <PatternTimelinePreview tracks={program.tracks} mainDurationSeconds={patternDurationSeconds(program)} onPress={onOpenSubBells} />
      </Reanimated.View> : null}
    </View>
  </>
}

function SequenceEditor({ state, onChange, clockAlignmentSupported, soundPickerVisible, onEditCue, onAdd, showHelp, onToggleHelp, onReorderingChange, onAutoScroll }: { state: TimerV2State; onChange: (state: TimerV2State) => void; clockAlignmentSupported: boolean; soundPickerVisible: boolean; onEditCue: (target: CueTarget) => void; onAdd: () => void; showHelp: boolean; onToggleHelp: () => void; onReorderingChange: (active: boolean) => void; onAutoScroll: (pageY: number, canMoveEarlier: boolean, canMoveLater: boolean) => number }) {
  const { tokens } = useTheme()
  const [editingStepId, setEditingStepId] = useState<string | null>(null)
  const [dragPreview, setDragPreview] = useState<ReorderPreview | null>(null)
  const program = state.workingPrograms.sequence
  const totalSeconds = program.steps.reduce((sum, step) => sum + sequenceStepDurationSeconds(step), 0)
  const previewStep = useCallback((stepId: string, from: number, to: number, rowHeight: number) => setDragPreview({ stepId, from, to, rowHeight }), [])
  const finishPreview = useCallback(() => setDragPreview(null), [])
  const moveStep = useCallback((from: number, to: number) => onChange(reorderSequenceSteps(state, from, to)), [onChange, state])
  useEffect(() => () => onReorderingChange(false), [onReorderingChange])
  return <View style={styles.section}>
    <View style={styles.titleWithHelp}><View style={styles.flex}><Text style={[styles.eyebrow, { color: tokens.textMuted }]}>SEQUENCE</Text><Text style={[styles.sectionValue, { color: tokens.text }]}>{formatClockDuration(totalSeconds)}</Text><Text style={[styles.helper, { color: tokens.textMuted }]}>{program.steps.length} step{program.steps.length === 1 ? '' : 's'} · repeats</Text></View>{!showHelp ? <HelpToggleButton active={false} onPress={onToggleHelp} /> : null}</View>
    <InlineHelp visible={showHelp}>Steps play in order and then repeat. Tap a step to edit it; hold its dotted handle to change the order.</InlineHelp>
    {program.steps.map((step, index) => <SequenceStepRow key={step.id} state={state} stepId={step.id} index={index} dragPreview={dragPreview} onEdit={() => setEditingStepId(step.id)} onDelete={() => onChange(removeSequenceStep(state, step.id))} onMove={moveStep} onPreviewChange={previewStep} onPreviewEnd={finishPreview} onReorderingChange={onReorderingChange} onAutoScroll={onAutoScroll} />)}
    {program.steps.length < 20 ? <AddRowButton onPress={onAdd} title="+ Add step" /> : null}
    <ProgramRunLength state={state} mode="sequence" onChange={onChange} showHelp={showHelp} />
    {clockAlignmentSupported ? <>
      <View style={styles.settingRow}><View style={styles.flex}><Text style={[styles.rowTitle, { color: tokens.text }]}>Align to clock</Text><Text numberOfLines={1} style={[styles.helper, { color: tokens.textMuted }]}>Keep the full sequence on a wall-clock rhythm.</Text></View><Toggle value={program.alignment.kind === 'local-clock'} onChange={enabled => onChange(updateSequence(state, value => ({ ...value, alignment: enabled ? { kind: 'local-clock', offsetMinutes: 0 } : { kind: 'elapsed' } })))} accessibilityLabel="Align sequence to clock" /></View>
      <InlineHelp visible={showHelp}>Turn this on when you want each full round to begin on a familiar clock mark.</InlineHelp>
      {program.alignment.kind === 'local-clock' ? <ClockSnapSelector cycleDurationSeconds={totalSeconds} value={program.alignment.offsetMinutes} compact fadeColor={tokens.bg} onChange={offsetMinutes => onChange(updateSequence(state, value => ({ ...value, alignment: { kind: 'local-clock', offsetMinutes } })))} /> : null}
    </> : null}
    {editingStepId ? <SequenceStepEditorSheet visible={!soundPickerVisible} state={state} stepId={editingStepId} onChange={onChange} onEditCue={() => onEditCue({ kind: 'step', id: editingStepId })} onClose={() => setEditingStepId(null)} /> : null}
  </View>
}

function SubBellFlowSheet({ visible, state, trackId, secondPrecision, onChange, onEditTrack, onEditCue, onAdd, onBack, onClose, onFeedback }: { visible: boolean; state: TimerV2State; trackId: string | null; secondPrecision: boolean; onChange: (state: TimerV2State) => void; onEditTrack: (id: string) => void; onEditCue: () => void; onAdd: () => void; onBack: () => void; onClose: () => void; onFeedback: Props['onFeedback'] }) {
  const reducedMotion = useReducedMotion()
  const program = state.workingPrograms.pattern
  const track = trackId ? program.tracks.find(value => value.id === trackId) : null
  const editing = Boolean(track)
  return <BottomSheet visible={visible} presentationKey={track?.id ?? 'library'} title={track ? <EditableTitle value={track.label} onCommit={label => onChange(patchPatternTrack(state, track.id, { label }))} accessibilityLabel={`Sub-bell ${program.tracks.findIndex(value => value.id === track.id) + 1} name`} large /> : 'Sub-bells'} accessibilityTitle={track?.label ?? 'Sub-bells'} help={track ? 'Choose how often this bell occurs and how it sounds. Color & visibility changes its watch-face ring without silencing it.' : 'Sub-bells add smaller cues inside each main interval. Open a bell to choose its rhythm, sound, color, volume, and exact cue positions.'} onBack={editing ? onBack : undefined} onClose={onClose}>
    <Reanimated.View key={track?.id ?? 'library'} entering={FadeIn.duration(reducedMotion ? 70 : 130)}>
      {track ? <TrackEditorContent state={state} trackId={track.id} secondPrecision={secondPrecision} onChange={onChange} onEditCue={onEditCue} onFeedback={onFeedback} /> : <SubBellLibraryContent state={state} onChange={onChange} onEditTrack={onEditTrack} onAdd={onAdd} />}
    </Reanimated.View>
  </BottomSheet>
}

function SubBellLibraryContent({ state, onChange, onEditTrack, onAdd }: { state: TimerV2State; onChange: (state: TimerV2State) => void; onEditTrack: (id: string) => void; onAdd: () => void }) {
  const { tokens } = useTheme()
  const program = state.workingPrograms.pattern
  const activeTracks = program.tracks.filter(track => track.enabled)
  const cueCount = activeTracks.reduce((count, track) => count + trackSelectedOffsetsSeconds(track).length, 0)
  return <View style={styles.trackEditorContent}>
    <Text style={[styles.helper, { color: tokens.textMuted }]}>{`${activeTracks.length} active · ${cueCount} selected ${cueCount === 1 ? 'cue' : 'cues'}`}</Text>
    <PatternTimelinePreview tracks={program.subBellsEnabled ? program.tracks : []} mainDurationSeconds={patternDurationSeconds(program)} />
    {program.tracks.length === 0 ? <GentleNotice title="No sub-bells yet" message="Add one when you want an extra cue within the main interval." /> : program.subBellsEnabled && cueCount === 0 ? <GentleNotice title="No sub-bell cues are active" message="The main gong will still play. Open a sub-bell to choose its cue positions." /> : null}
    <View style={styles.trackList}>{program.tracks.map((track, index) => <SwipeToDeleteRow key={track.id} accessibilityLabel={`Delete ${track.label}`} onDelete={() => onChange(removePatternTrack(state, track.id))}><PatternTrackRow state={state} track={track} index={index} onChange={onChange} onEdit={() => onEditTrack(track.id)} /></SwipeToDeleteRow>)}</View>
    <AddRowButton disabled={program.tracks.length >= 5} onPress={onAdd} title={program.tracks.length >= 5 ? '5 sub-bell limit reached' : '+ Add sub-bell'} />
  </View>
}

function PatternTrackRow({ state, track, index, onChange, onEdit }: { state: TimerV2State; track: PatternTrack; index: number; onChange: (state: TimerV2State) => void; onEdit: () => void }) {
  const { tokens } = useTheme()
  const reducedMotion = useReducedMotion()
  const selectedCount = trackSelectedOffsetsSeconds(track).length
  const occurrenceCount = validOffsetsForCadenceSeconds(patternDurationSeconds(state.workingPrograms.pattern), trackCadenceSeconds(track)).length
  const selectionSummary = selectedCount === occurrenceCount ? `${occurrenceCount} occurrence${occurrenceCount === 1 ? '' : 's'}` : `${selectedCount}/${occurrenceCount} selected`
  return <Reanimated.View entering={reducedMotion ? FadeIn.duration(80) : FadeInDown.duration(190)} exiting={FadeOut.duration(reducedMotion ? 70 : 130)} layout={reducedMotion ? undefined : LinearTransition.duration(160)}>
    <View style={[styles.trackSummary, index > 0 && { borderTopColor: tokens.border, borderTopWidth: StyleSheet.hairlineWidth }, { opacity: track.enabled ? 1 : 0.5 }]}>
      <View style={[styles.trackColorDot, { backgroundColor: subBellColorValue(track.color, index) }]} />
      <Pressable style={styles.flex} onPress={onEdit} accessibilityRole="button" accessibilityLabel={`Edit ${track.label}`}><Text numberOfLines={1} style={[styles.rowTitle, { color: tokens.text }]}>{track.label}</Text><Text numberOfLines={1} style={[styles.helper, { color: tokens.textMuted }]}>Every {formatCompactDurationSeconds(trackCadenceSeconds(track))} · {soundTitle(track.sound)} · {selectionSummary}</Text></Pressable>
      <Toggle value={track.enabled} onChange={enabled => onChange(patchPatternTrack(state, track.id, { enabled }))} accessibilityLabel={`Enable ${track.label}`} />
    </View>
  </Reanimated.View>
}

function SequenceStepRow({ state, stepId, index, dragPreview, onEdit, onDelete, onMove, onPreviewChange, onPreviewEnd, onReorderingChange, onAutoScroll }: { state: TimerV2State; stepId: string; index: number; dragPreview: ReorderPreview | null; onEdit: () => void; onDelete: () => void; onMove: (from: number, to: number) => void; onPreviewChange: (stepId: string, from: number, to: number, rowHeight: number) => void; onPreviewEnd: () => void; onReorderingChange: (active: boolean) => void; onAutoScroll: (pageY: number, canMoveEarlier: boolean, canMoveLater: boolean) => number }) {
  const { tokens } = useTheme()
  const dragTranslation = useSharedValue(0)
  const previewTranslation = useSharedValue(0)
  const [dragging, setDragging] = useState(false)
  const [rowHeight, setRowHeight] = useState(82)
  const reducedMotion = useReducedMotion()
  const program = state.workingPrograms.sequence
  const step = program.steps.find(value => value.id === stepId)
  const previewIndex = dragPreview ? previewIndexForItem(index, dragPreview.from, dragPreview.to) : index
  const previewOffset = dragPreview ? previewOffsetForItem(index, dragPreview.from, dragPreview.to, dragPreview.rowHeight) : 0
  useEffect(() => {
    previewTranslation.value = reducedMotion ? previewOffset : withTiming(previewOffset, { duration: 140 })
  }, [previewOffset, previewTranslation, reducedMotion])
  const rowAnimatedStyle = useAnimatedStyle(() => ({ transform: [{ translateY: dragTranslation.value + previewTranslation.value }] }))
  const handlePreviewChange = useCallback((from: number, to: number, height: number) => onPreviewChange(stepId, from, to, height), [onPreviewChange, stepId])
  const handleDragStateChange = useCallback((active: boolean) => { setDragging(active); onReorderingChange(active) }, [onReorderingChange])
  if (!step) return null
  return <Reanimated.View entering={reducedMotion ? FadeIn.duration(80) : FadeInDown.duration(190)} exiting={FadeOut.duration(reducedMotion ? 70 : 130)} layout={reducedMotion ? undefined : LinearTransition.duration(160)} style={dragging ? styles.draggingLayer : undefined}>
    <SwipeToDeleteRow accessibilityLabel={`Delete ${step.label}`} onDelete={onDelete} disabled={program.steps.length <= 1 || dragging}>
    <Reanimated.View onLayout={event => { if (!dragging) setRowHeight(event.nativeEvent.layout.height + 13) }} style={[styles.sequenceCard, index > 0 && { borderTopColor: tokens.border, borderTopWidth: StyleSheet.hairlineWidth }, dragging && styles.dragging, { opacity: dragging ? 0.92 : 1 }, rowAnimatedStyle]}>
      <View style={styles.sequenceHead}><ReorderHandle index={index} itemCount={program.steps.length} rowHeight={rowHeight} rowTranslation={dragTranslation} onDragStateChange={handleDragStateChange} onPreviewChange={handlePreviewChange} onPreviewEnd={onPreviewEnd} onAutoScroll={onAutoScroll} onMove={onMove} label={`Reorder ${step.label}`} /><Pressable style={styles.sequenceSummary} onPress={onEdit} accessibilityRole="button" accessibilityLabel={`Edit ${step.label}`}><View style={styles.flex}><View style={styles.sequenceTitleLine}><Text style={[styles.priority, { color: tokens.accent }]}>{String(previewIndex + 1).padStart(2, '0')}</Text><Text numberOfLines={1} style={[styles.rowTitle, styles.sequenceTitle, { color: tokens.text }]}>{step.label}</Text></View><Text numberOfLines={1} style={[styles.helper, { color: tokens.textMuted }]}>{formatCompactDurationSeconds(sequenceStepDurationSeconds(step))} · {soundTitle(step.sound)} · {Math.round(step.volume * 100)}%</Text></View><Text style={[styles.sequenceChevron, { color: tokens.accent }]}>›</Text></Pressable></View>
    </Reanimated.View>
    </SwipeToDeleteRow>
  </Reanimated.View>
}

function SequenceStepEditorSheet({ visible, state, stepId, onChange, onEditCue, onClose }: { visible: boolean; state: TimerV2State; stepId: string; onChange: (state: TimerV2State) => void; onEditCue: () => void; onClose: () => void }) {
  const { tokens } = useTheme()
  const [previewError, setPreviewError] = useState<string | null>(null)
  const program = state.workingPrograms.sequence
  const index = program.steps.findIndex(step => step.id === stepId)
  const step = program.steps[index]
  if (!step) return null
  const preview = async () => {
    setPreviewError(null)
    try {
      if (!await ChandasTimerService.previewSound(step.sound, state.settings.masterVolume * step.volume)) setPreviewError('This sound could not be opened. Its safe fallback will still be used when the timer runs.')
    } catch {
      setPreviewError('The preview stayed quiet. Try another sound or check the phone’s Alarm volume.')
    }
  }
  const close = () => { ChandasTimerService.stopSoundPreview(); setPreviewError(null); onClose() }
  return <BottomSheet visible={visible} eyebrow={`Step ${index + 1} of ${program.steps.length}`} title={<EditableTitle value={step.label} onCommit={label => onChange(patchSequenceStep(state, step.id, { label }))} accessibilityLabel={`Step ${index + 1} name`} large />} accessibilityTitle={step.label} help="Set how long this step lasts, how loudly it plays, and which sound marks its boundary. Tap the title to rename it." onClose={close}>
    {previewError ? <GentleNotice title="Preview stayed quiet" message={previewError} tone="attention" /> : null}
    <DurationSelector value={step.durationMinutes} valueSeconds={sequenceStepDurationSeconds(step)} secondPrecision={state.settings.secondPrecisionEnabled} presets={STEP_PRESETS} fadeColor={tokens.surface} onChange={durationMinutes => onChange(patchSequenceStep(state, step.id, { durationMinutes }))} onChangeSeconds={durationSeconds => onChange(patchSequenceStep(state, step.id, { durationSeconds }))} />
    <VolumeControl label="Volume" value={step.volume} onChange={volume => onChange(patchSequenceStep(state, step.id, { volume }))} onPreview={() => void preview()} />
    <CueRow title="Sound" detail={soundTitle(step.sound)} sound={step.sound} onPress={() => { ChandasTimerService.stopSoundPreview(); onEditCue() }} />
    <View style={styles.stepActions}><SheetTextButton disabled={program.steps.length >= 20} label="Duplicate step" onPress={() => { onChange(duplicateSequenceStep(state, step.id)); close() }} accessibilityLabel={`Duplicate ${step.label}`} /></View>
  </BottomSheet>
}

function TrackEditorContent({ state, trackId, secondPrecision, onChange, onEditCue, onFeedback }: { state: TimerV2State; trackId: string; secondPrecision: boolean; onChange: (state: TimerV2State) => void; onEditCue: () => void; onFeedback: Props['onFeedback'] }) {
  const { tokens } = useTheme()
  const reducedMotion = useReducedMotion()
  const [cuesOpen, setCuesOpen] = useState(false)
  const program = state.workingPrograms.pattern
  const track = program.tracks.find(value => value.id === trackId)
  if (!track) return null
  const cadenceSeconds = trackCadenceSeconds(track)
  const offsets = validOffsetsForCadenceSeconds(patternDurationSeconds(program), cadenceSeconds)
  const selectedOffsets = trackSelectedOffsetsSeconds(track)
  const index = program.tracks.findIndex(value => value.id === trackId)
  const shownOnWatchFace = track.showOnWatchFace !== false
  const preview = async () => {
    try {
      if (!await ChandasTimerService.previewSound(track.sound, state.settings.masterVolume * track.volume)) onFeedback({ title: 'Preview stayed quiet', message: 'This sound could not be opened. Its safe fallback will still be used.', tone: 'attention' })
    } catch { onFeedback({ title: 'Preview stayed quiet', message: 'Nothing changed. Try another sound or check the phone’s Alarm volume.', tone: 'attention' }) }
  }
  const allSelected = offsets.length > 0 && offsets.every(offset => selectedOffsets.includes(offset))
  return <View style={styles.trackEditorContent}>
    <DurationSelector value={track.cadenceMinutes} valueSeconds={cadenceSeconds} secondPrecision={secondPrecision} presets={CADENCE_PRESETS} min={1} max={240} onChange={minutes => onChange(setTrackCadence(state, track.id, minutes))} onChangeSeconds={seconds => onChange(setTrackCadenceSeconds(state, track.id, seconds))} label="Repeat every" />
    <ColorSelector label="Color & visibility" detail="Watch face" value={normalizeSubBellColor(track.color, index)} onChange={color => onChange(patchPatternTrack(state, track.id, { color }))} accessibilityLabel="Choose sub-bell color" trailing={<Pressable hitSlop={8} onPress={() => { tapHaptic(); onChange(patchPatternTrack(state, track.id, { showOnWatchFace: !shownOnWatchFace })) }} style={({ pressed }) => [styles.roundIcon, { borderColor: shownOnWatchFace ? tokens.accent : tokens.border, backgroundColor: shownOnWatchFace ? tokens.accentGlow : 'transparent', opacity: pressed ? 0.68 : shownOnWatchFace ? 1 : 0.72 }]} accessibilityRole="switch" accessibilityLabel={`${track.label} watch-face ring`} accessibilityState={{ checked: shownOnWatchFace }}><EyeIcon visible={shownOnWatchFace} color={shownOnWatchFace ? tokens.accent : tokens.textMuted} /></Pressable>} />
    <VolumeControl label="Volume" value={track.volume} onChange={volume => onChange(patchPatternTrack(state, track.id, { volume }))} onPreview={() => void preview()} />
    <CueRow title="Sound" detail={soundTitle(track.sound)} sound={track.sound} onPress={onEditCue} />
    <View style={styles.gridHeading}><Pressable onPress={() => { tapHaptic(); setCuesOpen(open => !open) }} style={styles.settingRow} accessibilityRole="button" accessibilityState={{ expanded: cuesOpen }} accessibilityLabel="Customize sub-bell cues"><View style={styles.flex}><Text style={[styles.rowTitle, { color: tokens.text }]}>Customize cues</Text><Text style={[styles.helper, { color: tokens.textMuted }]}>{selectedOffsets.length} of {offsets.length} selected</Text></View><Text style={[styles.chevron, { color: tokens.accent }]}>›</Text></Pressable></View>
    {cuesOpen ? <Reanimated.View entering={FadeInDown.duration(reducedMotion ? 70 : 150)} exiting={FadeOut.duration(reducedMotion ? 60 : 100)} style={styles.cueEditor}>
      <View style={styles.gridActionRow}><Text style={[styles.helper, { color: tokens.textMuted }]}>Time after the main gong. Tap to toggle.</Text><SheetTextButton disabled={offsets.length === 0} label={allSelected ? 'Clear' : 'Select all'} onPress={() => onChange(setTrackOffsetsSeconds(state, track.id, allSelected ? [] : offsets))} /></View>
      {offsets.length <= MAX_VISIBLE_PATTERN_OFFSETS ? <OffsetGrid offsets={offsets} selected={selectedOffsets} unit="seconds" onChange={selected => onChange(setTrackOffsetsSeconds(state, track.id, selected))} /> : <GentleNotice title="Too many times to show" message={`This repeat interval creates ${offsets.length} cues. Choose a longer interval to customize individual times.`} />}
      {offsets.length === 0 ? <GentleNotice title="No bell times fit" message="Choose a shorter repeat interval or a longer main interval." /> : null}
    </Reanimated.View> : null}
  </View>
}

function MixerSheet({ visible, state, onChange, onEditCue, onClose, onFeedback }: { visible: boolean; state: TimerV2State; onChange: (state: TimerV2State) => void; onEditCue: (target: CueTarget) => void; onClose: () => void; onFeedback: Props['onFeedback'] }) {
  const { tokens } = useTheme()
  const program = state.workingPrograms[state.workingPrograms.selectedMode]
  const preview = async (title: string, cue: CueSettings) => {
    try {
      const started = await ChandasTimerService.previewSound(cue.sound, state.settings.masterVolume * cue.volume)
      if (!started) onFeedback({ title: 'Preview stayed quiet', message: `${title} could not be opened. Its safe fallback will still be used when the timer runs.`, tone: 'attention' })
    } catch {
      onFeedback({ title: 'Preview stayed quiet', message: 'Nothing changed. Try another sound or check the phone’s Alarm volume.', tone: 'attention' })
    }
  }
  const row = (key: string, title: string, cue: CueSettings, target: CueTarget, patch: (volume: number) => TimerV2State) => <View key={key} style={styles.mixerChannel}><Pressable style={styles.mixerChannelHead} onPress={() => onEditCue(target)} accessibilityRole="button" accessibilityLabel={`Edit ${title} sound`}><View style={styles.flex}><Text numberOfLines={1} style={[styles.rowTitle, { color: tokens.text }]}>{title}</Text><SoundName sound={cue.sound} style={styles.helper} /></View><Text style={[styles.chevron, { color: tokens.accent }]}>›</Text></Pressable><View style={styles.mixerControl}><Slider style={styles.mixerSlider} minimumValue={0} maximumValue={1} step={0.05} value={cue.volume} onValueChange={volume => onChange(patch(volume))} minimumTrackTintColor={tokens.accent} maximumTrackTintColor={tokens.surfaceHi} thumbTintColor={tokens.accent} accessibilityLabel={`${title} volume`} accessibilityValue={{ min: 0, max: 100, now: Math.round(cue.volume * 100), text: `${Math.round(cue.volume * 100)} percent` }} /><Pressable hitSlop={7} onPress={() => void preview(title, cue)} style={[styles.previewMini, { borderColor: tokens.border }]} accessibilityRole="button" accessibilityLabel={`Preview ${title}`}><Text style={[styles.previewGlyph, { color: tokens.accent }]}>▶</Text></Pressable></View></View>
  const close = () => { ChandasTimerService.stopSoundPreview(); onClose() }
  const masterControl = <View style={styles.pinnedMixerControl}><VolumeControl label="Volume" value={state.settings.masterVolume} onChange={masterVolume => onChange({ ...state, settings: { ...state.settings, masterVolume } })} onPreview={() => void preview(program.mode === 'pattern' ? 'Main gong' : program.steps[0]?.label ?? 'First step', program.mode === 'pattern' ? program.mainCue : program.steps[0])} /><View style={[styles.divider, { backgroundColor: tokens.border }]} /></View>
  return <BottomSheet visible={visible} title="Mixer" help="The main Volume sets the overall level. Each channel below adjusts one sound within that level; use its play button to preview the result." onClose={close} pinnedContent={masterControl}>
    {program.mode === 'pattern' ? <>{row('main', 'Main gong', program.mainCue, { kind: 'main' }, volume => updatePattern(state, value => ({ ...value, mainCue: { ...value.mainCue, volume } })))}{program.tracks.map(track => row(track.id, track.label, track, { kind: 'track', id: track.id }, volume => patchPatternTrack(state, track.id, { volume })))}</> : program.steps.map((step, index) => row(step.id, `${index + 1}. ${step.label}`, step, { kind: 'step', id: step.id }, volume => patchSequenceStep(state, step.id, { volume })))}
    {program.runPolicy.kind !== 'continuous' && program.completionCue ? row('completion', 'Final gong', program.completionCue, { kind: 'completion', mode: program.mode }, volume => patchCompletionCue(state, program.mode, { volume })) : null}
  </BottomSheet>
}

function FocusControl({ state, enabled, onChange, onResume, onOpenAccessSettings, onOpenRuleSettings }: { state: NativeFocusState; enabled: boolean; onChange: (enabled: boolean) => void; onResume: () => void; onOpenAccessSettings: () => void; onOpenRuleSettings: () => void }) {
  const { tokens } = useTheme()
  const paused = state.reason === 'paused-by-android'
  const ruleDisabled = state.reason === 'rule-disabled'
  const status = ruleDisabled ? 'Disabled in Android' : !state.policyAccess ? 'Needs DND access' : paused ? 'Paused in Android' : null
  const detail = enabled && status ? status : 'Manages Chandas’ own Do Not Disturb rule.'
  return <View style={styles.section}><View style={styles.settingRow}><View style={styles.flex}><Text style={[styles.rowTitle, { color: tokens.text }]}>Chandas Focus</Text><Text numberOfLines={1} style={[styles.helper, { color: enabled && (paused || ruleDisabled) ? tokens.warm : tokens.textMuted }]}>{detail}</Text></View><Toggle value={enabled} onChange={onChange} accessibilityLabel="Chandas Focus automation" /></View>{enabled && !state.policyAccess ? <SheetTextButton label="Allow DND access" onPress={onOpenAccessSettings} /> : ruleDisabled ? <SheetTextButton label="Open Android settings" onPress={onOpenRuleSettings} /> : paused ? <SheetTextButton label="Resume Focus" onPress={onResume} /> : null}</View>
}

function ActionRow({ title, detail, onPress, accessibilityLabel, accessory, onAccessoryPress, accessoryLabel }: { title: string; detail: string; onPress: () => void; accessibilityLabel?: string; accessory?: ReactNode; onAccessoryPress?: () => void; accessoryLabel?: string }) {
  const { tokens } = useTheme()
  const reducedMotion = useReducedMotion()
  if (accessory && onAccessoryPress) return <View style={styles.actionRow}><Pressable onPress={() => { tapHaptic(); onPress() }} style={({ pressed }) => [styles.actionMain, { opacity: pressed ? 0.68 : 1, transform: [{ scale: pressed && !reducedMotion ? 0.99 : 1 }] }]} accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? title}><View style={styles.flex}><Text numberOfLines={1} style={[styles.rowTitle, { color: tokens.text }]}>{title}</Text><Text numberOfLines={1} style={[styles.helper, { color: tokens.textMuted }]}>{detail}</Text></View><Text style={[styles.chevron, { color: tokens.accent }]}>›</Text></Pressable><Pressable hitSlop={8} onPress={() => { tapHaptic(); onAccessoryPress() }} style={({ pressed }) => [styles.roundIcon, { borderColor: tokens.border, opacity: pressed ? 0.68 : 1, transform: [{ scale: pressed && !reducedMotion ? 0.92 : 1 }] }]} accessibilityRole="button" accessibilityLabel={accessoryLabel}>{accessory}</Pressable></View>
  return <Pressable onPress={() => { tapHaptic(); onPress() }} style={({ pressed }) => [styles.actionRow, { opacity: pressed ? 0.68 : 1, transform: [{ scale: pressed && !reducedMotion ? 0.99 : 1 }] }]} accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? title}><View style={styles.flex}><Text numberOfLines={1} style={[styles.rowTitle, { color: tokens.text }]}>{title}</Text><Text numberOfLines={1} style={[styles.helper, { color: tokens.textMuted }]}>{detail}</Text></View>{accessory ?? <Text style={[styles.chevron, { color: tokens.accent }]}>›</Text>}</Pressable>
}

function CueRow({ title, detail, sound, onPress }: { title: string; detail: string; sound?: SoundRef; onPress: () => void }) {
  const available = useSoundAvailability(sound ?? { kind: 'builtin', id: 'clear-bell' })
  return <ActionRow title={title} detail={`${detail}${available ? '' : ' · Unavailable'}`} onPress={onPress} accessibilityLabel={`${available ? 'Choose' : 'Replace'} ${title.toLowerCase()}`} />
}

function VolumeControl({ label, value, onChange, onOpenMixer, onPreview }: { label: string; value: number; onChange: (value: number) => void; onOpenMixer?: () => void; onPreview?: () => void }) {
  const { tokens } = useTheme()
  const reducedMotion = useReducedMotion()
  return <View style={styles.volumeBlock}><Text style={[styles.rowTitle, { color: tokens.text }]}>{label}</Text><View style={styles.volumeControlRow}><Slider style={styles.inlineSlider} minimumValue={0} maximumValue={1} step={0.05} value={value} onValueChange={onChange} minimumTrackTintColor={tokens.accent} maximumTrackTintColor={tokens.surfaceHi} thumbTintColor={tokens.accent} accessibilityLabel={label} accessibilityValue={{ min: 0, max: 100, now: Math.round(value * 100), text: `${Math.round(value * 100)} percent` }} />{onPreview ? <Pressable hitSlop={6} onPress={onPreview} accessibilityRole="button" accessibilityLabel="Preview sound at this volume" style={({ pressed }) => [styles.previewButton, { borderColor: tokens.border, backgroundColor: pressed ? tokens.accentGlow : 'transparent', transform: [{ scale: pressed && !reducedMotion ? 0.92 : 1 }] }]}><Text style={[styles.previewGlyph, { color: tokens.accent }]}>▶</Text></Pressable> : null}{onOpenMixer ? <Pressable hitSlop={6} onPress={onOpenMixer} accessibilityRole="button" accessibilityLabel="Open mixer" style={({ pressed }) => [styles.mixerButton, { borderColor: tokens.border, backgroundColor: pressed ? tokens.accentGlow : 'transparent', transform: [{ scale: pressed && !reducedMotion ? 0.92 : 1 }] }]}><MixerIcon color={tokens.accent} /></Pressable> : null}</View></View>
}

function cueForTarget(state: TimerV2State, target: CueTarget): CueSettings | null {
  if (target.kind === 'alarm') return { sound: state.settings.alarmSound, volume: state.settings.alarmVolume }
  if (target.kind === 'main') return state.workingPrograms.pattern.mainCue
  if (target.kind === 'track') return state.workingPrograms.pattern.tracks.find(track => track.id === target.id) ?? null
  if (target.kind === 'step') return state.workingPrograms.sequence.steps.find(step => step.id === target.id) ?? null
  return state.workingPrograms[target.mode].completionCue
}

function changeMainMinutes(state: TimerV2State, minutes: number, onChange: (state: TimerV2State) => void) {
  changeMainDurationSeconds(state, minutes * 60, onChange)
}

function changeMainDurationSeconds(state: TimerV2State, seconds: number, onChange: (state: TimerV2State) => void) {
  const nextState = updatePatternMainDurationSeconds(state, seconds)
  const nextByTrack = new Map(nextState.workingPrograms.pattern.tracks.map(track => [track.id, new Set(trackSelectedOffsetsSeconds(track))]))
  const removed = state.workingPrograms.pattern.tracks.reduce((count, track) => count + trackSelectedOffsetsSeconds(track).filter(offset => !nextByTrack.get(track.id)?.has(offset)).length, 0)
  const apply = () => onChange(nextState)
  if (removed === 0 || Platform.OS === 'web') apply()
  else Alert.alert('Shorten main interval?', `${removed} selected cue${removed === 1 ? '' : 's'} outside the new interval will be removed.`, [{ text: 'Cancel', style: 'cancel' }, { text: 'Continue', onPress: apply }])
}

/** A title until tapped, then a focused field; avoids presenting a duplicate form row. */
function EditableTitle({ value, onCommit, accessibilityLabel, large = false }: { value: string; onCommit: (value: string) => void; accessibilityLabel: string; large?: boolean }) {
  const { tokens } = useTheme()
  const [draft, setDraft] = useState(value)
  const [editing, setEditing] = useState(false)
  const editingRef = useRef(false)
  useEffect(() => { if (!editingRef.current) setDraft(value) }, [value])
  const commit = () => {
    if (!editingRef.current) return
    editingRef.current = false
    onCommit(draft)
    setEditing(false)
  }
  if (editing) return <TextInput autoFocus value={draft} selectTextOnFocus blurOnSubmit onChangeText={text => setDraft([...text].slice(0, 60).join(''))} onBlur={commit} onSubmitEditing={commit} returnKeyType="done" style={[styles.editableTitleInput, large && styles.editableTitleLarge, { color: tokens.text, borderBottomColor: tokens.accent }]} accessibilityLabel={accessibilityLabel} />
  return <Pressable onPress={() => { setDraft(value); editingRef.current = true; setEditing(true); selectionHaptic() }} style={[styles.editableTitle, { borderBottomColor: tokens.textMuted }]} accessibilityRole="button" accessibilityLabel={`Edit ${accessibilityLabel}`} accessibilityHint="Tap to rename"><Text numberOfLines={1} style={[styles.editableTitleText, large && styles.editableTitleTextLarge, { color: tokens.text }]}>{value}</Text></Pressable>
}

function PatternTimelinePreview({ tracks, mainDurationSeconds, onPress }: { tracks: PatternTrack[]; mainDurationSeconds: number; onPress?: () => void }) {
  const { tokens } = useTheme()
  const reducedMotion = useReducedMotion()
  const active = tracks.filter(track => track.enabled)
  return <Pressable disabled={!onPress} onPress={onPress ? () => { tapHaptic(); onPress() } : undefined} hitSlop={onPress ? 6 : undefined} style={({ pressed }) => [styles.timeline, { opacity: pressed && onPress ? 0.7 : 1, transform: [{ scale: pressed && onPress && !reducedMotion ? 0.995 : 1 }] }]} accessibilityRole={onPress ? 'button' : undefined} accessibilityLabel={onPress ? 'Configure sub-bells from cue timeline' : 'One main interval cue preview'} accessibilityHint={onPress ? 'Opens the Sub-bells editor' : undefined}>
    <View style={[styles.timelineLine, { backgroundColor: tokens.border }]} />
    <View style={[styles.timelineBoundary, { left: 0, backgroundColor: tokens.accent }]} />
    <View style={[styles.timelineBoundary, { right: 0, backgroundColor: tokens.accent }]} />
    {active.flatMap((track, trackIndex) => trackSelectedOffsetsSeconds(track).map(offset => {
      return <View key={`${track.id}:${offset}`} style={[styles.timelineCue, { left: `${offset / mainDurationSeconds * 100}%`, top: 8 + trackIndex * 6, backgroundColor: subBellColorValue(track.color, trackIndex) }]} />
    }))}
    <Text style={[styles.timelineStart, { color: tokens.textMuted }]}>0</Text><Text style={[styles.timelineEnd, { color: tokens.textMuted }]}>{formatCompactDurationSeconds(mainDurationSeconds)}</Text>
  </Pressable>
}

function formatClockDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3_600)
  const minutes = Math.floor(seconds % 3_600 / 60)
  const remainder = seconds % 60
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`
    : `${minutes}:${String(remainder).padStart(2, '0')}`
}

const styles = StyleSheet.create({
  screen: { flex: 1 }, content: { width: '100%', maxWidth: 620, alignSelf: 'center', paddingHorizontal: 20, gap: 23 }, modeContent: { gap: 23 },
  modeRow: { flexDirection: 'row', alignItems: 'center', gap: 10 }, eyebrow: { fontSize: 11, fontWeight: '700', letterSpacing: 1.4 }, titleWithHelp: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  pinnedHelp: { position: 'absolute', right: 20, zIndex: 50 },
  modeTabs: { flex: 1 },
  chevron: { width: 22, textAlign: 'center', fontSize: 25, lineHeight: 27, fontWeight: '300' },
  section: { gap: 13 }, sectionValue: { fontFamily: 'JetBrainsMono-Light', fontSize: 31, marginTop: 2 }, headingBlock: { gap: 3 }, subBellBody: { gap: 10 }, trackList: { gap: 0 }, accessPanel: { gap: 4 },
  editableTitle: { alignSelf: 'flex-start', flexShrink: 1, maxWidth: '100%', minHeight: 36, justifyContent: 'center', borderBottomWidth: 1, borderStyle: 'dotted' }, editableTitleText: { flexShrink: 1, fontSize: 17, lineHeight: 24, fontWeight: '700' }, editableTitleTextLarge: { fontSize: 20, lineHeight: 28 }, editableTitleInput: { width: '100%', minWidth: 0, minHeight: 40, borderBottomWidth: 1.5, fontSize: 17, lineHeight: 24, fontWeight: '700', paddingHorizontal: 0, paddingTop: 5, paddingBottom: 6 }, editableTitleLarge: { fontSize: 20, lineHeight: 28, minHeight: 44 },
  helper: { fontSize: 12, lineHeight: 17 }, rowTitle: { fontSize: 14, fontWeight: '700' }, flex: { flex: 1, gap: 3, minWidth: 0 }, settingRow: { flexDirection: 'row', alignItems: 'center', gap: 14 }, chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  actionRow: { minHeight: 54, paddingVertical: 7, flexDirection: 'row', alignItems: 'center', gap: 8 }, actionMain: { flex: 1, minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 8 }, link: { fontSize: 12, fontWeight: '700' }, roundIcon: { width: 38, height: 38, borderWidth: 1.5, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  volumeBlock: { gap: 2 }, volumeControlRow: { minHeight: 42, flexDirection: 'row', alignItems: 'center', gap: 8 }, inlineSlider: { flex: 1, height: 38 }, completionCueControls: { gap: 7, paddingTop: 4 },
  trackSummary: { minHeight: 68, paddingVertical: 11, flexDirection: 'row', alignItems: 'center', gap: 12 }, trackColorDot: { width: 8, height: 8, borderRadius: 4 }, priority: { fontFamily: 'JetBrainsMono-Regular', fontSize: 11 },
  sequenceCard: { paddingVertical: 9 }, sequenceHead: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 9 }, sequenceSummary: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 8 }, sequenceTitleLine: { flexDirection: 'row', alignItems: 'baseline', gap: 8 }, sequenceTitle: { flexShrink: 1 }, sequenceChevron: { width: 22, textAlign: 'center', fontSize: 22, lineHeight: 24, fontWeight: '300' }, stepActions: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, sheetAction: { fontSize: 13, fontWeight: '700' },
  dragging: { zIndex: 20, boxShadow: '0 5px 16px rgba(0,0,0,0.24)' },
  draggingLayer: { zIndex: 20 },
  trackEditorContent: { gap: 14, paddingTop: 3, paddingBottom: 12 }, gridHeading: { gap: 10 }, cueEditor: { gap: 10 }, gridActionRow: { minHeight: 36, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }, inlineActions: { flexDirection: 'row', alignItems: 'center', gap: 14 }, destructive: { fontSize: 12, fontWeight: '700', textAlign: 'center', paddingVertical: 8 },
  timeline: { height: 43, position: 'relative', overflow: 'hidden', paddingHorizontal: 8 }, timelineLine: { position: 'absolute', left: 8, right: 8, top: 17, height: 1 }, timelineBoundary: { position: 'absolute', top: 11, width: 2, height: 13 }, timelineCue: { position: 'absolute', width: 5, height: 5, marginLeft: -2.5, borderRadius: 3 }, timelineStart: { position: 'absolute', left: 7, bottom: 2, fontSize: 8 }, timelineEnd: { position: 'absolute', right: 7, bottom: 2, fontSize: 8 },
  pinnedMixerControl: { gap: 10 }, mixerChannel: { gap: 3, paddingVertical: 6 }, mixerChannelHead: { minHeight: 42, flexDirection: 'row', alignItems: 'center', gap: 9 }, mixerControl: { minHeight: 40, flexDirection: 'row', alignItems: 'center', gap: 8 }, mixerSlider: { flex: 1, height: 38 }, divider: { height: 1 },
  previewMini: { width: 30, height: 30, borderWidth: 1, borderRadius: 15, alignItems: 'center', justifyContent: 'center' }, previewGlyph: { fontSize: 9 },
  mixerButton: { width: 36, height: 36, borderWidth: 1, borderRadius: 18, alignItems: 'center', justifyContent: 'center' }, previewButton: { width: 36, height: 36, borderWidth: 1, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  outline: { alignSelf: 'flex-start', borderWidth: 1.5, borderRadius: 99, paddingHorizontal: 13, paddingVertical: 9 }, bottom: { position: 'absolute', bottom: 0, left: 0, right: 0, paddingHorizontal: 20 }, bottomFade: { position: 'absolute', top: -34, left: 0, right: 0, height: 34 }, start: { width: '100%', maxWidth: 580, minHeight: 54, alignSelf: 'center', borderRadius: 99, paddingVertical: 15, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 9 }, startText: { color: '#fff', fontSize: 14, fontWeight: '800', letterSpacing: 1.1, textTransform: 'uppercase' },
  advancedReveal: { minHeight: 54, alignItems: 'center', justifyContent: 'center', overflow: 'visible' }, advancedRevealPrompt: { alignSelf: 'center' }, advancedRevealPressable: { minHeight: 48, minWidth: 150, alignItems: 'center', justifyContent: 'center', gap: 7, paddingHorizontal: 18 }, advancedRevealIndicator: { width: 54, height: 1, borderRadius: 1 }, advancedRevealTitle: { fontSize: 14, fontWeight: '700' }, advancedSection: { width: '100%', gap: 23, opacity: 1, paddingHorizontal: 0, marginHorizontal: 0 }, hideAdvanced: { minHeight: 48, alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  accessRow: { minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: 12 }, accessAction: { minWidth: 64, minHeight: 40, paddingHorizontal: 12, borderWidth: 1.5, borderRadius: 99, alignItems: 'center', justifyContent: 'center' }, readyPill: { minHeight: 27, paddingHorizontal: 9, borderRadius: 99, alignItems: 'center', justifyContent: 'center' }, readyMark: { fontSize: 8, fontWeight: '900', letterSpacing: 0.9 }, checkingMark: { width: 36, textAlign: 'center', fontSize: 10, letterSpacing: 1 },
})
