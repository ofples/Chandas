import { useCallback, useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Alert, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import Slider from '@react-native-community/slider'
import * as Haptics from 'expo-haptics'
import Reanimated, { FadeIn, FadeInDown, FadeOut, LinearTransition, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type { CueSettings, PatternTrack, SoundRef, TimerV2State } from '../types'
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
import { TimerHelpSheet } from '../components/timer-v2/TimerHelpSheet'
import { SoundName } from '../components/timer-v2/SoundName'
import { RunLengthConfig } from '../components/timer-v2/run-length-config'
import { ScheduleConfig } from '../components/timer-v2/schedule-config'
import { ScheduleTimelinePreview } from '../components/timer-v2/ScheduleTimelinePreview'
import { SegmentedControl } from '../components/timer-v2/SegmentedControl'
import {
  addPatternTrack, addSequenceStep, chooseProgramMode, duplicateSequenceStep, patchPatternTrack, patchSequenceStep,
  removePatternTrack, removeSequenceStep, reorderSequenceSteps, setPatternSubBellsEnabled,
  setTrackCadence, setTrackOffsets, updatePattern, updatePatternMainMinutes,
} from '../lib/programActions'
import { soundTitle } from '../lib/soundLibrary'
import { validOffsets } from '../lib/timerV2'
import { useTheme } from '../theme/ThemeContext'
import { useSoundAvailability } from '../hooks/use-sound-availability'
import { ChandasTimerService } from '../native/ChandasTimerService'
import { GentleNotice, type AppNotice } from '../components/timer-v2/experience-feedback'
import { hasAvailableTime } from '../lib/activeHours'
import { MixerIcon } from '../components/Icons'
import { edgeAutoScrollStep, previewIndexForItem, previewOffsetForItem, type ReorderPreview } from '../lib/reorder-preview'

const MAIN_PRESETS = [5, 10, 15, 30, 45, 60] as const
const STEP_PRESETS = [5, 15, 25] as const
const CADENCE_PRESETS = [1, 2, 5] as const
const MODE_CHOICES = [{ value: 'pattern', label: 'Cycle' }, { value: 'sequence', label: 'Sequence' }] as const

type CueTarget = { kind: 'main' } | { kind: 'track'; id: string } | { kind: 'step'; id: string }

interface Props {
  state: TimerV2State
  onChange: (state: TimerV2State) => void
  onStart: () => void
  starting: boolean
  focusState: NativeFocusState
  onFocusAutomationChange: (enabled: boolean) => void
  onOpenFocusSettings: () => void
  onOpenFocusRuleSettings: () => void
  androidAccess: { exactAlarms: boolean; callMute: boolean; notifications: boolean; checking: boolean; pending: 'call-mute' | 'notifications' | null }
  onOpenExactAlarmSettings: () => void
  onRequestCallMuteAccess: () => void
  onRequestNotificationAccess: () => void
  onFeedback: (notice: Omit<AppNotice, 'id'>) => void
}

export function TimerV2ConfigScreen({ state, onChange, onStart, starting, focusState, onFocusAutomationChange, onOpenFocusSettings, onOpenFocusRuleSettings, androidAccess, onOpenExactAlarmSettings, onRequestCallMuteAccess, onRequestNotificationAccess, onFeedback }: Props) {
  const { tokens } = useTheme()
  const insets = useSafeAreaInsets()
  const [cueTarget, setCueTarget] = useState<CueTarget | null>(null)
  const [trackId, setTrackId] = useState<string | null>(null)
  const [subBellsOpen, setSubBellsOpen] = useState(false)
  const [presetsOpen, setPresetsOpen] = useState(false)
  const [mixerOpen, setMixerOpen] = useState(false)
  const [scheduleOpen, setScheduleOpen] = useState(false)
  const [systemAccessOpen, setSystemAccessOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [sequenceReordering, setSequenceReordering] = useState(false)
  const scrollRef = useRef<ScrollView>(null)
  const scrollOffsetRef = useRef(0)
  const scrollContentHeightRef = useRef(0)
  const scrollViewportRef = useRef({ top: 0, height: 0 })
  const reducedMotion = useReducedMotion()
  const program = state.workingPrograms[state.workingPrograms.selectedMode]
  const settings = state.settings

  const changeSettings = (patch: Partial<typeof settings>) => onChange({ ...state, settings: { ...settings, ...patch } })
  const cue = cueTarget ? cueForTarget(state, cueTarget) : null
  const cueTitle = cueTarget?.kind === 'main' ? 'Main gong' : cueTarget?.kind === 'track' ? 'Sub-bell sound' : cueTarget?.kind === 'step' ? 'Step sound' : ''
  const patchCue = (patch: Partial<CueSettings>) => {
    if (!cueTarget) return
    if (cueTarget.kind === 'main') onChange(updatePattern(state, value => ({ ...value, mainCue: { ...value.mainCue, ...patch } })))
    else if (cueTarget.kind === 'track') onChange(patchPatternTrack(state, cueTarget.id, patch))
    else onChange(patchSequenceStep(state, cueTarget.id, patch))
  }
  const addTrack = () => { void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined); onChange(addPatternTrack(state)) }
  const addStep = () => { void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined); onChange(addSequenceStep(state)) }
  const validToStart = program.runPolicy.kind !== 'continuous' || hasAvailableTime(settings.availability)
  const exactTimingNeedsSetup = Platform.OS === 'android' && !androidAccess.checking && !androidAccess.exactAlarms
  const selectMode = (mode: 'pattern' | 'sequence') => {
    if (state.workingPrograms.selectedMode === mode) return
    void Haptics.selectionAsync().catch(() => undefined)
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
    <View style={[styles.screen, { backgroundColor: tokens.bg }]}>
      <ScrollView ref={scrollRef} scrollEnabled={!sequenceReordering} onLayout={event => { scrollViewportRef.current = { top: event.nativeEvent.layout.y, height: event.nativeEvent.layout.height } }} onContentSizeChange={(_width, height) => { scrollContentHeightRef.current = height }} onScroll={event => { scrollOffsetRef.current = event.nativeEvent.contentOffset.y }} scrollEventThrottle={16} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={[styles.content, { paddingTop: insets.top + 22, paddingBottom: insets.bottom + 116 }]}>
        <View style={styles.modeRow}>
          <SegmentedControl items={MODE_CHOICES} value={state.workingPrograms.selectedMode} onChange={selectMode} accessibilityLabel="Timer mode" style={styles.modeTabs} />
          <Pressable hitSlop={4} onPress={() => setHelpOpen(true)} style={[styles.question, { borderColor: tokens.border }]} accessibilityRole="button" accessibilityLabel="Timer help"><Text style={[styles.questionText, { color: tokens.accent }]}>?</Text></Pressable>
        </View>

        <Reanimated.View key={program.mode} entering={FadeIn.duration(reducedMotion ? 80 : 180)} exiting={FadeOut.duration(reducedMotion ? 70 : 120)} style={styles.modeContent}>
          {program.mode === 'pattern' ? <PatternEditor state={state} onChange={onChange} onOpenSubBells={() => setSubBellsOpen(true)} /> : <SequenceEditor state={state} onChange={onChange} onEditCue={setCueTarget} onAdd={addStep} onReorderingChange={handleSequenceReordering} onAutoScroll={autoScrollSequence} />}
        </Reanimated.View>

        <View style={styles.section}>
          <Text style={[styles.eyebrow, { color: tokens.textMuted }]}>SOUND</Text>
          <VolumeControl label="Volume" value={settings.masterVolume} onChange={masterVolume => changeSettings({ masterVolume })} onOpenMixer={() => setMixerOpen(true)} />
          {program.mode === 'pattern' ? <CueRow title="Main gong" detail={soundTitle(program.mainCue.sound)} sound={program.mainCue.sound} onPress={() => setCueTarget({ kind: 'main' })} /> : null}
        </View>

        {program.runPolicy.kind === 'continuous' ? <View style={styles.section}>
          <View style={styles.settingRow}><Text style={[styles.eyebrow, styles.flex, { color: tokens.textMuted }]}>SCHEDULE</Text><Toggle value={settings.availability.enabled} onChange={enabled => changeSettings({ availability: { ...settings.availability, enabled } })} accessibilityLabel="Timer schedule" /></View>
          {settings.availability.enabled ? <Reanimated.View entering={FadeInDown.duration(reducedMotion ? 80 : 160)} exiting={FadeOut.duration(reducedMotion ? 70 : 110)}><ScheduleTimelinePreview value={settings.availability} onPress={() => setScheduleOpen(true)} /></Reanimated.View> : null}
        </View> : null}

        <ActionRow title="Configurations" detail={state.workingPrograms.sourcePreset?.deleted ? 'Working copy · source removed' : state.workingPrograms.sourcePreset ? `Loaded from ${state.workingPrograms.sourcePreset.name}` : 'Working copy'} onPress={() => setPresetsOpen(true)} accessibilityLabel="Open saved configurations" />

        {Platform.OS === 'android' ? <FocusControl state={focusState} enabled={settings.focusAutomationEnabled} onChange={onFocusAutomationChange} onResume={() => { onFocusAutomationChange(false); onFocusAutomationChange(true) }} onOpenAccessSettings={onOpenFocusSettings} onOpenRuleSettings={onOpenFocusRuleSettings} /> : null}

        {Platform.OS === 'android' ? <ActionRow title="Android access" detail={androidAccessSummary(androidAccess)} onPress={() => setSystemAccessOpen(true)} /> : null}
      </ScrollView>

      <View style={[styles.bottom, { backgroundColor: tokens.bg, paddingBottom: insets.bottom + 16 }]}>
        <Pressable disabled={!validToStart || starting} onPress={onStart} style={({ pressed }) => [styles.start, { backgroundColor: tokens.accent, opacity: !validToStart || starting ? 0.48 : pressed ? 0.76 : 1, transform: [{ scale: pressed && !starting && !reducedMotion ? 0.985 : 1 }] }]} accessibilityRole="button" accessibilityState={{ disabled: !validToStart || starting, busy: starting }}>
          {starting ? <ActivityIndicator color="#fff" size="small" /> : null}
          <Text style={styles.startText}>{starting ? 'Anchoring timer…' : !validToStart ? 'Add an active time' : exactTimingNeedsSetup ? 'Set up exact timing' : 'Start timer'}</Text>
        </Pressable>
      </View>

      <SubBellLibrarySheet visible={subBellsOpen && !trackId && !cue} state={state} onChange={onChange} onEditTrack={setTrackId} onAdd={addTrack} onClose={() => setSubBellsOpen(false)} />
      {trackId ? <TrackEditorSheet visible={subBellsOpen && !cue} state={state} trackId={trackId} onChange={onChange} onEditCue={() => setCueTarget({ kind: 'track', id: trackId })} onBack={() => setTrackId(null)} onClose={() => { setTrackId(null); setSubBellsOpen(false) }} /> : null}
      {cue ? <SoundPickerSheet visible title={cueTitle} cue={cue} masterVolume={settings.masterVolume} onChange={patchCue} onClose={() => setCueTarget(null)} onFeedback={onFeedback} /> : null}
      <MixerSheet visible={mixerOpen} state={state} onChange={onChange} onEditCue={target => { setMixerOpen(false); setCueTarget(target) }} onClose={() => setMixerOpen(false)} onFeedback={onFeedback} />
      <BottomSheet visible={scheduleOpen} title="Schedule" onClose={() => setScheduleOpen(false)}><ScheduleConfig showHeading={false} showEnabledControl={false} value={settings.availability} onChange={availability => changeSettings({ availability })} /></BottomSheet>
      {Platform.OS === 'android' ? <BottomSheet visible={systemAccessOpen} eyebrow="ANDROID" title="System access" onClose={() => setSystemAccessOpen(false)}><SystemAccessPanel access={androidAccess} onOpenExactAlarmSettings={onOpenExactAlarmSettings} onRequestCallMuteAccess={onRequestCallMuteAccess} onRequestNotificationAccess={onRequestNotificationAccess} /></BottomSheet> : null}
      <PresetLibrarySheet visible={presetsOpen} state={state} onChange={onChange} onClose={() => setPresetsOpen(false)} onFeedback={onFeedback} />
      <TimerHelpSheet visible={helpOpen} onClose={() => setHelpOpen(false)} onOpenFocusSettings={onOpenFocusSettings} />
    </View>
  )
}

function SystemAccessPanel({ access, onOpenExactAlarmSettings, onRequestCallMuteAccess, onRequestNotificationAccess }: { access: Props['androidAccess']; onOpenExactAlarmSettings: () => void; onRequestCallMuteAccess: () => void; onRequestNotificationAccess: () => void }) {
  const { tokens } = useTheme()
  const row = (key: NonNullable<Props['androidAccess']['pending']> | 'exact', label: string, detail: string, ready: boolean, action: string, onPress: () => void, required = false) => {
    const pending = access.pending === key
    const status = access.checking ? 'Checking…' : ready ? 'Ready' : required ? 'Needed to start' : 'Optional · not enabled'
    return <Reanimated.View layout={LinearTransition.duration(150)} style={styles.accessRow}><View style={styles.flex}><Text style={[styles.rowTitle, { color: tokens.text }]}>{label}</Text><Text style={[styles.helper, { color: ready || access.checking ? tokens.textMuted : required ? tokens.warm : tokens.textMuted }]}>{status} · {detail}</Text></View>{pending ? <ActivityIndicator color={tokens.accent} size="small" /> : access.checking ? <Text style={[styles.checkingMark, { color: tokens.textDisabled }]}>•••</Text> : !ready ? <Pressable onPress={onPress} style={[styles.accessAction, { borderColor: required ? tokens.warm : tokens.accent }]} accessibilityRole="button" accessibilityLabel={`${action} ${label} settings`}><Text style={[styles.link, { color: required ? tokens.warm : tokens.accent }]}>{action}</Text></Pressable> : <View style={[styles.readyPill, { backgroundColor: tokens.positiveGlow }]}><Text style={[styles.readyMark, { color: tokens.positive }]}>READY</Text></View>}</Reanimated.View>
  }
  return <View style={styles.accessPanel}>{row('exact', 'Exact timing', 'precise with the screen off', access.exactAlarms, 'Set up', onOpenExactAlarmSettings, true)}<View style={[styles.divider, { backgroundColor: tokens.border }]} />{row('call-mute', 'Mute during calls', 'optional', access.callMute, 'Allow', onRequestCallMuteAccess)}<View style={[styles.divider, { backgroundColor: tokens.border }]} />{row('notifications', 'Timer notifications', 'optional', access.notifications, 'Allow', onRequestNotificationAccess)}</View>
}

function androidAccessSummary(access: Props['androidAccess']): string {
  if (access.checking) return 'Checking permissions…'
  if (!access.exactAlarms) return 'Exact timing needs setup'
  const optionalMissing = Number(!access.callMute) + Number(!access.notifications)
  return optionalMissing === 0 ? 'Ready' : `${optionalMissing} optional ${optionalMissing === 1 ? 'permission' : 'permissions'} available`
}

function ProgramRunLength({ state, mode, onChange }: { state: TimerV2State; mode: 'pattern' | 'sequence'; onChange: (state: TimerV2State) => void }) {
  if (mode === 'pattern') {
    const program = state.workingPrograms.pattern
    return <RunLengthConfig mode="pattern" value={program.runPolicy} cycleDurationSeconds={program.mainMinutes * 60} onChange={runPolicy => onChange(updatePattern(state, value => ({ ...value, runPolicy })))} />
  }
  const program = state.workingPrograms.sequence
  return <RunLengthConfig mode="sequence" value={program.runPolicy} cycleDurationSeconds={program.steps.reduce((sum, step) => sum + step.durationMinutes, 0) * 60} onChange={runPolicy => onChange({ ...state, workingPrograms: { ...state.workingPrograms, sequence: { ...program, runPolicy } } })} />
}

function PatternEditor({ state, onChange, onOpenSubBells }: { state: TimerV2State; onChange: (state: TimerV2State) => void; onOpenSubBells: () => void }) {
  const { tokens } = useTheme()
  const program = state.workingPrograms.pattern
  const snapOffset = program.alignment.kind === 'local-clock' ? program.alignment.offsetMinutes : 0
  const activeTracks = program.tracks.filter(track => track.enabled)
  const cueCount = activeTracks.reduce((count, track) => count + track.selectedOffsetsMinutes.length, 0)
  return <>
    <View style={styles.section}>
      <View style={styles.headingBlock}><Text style={[styles.eyebrow, { color: tokens.textMuted }]}>MAIN INTERVAL</Text><Text style={[styles.fixedTitle, { color: tokens.text }]}>Main interval</Text></View>
      <DurationSelector value={program.mainMinutes} presets={MAIN_PRESETS} fadeColor={tokens.bg} onChange={minutes => changeMainMinutes(state, minutes, onChange)} />
      <ProgramRunLength state={state} mode="pattern" onChange={onChange} />
      <View style={styles.settingRow}><Text style={[styles.eyebrow, styles.flex, { color: tokens.textMuted }]}>ALIGN TO CLOCK</Text><Toggle value={program.alignment.kind === 'local-clock'} onChange={enabled => onChange(updatePattern(state, value => ({ ...value, alignment: enabled ? { kind: 'local-clock', offsetMinutes: 0 } : { kind: 'elapsed' } })))} accessibilityLabel="Align pattern to clock" /></View>
      {program.alignment.kind === 'local-clock' ? <ClockSnapSelector mainMinutes={program.mainMinutes} value={snapOffset} compact fadeColor={tokens.bg} onChange={offsetMinutes => onChange(updatePattern(state, value => ({ ...value, alignment: { kind: 'local-clock', offsetMinutes } })))} /> : null}
    </View>

    <View style={styles.section}>
      <View style={styles.settingRow}><Text style={[styles.eyebrow, styles.flex, { color: tokens.textMuted }]}>SUB-BELLS</Text><Toggle value={program.subBellsEnabled} onChange={enabled => onChange(setPatternSubBellsEnabled(state, enabled))} accessibilityLabel="Sub-bells" /></View>
      {program.subBellsEnabled ? <Reanimated.View entering={FadeInDown.duration(180)} exiting={FadeOut.duration(120)} style={styles.subBellBody}>
        <PatternTimelinePreview tracks={program.tracks} mainMinutes={program.mainMinutes} onPress={onOpenSubBells} />
        <ActionRow title="Configure sub-bells" detail={program.tracks.length === 0 ? 'No sub-bells yet' : `${activeTracks.length} active · ${cueCount} selected ${cueCount === 1 ? 'cue' : 'cues'}`} onPress={onOpenSubBells} />
      </Reanimated.View> : null}
    </View>
  </>
}

function SequenceEditor({ state, onChange, onEditCue, onAdd, onReorderingChange, onAutoScroll }: { state: TimerV2State; onChange: (state: TimerV2State) => void; onEditCue: (target: CueTarget) => void; onAdd: () => void; onReorderingChange: (active: boolean) => void; onAutoScroll: (pageY: number, canMoveEarlier: boolean, canMoveLater: boolean) => number }) {
  const { tokens } = useTheme()
  const [editingStepId, setEditingStepId] = useState<string | null>(null)
  const [dragPreview, setDragPreview] = useState<ReorderPreview | null>(null)
  const program = state.workingPrograms.sequence
  const total = program.steps.reduce((sum, step) => sum + step.durationMinutes, 0)
  const previewStep = useCallback((stepId: string, from: number, to: number, rowHeight: number) => setDragPreview({ stepId, from, to, rowHeight }), [])
  const finishPreview = useCallback(() => setDragPreview(null), [])
  const moveStep = useCallback((from: number, to: number) => onChange(reorderSequenceSteps(state, from, to)), [onChange, state])
  useEffect(() => () => onReorderingChange(false), [onReorderingChange])
  return <View style={styles.section}>
    <View><Text style={[styles.eyebrow, { color: tokens.textMuted }]}>SEQUENCE</Text><Text style={[styles.sectionValue, { color: tokens.text }]}>{formatMinutes(total)}</Text><Text style={[styles.helper, { color: tokens.textMuted }]}>{program.steps.length} step{program.steps.length === 1 ? '' : 's'} · repeats</Text></View>
    {program.steps.map((step, index) => <SequenceStepRow key={step.id} state={state} stepId={step.id} index={index} dragPreview={dragPreview} onEdit={() => setEditingStepId(step.id)} onMove={moveStep} onPreviewChange={previewStep} onPreviewEnd={finishPreview} onReorderingChange={onReorderingChange} onAutoScroll={onAutoScroll} />)}
    {program.steps.length < 20 ? <AddRowButton onPress={onAdd} title="+ Add step" /> : null}
    <ProgramRunLength state={state} mode="sequence" onChange={onChange} />
    {editingStepId ? <SequenceStepEditorSheet state={state} stepId={editingStepId} onChange={onChange} onEditCue={() => onEditCue({ kind: 'step', id: editingStepId })} onClose={() => setEditingStepId(null)} /> : null}
  </View>
}

function SubBellLibrarySheet({ visible, state, onChange, onEditTrack, onAdd, onClose }: { visible: boolean; state: TimerV2State; onChange: (state: TimerV2State) => void; onEditTrack: (id: string) => void; onAdd: () => void; onClose: () => void }) {
  const { tokens } = useTheme()
  const program = state.workingPrograms.pattern
  const activeTracks = program.tracks.filter(track => track.enabled)
  const cueCount = activeTracks.reduce((count, track) => count + track.selectedOffsetsMinutes.length, 0)
  return <BottomSheet visible={visible} eyebrow="CYCLE" title="Sub-bells" onClose={onClose}>
    <View style={styles.settingRow}><View style={styles.flex}><Text style={[styles.rowTitle, { color: tokens.text }]}>Sub-bells</Text><Text style={[styles.helper, { color: tokens.textMuted }]}>{program.subBellsEnabled ? `${activeTracks.length} active · ${cueCount} selected ${cueCount === 1 ? 'cue' : 'cues'}` : 'Off · settings preserved'}</Text></View><Toggle value={program.subBellsEnabled} onChange={enabled => onChange(setPatternSubBellsEnabled(state, enabled))} accessibilityLabel="Sub-bells" /></View>
    <PatternTimelinePreview tracks={program.subBellsEnabled ? program.tracks : []} mainMinutes={program.mainMinutes} />
    {program.tracks.length === 0 ? <GentleNotice title="No sub-bells yet" message="Add one when you want an extra cue within the main interval." /> : program.subBellsEnabled && cueCount === 0 ? <GentleNotice title="No sub-bell cues are active" message="The main gong will still play. Open a sub-bell to choose its cue positions." /> : null}
    <View style={styles.trackList}>{program.tracks.map((track, index) => <PatternTrackRow key={track.id} state={state} track={track} index={index} onChange={onChange} onEdit={() => onEditTrack(track.id)} />)}</View>
    <AddRowButton disabled={program.tracks.length >= 5} onPress={onAdd} title={program.tracks.length >= 5 ? '5 sub-bell limit reached' : '+ Add sub-bell'} />
  </BottomSheet>
}

function PatternTrackRow({ state, track, index, onChange, onEdit }: { state: TimerV2State; track: PatternTrack; index: number; onChange: (state: TimerV2State) => void; onEdit: () => void }) {
  const { tokens } = useTheme()
  const reducedMotion = useReducedMotion()
  const occurrenceCount = validOffsets(state.workingPrograms.pattern.mainMinutes, track.cadenceMinutes).length
  const selectionSummary = track.selectedOffsetsMinutes.length === occurrenceCount ? `${occurrenceCount} occurrence${occurrenceCount === 1 ? '' : 's'}` : `${track.selectedOffsetsMinutes.length}/${occurrenceCount} selected`
  return <Reanimated.View entering={reducedMotion ? FadeIn.duration(80) : FadeInDown.duration(190)} exiting={FadeOut.duration(reducedMotion ? 70 : 130)} layout={reducedMotion ? undefined : LinearTransition.duration(160)}>
    <View style={[styles.trackSummary, index > 0 && { borderTopColor: tokens.border, borderTopWidth: StyleSheet.hairlineWidth }, { opacity: track.enabled ? 1 : 0.5 }]}>
      <Pressable style={styles.flex} onPress={onEdit} accessibilityRole="button" accessibilityLabel={`Edit ${track.label}`}><Text numberOfLines={1} style={[styles.rowTitle, { color: tokens.text }]}>{track.label}</Text><Text numberOfLines={1} style={[styles.helper, { color: tokens.textMuted }]}>Every {track.cadenceMinutes}m · {soundTitle(track.sound)} · {selectionSummary}</Text></Pressable>
      <Toggle value={track.enabled} onChange={enabled => onChange(patchPatternTrack(state, track.id, { enabled }))} accessibilityLabel={`Enable ${track.label}`} />
    </View>
  </Reanimated.View>
}

function SequenceStepRow({ state, stepId, index, dragPreview, onEdit, onMove, onPreviewChange, onPreviewEnd, onReorderingChange, onAutoScroll }: { state: TimerV2State; stepId: string; index: number; dragPreview: ReorderPreview | null; onEdit: () => void; onMove: (from: number, to: number) => void; onPreviewChange: (stepId: string, from: number, to: number, rowHeight: number) => void; onPreviewEnd: () => void; onReorderingChange: (active: boolean) => void; onAutoScroll: (pageY: number, canMoveEarlier: boolean, canMoveLater: boolean) => number }) {
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
  const rowAnimatedStyle = useAnimatedStyle(() => ({ transform: [{ translateY: dragTranslation.value + previewTranslation.value }, { scale: dragging && !reducedMotion ? 1.015 : 1 }] }), [dragging, reducedMotion])
  const handlePreviewChange = useCallback((from: number, to: number, height: number) => onPreviewChange(stepId, from, to, height), [onPreviewChange, stepId])
  const handleDragStateChange = useCallback((active: boolean) => { setDragging(active); onReorderingChange(active) }, [onReorderingChange])
  if (!step) return null
  return <Reanimated.View entering={reducedMotion ? FadeIn.duration(80) : FadeInDown.duration(190)} exiting={FadeOut.duration(reducedMotion ? 70 : 130)} layout={reducedMotion ? undefined : LinearTransition.duration(160)} style={dragging ? styles.draggingLayer : undefined}>
    <Reanimated.View onLayout={event => { if (!dragging) setRowHeight(event.nativeEvent.layout.height + 13) }} style={[styles.sequenceCard, index > 0 && { borderTopColor: tokens.border, borderTopWidth: StyleSheet.hairlineWidth }, dragging && styles.dragging, { opacity: dragging ? 0.92 : 1 }, rowAnimatedStyle]}>
      <View style={styles.sequenceHead}><ReorderHandle index={index} itemCount={program.steps.length} rowHeight={rowHeight} rowTranslation={dragTranslation} onDragStateChange={handleDragStateChange} onPreviewChange={handlePreviewChange} onPreviewEnd={onPreviewEnd} onAutoScroll={onAutoScroll} onMove={onMove} label={`Reorder ${step.label}`} /><Text style={[styles.priority, { color: tokens.accent }]}>{String(previewIndex + 1).padStart(2, '0')}</Text><Pressable style={styles.sequenceSummary} onPress={onEdit} accessibilityRole="button" accessibilityLabel={`Edit ${step.label}`}><View style={styles.flex}><Text numberOfLines={1} style={[styles.rowTitle, { color: tokens.text }]}>{step.label}</Text><Text numberOfLines={1} style={[styles.helper, { color: tokens.textMuted }]}>{step.durationMinutes}m · {soundTitle(step.sound)} · {Math.round(step.volume * 100)}%</Text></View><Text style={[styles.sequenceChevron, { color: tokens.accent }]}>›</Text></Pressable></View>
    </Reanimated.View>
  </Reanimated.View>
}

function SequenceStepEditorSheet({ state, stepId, onChange, onEditCue, onClose }: { state: TimerV2State; stepId: string; onChange: (state: TimerV2State) => void; onEditCue: () => void; onClose: () => void }) {
  const { tokens } = useTheme()
  const program = state.workingPrograms.sequence
  const index = program.steps.findIndex(step => step.id === stepId)
  const step = program.steps[index]
  if (!step) return null
  return <BottomSheet visible eyebrow={`STEP ${index + 1} OF ${program.steps.length}`} title={<EditableTitle value={step.label} onCommit={label => onChange(patchSequenceStep(state, step.id, { label }))} accessibilityLabel={`Step ${index + 1} name`} large />} accessibilityTitle={step.label} onClose={onClose}>
    <DurationSelector value={step.durationMinutes} presets={STEP_PRESETS} onChange={durationMinutes => onChange(patchSequenceStep(state, step.id, { durationMinutes }))} />
    <VolumeControl label="Volume" value={step.volume} onChange={volume => onChange(patchSequenceStep(state, step.id, { volume }))} />
    <CueRow title="Sound" detail={soundTitle(step.sound)} sound={step.sound} onPress={onEditCue} />
    <View style={styles.stepActions}><Pressable hitSlop={10} disabled={program.steps.length >= 20} onPress={() => { onChange(duplicateSequenceStep(state, step.id)); onClose() }} accessibilityRole="button" accessibilityLabel={`Duplicate ${step.label}`}><Text style={[styles.sheetAction, { color: tokens.accent, opacity: program.steps.length >= 20 ? 0.35 : 1 }]}>Duplicate step</Text></Pressable>{program.steps.length > 1 ? <Pressable hitSlop={10} onPress={() => removeSequenceStepWithConfirmation(state, step.id, index, next => { onChange(next); onClose() })} accessibilityRole="button" accessibilityLabel={`Remove ${step.label}`}><Text style={[styles.sheetAction, { color: tokens.accent }]}>Remove step</Text></Pressable> : null}</View>
  </BottomSheet>
}

function TrackEditorSheet({ visible, state, trackId, onChange, onEditCue, onBack, onClose }: { visible: boolean; state: TimerV2State; trackId: string; onChange: (state: TimerV2State) => void; onEditCue: () => void; onBack: () => void; onClose: () => void }) {
  const { tokens } = useTheme()
  const program = state.workingPrograms.pattern
  const track = program.tracks.find(value => value.id === trackId)
  if (!track) return null
  const offsets = validOffsets(program.mainMinutes, track.cadenceMinutes)
  const index = program.tracks.findIndex(value => value.id === trackId)
  return <BottomSheet visible={visible} eyebrow={`SUB-BELL ${index + 1}${track.enabled ? '' : ' · OFF'}`} title={<EditableTitle value={track.label} onCommit={label => onChange(patchPatternTrack(state, track.id, { label }))} accessibilityLabel={`Sub-bell ${index + 1} name`} large />} accessibilityTitle={track.label} onBack={onBack} onClose={onClose}>
    <View style={styles.settingRow}><Text style={[styles.rowTitle, styles.flex, { color: tokens.text }]}>Enabled</Text><Toggle value={track.enabled} onChange={enabled => onChange(patchPatternTrack(state, track.id, { enabled }))} accessibilityLabel="Enable sub-bell" /></View>
    <DurationSelector value={track.cadenceMinutes} presets={CADENCE_PRESETS} min={1} max={240} onChange={minutes => onChange(setTrackCadence(state, track.id, minutes))} label="REPEAT EVERY" />
    <VolumeControl label="Volume" value={track.volume} onChange={volume => onChange(patchPatternTrack(state, track.id, { volume }))} />
    <CueRow title="Sound" detail={soundTitle(track.sound)} sound={track.sound} onPress={onEditCue} />
    <View style={styles.gridHeading}><View style={styles.flex}><Text style={[styles.rowTitle, { color: tokens.text }]}>Bell times</Text><Text style={[styles.helper, { color: tokens.textMuted }]}>Minutes after the main gong. Tap or drag.</Text></View><View style={styles.inlineActions}><Pressable onPress={() => onChange(setTrackOffsets(state, track.id, []))} accessibilityRole="button"><Text style={[styles.link, { color: tokens.accent }]}>Clear all</Text></Pressable><Pressable onPress={() => onChange(setTrackOffsets(state, track.id, offsets))} accessibilityRole="button"><Text style={[styles.link, { color: tokens.accent }]}>Select all</Text></Pressable></View></View>
    <OffsetGrid offsets={offsets} selected={track.selectedOffsetsMinutes} onChange={selectedOffsetsMinutes => onChange(setTrackOffsets(state, track.id, selectedOffsetsMinutes))} />
    {offsets.length === 0 ? <GentleNotice title="No bell times fit" message="Choose a shorter repeat interval or a longer main interval." /> : track.selectedOffsetsMinutes.length === 0 ? <GentleNotice title="No bell times selected" message="Select at least one time above." /> : null}
    <Pressable onPress={() => confirmRemove('this sub-bell', () => { onChange(removePatternTrack(state, track.id)); onBack() })} accessibilityRole="button"><Text style={[styles.destructive, { color: tokens.accent }]}>Remove sub-bell</Text></Pressable>
  </BottomSheet>
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
  const row = (key: string, title: string, cue: CueSettings, target: CueTarget, patch: (volume: number) => TimerV2State) => <View key={key} style={styles.mixerRow}><Pressable style={styles.mixerLabel} onPress={() => onEditCue(target)} accessibilityRole="button" accessibilityLabel={`Edit ${title} sound`}><Text numberOfLines={1} style={[styles.rowTitle, { color: tokens.text }]}>{title}</Text><SoundName sound={cue.sound} style={styles.helper} /></Pressable><Pressable hitSlop={7} onPress={() => void preview(title, cue)} style={[styles.previewMini, { borderColor: tokens.border }]} accessibilityRole="button" accessibilityLabel={`Preview ${title}`}><Text style={[styles.previewGlyph, { color: tokens.accent }]}>▶</Text></Pressable><Slider style={styles.mixerSlider} minimumValue={0} maximumValue={1} step={0.05} value={cue.volume} onValueChange={volume => onChange(patch(volume))} minimumTrackTintColor={tokens.accent} maximumTrackTintColor={tokens.surfaceHi} thumbTintColor={tokens.accent} accessibilityLabel={`${title} volume`} accessibilityValue={{ min: 0, max: 100, now: Math.round(cue.volume * 100), text: `${Math.round(cue.volume * 100)} percent` }} /><Text style={[styles.volumeValue, { color: tokens.text }]}>{Math.round(cue.volume * 100)}</Text></View>
  const close = () => { ChandasTimerService.stopSoundPreview(); onClose() }
  return <BottomSheet visible={visible} title="Mixer" onClose={close}>
    <View style={styles.mixerRow}><Text style={[styles.rowTitle, styles.mixerLabel, { color: tokens.text }]}>Volume</Text><Slider style={styles.mixerSlider} minimumValue={0} maximumValue={1} step={0.05} value={state.settings.masterVolume} onValueChange={masterVolume => onChange({ ...state, settings: { ...state.settings, masterVolume } })} minimumTrackTintColor={tokens.accent} maximumTrackTintColor={tokens.surfaceHi} thumbTintColor={tokens.accent} accessibilityLabel="Timer volume" accessibilityValue={{ min: 0, max: 100, now: Math.round(state.settings.masterVolume * 100), text: `${Math.round(state.settings.masterVolume * 100)} percent` }} /><Text style={[styles.volumeValue, { color: tokens.text }]}>{Math.round(state.settings.masterVolume * 100)}</Text></View>
    <View style={[styles.divider, { backgroundColor: tokens.border }]} />
    {program.mode === 'pattern' ? <>{row('main', 'Main gong', program.mainCue, { kind: 'main' }, volume => updatePattern(state, value => ({ ...value, mainCue: { ...value.mainCue, volume } })))}{program.tracks.map(track => row(track.id, track.label, track, { kind: 'track', id: track.id }, volume => patchPatternTrack(state, track.id, { volume })))}</> : program.steps.map((step, index) => row(step.id, `${index + 1}. ${step.label}`, step, { kind: 'step', id: step.id }, volume => patchSequenceStep(state, step.id, { volume })))}
  </BottomSheet>
}

function FocusControl({ state, enabled, onChange, onResume, onOpenAccessSettings, onOpenRuleSettings }: { state: NativeFocusState; enabled: boolean; onChange: (enabled: boolean) => void; onResume: () => void; onOpenAccessSettings: () => void; onOpenRuleSettings: () => void }) {
  const { tokens } = useTheme()
  const paused = state.reason === 'paused-by-android'
  const ruleDisabled = state.reason === 'rule-disabled'
  const status = ruleDisabled ? 'Disabled in Android' : !state.policyAccess ? 'Needs DND access' : paused ? 'Paused in Android' : null
  return <View style={styles.section}><View style={styles.settingRow}><View style={styles.flex}><Text style={[styles.eyebrow, { color: tokens.textMuted }]}>CHANDAS FOCUS</Text>{enabled && status ? <Text style={[styles.helper, { color: paused || ruleDisabled ? tokens.warm : tokens.textMuted }]}>{status}</Text> : null}</View><Toggle value={enabled} onChange={onChange} accessibilityLabel="Chandas Focus automation" /></View>{enabled && !state.policyAccess ? <Pressable onPress={onOpenAccessSettings} style={[styles.outline, { borderColor: tokens.accent }]} accessibilityRole="button"><Text style={[styles.link, { color: tokens.accent }]}>Allow DND access</Text></Pressable> : ruleDisabled ? <Pressable onPress={onOpenRuleSettings} style={[styles.outline, { borderColor: tokens.accent }]} accessibilityRole="button"><Text style={[styles.link, { color: tokens.accent }]}>Open Android settings</Text></Pressable> : paused ? <Pressable onPress={onResume} style={[styles.outline, { borderColor: tokens.accent }]} accessibilityRole="button"><Text style={[styles.link, { color: tokens.accent }]}>Resume Focus</Text></Pressable> : null}</View>
}

function ActionRow({ title, detail, onPress, accessibilityLabel }: { title: string; detail: string; onPress: () => void; accessibilityLabel?: string }) {
  const { tokens } = useTheme()
  const reducedMotion = useReducedMotion()
  return <Pressable onPress={onPress} style={({ pressed }) => [styles.actionRow, { opacity: pressed ? 0.68 : 1, transform: [{ scale: pressed && !reducedMotion ? 0.99 : 1 }] }]} accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? title}><View style={styles.flex}><Text numberOfLines={1} style={[styles.rowTitle, { color: tokens.text }]}>{title}</Text><Text numberOfLines={1} style={[styles.helper, { color: tokens.textMuted }]}>{detail}</Text></View><Text style={[styles.chevron, { color: tokens.accent }]}>›</Text></Pressable>
}

