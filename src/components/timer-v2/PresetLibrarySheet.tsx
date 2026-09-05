import { useEffect, useMemo, useState } from 'react'
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import * as Haptics from 'expo-haptics'
import Animated, { FadeIn, FadeInDown, FadeOut, LinearTransition, useReducedMotion } from 'react-native-reanimated'
import type { ProgramPreset, TimerMode, TimerProgram, TimerV2State } from '../../types'
import { deleteProgramPreset, loadProgramPreset, saveProgramPreset, updatePattern } from '../../lib/programActions'
import { soundTitle } from '../../lib/soundLibrary'
import { useTheme } from '../../theme/ThemeContext'
import { BottomSheet } from './BottomSheet'
import { GentleNotice, type AppNotice } from './experience-feedback'
import { formatDuration } from './run-length-config'
import { SegmentedControl } from './SegmentedControl'
import { SheetTextButton } from './SheetTextButton'
import { subBellColorValue } from '../../lib/subBellColors'
import { tapHaptic } from '../../lib/haptics'
import { SwipeToDeleteRow } from './swipe-to-delete-row'

const FILTERS = [{ value: 'all', label: 'All' }, { value: 'pattern', label: 'Cycle' }, { value: 'sequence', label: 'Sequence' }] as const

interface Props {
  visible: boolean
  state: TimerV2State
  onChange: (state: TimerV2State) => void
  onClose: () => void
  onFeedback: (notice: Omit<AppNotice, 'id'>) => void
}

export function PresetLibrarySheet({ visible, state, onChange, onClose, onFeedback }: Props) {
  const { tokens } = useTheme()
  const reducedMotion = useReducedMotion()
  const [name, setName] = useState('')
  const [filter, setFilter] = useState<'all' | TimerMode>('all')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [savedName, setSavedName] = useState<string | null>(null)
  const presets = useMemo(() => state.presets.filter(preset => filter === 'all' || preset.program.mode === filter), [filter, state.presets])
  const selected = state.presets.find(preset => preset.id === selectedId) ?? null
  const canSave = name.trim().length > 0

  useEffect(() => {
    if (visible) {
      const sourceName = state.workingPrograms.sourcePreset?.name
      setName(state.workingPrograms.selectedMode === 'pattern' ? state.workingPrograms.pattern.label : sourceName ?? 'Sequence')
    } else {
      setSavedName(null)
      setSelectedId(null)
    }
  }, [visible])

  const save = () => {
    if (!canSave) return
    const cleanName = name.trim()
    const namedState = state.workingPrograms.selectedMode === 'pattern'
      ? updatePattern(state, program => ({ ...program, label: cleanName }))
      : state
    onChange(saveProgramPreset(namedState, cleanName))
    setSavedName(cleanName)
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined)
    setName(cleanName)
  }
  const remove = (preset: ProgramPreset) => {
    onChange(deleteProgramPreset(state, preset.id))
    setSelectedId(current => current === preset.id ? null : current)
    onFeedback({ title: 'Configuration removed', message: 'Your current working copy was not changed.', tone: 'info' })
  }

  return (
    <BottomSheet visible={visible} eyebrow="SAVED SETUPS" title="Configurations" onClose={onClose}>
      {!selected ? <View style={styles.current}><Text style={[styles.presetTitle, { color: tokens.text }]}>Save current {state.workingPrograms.selectedMode === 'pattern' ? 'Cycle' : 'Sequence'}</Text><PresetVisual program={state.workingPrograms[state.workingPrograms.selectedMode]} /></View> : null}
      {!selected ? <View style={styles.saveRow}>
        <TextInput
          value={name}
          onChangeText={value => { setName([...value].slice(0, 80).join('')); setSavedName(null) }}
          onSubmitEditing={save}
          placeholder="Name this configuration"
          placeholderTextColor={tokens.textMuted}
          returnKeyType="done"
          style={[styles.input, { color: tokens.text, borderColor: tokens.border, backgroundColor: tokens.surfaceHi }]}
          accessibilityLabel="New configuration name"
        />
        <SheetTextButton disabled={!canSave} label="Save" onPress={save} />
      </View> : null}
      {!selected && savedName ? <GentleNotice title="Configuration saved" message={`“${savedName}” is ready to load.`} tone="success" /> : null}
      {!selected ? <SegmentedControl items={FILTERS} value={filter} onChange={setFilter} accessibilityLabel="Configuration type" /> : null}
      {selected ? <Animated.View entering={FadeInDown.duration(reducedMotion ? 80 : 180)} exiting={FadeOut.duration(reducedMotion ? 70 : 130)} style={[styles.inspector, { borderColor: tokens.border, backgroundColor: tokens.surfaceHi }]}>
        <View style={styles.copy}><Text style={[styles.presetTitle, { color: tokens.text }]}>{selected.name}</Text><PresetVisual program={selected.program} /><Text style={[styles.date, { color: tokens.textMuted }]}>Saved {new Date(selected.createdAt).toLocaleString()}</Text><PresetDetails preset={selected} /><Text style={[styles.helper, { color: tokens.text }]}>Loads as a new working copy.</Text></View>
        <View style={styles.inspectorActions}><SheetTextButton label="Cancel" tone="muted" onPress={() => setSelectedId(null)} /><SheetTextButton label="Load" onPress={() => { onChange(loadProgramPreset(state, selected.id)); setSelectedId(null); onClose(); onFeedback({ title: 'Configuration loaded', message: `“${selected.name}” is ready to adjust.`, tone: 'success' }) }} /></View>
      </Animated.View> : null}
      {!selected ? <View style={styles.list}>
        {presets.length === 0 ? <GentleNotice title={state.presets.length === 0 ? 'No saved configurations yet' : `No ${filter === 'pattern' ? 'Cycle' : 'Sequence'} configurations`} message={state.presets.length === 0 ? 'Name the current setup above to save it.' : 'Try All or save the current setup.'} /> : presets.map(preset => {
          const loaded = state.workingPrograms.sourcePreset?.id === preset.id && !state.workingPrograms.sourcePreset.deleted
          return <Animated.View key={preset.id} entering={FadeInDown.duration(reducedMotion ? 80 : 180)} exiting={FadeOut.duration(reducedMotion ? 70 : 120)} layout={reducedMotion ? undefined : LinearTransition.duration(160)}>
            <SwipeToDeleteRow accessibilityLabel={`Delete ${preset.name}`} onDelete={() => remove(preset)}>
            <Pressable style={[styles.preset, { borderColor: tokens.border, backgroundColor: tokens.surfaceHi }]} onPress={() => { tapHaptic(); setSelectedId(preset.id) }} accessibilityRole="button" accessibilityLabel={`Open ${preset.name}`}>
              <View style={styles.copy}>
              <View style={styles.titleRow}><Text numberOfLines={1} style={[styles.presetTitle, { color: tokens.text }]}>{preset.name}</Text>{loaded ? <Text style={[styles.loaded, { color: tokens.accent }]}>LOADED</Text> : null}</View>
              <PresetVisual program={preset.program} />
              <Text style={[styles.date, { color: tokens.textMuted }]}>Saved {new Date(preset.createdAt).toLocaleString()}</Text>
              </View><Text style={[styles.chevron, { color: tokens.accent }]}>›</Text>
            </Pressable>
            </SwipeToDeleteRow>
          </Animated.View>
        })}
      </View> : null}
    </BottomSheet>
  )
}

