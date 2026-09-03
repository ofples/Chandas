import { useState } from 'react'
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import Slider from '@react-native-community/slider'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type { CueSettings, PatternTrack, SoundRef, TimerV2State } from '../types'
import { ActiveHoursConfig } from '../components/ActiveHoursConfig'
import { Chip } from '../components/Chip'
import { Toggle } from '../components/Toggle'
import {
  addPatternTrack,
  addSequenceStep,
  chooseProgramMode,
  deleteProgramPreset,
  loadProgramPreset,
  patchPatternTrack,
  patchSequenceStep,
  removePatternTrack,
  removeSequenceStep,
  reorderPatternTracks,
  reorderSequenceSteps,
  saveProgramPreset,
  setTrackCadence,
  setTrackOffsets,
  toggleTrackOffset,
  updatePattern,
  updatePatternMainMinutes,
} from '../lib/programActions'
import { BUILT_IN_SOUNDS, soundTitle } from '../lib/soundLibrary'
import { validOffsets } from '../lib/timerV2'
import { useTheme } from '../theme/ThemeContext'
import { ChandasTimerService, isNativeServiceAvailable } from '../native/ChandasTimerService'

const MAIN_PRESETS = [5, 10, 15, 25, 30, 45, 60]
const CADENCE_PRESETS = [1, 2, 5, 10, 15]

interface Props {
  state: TimerV2State
  onChange: (state: TimerV2State) => void
  onStart: () => void
  focusPolicyAccess: boolean
  onFocusAutomationChange: (enabled: boolean) => void
  onOpenFocusSettings: () => void
}

interface EditingCue {
  title: string
  cue: CueSettings
  onChange: (cue: CueSettings) => void
}