function CueRow({ title, detail, sound, onPress }: { title: string; detail: string; sound?: SoundRef; onPress: () => void }) {
  const available = useSoundAvailability(sound ?? { kind: 'builtin', id: 'clear-bell' })
  return <ActionRow title={title} detail={`${detail}${available ? '' : ' · Unavailable'}`} onPress={onPress} accessibilityLabel={`${available ? 'Choose' : 'Replace'} ${title.toLowerCase()}`} />
}

function VolumeControl({ label, value, onChange, onOpenMixer }: { label: string; value: number; onChange: (value: number) => void; onOpenMixer?: () => void }) {
  const { tokens } = useTheme()
  const reducedMotion = useReducedMotion()
  return <View style={styles.volumeBlock}><Text style={[styles.rowTitle, { color: tokens.text }]}>{label}</Text><View style={styles.volumeControlRow}><Slider style={styles.inlineSlider} minimumValue={0} maximumValue={1} step={0.05} value={value} onValueChange={onChange} minimumTrackTintColor={tokens.accent} maximumTrackTintColor={tokens.surfaceHi} thumbTintColor={tokens.accent} accessibilityLabel={label} accessibilityValue={{ min: 0, max: 100, now: Math.round(value * 100), text: `${Math.round(value * 100)} percent` }} />{onOpenMixer ? <Pressable hitSlop={6} onPress={onOpenMixer} accessibilityRole="button" accessibilityLabel="Open mixer" style={({ pressed }) => [styles.mixerButton, { backgroundColor: pressed ? tokens.accentGlow : 'transparent', transform: [{ scale: pressed && !reducedMotion ? 0.92 : 1 }] }]}><MixerIcon color={tokens.accent} /></Pressable> : null}</View></View>
}

