import { useEffect, useMemo, useState } from 'react'
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import * as Haptics from 'expo-haptics'
import Animated, { FadeIn, FadeInDown, FadeOut, LinearTransition, useReducedMotion } from 'react-native-reanimated'
import type { ProgramPreset, TimerMode, TimerV2State } from '../../types'
import { deleteProgramPreset, loadProgramPreset, saveProgramPreset } from '../../lib/programActions'
import { soundTitle } from '../../lib/soundLibrary'
import { useTheme } from '../../theme/ThemeContext'
import { BottomSheet } from './BottomSheet'
import { GentleNotice, type AppNotice } from './experience-feedback'
import { formatDuration } from './run-length-config'

interface Props {
  visible: boolean
  state: TimerV2State
  onChange: (state: TimerV2State) => void
  onClose: () => void
  onFeedback: (notice: Omit<AppNotice, 'id'>) => void
}

function summary(preset: ProgramPreset): string {
  const run = preset.program.runPolicy.kind === 'continuous'
    ? 'continuous'
    : preset.program.runPolicy.kind === 'cycles'
      ? `${preset.program.runPolicy.cycleCount} ${preset.program.mode === 'sequence' ? (preset.program.runPolicy.cycleCount === 1 ? 'round' : 'rounds') : (preset.program.runPolicy.cycleCount === 1 ? 'main cycle' : 'main cycles')}`
      : formatDuration(preset.program.runPolicy.durationSeconds)
  if (preset.program.mode === 'sequence') {
    const total = preset.program.steps.reduce((sum, step) => sum + step.durationMinutes, 0)
    return `${preset.program.steps.length} steps · ${total} min cycle · ${run}`
  }
  const cueCount = preset.program.tracks.reduce((count, track) => count + (track.enabled ? track.selectedOffsetsMinutes.length : 0), 0)
  return `${preset.program.mainMinutes} min main · ${preset.program.tracks.length} sub-bell${preset.program.tracks.length === 1 ? '' : 's'} · ${cueCount} cues · ${run}`
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
    if (!visible) {
      setSavedName(null)
      setSelectedId(null)
    }
  }, [visible])

  const save = () => {
    if (!canSave) return
    const cleanName = name.trim()
    onChange(saveProgramPreset(state, cleanName))
    setSavedName(cleanName)
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined)
    setName('')
  }
  const remove = (preset: ProgramPreset) => Alert.alert('Delete configuration?', `“${preset.name}”, saved ${new Date(preset.createdAt).toLocaleString()}, will be removed. Your current working copy will not change.`, [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Delete', style: 'destructive', onPress: () => { onChange(deleteProgramPreset(state, preset.id)); setSelectedId(current => current === preset.id ? null : current); onFeedback({ title: 'Configuration removed', message: 'Your current working copy was not changed.', tone: 'info' }); void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined) } },
  ])

  return (
    <BottomSheet visible={visible} eyebrow="SAVED SETUPS" title="Configurations" onClose={onClose}>
      {!selected ? <View style={styles.current}><Text style={[styles.presetTitle, { color: tokens.text }]}>Save current {state.workingPrograms.selectedMode === 'pattern' ? 'Cycle' : 'Sequence'}</Text><Text style={[styles.helper, { color: tokens.textMuted }]}>{summary({ id: '', name: '', createdAt: 0, program: state.workingPrograms[state.workingPrograms.selectedMode] })}</Text></View> : null}
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
        <Pressable disabled={!canSave} onPress={save} style={[styles.save, { backgroundColor: tokens.accent, opacity: canSave ? 1 : 0.35 }]} accessibilityRole="button"><Text style={styles.saveText}>Save</Text></Pressable>
      </View> : null}
      {!selected && savedName ? <GentleNotice title="Configuration saved" message={`“${savedName}” is ready to load.`} tone="success" /> : null}
      {!selected ? <View style={styles.filters} accessibilityRole="tablist">{([['all', 'All'], ['pattern', 'Cycle'], ['sequence', 'Sequence']] as const).map(([value, label]) => <Pressable key={value} onPress={() => setFilter(value)} style={[styles.filter, { borderColor: filter === value ? tokens.accent : tokens.border, backgroundColor: filter === value ? tokens.accentGlow : 'transparent' }]} accessibilityRole="tab" accessibilityState={{ selected: filter === value }}><Text style={[styles.filterText, { color: filter === value ? tokens.accent : tokens.textMuted }]}>{label}</Text></Pressable>)}</View> : null}
      {selected ? <Animated.View entering={FadeInDown.duration(reducedMotion ? 80 : 180)} exiting={FadeOut.duration(reducedMotion ? 70 : 130)} style={[styles.inspector, { borderColor: tokens.accent, backgroundColor: tokens.accentGlow }]}>
        <View style={styles.copy}><Text style={[styles.presetTitle, { color: tokens.text }]}>{selected.name}</Text><Text style={[styles.helper, { color: tokens.textMuted }]}>{selected.program.mode === 'pattern' ? `Cycle · ${summary(selected)}` : `Sequence · ${summary(selected)}`}</Text><Text style={[styles.date, { color: tokens.textMuted }]}>Saved {new Date(selected.createdAt).toLocaleString()}</Text><PresetDetails preset={selected} /><Text style={[styles.helper, { color: tokens.textMuted }]}>Loads as a new working copy.</Text></View>
        <View style={styles.inspectorActions}><Pressable onPress={() => remove(selected)} accessibilityRole="button"><Text style={[styles.delete, { color: tokens.textMuted }]}>Delete</Text></Pressable><View style={styles.inspectorPrimary}><Pressable onPress={() => setSelectedId(null)} accessibilityRole="button"><Text style={[styles.action, { color: tokens.textMuted }]}>Cancel</Text></Pressable><Pressable onPress={() => { onChange(loadProgramPreset(state, selected.id)); setSelectedId(null); onClose(); onFeedback({ title: 'Configuration loaded', message: `“${selected.name}” is ready to adjust.`, tone: 'success' }) }} style={[styles.loadButton, { backgroundColor: tokens.accent }]} accessibilityRole="button"><Text style={styles.loadText}>Load</Text></Pressable></View></View>
      </Animated.View> : null}
      {!selected ? <View style={styles.list}>
        {presets.length === 0 ? <GentleNotice title={state.presets.length === 0 ? 'No saved configurations yet' : `No ${filter === 'pattern' ? 'Cycle' : 'Sequence'} configurations`} message={state.presets.length === 0 ? 'Name the current setup above to save it.' : 'Try All or save the current setup.'} /> : presets.map(preset => {
          const loaded = state.workingPrograms.sourcePreset?.id === preset.id && !state.workingPrograms.sourcePreset.deleted
          return <Animated.View key={preset.id} entering={FadeInDown.duration(reducedMotion ? 80 : 180)} exiting={FadeOut.duration(reducedMotion ? 70 : 120)} layout={reducedMotion ? undefined : LinearTransition.duration(160)}>
            <Pressable style={[styles.preset, { borderColor: loaded ? tokens.accent : tokens.border, backgroundColor: loaded ? tokens.accentGlow : 'transparent' }]} onPress={() => setSelectedId(preset.id)} accessibilityRole="button" accessibilityLabel={`Open ${preset.name}`}>
              <View style={styles.copy}>
              <View style={styles.titleRow}><Text numberOfLines={1} style={[styles.presetTitle, { color: tokens.text }]}>{preset.name}</Text>{loaded ? <Text style={[styles.loaded, { color: tokens.accent }]}>LOADED</Text> : null}</View>
              <Text style={[styles.helper, { color: tokens.textMuted }]}>{summary(preset)}</Text>
              <Text style={[styles.date, { color: tokens.textDisabled }]}>Saved {new Date(preset.createdAt).toLocaleString()}</Text>
              </View><Text style={[styles.chevron, { color: tokens.accent }]}>›</Text>
            </Pressable>
          </Animated.View>
        })}
      </View> : null}
    </BottomSheet>
  )
}