export function TimerV2ConfigScreen({
  state,
  onChange,
  onStart,
  focusPolicyAccess,
  onFocusAutomationChange,
  onOpenFocusSettings,
}: Props) {
  const { tokens } = useTheme()
  const insets = useSafeAreaInsets()
  const [editingCue, setEditingCue] = useState<EditingCue | null>(null)
  const [presetsOpen, setPresetsOpen] = useState(false)
  const [presetName, setPresetName] = useState('')
  const [helpOpen, setHelpOpen] = useState(false)
  const program = state.workingPrograms[state.workingPrograms.selectedMode]
  const settings = state.settings

  const setSettings = (patch: Partial<typeof settings>) => onChange({ ...state, settings: { ...settings, ...patch } })
  const editMainCue = () => setEditingCue({
    title: 'Main gong', cue: state.workingPrograms.pattern.mainCue,
    onChange: mainCue => onChange(updatePattern(state, pattern => ({ ...pattern, mainCue }))),
  })

  return (
    <View style={[styles.screen, { backgroundColor: tokens.bg }]}>
      <ScrollView contentContainerStyle={[styles.content, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 110 }]}>
        <View style={styles.header}>
          <View>
            <Text style={[styles.eyebrow, { color: tokens.accent }]}>CHANDAS</Text>
            <Text style={[styles.title, { color: tokens.text }]}>Interval timer</Text>
          </View>
          <Pressable onPress={() => setHelpOpen(true)} style={[styles.question, { borderColor: tokens.border }]} accessibilityLabel="Timer help">
            <Text style={[styles.questionText, { color: tokens.accent }]}>?</Text>
          </Pressable>
        </View>

        <View style={[styles.modeTabs, { borderColor: tokens.border }]}>
          {(['pattern', 'sequence'] as const).map(mode => (
            <Pressable key={mode} onPress={() => onChange(chooseProgramMode(state, mode))} style={[styles.modeTab, state.workingPrograms.selectedMode === mode && { backgroundColor: tokens.accent }]}>
              <Text style={[styles.modeTabText, { color: state.workingPrograms.selectedMode === mode ? '#fff' : tokens.textMuted }]}>{mode === 'pattern' ? 'Main + sub-bells' : 'Sequence / sets'}</Text>
            </Pressable>
          ))}
        </View>

        <Pressable onPress={() => setPresetsOpen(true)} style={[styles.presetBar, { borderColor: tokens.border, backgroundColor: tokens.surface }]}>
          <View>
            <Text style={[styles.eyebrow, { color: tokens.textMuted }]}>CONFIGURATION</Text>
            <Text style={[styles.presetTitle, { color: tokens.text }]}>{state.workingPrograms.sourcePreset?.name ?? 'Working copy'}</Text>
          </View>
          <Text style={[styles.presetAction, { color: tokens.accent }]}>Save / load</Text>
        </Pressable>

        {program.mode === 'pattern' ? (
          <PatternEditor state={state} onChange={onChange} onEditMainCue={editMainCue} onEditCue={setEditingCue} />
        ) : (
          <SequenceEditor state={state} onChange={onChange} onEditCue={setEditingCue} />
        )}

        <View style={styles.section}>
          <Text style={[styles.eyebrow, { color: tokens.textMuted }]}>MIXER</Text>
          <Text style={[styles.helper, { color: tokens.textMuted }]}>Master volume scales every bell; each cue keeps its own level.</Text>
          <View style={styles.sliderRow}>
            <Text style={[styles.sliderValue, { color: tokens.text }]}>{Math.round(settings.masterVolume * 100)}%</Text>
            <Slider style={styles.slider} minimumValue={0} maximumValue={1} step={0.05} value={settings.masterVolume} onValueChange={masterVolume => setSettings({ masterVolume })} minimumTrackTintColor={tokens.accent} maximumTrackTintColor={tokens.surfaceHi} thumbTintColor={tokens.accent} />
          </View>
        </View>

        <View style={styles.section}>
          <ActiveHoursConfig
            enabled={settings.activeHoursEnabled}
            startMinutes={settings.activeHoursStart}
            endMinutes={settings.activeHoursEnd}
            onToggle={activeHoursEnabled => setSettings({ activeHoursEnabled })}
            onStartChange={activeHoursStart => setSettings({ activeHoursStart })}
            onEndChange={activeHoursEnd => setSettings({ activeHoursEnd })}
          />
        </View>

        {Platform.OS === 'android' && (
          <View style={styles.section}>
            <View style={styles.line}>
              <View style={styles.lineCopy}>
                <Text style={[styles.eyebrow, { color: tokens.textMuted }]}>FOCUS / DND</Text>
                <Text style={[styles.helper, { color: tokens.textMuted }]}>Uses Android’s existing DND permissions and reflects system changes.</Text>
              </View>
              <Toggle value={settings.focusAutomationEnabled} onChange={onFocusAutomationChange} accessibilityLabel="Focus and Do Not Disturb automation" />
            </View>
            {settings.focusAutomationEnabled && !focusPolicyAccess && (
              <Pressable onPress={onOpenFocusSettings} style={[styles.outlineButton, { borderColor: tokens.accent }]}><Text style={[styles.outlineButtonText, { color: tokens.accent }]}>Grant DND access</Text></Pressable>
            )}
          </View>
        )}
      </ScrollView>

      <View style={[styles.bottom, { backgroundColor: tokens.bg, paddingBottom: insets.bottom + 16 }]}>
        <Pressable onPress={onStart} style={({ pressed }) => [styles.start, { backgroundColor: tokens.accent, opacity: pressed ? 0.75 : 1 }]}><Text style={styles.startText}>Start timer</Text></Pressable>
      </View>

      <SoundSheet editingCue={editingCue} onClose={() => setEditingCue(null)} />
      <PresetSheet visible={presetsOpen} state={state} presetName={presetName} onPresetNameChange={setPresetName} onChange={onChange} onClose={() => setPresetsOpen(false)} />
      <HelpSheet visible={helpOpen} onClose={() => setHelpOpen(false)} />
    </View>
  )
}

