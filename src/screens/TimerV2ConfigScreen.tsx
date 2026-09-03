import { type ComponentProps, useEffect, useState } from 'react'
import { ActivityIndicator, Alert, Animated, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import Slider from '@react-native-community/slider'
import * as Haptics from 'expo-haptics'
import Reanimated, { FadeIn, FadeInDown, FadeOut, LinearTransition, useReducedMotion } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type { CueSettings, PatternTrack, SoundRef, TimerV2State } from '../types'
import type { NativeFocusState } from '../native/ChandasTimerService'
import { Chip } from '../components/Chip'
import { CustomMinutePicker } from '../components/CustomMinutePicker'
import { Toggle } from '../components/Toggle'
import { BottomSheet } from '../components/timer-v2/BottomSheet'
import { DurationSelector } from '../components/timer-v2/DurationSelector'
import { OffsetGrid } from '../components/timer-v2/OffsetGrid'
import { PresetLibrarySheet } from '../components/timer-v2/PresetLibrarySheet'
import { ReorderHandle } from '../components/timer-v2/ReorderHandle'
import { SoundPickerSheet } from '../components/timer-v2/SoundPickerSheet'
import { TimerHelpSheet } from '../components/timer-v2/TimerHelpSheet'
import { SoundName } from '../components/timer-v2/SoundName'
import { RunLengthConfig } from '../components/timer-v2/run-length-config'
import { ScheduleConfig } from '../components/timer-v2/schedule-config'
import {
  addPatternTrack, addSequenceStep, chooseProgramMode, duplicateSequenceStep, patchPatternTrack, patchSequenceStep,
  removePatternTrack, removeSequenceStep, reorderPatternTracks, reorderSequenceSteps,
  setTrackCadence, setTrackOffsets, updatePattern, updatePatternMainMinutes,
} from '../lib/programActions'
import { soundTitle } from '../lib/soundLibrary'
import { validOffsets } from '../lib/timerV2'
import { useTheme } from '../theme/ThemeContext'
import { useSoundAvailability } from '../hooks/use-sound-availability'
import { ChandasTimerService } from '../native/ChandasTimerService'
import { GentleNotice, type AppNotice } from '../components/timer-v2/experience-feedback'
import { hasAvailableTime } from '../lib/activeHours'

const MAIN_PRESETS = [10, 15, 30] as const
const STEP_PRESETS = [5, 15, 25] as const
const CADENCE_PRESETS = [1, 2, 5] as const
const SNAP_PRESETS = [0, 10, 15] as const

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
  const [presetsOpen, setPresetsOpen] = useState(false)
  const [mixerOpen, setMixerOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [customSnapOpen, setCustomSnapOpen] = useState(false)
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
  const validToStart = hasAvailableTime(settings.availability)
  const exactTimingNeedsSetup = Platform.OS === 'android' && !androidAccess.checking && !androidAccess.exactAlarms
  const selectMode = (mode: 'pattern' | 'sequence') => {
    if (state.workingPrograms.selectedMode === mode) return
    void Haptics.selectionAsync().catch(() => undefined)
    onChange(chooseProgramMode(state, mode))
  }

  return (
    <View style={[styles.screen, { backgroundColor: tokens.bg }]}>
      <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={[styles.content, { paddingTop: insets.top + 22, paddingBottom: insets.bottom + 116 }]}>
        <View style={styles.header}>
          <View><Text style={[styles.eyebrow, { color: tokens.accent }]}>CHANDAS</Text><Text style={[styles.screenTitle, { color: tokens.text }]}>Interval timer</Text></View>
          <Pressable hitSlop={4} onPress={() => setHelpOpen(true)} style={[styles.question, { borderColor: tokens.border }]} accessibilityRole="button" accessibilityLabel="Timer help"><Text style={[styles.questionText, { color: tokens.accent }]}>?</Text></Pressable>
        </View>

        <View style={[styles.modeTabs, { borderColor: tokens.border }]} accessibilityRole="tablist">
          {([['pattern', 'Main + sub-bells'], ['sequence', 'Sequence / sets']] as const).map(([mode, label]) => <Pressable key={mode} onPress={() => selectMode(mode)} accessibilityRole="tab" accessibilityState={{ selected: state.workingPrograms.selectedMode === mode }} style={({ pressed }) => [styles.modeTab, state.workingPrograms.selectedMode === mode && { backgroundColor: tokens.accent }, { opacity: pressed ? 0.78 : 1, transform: [{ scale: pressed && !reducedMotion ? 0.985 : 1 }] }]}><Text style={[styles.modeTabText, { color: state.workingPrograms.selectedMode === mode ? '#fff' : tokens.textMuted }]}>{label}</Text></Pressable>)}
        </View>

        <Pressable onPress={() => setPresetsOpen(true)} style={({ pressed }) => [styles.summaryBar, { backgroundColor: tokens.surface, borderColor: tokens.border, opacity: pressed ? 0.78 : 1, transform: [{ scale: pressed && !reducedMotion ? 0.99 : 1 }] }]} accessibilityRole="button" accessibilityLabel="Save or load configurations">
          <View style={styles.flex}><Text style={[styles.eyebrow, { color: tokens.textMuted }]}>CONFIGURATION</Text><Text style={[styles.summaryTitle, { color: tokens.text }]}>{state.workingPrograms.sourcePreset?.deleted ? 'Working copy · source deleted' : state.workingPrograms.sourcePreset ? `Loaded from ${state.workingPrograms.sourcePreset.name}` : 'Working copy'}</Text></View>
          <Text style={[styles.link, { color: tokens.accent }]}>Save / load</Text>
        </Pressable>

        <Reanimated.View key={program.mode} entering={FadeIn.duration(reducedMotion ? 80 : 180)} exiting={FadeOut.duration(reducedMotion ? 70 : 120)} style={styles.modeContent}>
          {program.mode === 'pattern' ? <PatternEditor state={state} onChange={onChange} onEditCue={setCueTarget} onEditTrack={setTrackId} onAdd={addTrack} onCustomSnap={() => setCustomSnapOpen(true)} /> : <SequenceEditor state={state} onChange={onChange} onEditCue={setCueTarget} onAdd={addStep} />}
        </Reanimated.View>

        <View style={[styles.sectionCard, { borderColor: tokens.border }]}>
          <RunLengthConfig
            mode={program.mode}
            value={program.runPolicy}
            cycleDurationSeconds={(program.mode === 'pattern' ? program.mainMinutes : program.steps.reduce((sum, step) => sum + step.durationMinutes, 0)) * 60}
            onChange={runPolicy => onChange(program.mode === 'pattern'
              ? updatePattern(state, value => ({ ...value, runPolicy }))
              : { ...state, workingPrograms: { ...state.workingPrograms, sequence: { ...state.workingPrograms.sequence, runPolicy } } })}
          />
        </View>

        <Pressable onPress={() => setMixerOpen(true)} style={({ pressed }) => [styles.summaryBar, { backgroundColor: tokens.surface, borderColor: tokens.border, opacity: pressed ? 0.78 : 1, transform: [{ scale: pressed && !reducedMotion ? 0.99 : 1 }] }]} accessibilityRole="button" accessibilityLabel="Open mixer">
          <View style={styles.flex}><Text style={[styles.eyebrow, { color: tokens.textMuted }]}>MIXER</Text><Text style={[styles.summaryTitle, { color: tokens.text }]}>Master {Math.round(settings.masterVolume * 100)}%</Text><Text style={[styles.helper, { color: tokens.textMuted }]}>Fine-tune every cue in one place</Text></View>
          <Text style={[styles.link, { color: tokens.accent }]}>Mix</Text>
        </Pressable>

        <View style={[styles.sectionCard, { borderColor: tokens.border }]}>
          <ScheduleConfig value={settings.availability} onChange={availability => changeSettings({ availability })} />
        </View>

        {Platform.OS === 'android' ? <SystemAccessCard access={androidAccess} onOpenExactAlarmSettings={onOpenExactAlarmSettings} onRequestCallMuteAccess={onRequestCallMuteAccess} onRequestNotificationAccess={onRequestNotificationAccess} /> : null}

        {Platform.OS === 'android' ? <FocusCard state={focusState} enabled={settings.focusAutomationEnabled} onChange={onFocusAutomationChange} onResume={() => { onFocusAutomationChange(false); onFocusAutomationChange(true) }} onOpenAccessSettings={onOpenFocusSettings} onOpenRuleSettings={onOpenFocusRuleSettings} /> : null}
      </ScrollView>

      <View style={[styles.bottom, { backgroundColor: tokens.bg, paddingBottom: insets.bottom + 16 }]}>
        <Pressable disabled={!validToStart || starting} onPress={onStart} style={({ pressed }) => [styles.start, { backgroundColor: tokens.accent, opacity: !validToStart || starting ? 0.48 : pressed ? 0.76 : 1, transform: [{ scale: pressed && !starting && !reducedMotion ? 0.985 : 1 }] }]} accessibilityRole="button" accessibilityState={{ disabled: !validToStart || starting, busy: starting }}>
          {starting ? <ActivityIndicator color="#fff" size="small" /> : null}
          <Text style={styles.startText}>{starting ? 'Anchoring timer…' : !validToStart ? 'Add an active time' : exactTimingNeedsSetup ? 'Set up exact timing' : 'Start timer'}</Text>
        </Pressable>
      </View>

      {trackId ? <TrackEditorSheet state={state} trackId={trackId} onChange={onChange} onEditCue={() => setCueTarget({ kind: 'track', id: trackId })} onClose={() => setTrackId(null)} /> : null}
      {cue ? <SoundPickerSheet visible title={cueTitle} cue={cue} masterVolume={settings.masterVolume} onChange={patchCue} onClose={() => setCueTarget(null)} onFeedback={onFeedback} /> : null}
      <MixerSheet visible={mixerOpen} state={state} onChange={onChange} onEditCue={target => { setMixerOpen(false); setCueTarget(target) }} onClose={() => setMixerOpen(false)} onFeedback={onFeedback} />
      <PresetLibrarySheet visible={presetsOpen} state={state} onChange={onChange} onClose={() => setPresetsOpen(false)} onFeedback={onFeedback} />
      <TimerHelpSheet visible={helpOpen} onClose={() => setHelpOpen(false)} onOpenFocusSettings={onOpenFocusSettings} />
      {customSnapOpen && state.workingPrograms.pattern.alignment.kind === 'local-clock' ? <CustomMinutePicker title="Clock offset" initial={state.workingPrograms.pattern.alignment.offsetMinutes} min={0} max={59} onConfirm={offsetMinutes => { onChange(updatePattern(state, value => ({ ...value, alignment: { kind: 'local-clock', offsetMinutes } }))); setCustomSnapOpen(false) }} onClose={() => setCustomSnapOpen(false)} /> : null}
    </View>
  )
}

function SystemAccessCard({ access, onOpenExactAlarmSettings, onRequestCallMuteAccess, onRequestNotificationAccess }: { access: Props['androidAccess']; onOpenExactAlarmSettings: () => void; onRequestCallMuteAccess: () => void; onRequestNotificationAccess: () => void }) {
  const { tokens } = useTheme()
  const row = (key: NonNullable<Props['androidAccess']['pending']> | 'exact', label: string, detail: string, ready: boolean, action: string, onPress: () => void, required = false) => {
    const pending = access.pending === key
    const status = access.checking ? 'Checking…' : ready ? 'Ready' : required ? 'Needed to start' : 'Optional · not enabled'
    return <Reanimated.View layout={LinearTransition.duration(150)} style={styles.accessRow}><View style={styles.flex}><Text style={[styles.rowTitle, { color: tokens.text }]}>{label}</Text><Text style={[styles.helper, { color: ready || access.checking ? tokens.textMuted : required ? tokens.warm : tokens.textMuted }]}>{status} · {detail}</Text></View>{pending ? <ActivityIndicator color={tokens.accent} size="small" /> : access.checking ? <Text style={[styles.checkingMark, { color: tokens.textDisabled }]}>•••</Text> : !ready ? <Pressable onPress={onPress} style={[styles.accessAction, { borderColor: required ? tokens.warm : tokens.accent }]} accessibilityRole="button" accessibilityLabel={`${action} ${label} settings`}><Text style={[styles.link, { color: required ? tokens.warm : tokens.accent }]}>{action}</Text></Pressable> : <View style={[styles.readyPill, { backgroundColor: tokens.positiveGlow }]}><Text style={[styles.readyMark, { color: tokens.positive }]}>READY</Text></View>}</Reanimated.View>
  }
  return <View style={[styles.sectionCard, { borderColor: tokens.border }]}><View style={styles.flex}><Text style={[styles.eyebrow, { color: tokens.textMuted }]}>SYSTEM ACCESS</Text><Text style={[styles.helper, { color: tokens.textMuted }]}>Chandas asks only when a feature needs Android’s help.</Text></View>{row('exact', 'Exact timer timing', 'keeps bells precise with the screen off', access.exactAlarms, 'Set up', onOpenExactAlarmSettings, true)}{row('call-mute', 'Auto-mute during calls', 'never reads numbers or call history', access.callMute, 'Allow', onRequestCallMuteAccess)}{row('notifications', 'Timer notifications', 'shows status and alarm controls', access.notifications, 'Allow', onRequestNotificationAccess)}</View>
}

function PatternEditor({ state, onChange, onEditCue, onEditTrack, onAdd, onCustomSnap }: { state: TimerV2State; onChange: (state: TimerV2State) => void; onEditCue: (target: CueTarget) => void; onEditTrack: (id: string) => void; onAdd: () => void; onCustomSnap: () => void }) {
  const { tokens } = useTheme()
  const program = state.workingPrograms.pattern
  return <>
    <View style={styles.section}>
      <View><Text style={[styles.eyebrow, { color: tokens.textMuted }]}>MAIN INTERVAL</Text><Text style={[styles.sectionValue, { color: tokens.text }]}>{program.mainMinutes} minutes</Text></View>
      <DurationSelector value={program.mainMinutes} presets={MAIN_PRESETS} onChange={minutes => changeMainMinutes(state, minutes, onChange)} label="QUICK SELECT" />
      <CueRow title="Main gong" detail={`${soundTitle(program.mainCue.sound)} · ${Math.round(program.mainCue.volume * 100)}%`} sound={program.mainCue.sound} onPress={() => onEditCue({ kind: 'main' })} />
      <View style={styles.settingRow}><View style={styles.flex}><Text style={[styles.rowTitle, { color: tokens.text }]}>Align to clock</Text><Text style={[styles.helper, { color: tokens.textMuted }]}>Keep the pattern on a local wall-clock rhythm.</Text></View><Toggle value={program.alignment.kind === 'local-clock'} onChange={enabled => onChange(updatePattern(state, value => ({ ...value, alignment: enabled ? { kind: 'local-clock', offsetMinutes: 0 } : { kind: 'elapsed' } })))} accessibilityLabel="Align pattern to clock" /></View>
      {program.alignment.kind === 'local-clock' ? <View style={styles.chips}>{SNAP_PRESETS.map(offset => <Chip key={offset} label={`:${String(offset).padStart(2, '0')}`} compact active={program.alignment.kind === 'local-clock' && program.alignment.offsetMinutes === offset} onPress={() => onChange(updatePattern(state, value => ({ ...value, alignment: { kind: 'local-clock', offsetMinutes: offset } })))} />)}<Chip label={SNAP_PRESETS.includes(program.alignment.offsetMinutes as 0 | 10 | 15) ? 'Custom' : `:${String(program.alignment.offsetMinutes).padStart(2, '0')}`} compact active={!SNAP_PRESETS.includes(program.alignment.offsetMinutes as 0 | 10 | 15)} onPress={onCustomSnap} /></View> : null}
    </View>

    <View style={styles.section}>
      <View><Text style={[styles.eyebrow, { color: tokens.textMuted }]}>SUB-BELLS</Text><Text style={[styles.helper, { color: tokens.textMuted }]}>{program.tracks.length} of 5 tracks · highest row wins an overlap</Text></View>
      {program.tracks.length > 0 ? <PatternTimelinePreview tracks={program.tracks} mainMinutes={program.mainMinutes} /> : <Reanimated.View entering={FadeInDown.duration(180)} exiting={FadeOut.duration(120)} style={[styles.empty, { borderColor: tokens.border, backgroundColor: tokens.surface }]}><View style={[styles.emptyMark, { borderColor: tokens.border }]}><Text style={[styles.emptyMarkText, { color: tokens.accent }]}>+</Text></View><View style={styles.flex}><Text style={[styles.rowTitle, { color: tokens.text }]}>Keep it simple—or add a sub-bell</Text><Text style={[styles.helper, { color: tokens.textMuted }]}>The main gong already repeats on its own. Sub-bells can add smaller moments within it.</Text></View></Reanimated.View>}
      {program.tracks.length > 0 && !program.tracks.some(track => track.enabled && track.selectedOffsetsMinutes.length > 0) ? <GentleNotice title="No sub-bell cues are active" message="The main gong will still play. Turn on a track and select cue positions whenever you want more detail." /> : null}
      {program.tracks.map((track, index) => <PatternTrackRow key={track.id} state={state} track={track} index={index} onChange={onChange} onEdit={() => onEditTrack(track.id)} />)}
      <Pressable disabled={program.tracks.length >= 5} onPress={onAdd} style={[styles.add, { borderColor: program.tracks.length >= 5 ? tokens.border : tokens.accent, opacity: program.tracks.length >= 5 ? 0.45 : 1 }]} accessibilityRole="button"><Text style={[styles.addText, { color: program.tracks.length >= 5 ? tokens.textMuted : tokens.accent }]}>{program.tracks.length >= 5 ? '5 track limit reached' : '+ Add sub-bell'}</Text></Pressable>
    </View>
  </>
}

function SequenceEditor({ state, onChange, onEditCue, onAdd }: { state: TimerV2State; onChange: (state: TimerV2State) => void; onEditCue: (target: CueTarget) => void; onAdd: () => void }) {
  const { tokens } = useTheme()
  const program = state.workingPrograms.sequence
  const total = program.steps.reduce((sum, step) => sum + step.durationMinutes, 0)
  return <View style={styles.section}>
    <View><Text style={[styles.eyebrow, { color: tokens.textMuted }]}>CYCLE</Text><Text style={[styles.sectionValue, { color: tokens.text }]}>{formatMinutes(total)}</Text><Text style={[styles.helper, { color: tokens.textMuted }]}>{program.steps.length} step{program.steps.length === 1 ? '' : 's'} · repeats</Text></View>
    {program.steps.map((step, index) => <SequenceStepRow key={step.id} state={state} stepId={step.id} index={index} onChange={onChange} onEditCue={() => onEditCue({ kind: 'step', id: step.id })} />)}
    {program.steps.length < 20 ? <Pressable onPress={onAdd} style={[styles.add, { borderColor: tokens.accent }]} accessibilityRole="button"><Text style={[styles.addText, { color: tokens.accent }]}>+ Add step</Text></Pressable> : null}
  </View>
}

function PatternTrackRow({ state, track, index, onChange, onEdit }: { state: TimerV2State; track: PatternTrack; index: number; onChange: (state: TimerV2State) => void; onEdit: () => void }) {
  const { tokens } = useTheme()
  const translation = useState(() => new Animated.Value(0))[0]
  const [dragging, setDragging] = useState(false)
  const [rowHeight, setRowHeight] = useState(87)
  const reducedMotion = useReducedMotion()
  const count = state.workingPrograms.pattern.tracks.length
  const overlapCount = overlapOffsetsFor(state.workingPrograms.pattern.tracks, track.id).size
  return <Reanimated.View entering={reducedMotion ? FadeIn.duration(80) : FadeInDown.duration(190)} exiting={FadeOut.duration(reducedMotion ? 70 : 130)} layout={reducedMotion ? undefined : LinearTransition.duration(160)}>
    <Animated.View onLayout={event => { if (!dragging) setRowHeight(event.nativeEvent.layout.height + 13) }} style={[styles.trackSummary, dragging && styles.dragging, { borderColor: track.enabled ? tokens.border : tokens.surfaceHi, opacity: track.enabled ? dragging ? 0.92 : 1 : 0.5, transform: [{ translateY: translation }, { scale: dragging && !reducedMotion ? 1.015 : 1 }] }]}>
      <ReorderHandle index={index} itemCount={count} rowHeight={rowHeight} rowTranslation={translation} onDragStateChange={setDragging} onMove={(from, to) => onChange(reorderPatternTracks(state, from, to))} label={`Reorder ${soundTitle(track.sound)} priority`} />
      <Pressable style={styles.flex} onPress={onEdit} accessibilityRole="button" accessibilityLabel={`Edit ${soundTitle(track.sound)} sub-bell`}><View style={styles.titleInline}><Text style={[styles.priority, { color: tokens.accent }]}>{String(index + 1).padStart(2, '0')}</Text><SoundName sound={track.sound} style={styles.rowTitle} /></View><Text style={[styles.helper, { color: tokens.textMuted }]}>{track.cadenceMinutes}m grid · {track.selectedOffsetsMinutes.length} selected · {Math.round(track.volume * 100)}%{overlapCount ? ` · ${overlapCount} overlap${overlapCount === 1 ? '' : 's'}` : ''}</Text></Pressable>
      <Toggle value={track.enabled} onChange={enabled => onChange(patchPatternTrack(state, track.id, { enabled }))} accessibilityLabel={`Enable ${soundTitle(track.sound)}`} />
    </Animated.View>
  </Reanimated.View>
}

function SequenceStepRow({ state, stepId, index, onChange, onEditCue }: { state: TimerV2State; stepId: string; index: number; onChange: (state: TimerV2State) => void; onEditCue: () => void }) {
  const { tokens } = useTheme()
  const translation = useState(() => new Animated.Value(0))[0]
  const [dragging, setDragging] = useState(false)
  const [rowHeight, setRowHeight] = useState(190)
  const reducedMotion = useReducedMotion()
  const program = state.workingPrograms.sequence
  const step = program.steps.find(value => value.id === stepId)
  if (!step) return null
  return <Reanimated.View entering={reducedMotion ? FadeIn.duration(80) : FadeInDown.duration(190)} exiting={FadeOut.duration(reducedMotion ? 70 : 130)} layout={reducedMotion ? undefined : LinearTransition.duration(160)}>
    <Animated.View onLayout={event => { if (!dragging) setRowHeight(event.nativeEvent.layout.height + 13) }} style={[styles.sequenceCard, dragging && styles.dragging, { borderColor: tokens.border, backgroundColor: tokens.surface, opacity: dragging ? 0.92 : 1, transform: [{ translateY: translation }, { scale: dragging && !reducedMotion ? 1.015 : 1 }] }]}>
      <View style={styles.sequenceHead}><ReorderHandle index={index} itemCount={program.steps.length} rowHeight={rowHeight} rowTranslation={translation} onDragStateChange={setDragging} onMove={(from, to) => onChange(reorderSequenceSteps(state, from, to))} label={`Reorder ${step.label}`} /><Text style={[styles.priority, { color: tokens.accent }]}>{String(index + 1).padStart(2, '0')}</Text><StepLabelInput value={step.label} onCommit={label => onChange(patchSequenceStep(state, step.id, { label }))} style={[styles.stepInput, { color: tokens.text, borderBottomColor: tokens.border }]} accessibilityLabel={`Step ${index + 1} name`} /></View>
      <DurationSelector compact value={step.durationMinutes} presets={STEP_PRESETS} onChange={durationMinutes => onChange(patchSequenceStep(state, step.id, { durationMinutes }))} />
      <CueRow compact title={soundTitle(step.sound)} detail={`${Math.round(step.volume * 100)}%`} sound={step.sound} onPress={onEditCue} />
      <View style={styles.inlineActions}><Pressable disabled={program.steps.length >= 20} onPress={() => onChange(duplicateSequenceStep(state, step.id))} accessibilityRole="button" accessibilityLabel={`Duplicate ${step.label}`}><Text style={[styles.remove, { color: tokens.textMuted, opacity: program.steps.length >= 20 ? 0.35 : 1 }]}>Duplicate</Text></Pressable>{program.steps.length > 1 ? <Pressable onPress={() => removeSequenceStepWithConfirmation(state, step.id, index, onChange)} accessibilityRole="button" accessibilityLabel={`Remove ${step.label}`}><Text style={[styles.remove, { color: tokens.textMuted }]}>Remove</Text></Pressable> : null}</View>
    </Animated.View>
  </Reanimated.View>
}

function TrackEditorSheet({ state, trackId, onChange, onEditCue, onClose }: { state: TimerV2State; trackId: string; onChange: (state: TimerV2State) => void; onEditCue: () => void; onClose: () => void }) {
  const { tokens } = useTheme()
  const program = state.workingPrograms.pattern
  const track = program.tracks.find(value => value.id === trackId)
  if (!track) return null
  const offsets = validOffsets(program.mainMinutes, track.cadenceMinutes)
  const overlaps = overlapOffsetsFor(program.tracks, trackId)
  const conflicts = conflictMapFor(program.tracks, trackId)
  const index = program.tracks.findIndex(value => value.id === trackId)
  return <BottomSheet visible eyebrow={`SUB-BELL ${index + 1} OF ${program.tracks.length}${track.enabled ? '' : ' · OFF'}`} title={soundTitle(track.sound)} onClose={onClose}>
    <View style={styles.settingRow}><View style={styles.flex}><Text style={[styles.rowTitle, { color: tokens.text }]}>Enabled</Text><Text style={[styles.helper, { color: tokens.textMuted }]}>Disabled tracks keep their selections.</Text></View><Toggle value={track.enabled} onChange={enabled => onChange(patchPatternTrack(state, track.id, { enabled }))} accessibilityLabel="Enable sub-bell" /></View>
    <DurationSelector value={track.cadenceMinutes} presets={CADENCE_PRESETS} min={1} max={240} onChange={minutes => onChange(setTrackCadence(state, track.id, minutes))} label="TRIGGER GRID" />
    <CueRow title="Sound & level" detail={`${soundTitle(track.sound)} · ${Math.round(track.volume * 100)}%`} sound={track.sound} onPress={onEditCue} />
    <View style={styles.gridHeading}><View style={styles.flex}><Text style={[styles.rowTitle, { color: tokens.text }]}>Cue positions</Text><Text style={[styles.helper, { color: tokens.textMuted }]}>{overlaps.size ? `${overlaps.size} overlap${overlaps.size === 1 ? '' : 's'} · higher tracks win. ` : ''}Minutes after the main gong. Tap or drag to paint.</Text></View><View style={styles.inlineActions}><Pressable onPress={() => onChange(setTrackOffsets(state, track.id, []))} accessibilityRole="button"><Text style={[styles.link, { color: tokens.accent }]}>Clear all</Text></Pressable><Pressable onPress={() => onChange(setTrackOffsets(state, track.id, offsets))} accessibilityRole="button"><Text style={[styles.link, { color: tokens.accent }]}>Select all</Text></Pressable></View></View>
    <OffsetGrid offsets={offsets} selected={track.selectedOffsetsMinutes} conflicts={conflicts} onChange={selectedOffsetsMinutes => onChange(setTrackOffsets(state, track.id, selectedOffsetsMinutes))} />
    {offsets.length === 0 ? <GentleNotice title="No cue positions in this interval" message={`A ${track.cadenceMinutes}-minute grid has no points inside a ${program.mainMinutes}-minute main interval. Choose a shorter grid or leave this track ready for a longer pattern.`} /> : track.selectedOffsetsMinutes.length === 0 ? <GentleNotice title="This sub-bell is quiet for now" message="Select one or more positions above. Your sound and volume settings are still saved." /> : null}
    {overlaps.size ? <Text style={[styles.helper, { color: tokens.textMuted }]}>Overlap cells are shared with another track. Track order decides which sound plays; the highest track wins.</Text> : null}
    <Pressable onPress={() => confirmRemove('this sub-bell', () => { onChange(removePatternTrack(state, track.id)); onClose() })} accessibilityRole="button"><Text style={[styles.destructive, { color: tokens.accent }]}>Remove sub-bell</Text></Pressable>
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
  return <BottomSheet visible={visible} eyebrow="ALARM STREAM" title="Mixer" onClose={close}>
    <Text style={[styles.helper, { color: tokens.textMuted }]}>Master volume scales every cue. Individual levels and mute state remain independent, so nothing is lost when you silence the timer.</Text>
    <View style={styles.mixerRow}><View style={styles.mixerLabel}><Text style={[styles.rowTitle, { color: tokens.text }]}>Master</Text><Text style={[styles.helper, { color: tokens.textMuted }]}>All timer sounds</Text></View><Slider style={styles.mixerSlider} minimumValue={0} maximumValue={1} step={0.05} value={state.settings.masterVolume} onValueChange={masterVolume => onChange({ ...state, settings: { ...state.settings, masterVolume } })} minimumTrackTintColor={tokens.accent} maximumTrackTintColor={tokens.surfaceHi} thumbTintColor={tokens.accent} accessibilityLabel="Master timer volume" accessibilityValue={{ min: 0, max: 100, now: Math.round(state.settings.masterVolume * 100), text: `${Math.round(state.settings.masterVolume * 100)} percent` }} /><Text style={[styles.volumeValue, { color: tokens.text }]}>{Math.round(state.settings.masterVolume * 100)}</Text></View>
    <View style={[styles.divider, { backgroundColor: tokens.border }]} />
    {program.mode === 'pattern' ? <>{row('main', 'Main gong', program.mainCue, { kind: 'main' }, volume => updatePattern(state, value => ({ ...value, mainCue: { ...value.mainCue, volume } })))}{program.tracks.map(track => row(track.id, `${track.cadenceMinutes}m · ${soundTitle(track.sound)}`, track, { kind: 'track', id: track.id }, volume => patchPatternTrack(state, track.id, { volume })))}</> : program.steps.map((step, index) => row(step.id, `${index + 1}. ${step.label}`, step, { kind: 'step', id: step.id }, volume => patchSequenceStep(state, step.id, { volume })))}
    <Text style={[styles.helper, { color: tokens.textDisabled }]}>Final output is also multiplied by your phone’s Alarm volume.</Text>
  </BottomSheet>
}

function FocusCard({ state, enabled, onChange, onResume, onOpenAccessSettings, onOpenRuleSettings }: { state: NativeFocusState; enabled: boolean; onChange: (enabled: boolean) => void; onResume: () => void; onOpenAccessSettings: () => void; onOpenRuleSettings: () => void }) {
  const { tokens } = useTheme()
  const paused = state.reason === 'paused-by-android'
  const ruleDisabled = state.reason === 'rule-disabled'
  const description = ruleDisabled ? 'Android disabled the Chandas rule. Open its system page to turn it back on or change its exceptions.' : !enabled ? 'Optional. Let Chandas manage its own Android DND rule while the timer runs.' : !state.policyAccess ? 'DND access is required before Android can activate the Chandas rule.' : state.actual === 'active' ? 'Chandas Focus is active. Alarms remain allowed.' : paused ? 'Paused from Android. Resume when you want Chandas to request this Focus session again.' : 'Ready. It activates while the timer is running and within active hours.'
  return <View style={[styles.sectionCard, { borderColor: state.actual === 'active' || paused || ruleDisabled ? tokens.accent : tokens.border }]}><View style={styles.settingRow}><View style={styles.flex}><Text style={[styles.eyebrow, { color: tokens.textMuted }]}>FOCUS / DND</Text><Text style={[styles.rowTitle, { color: tokens.text }]}>{state.actual === 'active' ? 'Chandas Focus active' : paused ? 'Paused in Android' : enabled ? 'Focus automation ready' : ruleDisabled ? 'Focus rule disabled' : 'Focus automation off'}</Text><Text style={[styles.helper, { color: tokens.textMuted }]}>{description}</Text></View><Toggle value={enabled} onChange={onChange} accessibilityLabel="Chandas Focus automation" /></View>{enabled && !state.policyAccess ? <Pressable onPress={onOpenAccessSettings} style={[styles.outline, { borderColor: tokens.accent }]} accessibilityRole="button"><Text style={[styles.link, { color: tokens.accent }]}>Grant DND access</Text></Pressable> : ruleDisabled ? <Pressable onPress={onOpenRuleSettings} style={[styles.outline, { borderColor: tokens.accent }]} accessibilityRole="button"><Text style={[styles.link, { color: tokens.accent }]}>Open Chandas Focus in Android</Text></Pressable> : paused ? <Pressable onPress={onResume} style={[styles.outline, { borderColor: tokens.accent }]} accessibilityRole="button"><Text style={[styles.link, { color: tokens.accent }]}>Resume Chandas Focus</Text></Pressable> : null}</View>
}

function CueRow({ title, detail, sound, onPress, compact = false }: { title: string; detail: string; sound?: SoundRef; onPress: () => void; compact?: boolean }) {
  const { tokens } = useTheme()
  const reducedMotion = useReducedMotion()
  const available = useSoundAvailability(sound ?? { kind: 'builtin', id: 'clear-bell' })
  return <Pressable onPress={onPress} style={({ pressed }) => [styles.cueRow, compact && styles.cueCompact, { borderColor: available ? tokens.border : tokens.accent, backgroundColor: tokens.surface, opacity: pressed ? 0.78 : 1, transform: [{ scale: pressed && !reducedMotion ? 0.99 : 1 }] }]} accessibilityRole="button"><View style={styles.flex}><Text numberOfLines={1} style={[styles.rowTitle, { color: tokens.text }]}>{title}</Text><Text numberOfLines={1} style={[styles.helper, { color: available ? tokens.textMuted : tokens.accent }]}>{detail}{available ? '' : ' · Unavailable'}</Text></View><Text style={[styles.link, { color: tokens.accent }]}>{available ? 'Edit' : 'Replace'}</Text></Pressable>
}

function cueForTarget(state: TimerV2State, target: CueTarget): CueSettings | null {
  if (target.kind === 'main') return state.workingPrograms.pattern.mainCue
  if (target.kind === 'track') return state.workingPrograms.pattern.tracks.find(track => track.id === target.id) ?? null
  return state.workingPrograms.sequence.steps.find(step => step.id === target.id) ?? null
}

function overlapOffsetsFor(tracks: PatternTrack[], trackId: string): Set<number> {
  const track = tracks.find(value => value.id === trackId)
  if (!track?.enabled) return new Set()
  const others = new Set(tracks.filter(value => value.id !== trackId && value.enabled).flatMap(value => value.selectedOffsetsMinutes))
  return new Set(track.selectedOffsetsMinutes.filter(offset => others.has(offset)))
}

function conflictMapFor(tracks: PatternTrack[], trackId: string): Map<number, { winner: string; isWinner: boolean }> {
  const currentIndex = tracks.findIndex(track => track.id === trackId)
  if (currentIndex < 0 || !tracks[currentIndex].enabled) return new Map()
  const result = new Map<number, { winner: string; isWinner: boolean }>()
  for (const offset of tracks[currentIndex].selectedOffsetsMinutes) {
    const candidates = tracks.map((track, index) => ({ track, index })).filter(({ track }) => track.enabled && track.selectedOffsetsMinutes.includes(offset))
    if (candidates.length < 2) continue
    const winner = candidates[0]
    result.set(offset, { winner: soundTitle(winner.track.sound), isWinner: winner.index === currentIndex })
  }
  return result
}

function changeMainMinutes(state: TimerV2State, minutes: number, onChange: (state: TimerV2State) => void) {
  const nextState = updatePatternMainMinutes(state, minutes)
  const nextByTrack = new Map(nextState.workingPrograms.pattern.tracks.map(track => [track.id, new Set(track.selectedOffsetsMinutes)]))
  const removed = state.workingPrograms.pattern.tracks.reduce((count, track) => count + track.selectedOffsetsMinutes.filter(offset => !nextByTrack.get(track.id)?.has(offset)).length, 0)
  const apply = () => onChange(nextState)
  if (removed === 0) apply()
  else Alert.alert('Shorten main interval?', `${removed} selected cue${removed === 1 ? '' : 's'} outside the new interval will be removed.`, [{ text: 'Cancel', style: 'cancel' }, { text: 'Continue', onPress: apply }])
}

/** Keeps whitespace typeable while normalizing only when editing finishes. */
function StepLabelInput({ value, onCommit, style, accessibilityLabel }: { value: string; onCommit: (value: string) => void; style: ComponentProps<typeof TextInput>['style']; accessibilityLabel: string }) {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  const commit = () => onCommit(draft)
  return <TextInput value={draft} selectTextOnFocus onChangeText={text => setDraft([...text].slice(0, 60).join(''))} onBlur={commit} onSubmitEditing={commit} returnKeyType="done" style={style} accessibilityLabel={accessibilityLabel} />
}

function PatternTimelinePreview({ tracks, mainMinutes }: { tracks: PatternTrack[]; mainMinutes: number }) {
  const { tokens } = useTheme()
  const active = tracks.filter(track => track.enabled)
  return <View style={[styles.timeline, { borderColor: tokens.border }]} accessibilityLabel="One main interval cue preview">
    <View style={[styles.timelineLine, { backgroundColor: tokens.border }]} />
    <View style={[styles.timelineBoundary, { left: 0, backgroundColor: tokens.accent }]} />
    <View style={[styles.timelineBoundary, { right: 0, backgroundColor: tokens.accent }]} />
    {active.flatMap((track, trackIndex) => track.selectedOffsetsMinutes.map(offset => {
      const winner = active.find(value => value.selectedOffsetsMinutes.includes(offset))
      const won = winner?.id === track.id
      return <View key={`${track.id}:${offset}`} style={[styles.timelineCue, { left: `${offset / mainMinutes * 100}%`, top: 8 + trackIndex * 6, backgroundColor: won ? tokens.accent : tokens.textDisabled, opacity: won ? 1 : 0.45 }]} />
    }))}
    <Text style={[styles.timelineStart, { color: tokens.textMuted }]}>0</Text><Text style={[styles.timelineEnd, { color: tokens.textMuted }]}>{mainMinutes}m</Text>
  </View>
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
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, eyebrow: { fontSize: 11, fontWeight: '700', letterSpacing: 1.4 }, screenTitle: { fontSize: 28, fontWeight: '600', marginTop: 3 },
  question: { width: 36, height: 36, borderWidth: 1.5, borderRadius: 18, alignItems: 'center', justifyContent: 'center' }, questionText: { fontSize: 17, fontWeight: '800' },
  modeTabs: { flexDirection: 'row', borderWidth: 1.5, borderRadius: 14, padding: 3, gap: 3 }, modeTab: { flex: 1, paddingVertical: 11, borderRadius: 10, alignItems: 'center' }, modeTabText: { fontSize: 13, fontWeight: '700' },
  summaryBar: { minHeight: 72, padding: 14, borderWidth: 1.5, borderRadius: 15, flexDirection: 'row', alignItems: 'center', gap: 12 }, summaryTitle: { fontSize: 16, fontWeight: '700', marginTop: 2 },
  section: { gap: 13 }, sectionCard: { borderWidth: 1.5, borderRadius: 15, padding: 15, gap: 12 }, sectionValue: { fontFamily: 'JetBrainsMono-Light', fontSize: 31, marginTop: 2 },
  helper: { fontSize: 12, lineHeight: 17 }, rowTitle: { fontSize: 14, fontWeight: '700' }, flex: { flex: 1, gap: 3, minWidth: 0 }, settingRow: { flexDirection: 'row', alignItems: 'center', gap: 14 }, chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  cueRow: { minHeight: 62, borderWidth: 1.5, borderRadius: 13, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 12 }, cueCompact: { minHeight: 52, paddingVertical: 9 }, link: { fontSize: 12, fontWeight: '700' },
  trackSummary: { minHeight: 74, borderWidth: 1.5, borderRadius: 14, padding: 11, flexDirection: 'row', alignItems: 'center', gap: 10 }, titleInline: { flexDirection: 'row', alignItems: 'center', gap: 8 }, priority: { fontFamily: 'JetBrainsMono-Regular', fontSize: 11 },
  empty: { padding: 15, borderWidth: 1.5, borderStyle: 'dashed', borderRadius: 13, gap: 11, flexDirection: 'row', alignItems: 'center' }, emptyMark: { width: 34, height: 34, borderWidth: 1.5, borderRadius: 17, alignItems: 'center', justifyContent: 'center' }, emptyMarkText: { fontSize: 20, fontWeight: '400' }, add: { minHeight: 52, borderWidth: 1.5, borderStyle: 'dashed', borderRadius: 13, alignItems: 'center', justifyContent: 'center' }, addText: { fontSize: 13, fontWeight: '700' },
  sequenceCard: { borderWidth: 1.5, borderRadius: 15, padding: 13, gap: 11 }, sequenceHead: { flexDirection: 'row', alignItems: 'center', gap: 9 }, stepInput: { flex: 1, minWidth: 0, borderBottomWidth: 1, fontSize: 15, fontWeight: '700', paddingVertical: 5 }, remove: { fontSize: 11, textDecorationLine: 'underline' },
  dragging: { zIndex: 20, boxShadow: '0 5px 16px rgba(0,0,0,0.24)' },
  gridHeading: { gap: 10 }, inlineActions: { flexDirection: 'row', alignItems: 'center', gap: 14 }, destructive: { fontSize: 12, fontWeight: '700', textAlign: 'center', paddingVertical: 8 },
  timeline: { height: 48, borderWidth: 1, borderRadius: 11, position: 'relative', overflow: 'hidden', paddingHorizontal: 8 }, timelineLine: { position: 'absolute', left: 8, right: 8, top: 20, height: 1 }, timelineBoundary: { position: 'absolute', top: 14, width: 2, height: 13 }, timelineCue: { position: 'absolute', width: 5, height: 5, marginLeft: -2.5, borderRadius: 3 }, timelineStart: { position: 'absolute', left: 7, bottom: 4, fontSize: 8 }, timelineEnd: { position: 'absolute', right: 7, bottom: 4, fontSize: 8 },
  mixerRow: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 9 }, mixerLabel: { width: 118, gap: 2 }, mixerSlider: { flex: 1, height: 34 }, volumeValue: { width: 28, fontFamily: 'JetBrainsMono-Regular', fontSize: 11, textAlign: 'right' }, divider: { height: 1 },
  previewMini: { width: 30, height: 30, borderWidth: 1, borderRadius: 15, alignItems: 'center', justifyContent: 'center' }, previewGlyph: { fontSize: 9 },
  outline: { alignSelf: 'flex-start', borderWidth: 1.5, borderRadius: 99, paddingHorizontal: 13, paddingVertical: 9 }, bottom: { position: 'absolute', bottom: 0, left: 0, right: 0, paddingHorizontal: 20 }, start: { width: '100%', maxWidth: 580, minHeight: 54, alignSelf: 'center', borderRadius: 99, paddingVertical: 15, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 9 }, startText: { color: '#fff', fontSize: 14, fontWeight: '800', letterSpacing: 1.1, textTransform: 'uppercase' },
  accessRow: { minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: 12 }, accessAction: { minWidth: 64, minHeight: 40, paddingHorizontal: 12, borderWidth: 1.5, borderRadius: 99, alignItems: 'center', justifyContent: 'center' }, readyPill: { minHeight: 27, paddingHorizontal: 9, borderRadius: 99, alignItems: 'center', justifyContent: 'center' }, readyMark: { fontSize: 8, fontWeight: '900', letterSpacing: 0.9 }, checkingMark: { width: 36, textAlign: 'center', fontSize: 10, letterSpacing: 1 },
})
