import { useMemo, useState } from 'react'
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import * as Haptics from 'expo-haptics'
import type { ProgramPreset, TimerMode, TimerV2State } from '../../types'
import { deleteProgramPreset, loadProgramPreset, saveProgramPreset } from '../../lib/programActions'
import { soundTitle } from '../../lib/soundLibrary'
import { useTheme } from '../../theme/ThemeContext'
import { BottomSheet } from './BottomSheet'

interface Props {
  visible: boolean
  state: TimerV2State
  onChange: (state: TimerV2State) => void
  onClose: () => void
}

function summary(preset: ProgramPreset): string {
  if (preset.program.mode === 'sequence') {
    const total = preset.program.steps.reduce((sum, step) => sum + step.durationMinutes, 0)
    return `${preset.program.steps.length} steps · ${total} min cycle`
  }
  const cueCount = preset.program.tracks.reduce((count, track) => count + (track.enabled ? track.selectedOffsetsMinutes.length : 0), 0)
  return `${preset.program.mainMinutes} min main · ${preset.program.tracks.length} sub-bell${preset.program.tracks.length === 1 ? '' : 's'} · ${cueCount} cues`
}

export function PresetLibrarySheet({ visible, state, onChange, onClose }: Props) {
  const { tokens } = useTheme()
  const [name, setName] = useState('')
  const [filter, setFilter] = useState<'all' | TimerMode>('all')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const presets = useMemo(() => state.presets.filter(preset => filter === 'all' || preset.program.mode === filter), [filter, state.presets])
  const selected = state.presets.find(preset => preset.id === selectedId) ?? null
  const canSave = name.trim().length > 0

  const save = () => {
    if (!canSave) return
    onChange(saveProgramPreset(state, name))
    setName('')
  }
  const remove = (preset: ProgramPreset) => Alert.alert('Delete configuration?', `“${preset.name}”, saved ${new Date(preset.createdAt).toLocaleString()}, will be removed. Your current working copy will not change.`, [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Delete', style: 'destructive', onPress: () => { onChange(deleteProgramPreset(state, preset.id)); void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => undefined) } },
  ])

  return (
    <BottomSheet visible={visible} eyebrow="CONFIGURATIONS" title="Save or load" onClose={onClose}>
      <Text style={[styles.helper, { color: tokens.textMuted }]}>Saved configurations are immutable snapshots. Loading creates a working copy you can change and save under a new name.</Text>
      <View style={[styles.current, { backgroundColor: tokens.surfaceHi }]}><Text style={[styles.miniLabel, { color: tokens.textMuted }]}>SAVING THIS WORKING COPY</Text><Text style={[styles.presetTitle, { color: tokens.text }]}>{state.workingPrograms.selectedMode === 'pattern' ? 'Main + sub-bells' : 'Sequence / sets'}</Text><Text style={[styles.helper, { color: tokens.textMuted }]}>{summary({ id: '', name: '', createdAt: 0, program: state.workingPrograms[state.workingPrograms.selectedMode] })}</Text></View>
      <View style={styles.saveRow}>
        <TextInput
          value={name}
          onChangeText={value => setName([...value].slice(0, 80).join(''))}
          onSubmitEditing={save}
          placeholder="Name this configuration"
          placeholderTextColor={tokens.textMuted}
          returnKeyType="done"
          style={[styles.input, { color: tokens.text, borderColor: tokens.border, backgroundColor: tokens.surfaceHi }]}
          accessibilityLabel="New configuration name"
        />
        <Pressable disabled={!canSave} onPress={save} style={[styles.save, { backgroundColor: tokens.accent, opacity: canSave ? 1 : 0.35 }]}><Text style={styles.saveText}>Save new</Text></Pressable>
      </View>
      <View style={styles.filters}>{([['all', 'All'], ['pattern', 'Main + sub'], ['sequence', 'Sequence']] as const).map(([value, label]) => <Pressable key={value} onPress={() => setFilter(value)} style={[styles.filter, { borderColor: filter === value ? tokens.accent : tokens.border, backgroundColor: filter === value ? tokens.accentGlow : 'transparent' }]}><Text style={[styles.filterText, { color: filter === value ? tokens.accent : tokens.textMuted }]}>{label}</Text></Pressable>)}</View>
      {selected ? <View style={[styles.inspector, { borderColor: tokens.accent, backgroundColor: tokens.accentGlow }]}>
        <View style={styles.copy}><Text style={[styles.miniLabel, { color: tokens.accent }]}>READY TO LOAD</Text><Text style={[styles.presetTitle, { color: tokens.text }]}>{selected.name}</Text><Text style={[styles.helper, { color: tokens.textMuted }]}>{selected.program.mode === 'pattern' ? `Main + sub-bells · ${summary(selected)}` : `Sequence / sets · ${summary(selected)}`}</Text><Text style={[styles.date, { color: tokens.textMuted }]}>Saved {new Date(selected.createdAt).toLocaleString()}</Text><PresetDetails preset={selected} /><Text style={[styles.helper, { color: tokens.textMuted }]}>This replaces the {selected.program.mode} working copy only. It does not start the timer.</Text></View>
        <View style={styles.inspectorActions}><Pressable onPress={() => setSelectedId(null)}><Text style={[styles.action, { color: tokens.textMuted }]}>Cancel</Text></Pressable><Pressable onPress={() => { onChange(loadProgramPreset(state, selected.id)); setSelectedId(null); onClose() }} style={[styles.loadButton, { backgroundColor: tokens.accent }]}><Text style={styles.loadText}>Load copy</Text></Pressable></View>
      </View> : null}
      <View style={styles.list}>
        {presets.length === 0 ? <View style={[styles.empty, { borderColor: tokens.border }]}><Text style={[styles.emptyTitle, { color: tokens.text }]}>No saved configurations here</Text><Text style={[styles.helper, { color: tokens.textMuted }]}>Set up the timer above, give it a name, and save a reusable snapshot.</Text></View> : presets.map(preset => {
          const loaded = state.workingPrograms.sourcePreset?.id === preset.id && !state.workingPrograms.sourcePreset.deleted
          return <View key={preset.id} style={[styles.preset, { borderColor: loaded ? tokens.accent : tokens.border, backgroundColor: loaded ? tokens.accentGlow : 'transparent' }]}>
            <Pressable style={styles.copy} onPress={() => setSelectedId(preset.id)} accessibilityLabel={`Inspect ${preset.name}`}>
              <View style={styles.titleRow}><Text numberOfLines={1} style={[styles.presetTitle, { color: tokens.text }]}>{preset.name}</Text>{loaded ? <Text style={[styles.loaded, { color: tokens.accent }]}>LOADED</Text> : null}</View>
              <Text style={[styles.helper, { color: tokens.textMuted }]}>{summary(preset)}</Text>
              <Text style={[styles.date, { color: tokens.textDisabled }]}>Saved {new Date(preset.createdAt).toLocaleString()}</Text>
            </Pressable>
            <View style={styles.actions}><Pressable onPress={() => setSelectedId(preset.id)}><Text style={[styles.action, { color: tokens.accent }]}>Inspect</Text></Pressable><Pressable onPress={() => remove(preset)}><Text style={[styles.delete, { color: tokens.textMuted }]}>Delete</Text></Pressable></View>
          </View>
        })}
      </View>
    </BottomSheet>
  )
}