function PatternEditor({ state, onChange, onEditMainCue, onEditCue }: { state: TimerV2State; onChange: (state: TimerV2State) => void; onEditMainCue: () => void; onEditCue: (cue: EditingCue) => void }) {
  const { tokens } = useTheme()
  const program = state.workingPrograms.pattern
  return <>
    <View style={styles.section}>
      <Text style={[styles.eyebrow, { color: tokens.textMuted }]}>MAIN INTERVAL</Text>
      <View style={styles.chips}>{MAIN_PRESETS.map(minutes => <Chip key={minutes} label={`${minutes}m`} active={program.mainMinutes === minutes} onPress={() => onChange(updatePatternMainMinutes(state, minutes))} />)}</View>
      <View style={styles.line}>
        <View style={styles.lineCopy}><Text style={[styles.rowTitle, { color: tokens.text }]}>Align to clock</Text><Text style={[styles.helper, { color: tokens.textMuted }]}>Snap this repeating pattern to local wall-clock minutes.</Text></View>
        <Toggle value={program.alignment.kind === 'local-clock'} onChange={enabled => onChange(updatePattern(state, value => ({ ...value, alignment: enabled ? { kind: 'local-clock', offsetMinutes: 0 } : { kind: 'elapsed' } })))} accessibilityLabel="Align interval to clock" />
      </View>
      {program.alignment.kind === 'local-clock' && <View style={styles.chips}>{[0, 5, 10, 15, 30, 45].map(offset => <Chip key={offset} label={offset === 0 ? ':00' : `:${String(offset).padStart(2, '0')}`} active={program.alignment.kind === 'local-clock' && program.alignment.offsetMinutes === offset} onPress={() => onChange(updatePattern(state, value => ({ ...value, alignment: { kind: 'local-clock', offsetMinutes: offset } })))} />)}</View>}
      <CueRow label="Main gong" cue={program.mainCue} onPress={onEditMainCue} />
    </View>
    <View style={styles.section}>
      <View style={styles.line}><View><Text style={[styles.eyebrow, { color: tokens.textMuted }]}>SUB-BELLS</Text><Text style={[styles.helper, { color: tokens.textMuted }]}>{program.tracks.length} of 5 tracks · top track wins overlaps</Text></View></View>
      {program.tracks.map((track, index) => <TrackEditor key={track.id} track={track} index={index} total={program.tracks.length} mainMinutes={program.mainMinutes} onChange={onChange} state={state} onEditCue={onEditCue} />)}
      {program.tracks.length < 5 && <Pressable onPress={() => onChange(addPatternTrack(state))} style={[styles.add, { borderColor: tokens.accent }]}><Text style={[styles.addText, { color: tokens.accent }]}>+ Add sub-bell</Text></Pressable>}
    </View>
  </>
}

