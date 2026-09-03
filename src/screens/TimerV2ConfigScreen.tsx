import { useState } from 'react'
import { Alert, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import Slider from '@react-native-community/slider'
import * as Haptics from 'expo-haptics'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type { CueSettings, PatternTrack, TimerV2State } from '../types'
import type { NativeFocusState } from '../native/ChandasTimerService'
import { ActiveHoursConfig } from '../components/ActiveHoursConfig'
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
import {
  addPatternTrack, addSequenceStep, chooseProgramMode, duplicateSequenceStep, patchPatternTrack, patchSequenceStep,
  removePatternTrack, removeSequenceStep, reorderPatternTracks, reorderSequenceSteps,
  setTrackCadence, setTrackOffsets, updatePattern, updatePatternMainMinutes,
} from '../lib/programActions'
import { soundTitle } from '../lib/soundLibrary'
import { validOffsets } from '../lib/timerV2'
import { useTheme } from '../theme/ThemeContext'

const MAIN_PRESETS = [10, 15, 30] as const
const STEP_PRESETS = [5, 15, 25] as const
const CADENCE_PRESETS = [1, 2, 5] as const
const SNAP_PRESETS = [0, 10, 15] as const

type CueTarget = { kind: 'main' } | { kind: 'track'; id: string } | { kind: 'step'; id: string }

interface Props {
  state: TimerV2State
  onChange: (state: TimerV2State) => void
  onStart: () => void
  focusState: NativeFocusState
  onFocusAutomationChange: (enabled: boolean) => void
  onOpenFocusSettings: () => void
}

export function TimerV2ConfigScreen({ state, onChange, onStart, focusState, onFocusAutomationChange, onOpenFocusSettings }: Props) {
  const { tokens } = useTheme()
  const insets = useSafeAreaInsets()
  const [cueTarget, setCueTarget] = useState<CueTarget | null>(null)
  const [trackId, setTrackId] = useState<string | null>(null)
  const [presetsOpen, setPresetsOpen] = useState(false)
  const [mixerOpen, setMixerOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [customSnapOpen, setCustomSnapOpen] = useState(false)
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
  const validToStart = !settings.activeHoursEnabled || settings.activeHoursDays !== 0

  return (
    <View style={[styles.screen, { backgroundColor: tokens.bg }]}>
      <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={[styles.content, { paddingTop: insets.top + 22, paddingBottom: insets.bottom + 116 }]}>
        <View style={styles.header}>
          <View><Text style={[styles.eyebrow, { color: tokens.accent }]}>CHANDAS</Text><Text style={[styles.screenTitle, { color: tokens.text }]}>Interval timer</Text></View>
          <Pressable onPress={() => setHelpOpen(true)} style={[styles.question, { borderColor: tokens.border }]} accessibilityRole="button" accessibilityLabel="Timer help"><Text style={[styles.questionText, { color: tokens.accent }]}>?</Text></Pressable>
        </View>

        <View style={[styles.modeTabs, { borderColor: tokens.border }]} accessibilityRole="tablist">
          {([['pattern', 'Main + sub-bells'], ['sequence', 'Sequence / sets']] as const).map(([mode, label]) => <Pressable key={mode} onPress={() => onChange(chooseProgramMode(state, mode))} accessibilityRole="tab" accessibilityState={{ selected: state.workingPrograms.selectedMode === mode }} style={[styles.modeTab, state.workingPrograms.selectedMode === mode && { backgroundColor: tokens.accent }]}><Text style={[styles.modeTabText, { color: state.workingPrograms.selectedMode === mode ? '#fff' : tokens.textMuted }]}>{label}</Text></Pressable>)}
        </View>

        <Pressable onPress={() => setPresetsOpen(true)} style={[styles.summaryBar, { backgroundColor: tokens.surface, borderColor: tokens.border }]} accessibilityLabel="Save or load configurations">
          <View style={styles.flex}><Text style={[styles.eyebrow, { color: tokens.textMuted }]}>CONFIGURATION</Text><Text style={[styles.summaryTitle, { color: tokens.text }]}>{state.workingPrograms.sourcePreset?.deleted ? 'Working copy · source deleted' : state.workingPrograms.sourcePreset?.name ?? 'Working copy'}</Text></View>
          <Text style={[styles.link, { color: tokens.accent }]}>Save / load</Text>
        </Pressable>

        {program.mode === 'pattern' ? <PatternEditor state={state} onChange={onChange} onEditCue={setCueTarget} onEditTrack={setTrackId} onAdd={addTrack} onCustomSnap={() => setCustomSnapOpen(true)} /> : <SequenceEditor state={state} onChange={onChange} onEditCue={setCueTarget} onAdd={addStep} />}

        <Pressable onPress={() => setMixerOpen(true)} style={[styles.summaryBar, { backgroundColor: tokens.surface, borderColor: tokens.border }]} accessibilityLabel="Open mixer">
          <View style={styles.flex}><Text style={[styles.eyebrow, { color: tokens.textMuted }]}>MIXER</Text><Text style={[styles.summaryTitle, { color: tokens.text }]}>Master {Math.round(settings.masterVolume * 100)}%</Text><Text style={[styles.helper, { color: tokens.textMuted }]}>Fine-tune every cue in one place</Text></View>
          <Text style={[styles.link, { color: tokens.accent }]}>Mix</Text>
        </Pressable>

        <View style={[styles.sectionCard, { borderColor: tokens.border }]}>
          <ActiveHoursConfig enabled={settings.activeHoursEnabled} startMinutes={settings.activeHoursStart} endMinutes={settings.activeHoursEnd} days={settings.activeHoursDays} onToggle={activeHoursEnabled => changeSettings({ activeHoursEnabled })} onStartChange={activeHoursStart => changeSettings({ activeHoursStart })} onEndChange={activeHoursEnd => changeSettings({ activeHoursEnd })} onDaysChange={activeHoursDays => changeSettings({ activeHoursDays })} />
        </View>

        {Platform.OS === 'android' ? <FocusCard state={focusState} enabled={settings.focusAutomationEnabled} onChange={onFocusAutomationChange} onOpenSettings={onOpenFocusSettings} /> : null}
      </ScrollView>

      <View style={[styles.bottom, { backgroundColor: tokens.bg, paddingBottom: insets.bottom + 16 }]}>
        <Pressable disabled={!validToStart} onPress={onStart} style={({ pressed }) => [styles.start, { backgroundColor: tokens.accent, opacity: !validToStart ? 0.35 : pressed ? 0.76 : 1 }]} accessibilityRole="button"><Text style={styles.startText}>{validToStart ? 'Start timer' : 'Choose an active day'}</Text></Pressable>
      </View>

      {trackId ? <TrackEditorSheet state={state} trackId={trackId} onChange={onChange} onEditCue={() => setCueTarget({ kind: 'track', id: trackId })} onClose={() => setTrackId(null)} /> : null}
      {cue ? <SoundPickerSheet visible title={cueTitle} cue={cue} masterVolume={settings.masterVolume} onChange={patchCue} onClose={() => setCueTarget(null)} /> : null}
      <MixerSheet visible={mixerOpen} state={state} onChange={onChange} onEditCue={target => { setMixerOpen(false); setCueTarget(target) }} onClose={() => setMixerOpen(false)} />
      <PresetLibrarySheet visible={presetsOpen} state={state} onChange={onChange} onClose={() => setPresetsOpen(false)} />
      <TimerHelpSheet visible={helpOpen} onClose={() => setHelpOpen(false)} />
      {customSnapOpen && state.workingPrograms.pattern.alignment.kind === 'local-clock' ? <CustomMinutePicker title="Clock offset" initial={state.workingPrograms.pattern.alignment.offsetMinutes} min={0} max={59} onConfirm={offsetMinutes => { onChange(updatePattern(state, value => ({ ...value, alignment: { kind: 'local-clock', offsetMinutes } }))); setCustomSnapOpen(false) }} onClose={() => setCustomSnapOpen(false)} /> : null}
    </View>
  )
}

function PatternEditor({ state, onChange, onEditCue, onEditTrack, onAdd, onCustomSnap }: { state: TimerV2State; onChange: (state: TimerV2State) => void; onEditCue: (target: CueTarget) => void; onEditTrack: (id: string) => void; onAdd: () => void; onCustomSnap: () => void }) {
  const { tokens } = useTheme()
  const program = state.workingPrograms.pattern
  return <>
    <View style={styles.section}>
      <View><Text style={[styles.eyebrow, { color: tokens.textMuted }]}>MAIN INTERVAL</Text><Text style={[styles.sectionValue, { color: tokens.text }]}>{program.mainMinutes} minutes</Text></View>
      <DurationSelector value={program.mainMinutes} presets={MAIN_PRESETS} onChange={minutes => changeMainMinutes(state, minutes, onChange)} label="QUICK SELECT" />
      <CueRow title="Main gong" detail={`${soundTitle(program.mainCue.sound)} · ${Math.round(program.mainCue.volume * 100)}%`} onPress={() => onEditCue({ kind: 'main' })} />
      <View style={styles.settingRow}><View style={styles.flex}><Text style={[styles.rowTitle, { color: tokens.text }]}>Align to clock</Text><Text style={[styles.helper, { color: tokens.textMuted }]}>Keep the pattern on a local wall-clock rhythm.</Text></View><Toggle value={program.alignment.kind === 'local-clock'} onChange={enabled => onChange(updatePattern(state, value => ({ ...value, alignment: enabled ? { kind: 'local-clock', offsetMinutes: 0 } : { kind: 'elapsed' } })))} accessibilityLabel="Align pattern to clock" /></View>
      {program.alignment.kind === 'local-clock' ? <View style={styles.chips}>{SNAP_PRESETS.map(offset => <Chip key={offset} label={`:${String(offset).padStart(2, '0')}`} compact active={program.alignment.kind === 'local-clock' && program.alignment.offsetMinutes === offset} onPress={() => onChange(updatePattern(state, value => ({ ...value, alignment: { kind: 'local-clock', offsetMinutes: offset } })))} />)}<Chip label={SNAP_PRESETS.includes(program.alignment.offsetMinutes as 0 | 10 | 15) ? 'Custom' : `:${String(program.alignment.offsetMinutes).padStart(2, '0')}`} compact active={!SNAP_PRESETS.includes(program.alignment.offsetMinutes as 0 | 10 | 15)} onPress={onCustomSnap} /></View> : null}
    </View>

    <View style={styles.section}>
      <View><Text style={[styles.eyebrow, { color: tokens.textMuted }]}>SUB-BELLS</Text><Text style={[styles.helper, { color: tokens.textMuted }]}>{program.tracks.length} of 5 tracks · highest row wins an overlap</Text></View>
      {program.tracks.length > 0 ? <PatternTimelinePreview tracks={program.tracks} mainMinutes={program.mainMinutes} /> : <View style={[styles.empty, { borderColor: tokens.border }]}><Text style={[styles.rowTitle, { color: tokens.text }]}>No sub-bells</Text><Text style={[styles.helper, { color: tokens.textMuted }]}>The main gong will still repeat on its own.</Text></View>}
      {program.tracks.map((track, index) => {
        const overlapCount = overlapOffsetsFor(program.tracks, track.id).size
        return <View key={track.id} style={[styles.trackSummary, { borderColor: track.enabled ? tokens.border : tokens.surfaceHi, opacity: track.enabled ? 1 : 0.5 }]}>
          <ReorderHandle index={index} itemCount={program.tracks.length} onMove={(from, to) => onChange(reorderPatternTracks(state, from, to))} label={`Reorder ${soundTitle(track.sound)} priority`} />
          <Pressable style={styles.flex} onPress={() => onEditTrack(track.id)} accessibilityLabel={`Edit ${soundTitle(track.sound)} sub-bell`}><View style={styles.titleInline}><Text style={[styles.priority, { color: tokens.accent }]}>{String(index + 1).padStart(2, '0')}</Text><Text numberOfLines={1} style={[styles.rowTitle, { color: tokens.text }]}>{soundTitle(track.sound)}</Text></View><Text style={[styles.helper, { color: tokens.textMuted }]}>{track.cadenceMinutes}m grid · {track.selectedOffsetsMinutes.length} selected{overlapCount ? ` · ${overlapCount} overlap${overlapCount === 1 ? '' : 's'}` : ''}</Text></Pressable>
          <Toggle value={track.enabled} onChange={enabled => onChange(patchPatternTrack(state, track.id, { enabled }))} accessibilityLabel={`Enable ${soundTitle(track.sound)}`} />
        </View>
      })}
      {program.tracks.length < 5 ? <Pressable onPress={onAdd} style={[styles.add, { borderColor: tokens.accent }]}><Text style={[styles.addText, { color: tokens.accent }]}>+ Add sub-bell</Text></Pressable> : null}
    </View>
  </>
}

function SequenceEditor({ state, onChange, onEditCue, onAdd }: { state: TimerV2State; onChange: (state: TimerV2State) => void; onEditCue: (target: CueTarget) => void; onAdd: () => void }) {
  const { tokens } = useTheme()
  const program = state.workingPrograms.sequence
  const total = program.steps.reduce((sum, step) => sum + step.durationMinutes, 0)
  return <View style={styles.section}>
    <View><Text style={[styles.eyebrow, { color: tokens.textMuted }]}>CYCLE</Text><Text style={[styles.sectionValue, { color: tokens.text }]}>{formatMinutes(total)}</Text><Text style={[styles.helper, { color: tokens.textMuted }]}>{program.steps.length} step{program.steps.length === 1 ? '' : 's'} · repeats</Text></View>
    {program.steps.map((step, index) => <View key={step.id} style={[styles.sequenceCard, { borderColor: tokens.border, backgroundColor: tokens.surface }]}>
      <View style={styles.sequenceHead}><ReorderHandle index={index} itemCount={program.steps.length} rowHeight={116} onMove={(from, to) => onChange(reorderSequenceSteps(state, from, to))} label={`Reorder ${step.label}`} /><Text style={[styles.priority, { color: tokens.accent }]}>{String(index + 1).padStart(2, '0')}</Text><TextInput value={step.label} maxLength={60} selectTextOnFocus onChangeText={label => onChange(patchSequenceStep(state, step.id, { label }))} style={[styles.stepInput, { color: tokens.text, borderBottomColor: tokens.border }]} accessibilityLabel={`Step ${index + 1} name`} /></View>
      <DurationSelector compact value={step.durationMinutes} presets={STEP_PRESETS} onChange={durationMinutes => onChange(patchSequenceStep(state, step.id, { durationMinutes }))} />
      <CueRow compact title={soundTitle(step.sound)} detail={`${Math.round(step.volume * 100)}%`} onPress={() => onEditCue({ kind: 'step', id: step.id })} />
      <View style={styles.inlineActions}><Pressable disabled={program.steps.length >= 20} onPress={() => onChange(duplicateSequenceStep(state, step.id))}><Text style={[styles.remove, { color: tokens.textMuted, opacity: program.steps.length >= 20 ? 0.35 : 1 }]}>Duplicate</Text></Pressable>{program.steps.length > 1 ? <Pressable onPress={() => confirmRemove(step.label, () => onChange(removeSequenceStep(state, step.id)))}><Text style={[styles.remove, { color: tokens.textMuted }]}>Remove</Text></Pressable> : null}</View>
    </View>)}
    {program.steps.length < 20 ? <Pressable onPress={onAdd} style={[styles.add, { borderColor: tokens.accent }]}><Text style={[styles.addText, { color: tokens.accent }]}>+ Add step</Text></Pressable> : null}
  </View>
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
  return <BottomSheet visible eyebrow={`SUB-BELL ${index + 1} OF ${program.tracks.length}`} title={soundTitle(track.sound)} onClose={onClose}>
    <View style={styles.settingRow}><View style={styles.flex}><Text style={[styles.rowTitle, { color: tokens.text }]}>Enabled</Text><Text style={[styles.helper, { color: tokens.textMuted }]}>Disabled tracks keep their selections.</Text></View><Toggle value={track.enabled} onChange={enabled => onChange(patchPatternTrack(state, track.id, { enabled }))} accessibilityLabel="Enable sub-bell" /></View>
    <DurationSelector value={track.cadenceMinutes} presets={CADENCE_PRESETS} min={1} max={Math.max(1, program.mainMinutes - 1)} onChange={minutes => onChange(setTrackCadence(state, track.id, minutes))} label="TRIGGER GRID" />
    <CueRow title="Sound & level" detail={`${soundTitle(track.sound)} · ${Math.round(track.volume * 100)}%`} onPress={onEditCue} />
    <View style={styles.gridHeading}><View style={styles.flex}><Text style={[styles.rowTitle, { color: tokens.text }]}>Cue positions</Text><Text style={[styles.helper, { color: tokens.textMuted }]}>Minutes after the main gong. Tap or drag to paint.</Text></View><View style={styles.inlineActions}><Pressable onPress={() => onChange(setTrackOffsets(state, track.id, []))}><Text style={[styles.link, { color: tokens.accent }]}>Clear all</Text></Pressable><Pressable onPress={() => onChange(setTrackOffsets(state, track.id, offsets))}><Text style={[styles.link, { color: tokens.accent }]}>Select all</Text></Pressable></View></View>
    <OffsetGrid offsets={offsets} selected={track.selectedOffsetsMinutes} conflicts={conflicts} onChange={selectedOffsetsMinutes => onChange(setTrackOffsets(state, track.id, selectedOffsetsMinutes))} />
    {overlaps.size ? <Text style={[styles.helper, { color: tokens.textMuted }]}>Overlap cells are shared with another track. Track order decides which sound plays; the highest track wins.</Text> : null}
    <Pressable onPress={() => confirmRemove('this sub-bell', () => { onChange(removePatternTrack(state, track.id)); onClose() })}><Text style={[styles.destructive, { color: tokens.accent }]}>Remove sub-bell</Text></Pressable>
  </BottomSheet>
}

function MixerSheet({ visible, state, onChange, onEditCue, onClose }: { visible: boolean; state: TimerV2State; onChange: (state: TimerV2State) => void; onEditCue: (target: CueTarget) => void; onClose: () => void }) {
  const { tokens } = useTheme()
  const program = state.workingPrograms[state.workingPrograms.selectedMode]
  const row = (key: string, title: string, cue: CueSettings, target: CueTarget, patch: (volume: number) => TimerV2State) => <View key={key} style={styles.mixerRow}><Pressable style={styles.mixerLabel} onPress={() => onEditCue(target)}><Text numberOfLines={1} style={[styles.rowTitle, { color: tokens.text }]}>{title}</Text><Text numberOfLines={1} style={[styles.helper, { color: tokens.textMuted }]}>{soundTitle(cue.sound)}</Text></Pressable><Slider style={styles.mixerSlider} minimumValue={0} maximumValue={1} step={0.05} value={cue.volume} onValueChange={volume => onChange(patch(volume))} minimumTrackTintColor={tokens.accent} maximumTrackTintColor={tokens.surfaceHi} thumbTintColor={tokens.accent} accessibilityLabel={`${title} volume`} /><Text style={[styles.volumeValue, { color: tokens.text }]}>{Math.round(cue.volume * 100)}</Text></View>
  return <BottomSheet visible={visible} eyebrow="ALARM STREAM" title="Mixer" onClose={onClose}>
    <Text style={[styles.helper, { color: tokens.textMuted }]}>Master volume scales every cue. Individual levels and mute state remain independent, so nothing is lost when you silence the timer.</Text>
    <View style={styles.mixerRow}><View style={styles.mixerLabel}><Text style={[styles.rowTitle, { color: tokens.text }]}>Master</Text><Text style={[styles.helper, { color: tokens.textMuted }]}>All timer sounds</Text></View><Slider style={styles.mixerSlider} minimumValue={0} maximumValue={1} step={0.05} value={state.settings.masterVolume} onValueChange={masterVolume => onChange({ ...state, settings: { ...state.settings, masterVolume } })} minimumTrackTintColor={tokens.accent} maximumTrackTintColor={tokens.surfaceHi} thumbTintColor={tokens.accent} accessibilityLabel="Master timer volume" /><Text style={[styles.volumeValue, { color: tokens.text }]}>{Math.round(state.settings.masterVolume * 100)}</Text></View>
    <View style={[styles.divider, { backgroundColor: tokens.border }]} />
    {program.mode === 'pattern' ? <>{row('main', 'Main gong', program.mainCue, { kind: 'main' }, volume => updatePattern(state, value => ({ ...value, mainCue: { ...value.mainCue, volume } })))}{program.tracks.map(track => row(track.id, `${track.cadenceMinutes}m · ${soundTitle(track.sound)}`, track, { kind: 'track', id: track.id }, volume => patchPatternTrack(state, track.id, { volume })))}</> : program.steps.map((step, index) => row(step.id, `${index + 1}. ${step.label}`, step, { kind: 'step', id: step.id }, volume => patchSequenceStep(state, step.id, { volume })))}
    <Text style={[styles.helper, { color: tokens.textDisabled }]}>Final output is also multiplied by your phone’s Alarm volume.</Text>
  </BottomSheet>
}

function FocusCard({ state, enabled, onChange, onOpenSettings }: { state: NativeFocusState; enabled: boolean; onChange: (enabled: boolean) => void; onOpenSettings: () => void }) {
  const { tokens } = useTheme()
  const description = !enabled ? 'Optional. Let Chandas manage its own Android DND rule while the timer runs.' : !state.policyAccess ? 'DND access is required before Android can activate the Chandas rule.' : state.actual === 'active' ? 'Chandas Focus is active. Alarms remain allowed.' : state.reason === 'paused-by-android' || state.reason === 'rule-disabled' ? 'Paused in Android. Turn it on here to resume automation.' : 'Ready. It activates while the timer is running and within active hours.'
  return <View style={[styles.sectionCard, { borderColor: state.actual === 'active' ? tokens.accent : tokens.border }]}><View style={styles.settingRow}><View style={styles.flex}><Text style={[styles.eyebrow, { color: tokens.textMuted }]}>FOCUS / DND</Text><Text style={[styles.rowTitle, { color: tokens.text }]}>{state.actual === 'active' ? 'Chandas Focus active' : enabled ? 'Focus automation on' : 'Focus automation off'}</Text><Text style={[styles.helper, { color: tokens.textMuted }]}>{description}</Text></View><Toggle value={enabled} onChange={onChange} accessibilityLabel="Chandas Focus automation" /></View>{enabled && !state.policyAccess ? <Pressable onPress={onOpenSettings} style={[styles.outline, { borderColor: tokens.accent }]}><Text style={[styles.link, { color: tokens.accent }]}>Grant DND access</Text></Pressable> : null}</View>
}

function CueRow({ title, detail, onPress, compact = false }: { title: string; detail: string; onPress: () => void; compact?: boolean }) {
  const { tokens } = useTheme()
  return <Pressable onPress={onPress} style={[styles.cueRow, compact && styles.cueCompact, { borderColor: tokens.border, backgroundColor: tokens.surface }]} accessibilityRole="button"><View style={styles.flex}><Text numberOfLines={1} style={[styles.rowTitle, { color: tokens.text }]}>{title}</Text><Text numberOfLines={1} style={[styles.helper, { color: tokens.textMuted }]}>{detail}</Text></View><Text style={[styles.link, { color: tokens.accent }]}>Edit</Text></Pressable>
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
  const removed = state.workingPrograms.pattern.tracks.reduce((count, track) => count + track.selectedOffsetsMinutes.filter(offset => offset >= minutes).length, 0)
  const apply = () => onChange(updatePatternMainMinutes(state, minutes))
  if (removed === 0) apply()
  else Alert.alert('Shorten main interval?', `${removed} selected cue${removed === 1 ? '' : 's'} outside the new interval will be removed.`, [{ text: 'Cancel', style: 'cancel' }, { text: 'Continue', onPress: apply }])
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

const styles = StyleSheet.create({
  screen: { flex: 1 }, content: { width: '100%', maxWidth: 620, alignSelf: 'center', paddingHorizontal: 20, gap: 23 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, eyebrow: { fontSize: 11, fontWeight: '700', letterSpacing: 1.4 }, screenTitle: { fontSize: 28, fontWeight: '600', marginTop: 3 },
  question: { width: 36, height: 36, borderWidth: 1.5, borderRadius: 18, alignItems: 'center', justifyContent: 'center' }, questionText: { fontSize: 17, fontWeight: '800' },
  modeTabs: { flexDirection: 'row', borderWidth: 1.5, borderRadius: 14, padding: 3, gap: 3 }, modeTab: { flex: 1, paddingVertical: 11, borderRadius: 10, alignItems: 'center' }, modeTabText: { fontSize: 13, fontWeight: '700' },
  summaryBar: { minHeight: 72, padding: 14, borderWidth: 1.5, borderRadius: 15, flexDirection: 'row', alignItems: 'center', gap: 12 }, summaryTitle: { fontSize: 16, fontWeight: '700', marginTop: 2 },
  section: { gap: 13 }, sectionCard: { borderWidth: 1.5, borderRadius: 15, padding: 15, gap: 12 }, sectionValue: { fontFamily: 'JetBrainsMono-Light', fontSize: 31, marginTop: 2 },
  helper: { fontSize: 12, lineHeight: 17 }, rowTitle: { fontSize: 14, fontWeight: '700' }, flex: { flex: 1, gap: 3, minWidth: 0 }, settingRow: { flexDirection: 'row', alignItems: 'center', gap: 14 }, chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  cueRow: { minHeight: 62, borderWidth: 1.5, borderRadius: 13, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 12 }, cueCompact: { minHeight: 52, paddingVertical: 9 }, link: { fontSize: 12, fontWeight: '700' },
  trackSummary: { minHeight: 74, borderWidth: 1.5, borderRadius: 14, padding: 11, flexDirection: 'row', alignItems: 'center', gap: 10 }, titleInline: { flexDirection: 'row', alignItems: 'center', gap: 8 }, priority: { fontFamily: 'JetBrainsMono-Regular', fontSize: 11 },
  empty: { padding: 15, borderWidth: 1.5, borderStyle: 'dashed', borderRadius: 13, gap: 4 }, add: { minHeight: 52, borderWidth: 1.5, borderStyle: 'dashed', borderRadius: 13, alignItems: 'center', justifyContent: 'center' }, addText: { fontSize: 13, fontWeight: '700' },
  sequenceCard: { borderWidth: 1.5, borderRadius: 15, padding: 13, gap: 11 }, sequenceHead: { flexDirection: 'row', alignItems: 'center', gap: 9 }, stepInput: { flex: 1, minWidth: 0, borderBottomWidth: 1, fontSize: 15, fontWeight: '700', paddingVertical: 5 }, remove: { fontSize: 11, textDecorationLine: 'underline' },
  gridHeading: { gap: 10 }, inlineActions: { flexDirection: 'row', alignItems: 'center', gap: 14 }, destructive: { fontSize: 12, fontWeight: '700', textAlign: 'center', paddingVertical: 8 },
  timeline: { height: 48, borderWidth: 1, borderRadius: 11, position: 'relative', overflow: 'hidden', paddingHorizontal: 8 }, timelineLine: { position: 'absolute', left: 8, right: 8, top: 20, height: 1 }, timelineBoundary: { position: 'absolute', top: 14, width: 2, height: 13 }, timelineCue: { position: 'absolute', width: 5, height: 5, marginLeft: -2.5, borderRadius: 3 }, timelineStart: { position: 'absolute', left: 7, bottom: 4, fontSize: 8 }, timelineEnd: { position: 'absolute', right: 7, bottom: 4, fontSize: 8 },
  mixerRow: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 9 }, mixerLabel: { width: 118, gap: 2 }, mixerSlider: { flex: 1, height: 34 }, volumeValue: { width: 28, fontFamily: 'JetBrainsMono-Regular', fontSize: 11, textAlign: 'right' }, divider: { height: 1 },
  outline: { alignSelf: 'flex-start', borderWidth: 1.5, borderRadius: 99, paddingHorizontal: 13, paddingVertical: 9 }, bottom: { position: 'absolute', bottom: 0, left: 0, right: 0, paddingHorizontal: 20 }, start: { width: '100%', maxWidth: 580, alignSelf: 'center', borderRadius: 99, paddingVertical: 17, alignItems: 'center' }, startText: { color: '#fff', fontSize: 14, fontWeight: '800', letterSpacing: 1.1, textTransform: 'uppercase' },
})