function PresetDetails({ preset }: { preset: ProgramPreset }) {
  const { tokens } = useTheme()
  const program = preset.program
  if (program.mode === 'sequence') return <View style={[styles.details, { borderColor: tokens.border }]}>{program.steps.map((step, index) => <Text key={step.id} style={[styles.detailLine, { color: tokens.textMuted }]}>{index + 1}. {step.label} · {step.durationMinutes}m · {soundTitle(step.sound)} · {Math.round(step.volume * 100)}%</Text>)}</View>
  return <View style={[styles.details, { borderColor: tokens.border }]}>
    <Text style={[styles.detailLine, { color: tokens.textMuted }]}>Main · {program.mainMinutes}m · {soundTitle(program.mainCue.sound)} · {Math.round(program.mainCue.volume * 100)}%</Text>
    <Text style={[styles.detailLine, { color: tokens.textMuted }]}>Timing · {program.alignment.kind === 'elapsed' ? 'starts when timer starts' : `aligned to :${String(program.alignment.offsetMinutes).padStart(2, '0')} local time`}</Text>
    {program.tracks.map((track, index) => <Text key={track.id} style={[styles.detailLine, { color: tokens.textMuted }]}>{index + 1}. {track.enabled ? `${track.cadenceMinutes}m · ${track.selectedOffsetsMinutes.join(', ') || 'no cues'}` : 'Off'} · {soundTitle(track.sound)} · {Math.round(track.volume * 100)}%</Text>)}
  </View>
}

const styles = StyleSheet.create({
  helper: { fontSize: 12, lineHeight: 18 },
  current: { padding: 13, borderRadius: 12, gap: 3 },
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
  actions: { justifyContent: 'space-between', alignItems: 'flex-end' },
  action: { fontSize: 12, fontWeight: '700' },
  delete: { fontSize: 11, textDecorationLine: 'underline' },
  inspector: { borderWidth: 1.5, borderRadius: 14, padding: 14, gap: 12 },
  details: { borderTopWidth: 1, borderBottomWidth: 1, paddingVertical: 9, gap: 5 },
  detailLine: { fontSize: 11, lineHeight: 16 },
  inspectorActions: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: 16 },
  loadButton: { paddingHorizontal: 15, paddingVertical: 10, borderRadius: 10 },
  loadText: { color: '#fff', fontSize: 12, fontWeight: '800' },
})