function TrackEditor({ state, onChange, track, index, total, mainMinutes, onEditCue }: { state: TimerV2State; onChange: (state: TimerV2State) => void; track: PatternTrack; index: number; total: number; mainMinutes: number; onEditCue: (cue: EditingCue) => void }) {
  const { tokens } = useTheme()
  const offsets = validOffsets(mainMinutes, track.cadenceMinutes)
  return <View style={[styles.track, { borderColor: track.enabled ? tokens.border : tokens.surfaceHi, opacity: track.enabled ? 1 : 0.52 }]}>
    <View style={styles.line}>
      <View style={styles.dragLine}><Text style={[styles.drag, { color: tokens.textMuted }]}>⠿</Text><Text style={[styles.rowTitle, { color: tokens.text }]}>{soundTitle(track.sound)}</Text></View>
      <View style={styles.actionRow}>
        <Pressable disabled={index === 0} onPress={() => onChange(reorderPatternTracks(state, index, index - 1))} accessibilityLabel="Move track earlier"><Text style={[styles.order, { color: index === 0 ? tokens.surfaceHi : tokens.accent }]}>↑</Text></Pressable>
        <Pressable disabled={index === total - 1} onPress={() => onChange(reorderPatternTracks(state, index, index + 1))} accessibilityLabel="Move track later"><Text style={[styles.order, { color: index === total - 1 ? tokens.surfaceHi : tokens.accent }]}>↓</Text></Pressable>
        <Toggle value={track.enabled} onChange={enabled => onChange(patchPatternTrack(state, track.id, { enabled }))} accessibilityLabel={`Enable ${soundTitle(track.sound)}`} />
      </View>
    </View>
    <CueRow label={`${track.cadenceMinutes}m bell`} cue={track} compact onPress={() => onEditCue({ title: 'Sub-bell sound', cue: track, onChange: cue => onChange(patchPatternTrack(state, track.id, cue)) })} />
    <View style={styles.chips}>{CADENCE_PRESETS.filter(value => value < mainMinutes).map(minutes => <Chip key={minutes} label={`${minutes}m`} active={track.cadenceMinutes === minutes} onPress={() => onChange(setTrackCadence(state, track.id, minutes))} />)}</View>
    <View style={styles.gridActions}><Text style={[styles.helper, { color: tokens.textMuted }]}>Choose cues within the main interval</Text><View style={styles.actionRow}><Pressable onPress={() => onChange(setTrackOffsets(state, track.id, []))}><Text style={[styles.smallAction, { color: tokens.accent }]}>Clear</Text></Pressable><Pressable onPress={() => onChange(setTrackOffsets(state, track.id, offsets))}><Text style={[styles.smallAction, { color: tokens.accent }]}>All</Text></Pressable></View></View>
    <View style={styles.grid}>{offsets.map(offset => <Pressable key={offset} onPress={() => onChange(toggleTrackOffset(state, track.id, offset))} style={[styles.gridCell, { borderColor: track.selectedOffsetsMinutes.includes(offset) ? tokens.accent : tokens.border, backgroundColor: track.selectedOffsetsMinutes.includes(offset) ? tokens.accentGlow : 'transparent' }]}><Text style={[styles.gridText, { color: track.selectedOffsetsMinutes.includes(offset) ? tokens.text : tokens.textMuted }]}>{offset}m</Text></Pressable>)}</View>
    <Pressable onPress={() => onChange(removePatternTrack(state, track.id))}><Text style={[styles.delete, { color: tokens.textMuted }]}>Remove track</Text></Pressable>
  </View>
}

function SequenceEditor({ state, onChange, onEditCue }: { state: TimerV2State; onChange: (state: TimerV2State) => void; onEditCue: (cue: EditingCue) => void }) {
  const { tokens } = useTheme(); const program = state.workingPrograms.sequence
  return <View style={styles.section}>
    <View><Text style={[styles.eyebrow, { color: tokens.textMuted }]}>INTERVAL SEQUENCE</Text><Text style={[styles.helper, { color: tokens.textMuted }]}>Steps repeat in this order. Drag handles establish their playback order.</Text></View>
    {program.steps.map((step, index) => <View key={step.id} style={[styles.track, { borderColor: tokens.border }]}>
      <View style={styles.line}><View style={styles.dragLine}><Text style={[styles.drag, { color: tokens.textMuted }]}>⠿</Text><Text style={[styles.sequenceNumber, { color: tokens.accent }]}>{String(index + 1).padStart(2, '0')}</Text><TextInput value={step.label} onChangeText={label => onChange(patchSequenceStep(state, step.id, { label }))} style={[styles.stepInput, { color: tokens.text, borderBottomColor: tokens.border }]} /></View><View style={styles.actionRow}><Pressable disabled={index === 0} onPress={() => onChange(reorderSequenceSteps(state, index, index - 1))}><Text style={[styles.order, { color: index === 0 ? tokens.surfaceHi : tokens.accent }]}>↑</Text></Pressable><Pressable disabled={index === program.steps.length - 1} onPress={() => onChange(reorderSequenceSteps(state, index, index + 1))}><Text style={[styles.order, { color: index === program.steps.length - 1 ? tokens.surfaceHi : tokens.accent }]}>↓</Text></Pressable></View></View>
      <View style={styles.chips}>{MAIN_PRESETS.map(minutes => <Chip key={minutes} label={`${minutes}m`} active={step.durationMinutes === minutes} onPress={() => onChange(patchSequenceStep(state, step.id, { durationMinutes: minutes }))} />)}</View>
      <CueRow label={`${step.durationMinutes}m · ${soundTitle(step.sound)}`} cue={step} compact onPress={() => onEditCue({ title: `${step.label} sound`, cue: step, onChange: cue => onChange(patchSequenceStep(state, step.id, cue)) })} />
      {program.steps.length > 1 && <Pressable onPress={() => onChange(removeSequenceStep(state, step.id))}><Text style={[styles.delete, { color: tokens.textMuted }]}>Remove step</Text></Pressable>}
    </View>)}
    {program.steps.length < 20 && <Pressable onPress={() => onChange(addSequenceStep(state))} style={[styles.add, { borderColor: tokens.accent }]}><Text style={[styles.addText, { color: tokens.accent }]}>+ Add step</Text></Pressable>}
  </View>
}

