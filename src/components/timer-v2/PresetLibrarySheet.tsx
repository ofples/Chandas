import { useMemo, useState } from 'react'
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import type { ProgramPreset, TimerMode, TimerV2State } from '../../types'
import { deleteProgramPreset, loadProgramPreset, saveProgramPreset } from '../../lib/programActions'
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
  const presets = useMemo(() => state.presets.filter(preset => filter === 'all' || preset.program.mode === filter), [filter, state.presets])
  const canSave = name.trim().length > 0

  const save = () => {
    if (!canSave) return
    onChange(saveProgramPreset(state, name))
    setName('')
  }
  const remove = (preset: ProgramPreset) => Alert.alert('Delete configuration?', `“${preset.name}” will be removed. Your current working copy will not change.`, [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Delete', style: 'destructive', onPress: () => onChange(deleteProgramPreset(state, preset.id)) },
  ])

  return (
    <BottomSheet visible={visible} eyebrow="CONFIGURATIONS" title="Save or load" onClose={onClose}>
      <Text style={[styles.helper, { color: tokens.textMuted }]}>Saved configurations are immutable snapshots. Loading creates a working copy you can change and save under a new name.</Text>
      <View style={styles.saveRow}>
        <TextInput
          value={name}
          onChangeText={setName}
          onSubmitEditing={save}
          placeholder="Name this configuration"
          placeholderTextColor={tokens.textMuted}
          maxLength={80}
          returnKeyType="done"
          style={[styles.input, { color: tokens.text, borderColor: tokens.border, backgroundColor: tokens.surfaceHi }]}
          accessibilityLabel="New configuration name"
        />
        <Pressable disabled={!canSave} onPress={save} style={[styles.save, { backgroundColor: tokens.accent, opacity: canSave ? 1 : 0.35 }]}><Text style={styles.saveText}>Save new</Text></Pressable>
      </View>
      <View style={styles.filters}>{([['all', 'All'], ['pattern', 'Main + sub'], ['sequence', 'Sequence']] as const).map(([value, label]) => <Pressable key={value} onPress={() => setFilter(value)} style={[styles.filter, { borderColor: filter === value ? tokens.accent : tokens.border, backgroundColor: filter === value ? tokens.accentGlow : 'transparent' }]}><Text style={[styles.filterText, { color: filter === value ? tokens.accent : tokens.textMuted }]}>{label}</Text></Pressable>)}</View>
      <View style={styles.list}>
        {presets.length === 0 ? <View style={[styles.empty, { borderColor: tokens.border }]}><Text style={[styles.emptyTitle, { color: tokens.text }]}>No saved configurations here</Text><Text style={[styles.helper, { color: tokens.textMuted }]}>Set up the timer above, give it a name, and save a reusable snapshot.</Text></View> : presets.map(preset => {
          const loaded = state.workingPrograms.sourcePreset?.id === preset.id && !state.workingPrograms.sourcePreset.deleted
          return <View key={preset.id} style={[styles.preset, { borderColor: loaded ? tokens.accent : tokens.border, backgroundColor: loaded ? tokens.accentGlow : 'transparent' }]}>
            <Pressable style={styles.copy} onPress={() => { onChange(loadProgramPreset(state, preset.id)); onClose() }} accessibilityLabel={`Load ${preset.name}`}>
              <View style={styles.titleRow}><Text numberOfLines={1} style={[styles.presetTitle, { color: tokens.text }]}>{preset.name}</Text>{loaded ? <Text style={[styles.loaded, { color: tokens.accent }]}>LOADED</Text> : null}</View>
              <Text style={[styles.helper, { color: tokens.textMuted }]}>{summary(preset)}</Text>
              <Text style={[styles.date, { color: tokens.textDisabled }]}>Saved {new Date(preset.createdAt).toLocaleDateString()}</Text>
            </Pressable>
            <View style={styles.actions}><Pressable onPress={() => { onChange(loadProgramPreset(state, preset.id)); onClose() }}><Text style={[styles.action, { color: tokens.accent }]}>Load</Text></Pressable><Pressable onPress={() => remove(preset)}><Text style={[styles.delete, { color: tokens.textMuted }]}>Delete</Text></Pressable></View>
          </View>
        })}
      </View>
    </BottomSheet>
  )
}

const styles = StyleSheet.create({
  helper: { fontSize: 12, lineHeight: 18 },
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
})