function PresetVisual({ program }: { program: TimerProgram }) {
  const { tokens } = useTheme()
  if (program.mode === 'pattern') {
    const tracks = program.subBellsEnabled ? program.tracks.filter(track => track.enabled) : []
    const cues = tracks.reduce((count, track) => count + track.selectedOffsetsMinutes.length, 0)
    return <View style={styles.visual} accessibilityLabel={`${program.mainMinutes} minute cycle with ${cues} sub-bell cues`}>
      <View style={styles.visualMeta}><Text style={[styles.visualKind, { color: tokens.text }]}>Cycle · {program.mainMinutes}m</Text><Text style={[styles.visualCount, { color: tokens.textMuted }]}>{cues} cue{cues === 1 ? '' : 's'}</Text></View>
      <View style={styles.visualTrack}><View style={[styles.visualLine, { backgroundColor: tokens.border }]} /><View style={[styles.visualBoundary, { left: 0, backgroundColor: tokens.accent }]} /><View style={[styles.visualBoundary, { right: 0, backgroundColor: tokens.accent }]} />{tracks.flatMap((track, trackIndex) => track.selectedOffsetsMinutes.map(offset => <View key={`${track.id}:${offset}`} style={[styles.visualCue, { left: `${offset / program.mainMinutes * 100}%`, backgroundColor: subBellColorValue(track.color, trackIndex) }]} />))}</View>
    </View>
  }
  const total = Math.max(1, program.steps.reduce((sum, step) => sum + step.durationMinutes, 0))
  return <View style={styles.visual} accessibilityLabel={`${program.steps.length} step sequence lasting ${total} minutes`}>
    <View style={styles.visualMeta}><Text style={[styles.visualKind, { color: tokens.text }]}>Sequence · {total}m</Text><Text style={[styles.visualCount, { color: tokens.textMuted }]}>{program.steps.length} step{program.steps.length === 1 ? '' : 's'}</Text></View>
    <View style={[styles.sequenceTrack, { backgroundColor: tokens.border }]}>{program.steps.map((step, index) => <View key={step.id} style={[styles.sequenceSegment, { flex: step.durationMinutes, backgroundColor: tokens.accent, opacity: 0.45 + index % 3 * 0.18 }]} />)}</View>
  </View>
}