function CueRow({ label, cue, onPress, compact = false }: { label: string; cue: CueSettings; onPress: () => void; compact?: boolean }) {
  const { tokens } = useTheme()
  return <Pressable onPress={onPress} style={[styles.cue, { borderColor: tokens.border, backgroundColor: tokens.surface }]}><View><Text style={[compact ? styles.cueLabelSmall : styles.rowTitle, { color: tokens.text }]}>{label}</Text><Text style={[styles.helper, { color: tokens.textMuted }]}>{soundTitle(cue.sound)} · {Math.round(cue.volume * 100)}%</Text></View><Text style={[styles.cueEdit, { color: tokens.accent }]}>Edit</Text></Pressable>
}

function SoundSheet({ editingCue, onClose }: { editingCue: EditingCue | null; onClose: () => void }) {
  const { tokens } = useTheme()
  if (!editingCue) return null
  const update = (patch: Partial<CueSettings>) => editingCue.onChange({ ...editingCue.cue, ...patch })
  const pick = (ringtoneType: 'alarm' | 'notification') => void ChandasTimerService.pickDeviceSound(ringtoneType).then(selected => { if (selected) update({ sound: { kind: 'android', ...selected, ringtoneType } }) })
  return <Modal visible transparent animationType="slide" onRequestClose={onClose}><Pressable style={styles.backdrop} onPress={onClose}><Pressable onPress={event => event.stopPropagation()} style={[styles.sheet, { backgroundColor: tokens.surface, borderColor: tokens.border }]}><View style={styles.line}><View><Text style={[styles.eyebrow, { color: tokens.textMuted }]}>SOUND</Text><Text style={[styles.presetTitle, { color: tokens.text }]}>{editingCue.title}</Text></View><Pressable onPress={onClose}><Text style={[styles.cueEdit, { color: tokens.accent }]}>Done</Text></Pressable></View><View style={styles.soundList}>{BUILT_IN_SOUNDS.map(sound => <Pressable key={sound.id} onPress={() => update({ sound: { kind: 'builtin', id: sound.id } })} style={[styles.soundOption, { borderColor: editingCue.cue.sound.kind === 'builtin' && editingCue.cue.sound.id === sound.id ? tokens.accent : tokens.border }]}><View><Text style={[styles.rowTitle, { color: tokens.text }]}>{sound.name}</Text><Text style={[styles.helper, { color: tokens.textMuted }]}>{sound.description}</Text></View><Text style={[styles.cueEdit, { color: tokens.accent }]}>{editingCue.cue.sound.kind === 'builtin' && editingCue.cue.sound.id === sound.id ? 'Selected' : 'Select'}</Text></Pressable>)}</View>{Platform.OS === 'android' && isNativeServiceAvailable && <View style={styles.pickRow}><Pressable onPress={() => pick('alarm')} style={[styles.outlineButton, { borderColor: tokens.accent }]}><Text style={[styles.outlineButtonText, { color: tokens.accent }]}>Device alarm</Text></Pressable><Pressable onPress={() => pick('notification')} style={[styles.outlineButton, { borderColor: tokens.accent }]}><Text style={[styles.outlineButtonText, { color: tokens.accent }]}>Device notification</Text></Pressable></View>}<View style={styles.sliderRow}><Text style={[styles.sliderValue, { color: tokens.text }]}>{Math.round(editingCue.cue.volume * 100)}%</Text><Slider style={styles.slider} minimumValue={0} maximumValue={1} step={0.05} value={editingCue.cue.volume} onValueChange={volume => update({ volume })} minimumTrackTintColor={tokens.accent} maximumTrackTintColor={tokens.surfaceHi} thumbTintColor={tokens.accent} /></View></Pressable></Pressable></Modal>
}

