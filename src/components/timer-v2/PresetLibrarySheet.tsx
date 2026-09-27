import { useAppReducedMotion } from '../../theme/ThemeContext'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { successHaptic } from '../../lib/haptics'
import Animated, { FadeIn, FadeInDown, FadeOut, LinearTransition } from 'react-native-reanimated'
import type { AppTimerSettings, ProgramPreset, TimerMode, TimerProgram, TimerV2State } from '../../types'
import { addStarterProgramPresets, deleteProgramPreset, hasUnsavedProgramChanges, loadProgramPreset, saveProgramPreset, updatePattern } from '../../lib/programActions'
import { soundTitle } from '../../lib/soundLibrary'
import { useTheme } from '../../theme/ThemeContext'
import { BottomSheet } from './BottomSheet'
import { GentleNotice, type AppNotice } from './experience-feedback'
import { formatDuration } from './run-length-config'
import { SegmentedControl } from './SegmentedControl'
import { SheetTextButton } from './SheetTextButton'
import { tapHaptic } from '../../lib/haptics'
import { hapticProfileSummary } from '../../lib/haptic-profiles'
import { SwipeToDeleteRow } from './swipe-to-delete-row'
import { Toggle } from '../Toggle'
import { formatCompactDurationSeconds, patternDurationSeconds, sequenceStepDurationSeconds, trackCadenceSeconds, trackEventOffsetsSeconds } from '../../lib/timerV2'
import { configurationTransferFilename, parseConfigurationTransfer, serializeConfiguration, type ConfigurationTransferError, type ConfigurationTransferResult } from '../../lib/configuration-transfer'
import { copyConfigurationText, pickConfigurationText, readConfigurationTextFromClipboard, saveConfigurationFile } from '../../lib/configuration-transfer-io'
import { PatternTimelinePreview } from './PatternTimelinePreview'
import { DoubleTapDeleteButton } from './DoubleTapDeleteButton'
import { useConfirmation } from './ConfirmationDialog'

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
  const confirm = useConfirmation()
  const reducedMotion = useAppReducedMotion()
  const [name, setName] = useState('')
  const [filter, setFilter] = useState<'all' | TimerMode>('all')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [savedName, setSavedName] = useState<string | null>(null)
  const [transferAction, setTransferAction] = useState<'copy' | 'save-file' | 'load' | 'open-file' | null>(null)
  const stateRef = useRef(state)
  stateRef.current = state
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
      setTransferAction(null)
    }
  }, [visible])

  const save = () => {
    if (!canSave) return
    const cleanName = name.trim()
    const namedState = state.workingPrograms.selectedMode === 'pattern'
      ? updatePattern(state, program => ({ ...program, label: cleanName, labelIsCustom: true }))
      : state
    onChange(saveProgramPreset(namedState, cleanName))
    setSavedName(cleanName)
    successHaptic()
    setName(cleanName)
  }
  const remove = (preset: ProgramPreset) => {
    onChange(deleteProgramPreset(state, preset.id))
    setSelectedId(current => current === preset.id ? null : current)
    onFeedback({ title: 'Configuration removed', message: 'Your current working copy was not changed.', tone: 'info' })
  }
  const confirmWorkingCopyReplacement = async (sourceState: TimerV2State, apply: () => void) => {
    if (!hasUnsavedProgramChanges(sourceState)) {
      apply()
      return
    }
    const message = 'Your current changes have not been saved as a configuration. Load this one anyway?'
    if (await confirm({ title: 'Discard unsaved changes?', message, cancelLabel: 'Keep editing', confirmLabel: 'Load', destructive: true })) apply()
  }
  const load = (preset: ProgramPreset) => {
    const apply = () => {
      onChange(loadProgramPreset(state, preset.id))
      setSelectedId(null)
      onClose()
      onFeedback({ title: 'Configuration loaded', message: `“${preset.name}” is ready to adjust.`, tone: 'success' })
    }
    void confirmWorkingCopyReplacement(state, apply)
  }

  const applyImportedConfiguration = (result: Extract<ConfigurationTransferResult, { ok: true }>, source: 'clipboard' | 'file') => {
    const sourceState = stateRef.current
    const apply = () => {
      const latestState = stateRef.current
      const stateWithPreset: TimerV2State = {
        ...latestState,
        presets: [result.preset, ...latestState.presets.filter(preset => preset.id !== result.preset.id)],
      }
      onChange(loadProgramPreset(stateWithPreset, result.preset.id))
      setFilter('all')
      setSelectedId(null)
      onClose()
      onFeedback({
        title: source === 'clipboard' ? 'Loaded from clipboard' : 'Configuration loaded',
        message: result.hasDeviceSpecificSounds
          ? `“${result.preset.name}” is ready. Sounds chosen from another device may need to be selected again.`
          : `“${result.preset.name}” is ready to adjust.`,
        tone: 'success',
        actionLabel: source === 'clipboard' ? 'Load from file instead' : undefined,
        onAction: source === 'clipboard' ? () => void openFile() : undefined,
      })
      successHaptic()
    }
    confirmWorkingCopyReplacement(sourceState, apply)
  }
  const importText = (text: string, source: 'clipboard' | 'file', reportError = true): boolean => {
    const currentState = stateRef.current
    const result = parseConfigurationTransfer(text, currentState.presets.map(preset => preset.name))
    if (!result.ok) {
      if (reportError) onFeedback(configurationImportError(result.error))
      return false
    }
    applyImportedConfiguration(result, source)
    return true
  }
  const openFile = async () => {
    if (transferAction) return
    setTransferAction('open-file')
    try {
      const text = await pickConfigurationText()
      if (text !== null) importText(text, 'file')
    } catch {
      onFeedback({ title: 'Could not open that file', message: 'Choose a Chandas configuration file and try again.', tone: 'attention' })
    } finally {
      setTransferAction(null)
    }
  }
  const loadExternalConfiguration = async () => {
    if (transferAction) return
    setTransferAction('load')
    let loadedFromClipboard = false
    try {
      const clipboardText = await readConfigurationTextFromClipboard()
      loadedFromClipboard = importText(clipboardText, 'clipboard', false)
    } catch {
      // Clipboard access can be unavailable or empty. In either case, fall through
      // to the file picker without presenting a dead-end error.
    }
    if (loadedFromClipboard) {
      setTransferAction(null)
      return
    }
    setTransferAction('open-file')
    try {
      const text = await pickConfigurationText()
      if (text !== null) importText(text, 'file')
    } catch {
      onFeedback({ title: 'Could not open that file', message: 'Choose a Chandas configuration file and try again.', tone: 'attention' })
    } finally {
      setTransferAction(null)
    }
  }
  const copy = async (preset: ProgramPreset) => {
    if (transferAction) return
    setTransferAction('copy')
    try {
      await copyConfigurationText(serializeConfiguration(preset))
      onFeedback({
        title: 'Copied to clipboard',
        message: 'Would you also like to save this configuration as a file?',
        tone: 'success',
        actionLabel: 'Save file',
        onAction: () => void saveFile(preset),
      })
      successHaptic()
    } catch {
      onFeedback({ title: 'Could not copy the configuration', message: 'Please try again in a moment.', tone: 'attention' })
    } finally {
      setTransferAction(null)
    }
  }
  const saveFile = async (preset: ProgramPreset) => {
    if (transferAction) return
    setTransferAction('save-file')
    try {
      await saveConfigurationFile(configurationTransferFilename(preset.name), serializeConfiguration(preset))
      if (Platform.OS === 'web') onFeedback({ title: 'Configuration saved', message: `“${preset.name}” was downloaded as a file.`, tone: 'success' })
    } catch {
      onFeedback({ title: 'Could not save the configuration', message: 'Please choose another location or try again.', tone: 'attention' })
    } finally {
      setTransferAction(null)
    }
  }

  return (
    <BottomSheet
      visible={visible}
      title={selected?.name ?? 'Configurations'}
      accessibilityTitle={selected?.name ?? 'Configurations'}
      help={selected ? 'Review this saved setup before loading it as a new working copy. Export copies a portable version and then offers to save it as a file.' : 'Save the current setup for later. Load checks the clipboard for a Chandas configuration first, then lets you choose a file.'}
      onClose={selected ? () => setSelectedId(null) : onClose}
      leadingAction={selected
        ? { label: 'Cancel', tone: 'muted', onPress: () => setSelectedId(null) }
        : { label: transferAction === 'load' || transferAction === 'open-file' ? 'Loading…' : 'Load', disabled: Boolean(transferAction), onPress: () => void loadExternalConfiguration() }}
      trailingAction={selected ? { label: 'Load', disabled: Boolean(transferAction), onPress: () => load(selected) } : undefined}
    >
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
        <View style={styles.saveAction}><SheetTextButton disabled={!canSave || Boolean(transferAction)} label="Save" onPress={save} /></View>
      </View> : null}
      {!selected && savedName ? <GentleNotice title="Configuration saved" message={`“${savedName}” is ready to load.`} tone="success" /> : null}
      {!selected && state.presets.length === 0 ? <View style={[styles.starterRow, { borderColor: tokens.border }]}><View style={styles.copy}><Text style={[styles.presetTitle, { color: tokens.text }]}>Starter configurations</Text><Text style={[styles.helper, { color: tokens.textMuted }]}>Add editable examples for work, study, a morning sequence, and movement reminders.</Text></View><SheetTextButton label="Add" onPress={() => onChange(addStarterProgramPresets(state))} accessibilityLabel="Add starter configurations" /></View> : null}
      {!selected ? <SegmentedControl items={FILTERS} value={filter} onChange={setFilter} accessibilityLabel="Configuration type" /> : null}
      {selected ? <Animated.View entering={reducedMotion ? undefined : FadeInDown.duration(180)} exiting={reducedMotion ? undefined : FadeOut.duration(130)} style={styles.inspector}>
        <View style={styles.copy}><PresetVisual program={selected.program} /><Text style={[styles.date, { color: tokens.textMuted }]}>Saved {new Date(selected.createdAt).toLocaleString()}</Text><PresetDetails preset={selected} /><Text style={[styles.helper, { color: tokens.text }]}>Loads as a new working copy.</Text></View>
        <View style={styles.visibilityRow}><View style={styles.copy}><Text style={[styles.presetTitle, { color: tokens.text }]}>Show while running</Text><Text style={[styles.helper, { color: tokens.textMuted }]}>Lets you switch to this saved configuration from the timer.</Text></View><Toggle value={selected.showInRunningSelector !== false} onChange={showInRunningSelector => onChange({ ...state, presets: state.presets.map(preset => preset.id === selected.id ? { ...preset, showInRunningSelector } : preset) })} accessibilityLabel={`Show ${selected.name} while timer is running`} /></View>
        <View style={styles.exportActions}><DoubleTapDeleteButton label="Delete configuration" accessibilityLabel={`Delete ${selected.name}`} onDelete={() => remove(selected)} /><SheetTextButton disabled={Boolean(transferAction)} label={transferAction === 'copy' ? 'Exporting…' : 'Export'} accessibilityLabel="Copy configuration" onPress={() => void copy(selected)} /></View>
      </Animated.View> : null}
      {!selected ? <View style={styles.list}>
        {presets.length === 0 ? <GentleNotice title={state.presets.length === 0 ? 'No saved configurations yet' : `No ${filter === 'pattern' ? 'Cycle' : 'Sequence'} configurations`} message={state.presets.length === 0 ? 'Name the current setup above to save it.' : 'Try All or save the current setup.'} /> : presets.map(preset => {
          const loaded = state.workingPrograms.sourcePreset?.id === preset.id && !state.workingPrograms.sourcePreset.deleted && !hasUnsavedProgramChanges(state)
          return <Animated.View key={preset.id} entering={reducedMotion ? undefined : FadeInDown.duration(180)} exiting={reducedMotion ? undefined : FadeOut.duration(120)} layout={reducedMotion ? undefined : LinearTransition.duration(160)}>
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
    const durationSeconds = patternDurationSeconds(program)
    const tracks = program.subBellsEnabled ? program.tracks.filter(track => track.enabled) : []
    const cues = tracks.reduce((count, track) => count + trackEventOffsetsSeconds(track, durationSeconds).length, 0)
    return <View style={styles.visual} accessibilityLabel={`${formatCompactDurationSeconds(durationSeconds)} cycle with ${cues} sub-bell cues`}>
      <View style={styles.visualMeta}><Text style={[styles.visualKind, { color: tokens.text }]}>Cycle · {formatCompactDurationSeconds(durationSeconds)}</Text><Text style={[styles.visualCount, { color: tokens.textMuted }]}>{cues} cue{cues === 1 ? '' : 's'}</Text></View>
      <PatternTimelinePreview tracks={tracks} mainDurationSeconds={durationSeconds} />
    </View>
  }
  const total = Math.max(1, program.steps.reduce((sum, step) => sum + sequenceStepDurationSeconds(step), 0))
  return <View style={styles.visual} accessibilityLabel={`${program.steps.length} step sequence lasting ${formatCompactDurationSeconds(total)}`}>
    <View style={styles.visualMeta}><Text style={[styles.visualKind, { color: tokens.text }]}>Sequence · {formatCompactDurationSeconds(total)}</Text><Text style={[styles.visualCount, { color: tokens.textMuted }]}>{program.steps.length} step{program.steps.length === 1 ? '' : 's'}</Text></View>
    <View style={[styles.sequenceTrack, { backgroundColor: tokens.border }]}>{program.steps.map((step, index) => <View key={step.id} style={[styles.sequenceSegment, { flex: sequenceStepDurationSeconds(step), backgroundColor: tokens.accent, opacity: 0.45 + index % 3 * 0.18 }]} />)}</View>
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
  if (program.mode === 'sequence') return <View style={[styles.details, { borderColor: tokens.border }]}><Text style={[styles.detailLine, { color: tokens.text }]}>Run · {run}</Text>{program.steps.map((step, index) => <Text key={step.id} style={[styles.detailLine, { color: tokens.text }]}>{index + 1}. {step.label} · {formatCompactDurationSeconds(sequenceStepDurationSeconds(step))} · {soundTitle(step.sound)} · {Math.round(step.volume * 100)}%</Text>)}{preset.settings ? <PresetSettingsDetails settings={preset.settings} /> : <Text style={[styles.detailLine, { color: tokens.text }]}>Settings · Keeps current timer settings</Text>}</View>
  return <View style={[styles.details, { borderColor: tokens.border }]}>
    <Text style={[styles.detailLine, { color: tokens.text }]}>Run · {run}</Text>
    <Text style={[styles.detailLine, { color: tokens.text }]}>Main · {formatCompactDurationSeconds(patternDurationSeconds(program))} · {soundTitle(program.mainCue.sound)} · {Math.round(program.mainCue.volume * 100)}%</Text>
    <Text style={[styles.detailLine, { color: tokens.text }]}>Timing · {program.alignment.kind === 'elapsed' ? 'starts when timer starts' : `aligned to :${String(program.alignment.offsetMinutes).padStart(2, '0')} local time`}</Text>
    {!program.subBellsEnabled ? <Text style={[styles.detailLine, { color: tokens.text }]}>Sub-bells off · settings preserved</Text> : null}
    {program.tracks.map((track, index) => <Text key={track.id} style={[styles.detailLine, { color: tokens.text }]}>{index + 1}. {track.enabled ? `${track.repeatEnabled === false ? 'No repeat' : `Every ${formatCompactDurationSeconds(trackCadenceSeconds(track))}`} · ${trackEventOffsetsSeconds(track, patternDurationSeconds(program)).map(formatCompactDurationSeconds).join(', ') || 'no cues'}` : 'Off'} · {soundTitle(track.sound)} · {Math.round(track.volume * 100)}%</Text>)}
    {preset.settings ? <PresetSettingsDetails settings={preset.settings} /> : <Text style={[styles.detailLine, { color: tokens.text }]}>Settings · Keeps current timer settings</Text>}
  </View>
}

function PresetSettingsDetails({ settings }: { settings: AppTimerSettings }) {
  const { tokens } = useTheme()
  const activeRanges = settings.availability.weeklyWindows.filter(window => window.enabled && window.days !== 0 && window.behavior !== 'mute').length
  const quietRanges = settings.availability.weeklyWindows.filter(window => window.enabled && window.days !== 0 && window.behavior === 'mute').length
  const schedule = !settings.availability.enabled
    ? 'Off'
    : `${activeRanges} active ${activeRanges === 1 ? 'range' : 'ranges'}${quietRanges ? ` · ${quietRanges} quiet ${quietRanges === 1 ? 'range' : 'ranges'}` : ''}`
  const optional = [
    settings.liveCountdownEnabled ? 'live countdown' : null,
    settings.muteDuringCallsEnabled ? 'mute during calls' : null,
    settings.focusAutomationEnabled ? 'Focus' : null,
  ].filter((value): value is string => Boolean(value))
  return <>
    <Text style={[styles.detailLine, { color: tokens.text }]}>Schedule · {schedule}</Text>
    <Text style={[styles.detailLine, { color: tokens.text }]}>Sound · {Math.round(settings.masterVolume * 100)}% master · alarm {soundTitle(settings.alarmSound)} at {Math.round(settings.alarmVolume * 100)}% for {formatCompactDurationSeconds(settings.alarmDurationSeconds)}</Text>
    <Text style={[styles.detailLine, { color: tokens.text }]}>Haptics · {settings.haptics.enabled ? `main ${hapticProfileSummary(settings.haptics.main)} · sub-bell ${hapticProfileSummary(settings.haptics.subBell)} · alarm ${hapticProfileSummary(settings.haptics.alarm)}` : 'Off'}</Text>
    <Text style={[styles.detailLine, { color: tokens.text }]}>Options · {settings.advancedModeEnabled ? 'advanced controls' : 'simple controls'} · notifications {settings.notificationsEnabled ? 'on' : 'off'}{optional.length ? ` · ${optional.join(' · ')}` : ''}</Text>
  </>
}

const styles = StyleSheet.create({
  helper: { fontSize: 12, lineHeight: 18 },
  current: { gap: 3 },
  saveRow: { flexDirection: 'row', gap: 8 },
  saveAction: { paddingHorizontal: 7 },
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
  inspector: { gap: 12 },
  visibilityRow: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 12, borderTopWidth: 1, borderBottomWidth: 1, borderColor: 'transparent', paddingVertical: 7 },
  starterRow: { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderRadius: 13, padding: 12 },
  exportActions: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 14 },
  details: { borderTopWidth: 1, borderBottomWidth: 1, paddingVertical: 9, gap: 5 },
  detailLine: { fontSize: 11, lineHeight: 16 },
  visual: { gap: 2, paddingVertical: 4 }, visualMeta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }, visualKind: { fontSize: 12, fontWeight: '600' }, visualCount: { fontSize: 11 }, sequenceTrack: { height: 8, borderRadius: 4, overflow: 'hidden', flexDirection: 'row', gap: 2 }, sequenceSegment: { minWidth: 3 },
  chevron: { fontSize: 24, lineHeight: 26, fontWeight: '300' },
})

function configurationImportError(error: ConfigurationTransferError): Omit<AppNotice, 'id'> {
  if (error === 'empty') return { title: 'Nothing to import yet', message: 'Copy a Chandas configuration first, then choose Paste.', tone: 'info' }
  if (error === 'too-large') return { title: 'That configuration is too large', message: 'Choose a single Chandas configuration file.', tone: 'attention' }
  if (error === 'unsupported-version') return { title: 'This configuration is from a newer Chandas', message: 'Update the app before loading it.', tone: 'attention' }
  return { title: 'That is not a Chandas configuration', message: 'Copy or choose a configuration exported by Chandas.', tone: 'attention' }
}