function PresetDetails({ preset }: { preset: ProgramPreset }) {
  const { tokens } = useTheme()
  const program = preset.program
  const run = program.runPolicy.kind === 'continuous'
    ? 'Continuous'
    : program.runPolicy.kind === 'cycles'
      ? `${program.runPolicy.cycleCount} ${program.mode === 'sequence' ? (program.runPolicy.cycleCount === 1 ? 'round' : 'rounds') : (program.runPolicy.cycleCount === 1 ? 'main cycle' : 'main cycles')}`
      : formatDuration(program.runPolicy.durationSeconds)
  if (program.mode === 'sequence') return <View style={[styles.details, { borderColor: tokens.border }]}><Text style={[styles.detailLine, { color: tokens.text }]}>Run · {run}</Text>{program.steps.map((step, index) => <Text key={step.id} style={[styles.detailLine, { color: tokens.text }]}>{index + 1}. {step.label} · {step.durationMinutes}m · {soundTitle(step.sound)} · {Math.round(step.volume * 100)}%</Text>)}</View>
  return <View style={[styles.details, { borderColor: tokens.border }]}>
    <Text style={[styles.detailLine, { color: tokens.text }]}>Run · {run}</Text>
    <Text style={[styles.detailLine, { color: tokens.text }]}>Main · {program.mainMinutes}m · {soundTitle(program.mainCue.sound)} · {Math.round(program.mainCue.volume * 100)}%</Text>
    <Text style={[styles.detailLine, { color: tokens.text }]}>Timing · {program.alignment.kind === 'elapsed' ? 'starts when timer starts' : `aligned to :${String(program.alignment.offsetMinutes).padStart(2, '0')} local time`}</Text>
    {!program.subBellsEnabled ? <Text style={[styles.detailLine, { color: tokens.text }]}>Sub-bells off · settings preserved</Text> : null}
    {program.tracks.map((track, index) => <Text key={track.id} style={[styles.detailLine, { color: tokens.text }]}>{index + 1}. {track.enabled ? `${track.cadenceMinutes}m · ${track.selectedOffsetsMinutes.join(', ') || 'no cues'}` : 'Off'} · {soundTitle(track.sound)} · {Math.round(track.volume * 100)}%</Text>)}
  </View>
}

const styles = StyleSheet.create({
  helper: { fontSize: 12, lineHeight: 18 },
  current: { gap: 3 },
  saveRow: { flexDirection: 'row', gap: 8 },
  input: { flex: 1, minHeight: 45, borderWidth: 1.5, borderRadius: 11, paddingHorizontal: 12, fontSize: 14 },
  list: { gap: 9 },
  empty: { padding: 18, borderWidth: 1.5, borderStyle: 'dashed', borderRadius: 13, gap: 4 },
  emptyTitle: { fontSize: 14, fontWeight: '700' },
  preset: { borderWidth: 1.5, borderRadius: 14, padding: 13, flexDirection: 'row', gap: 12 },
  copy: { flex: 1, gap: 3 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  presetTitle: { flexShrink: 1, fontSize: 15, fontWeight: '700' },
  loaded: { fontSize: 8, letterSpacing: 1, fontWeight: '800' },
  date: { fontSize: 10, marginTop: 2 },
  action: { fontSize: 12, fontWeight: '700' },
  delete: { fontSize: 11, textDecorationLine: 'underline' },
  inspector: { borderWidth: 1.5, borderRadius: 14, padding: 14, gap: 12 },
  details: { borderTopWidth: 1, borderBottomWidth: 1, paddingVertical: 9, gap: 5 },
  detailLine: { fontSize: 11, lineHeight: 16 },
  inspectorActions: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: 16 }, inspectorPrimary: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  visual: { gap: 7, paddingVertical: 4 }, visualMeta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }, visualKind: { fontSize: 12, fontWeight: '600' }, visualCount: { fontSize: 11 }, visualTrack: { height: 18, position: 'relative' }, visualLine: { position: 'absolute', left: 0, right: 0, top: 8, height: 2 }, visualBoundary: { position: 'absolute', top: 3, width: 2, height: 12, borderRadius: 1 }, visualCue: { position: 'absolute', top: 5, width: 8, height: 8, marginLeft: -4, borderRadius: 4 }, sequenceTrack: { height: 8, borderRadius: 4, overflow: 'hidden', flexDirection: 'row', gap: 2 }, sequenceSegment: { minWidth: 3 },
  chevron: { fontSize: 24, lineHeight: 26, fontWeight: '300' },
})