function PresetSheet({ visible, state, presetName, onPresetNameChange, onChange, onClose }: { visible: boolean; state: TimerV2State; presetName: string; onPresetNameChange: (name: string) => void; onChange: (state: TimerV2State) => void; onClose: () => void }) {
  const { tokens } = useTheme()
  return <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}><Pressable style={styles.backdrop} onPress={onClose}><Pressable onPress={event => event.stopPropagation()} style={[styles.sheet, { backgroundColor: tokens.surface, borderColor: tokens.border }]}><View style={styles.line}><View><Text style={[styles.eyebrow, { color: tokens.textMuted }]}>CONFIGURATIONS</Text><Text style={[styles.presetTitle, { color: tokens.text }]}>Save a snapshot</Text></View><Pressable onPress={onClose}><Text style={[styles.cueEdit, { color: tokens.accent }]}>Done</Text></Pressable></View><View style={styles.presetSave}><TextInput value={presetName} onChangeText={onPresetNameChange} placeholder="Name this configuration" placeholderTextColor={tokens.textMuted} style={[styles.nameInput, { color: tokens.text, borderColor: tokens.border }]} /><Pressable onPress={() => { onChange(saveProgramPreset(state, presetName)); onPresetNameChange('') }} style={[styles.saveButton, { backgroundColor: tokens.accent }]}><Text style={styles.saveButtonText}>Save new</Text></Pressable></View><Text style={[styles.helper, { color: tokens.textMuted }]}>Loading copies a preset into a working copy. Saved configurations are never edited in place.</Text><View style={styles.presetList}>{state.presets.length === 0 ? <Text style={[styles.helper, { color: tokens.textMuted }]}>No saved configurations yet.</Text> : state.presets.map(preset => <View key={preset.id} style={[styles.soundOption, { borderColor: tokens.border }]}><Pressable style={styles.lineCopy} onPress={() => { onChange(loadProgramPreset(state, preset.id)); onClose() }}><Text style={[styles.rowTitle, { color: tokens.text }]}>{preset.name}</Text><Text style={[styles.helper, { color: tokens.textMuted }]}>{preset.program.mode === 'pattern' ? 'Main + sub-bells' : `${preset.program.steps.length} sequence steps`}</Text></Pressable><Pressable onPress={() => onChange(deleteProgramPreset(state, preset.id))}><Text style={[styles.delete, { color: tokens.textMuted }]}>Delete</Text></Pressable></View>)}</View></Pressable></Pressable></Modal>
}

function HelpSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { tokens } = useTheme()
  return <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}><Pressable style={styles.backdrop} onPress={onClose}><Pressable onPress={event => event.stopPropagation()} style={[styles.sheet, { backgroundColor: tokens.surface, borderColor: tokens.border }]}><Text style={[styles.presetTitle, { color: tokens.text }]}>Timer help</Text><Text style={[styles.help, { color: tokens.textMuted }]}>Main + sub-bells repeats one main interval. Each sub-bell has its own cadence, selected offsets, sound and level. Track order resolves a same-minute overlap. Sequence / sets plays each step’s cue at its end and then repeats.</Text><Text style={[styles.help, { color: tokens.textMuted }]}>The alarm button is one-shot by default; tap again quickly to lock it for every main gong. Timed mute leaves the last requested main boundary audible. During calls, Android suppresses normal bells and resumes only at the next future cue.</Text><Pressable onPress={onClose} style={[styles.saveButton, { backgroundColor: tokens.accent }]}><Text style={styles.saveButtonText}>Got it</Text></Pressable></Pressable></Pressable></Modal>
}