function PresetDetails({ preset }: { preset: ProgramPreset }) {
  const { tokens } = useTheme()
  const program = preset.program
  const run = program.runPolicy.kind === 'continuous'
    ? 'Continuous'
    : program.runPolicy.kind === 'cycles'
      ? `${program.runPolicy.cycleCount} ${program.mode === 'sequence' ? (program.runPolicy.cycleCount === 1 ? 'round' : 'rounds') : (program.runPolicy.cycleCount === 1 ? 'main cycle' : 'main cycles')}`
      : formatDuration(program.runPolicy.durationSeconds)
  if (program.mode === 'sequence') return <View style={[styles.details, { borderColor: tokens.border }]}><Text style={[styles.detailLine, { color: tokens.textMuted }]}>Run · {run}</Text>{program.steps.map((step, index) => <Text key={step.id} style={[styles.detailLine, { color: tokens.textMuted }]}>{index + 1}. {step.label} · {step.durationMinutes}m · {soundTitle(step.sound)} · {Math.round(step.volume * 100)}%</Text>)}</View>
  return <View style={[styles.details, { borderColor: tokens.border }]}>
    <Text style={[styles.detailLine, { color: tokens.textMuted }]}>Run · {run}</Text>
    <Text style={[styles.detailLine, { color: tokens.textMuted }]}>Main · {program.mainMinutes}m · {soundTitle(program.mainCue.sound)} · {Math.round(program.mainCue.volume * 100)}%</Text>
    <Text style={[styles.detailLine, { color: tokens.textMuted }]}>Timing · {program.alignment.kind === 'elapsed' ? 'starts when timer starts' : `aligned to :${String(program.alignment.offsetMinutes).padStart(2, '0')} local time`}</Text>
    {program.tracks.map((track, index) => <Text key={track.id} style={[styles.detailLine, { color: tokens.textMuted }]}>{index + 1}. {track.enabled ? `${track.cadenceMinutes}m · ${track.selectedOffsetsMinutes.join(', ') || 'no cues'}` : 'Off'} · {soundTitle(track.sound)} · {Math.round(track.volume * 100)}%</Text>)}
  </View>
}

const styles = StyleSheet.create({
  helper: { fontSize: 12, lineHeight: 18 },
  current: { gap: 3 },
  miniLabel: { fontSize: 9, fontWeight: '800', letterSpacing: 1.1 },
  saveRow: { flexDirection: 'row', gap: 8 },
  input: { flex: 1, minHeight: 45, borderWidth: 1.5, borderRadius: 11, paddingHorizontal: 12, fontSize: 14 },
  save: { borderRadius: 11, justifyContent: 'center', paddingHorizontal: 15 },
  saveText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  filter: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 99, borderWidth: 1.5 },
  filterText: { fontSize: 11, fontWeight: '700' },
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
  inspectorActions: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 16 }, inspectorPrimary: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  loadButton: { paddingHorizontal: 15, paddingVertical: 10, borderRadius: 10 },
  loadText: { color: '#fff', fontSize: 12, fontWeight: '800' },
  chevron: { fontSize: 24, lineHeight: 26, fontWeight: '300' },
})