function cueForTarget(state: TimerV2State, target: CueTarget): CueSettings | null {
  if (target.kind === 'main') return state.workingPrograms.pattern.mainCue
  if (target.kind === 'track') return state.workingPrograms.pattern.tracks.find(track => track.id === target.id) ?? null
  return state.workingPrograms.sequence.steps.find(step => step.id === target.id) ?? null
}

function changeMainMinutes(state: TimerV2State, minutes: number, onChange: (state: TimerV2State) => void) {
  const nextState = updatePatternMainMinutes(state, minutes)
  const nextByTrack = new Map(nextState.workingPrograms.pattern.tracks.map(track => [track.id, new Set(track.selectedOffsetsMinutes)]))
  const removed = state.workingPrograms.pattern.tracks.reduce((count, track) => count + track.selectedOffsetsMinutes.filter(offset => !nextByTrack.get(track.id)?.has(offset)).length, 0)
  const apply = () => onChange(nextState)
  if (removed === 0 || Platform.OS === 'web') apply()
  else Alert.alert('Shorten main interval?', `${removed} selected cue${removed === 1 ? '' : 's'} outside the new interval will be removed.`, [{ text: 'Cancel', style: 'cancel' }, { text: 'Continue', onPress: apply }])
}

/** A title until tapped, then a focused field; avoids presenting a duplicate form row. */
function EditableTitle({ value, onCommit, accessibilityLabel, large = false }: { value: string; onCommit: (value: string) => void; accessibilityLabel: string; large?: boolean }) {
  const { tokens } = useTheme()
  const [draft, setDraft] = useState(value)
  const [editing, setEditing] = useState(false)
  useEffect(() => setDraft(value), [value])
  const commit = () => { onCommit(draft); setEditing(false) }
  if (editing) return <TextInput autoFocus value={draft} selectTextOnFocus onChangeText={text => setDraft([...text].slice(0, 60).join(''))} onBlur={commit} onSubmitEditing={commit} returnKeyType="done" style={[styles.editableTitleInput, large && styles.editableTitleLarge, { color: tokens.text, borderBottomColor: tokens.accent }]} accessibilityLabel={accessibilityLabel} />
  return <Pressable onPress={() => { setDraft(value); setEditing(true); void Haptics.selectionAsync().catch(() => undefined) }} style={[styles.editableTitle, { borderBottomColor: tokens.border }]} accessibilityRole="button" accessibilityLabel={`Edit ${accessibilityLabel}`} accessibilityHint="Tap to rename"><Text numberOfLines={1} style={[styles.editableTitleText, large && styles.editableTitleTextLarge, { color: tokens.text }]}>{value}</Text></Pressable>
}