const styles = StyleSheet.create({
  screen: { flex: 1 }, content: { width: '100%', maxWidth: 600, alignSelf: 'center', gap: 24, paddingHorizontal: 20 }, header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, eyebrow: { fontSize: 11, letterSpacing: 1.4, fontWeight: '700' }, title: { fontSize: 27, fontWeight: '600', marginTop: 3 }, question: { width: 34, height: 34, borderWidth: 1.5, borderRadius: 17, alignItems: 'center', justifyContent: 'center' }, questionText: { fontSize: 17, fontWeight: '700' }, modeTabs: { flexDirection: 'row', borderWidth: 1.5, borderRadius: 14, padding: 3, gap: 3 }, modeTab: { flex: 1, paddingVertical: 11, borderRadius: 10, alignItems: 'center' }, modeTabText: { fontSize: 13, fontWeight: '600' }, presetBar: { padding: 14, borderWidth: 1.5, borderRadius: 14, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, presetTitle: { fontSize: 17, fontWeight: '600', marginTop: 3 }, presetAction: { fontSize: 12, fontWeight: '700' }, section: { gap: 12 }, chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, line: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 }, lineCopy: { flex: 1, gap: 3 }, rowTitle: { fontSize: 14, fontWeight: '600' }, helper: { fontSize: 12, lineHeight: 17 }, sliderRow: { flexDirection: 'row', alignItems: 'center', gap: 12 }, sliderValue: { fontFamily: 'JetBrainsMono-Regular', width: 38, fontSize: 13 }, slider: { flex: 1, height: 34 }, track: { gap: 11, borderWidth: 1.5, padding: 14, borderRadius: 14 }, dragLine: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }, drag: { fontSize: 20, lineHeight: 20 }, actionRow: { flexDirection: 'row', alignItems: 'center', gap: 10 }, order: { fontSize: 18, fontWeight: '600', paddingHorizontal: 3 }, cue: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderWidth: 1, padding: 11, borderRadius: 10 }, cueLabelSmall: { fontSize: 13, fontWeight: '600' }, cueEdit: { fontSize: 12, fontWeight: '700' }, gridActions: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, smallAction: { fontSize: 12, fontWeight: '700', marginLeft: 12 }, grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 }, gridCell: { width: 47, paddingVertical: 8, borderRadius: 8, borderWidth: 1, alignItems: 'center' }, gridText: { fontFamily: 'JetBrainsMono-Regular', fontSize: 11 }, delete: { fontSize: 12, textDecorationLine: 'underline' }, add: { borderWidth: 1.5, borderStyle: 'dashed', borderRadius: 12, paddingVertical: 14, alignItems: 'center' }, addText: { fontSize: 13, fontWeight: '700' }, outlineButton: { alignSelf: 'flex-start', borderWidth: 1.5, paddingVertical: 9, paddingHorizontal: 12, borderRadius: 99 }, outlineButtonText: { fontSize: 12, fontWeight: '700' }, pickRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, bottom: { position: 'absolute', bottom: 0, left: 0, right: 0, paddingHorizontal: 20 }, start: { borderRadius: 99, alignItems: 'center', paddingVertical: 17 }, startText: { color: '#fff', textTransform: 'uppercase', letterSpacing: 1.1, fontSize: 14, fontWeight: '700' }, backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' }, sheet: { gap: 16, borderTopLeftRadius: 18, borderTopRightRadius: 18, borderWidth: 1.5, borderBottomWidth: 0, padding: 20, maxHeight: '88%' }, soundList: { gap: 8 }, soundOption: { padding: 12, borderWidth: 1, borderRadius: 11, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }, presetSave: { flexDirection: 'row', gap: 8 }, nameInput: { flex: 1, minHeight: 43, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, fontSize: 14 }, saveButton: { borderRadius: 10, alignItems: 'center', justifyContent: 'center', paddingVertical: 11, paddingHorizontal: 15 }, saveButtonText: { color: '#fff', fontSize: 13, fontWeight: '700' }, presetList: { gap: 8 }, sequenceNumber: { fontFamily: 'JetBrainsMono-Regular', fontSize: 12 }, stepInput: { flex: 1, borderBottomWidth: 1, fontSize: 14, fontWeight: '600', paddingVertical: 3 }, help: { fontSize: 14, lineHeight: 21 },
})