function PatternTimelinePreview({ tracks, mainMinutes, onPress }: { tracks: PatternTrack[]; mainMinutes: number; onPress?: () => void }) {
  const { tokens } = useTheme()
  const reducedMotion = useReducedMotion()
  const active = tracks.filter(track => track.enabled)
  return <Pressable disabled={!onPress} onPress={onPress} hitSlop={onPress ? 6 : undefined} style={({ pressed }) => [styles.timeline, { opacity: pressed && onPress ? 0.7 : 1, transform: [{ scale: pressed && onPress && !reducedMotion ? 0.995 : 1 }] }]} accessibilityRole={onPress ? 'button' : undefined} accessibilityLabel={onPress ? 'Configure sub-bells from cue timeline' : 'One main interval cue preview'} accessibilityHint={onPress ? 'Opens the Sub-bells editor' : undefined}>
    <View style={[styles.timelineLine, { backgroundColor: tokens.border }]} />
    <View style={[styles.timelineBoundary, { left: 0, backgroundColor: tokens.accent }]} />
    <View style={[styles.timelineBoundary, { right: 0, backgroundColor: tokens.accent }]} />
    {active.flatMap((track, trackIndex) => track.selectedOffsetsMinutes.map(offset => {
      return <View key={`${track.id}:${offset}`} style={[styles.timelineCue, { left: `${offset / mainMinutes * 100}%`, top: 8 + trackIndex * 6, backgroundColor: tokens.accent, opacity: Math.max(0.45, 1 - trackIndex * 0.12) }]} />
    }))}
    <Text style={[styles.timelineStart, { color: tokens.textMuted }]}>0</Text><Text style={[styles.timelineEnd, { color: tokens.textMuted }]}>{mainMinutes}m</Text>
  </Pressable>
}

function formatMinutes(minutes: number): string {
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return hours > 0 ? `${hours}:${String(rest).padStart(2, '0')}` : `${minutes}:00`
}

function confirmRemove(label: string, remove: () => void) {
  Alert.alert('Remove?', `Remove ${label}?`, [{ text: 'Cancel', style: 'cancel' }, { text: 'Remove', style: 'destructive', onPress: remove }])
}

function removeSequenceStepWithConfirmation(state: TimerV2State, stepId: string, index: number, onChange: (state: TimerV2State) => void) {
  const step = state.workingPrograms.sequence.steps.find(value => value.id === stepId)
  if (!step) return
  const remove = () => onChange(removeSequenceStep(state, stepId))
  const untouched = step.durationMinutes === 5 && step.volume === 0.8 && step.sound.kind === 'builtin' && step.sound.id === 'clear-bell' && step.label === `Step ${index + 1}`
  if (untouched) remove()
  else confirmRemove(step.label, remove)
}

const styles = StyleSheet.create({
  screen: { flex: 1 }, content: { width: '100%', maxWidth: 620, alignSelf: 'center', paddingHorizontal: 20, gap: 23 }, modeContent: { gap: 23 },
  modeRow: { flexDirection: 'row', alignItems: 'center', gap: 10 }, eyebrow: { fontSize: 11, fontWeight: '700', letterSpacing: 1.4 },
  question: { width: 36, height: 36, borderWidth: 1.5, borderRadius: 18, alignItems: 'center', justifyContent: 'center' }, questionText: { fontSize: 17, fontWeight: '800' },
  modeTabs: { flex: 1 },
  chevron: { width: 22, textAlign: 'center', fontSize: 25, lineHeight: 27, fontWeight: '300' },
  section: { gap: 13 }, sectionValue: { fontFamily: 'JetBrainsMono-Light', fontSize: 31, marginTop: 2 }, headingBlock: { gap: 3 }, subBellBody: { gap: 10 }, trackList: { gap: 0 }, accessPanel: { gap: 4 },
  fixedTitle: { fontSize: 17, fontWeight: '700', minHeight: 30, textAlignVertical: 'center' }, editableTitle: { alignSelf: 'flex-start', maxWidth: '100%', minHeight: 34, justifyContent: 'center', borderBottomWidth: StyleSheet.hairlineWidth, borderStyle: 'dotted' }, editableTitleText: { flexShrink: 1, fontSize: 17, fontWeight: '700' }, editableTitleTextLarge: { fontSize: 20 }, editableTitleInput: { alignSelf: 'stretch', minWidth: 180, maxWidth: '100%', borderBottomWidth: 1.5, fontSize: 17, fontWeight: '700', paddingVertical: 4 }, editableTitleLarge: { fontSize: 20 },
  helper: { fontSize: 12, lineHeight: 17 }, rowTitle: { fontSize: 14, fontWeight: '700' }, flex: { flex: 1, gap: 3, minWidth: 0 }, settingRow: { flexDirection: 'row', alignItems: 'center', gap: 14 }, chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  actionRow: { minHeight: 54, paddingVertical: 7, flexDirection: 'row', alignItems: 'center', gap: 12 }, link: { fontSize: 12, fontWeight: '700' },
  volumeBlock: { gap: 2 }, volumeControlRow: { minHeight: 42, flexDirection: 'row', alignItems: 'center', gap: 8 }, inlineSlider: { flex: 1, height: 38 },
  trackSummary: { minHeight: 68, paddingVertical: 11, flexDirection: 'row', alignItems: 'center', gap: 12 }, priority: { fontFamily: 'JetBrainsMono-Regular', fontSize: 11 },
  sequenceCard: { paddingVertical: 9 }, sequenceHead: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 9 }, sequenceSummary: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 8 }, sequenceChevron: { width: 22, textAlign: 'center', fontSize: 22, lineHeight: 24, fontWeight: '300' }, stepActions: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, sheetAction: { fontSize: 13, fontWeight: '700' },
  dragging: { zIndex: 20, boxShadow: '0 5px 16px rgba(0,0,0,0.24)' },
  draggingLayer: { zIndex: 20 },
  gridHeading: { gap: 10 }, inlineActions: { flexDirection: 'row', alignItems: 'center', gap: 14 }, destructive: { fontSize: 12, fontWeight: '700', textAlign: 'center', paddingVertical: 8 },
  timeline: { height: 43, position: 'relative', overflow: 'hidden', paddingHorizontal: 8 }, timelineLine: { position: 'absolute', left: 8, right: 8, top: 17, height: 1 }, timelineBoundary: { position: 'absolute', top: 11, width: 2, height: 13 }, timelineCue: { position: 'absolute', width: 5, height: 5, marginLeft: -2.5, borderRadius: 3 }, timelineStart: { position: 'absolute', left: 7, bottom: 2, fontSize: 8 }, timelineEnd: { position: 'absolute', right: 7, bottom: 2, fontSize: 8 },
  mixerRow: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 9 }, mixerLabel: { width: 118, gap: 2 }, mixerSlider: { flex: 1, height: 34 }, volumeValue: { width: 28, fontFamily: 'JetBrainsMono-Regular', fontSize: 11, textAlign: 'right' }, divider: { height: 1 },
  previewMini: { width: 30, height: 30, borderWidth: 1, borderRadius: 15, alignItems: 'center', justifyContent: 'center' }, previewGlyph: { fontSize: 9 },
  mixerButton: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  outline: { alignSelf: 'flex-start', borderWidth: 1.5, borderRadius: 99, paddingHorizontal: 13, paddingVertical: 9 }, bottom: { position: 'absolute', bottom: 0, left: 0, right: 0, paddingHorizontal: 20 }, start: { width: '100%', maxWidth: 580, minHeight: 54, alignSelf: 'center', borderRadius: 99, paddingVertical: 15, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 9 }, startText: { color: '#fff', fontSize: 14, fontWeight: '800', letterSpacing: 1.1, textTransform: 'uppercase' },
  accessRow: { minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: 12 }, accessAction: { minWidth: 64, minHeight: 40, paddingHorizontal: 12, borderWidth: 1.5, borderRadius: 99, alignItems: 'center', justifyContent: 'center' }, readyPill: { minHeight: 27, paddingHorizontal: 9, borderRadius: 99, alignItems: 'center', justifyContent: 'center' }, readyMark: { fontSize: 8, fontWeight: '900', letterSpacing: 0.9 }, checkingMark: { width: 36, textAlign: 'center', fontSize: 10, letterSpacing: 1 },
})
