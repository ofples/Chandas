import { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import Slider from '@react-native-community/slider'
import type { AppTimerSettings, CueSettings, HapticProfile, SubBellColorId, UnifiedSubBellTrack, UnifiedTimerProgram, UnifiedTimerStep } from '../types'
import type { NativeFocusState } from '../native/ChandasTimerService'
import { ChandasTimerService, isNativeServiceAvailable } from '../native/ChandasTimerService'
import { Toggle } from '../components/Toggle'
import { DraggableSheet } from '../components/timer-v2/DraggableSheet'
import { DurationSelector } from '../components/timer-v2/DurationSelector'
import { ClockSnapSelector } from '../components/timer-v2/ClockSnapSelector'
import { OffsetGrid } from '../components/timer-v2/OffsetGrid'
import { SoundPickerSheet } from '../components/timer-v2/SoundPickerSheet'
import { ColorSelector } from '../components/timer-v2/ColorSelector'
import { RunLengthConfig } from '../components/timer-v2/run-length-config'
import { ScheduleConfig } from '../components/timer-v2/schedule-config'
import { ScheduleTimelinePreview } from '../components/timer-v2/ScheduleTimelinePreview'
import { PatternTimelinePreview } from '../components/timer-v2/PatternTimelinePreview'
import { SoundName } from '../components/timer-v2/SoundName'
import { Sortable, SortableItem, type SortableRenderItemProps } from 'react-native-reanimated-dnd'
import { SegmentedControl } from '../components/timer-v2/SegmentedControl'
import { SheetTextButton } from '../components/timer-v2/SheetTextButton'
import { GentleNotice, type AppNotice } from '../components/timer-v2/experience-feedback'
import { useConfirmation } from '../components/timer-v2/ConfirmationDialog'
import { useTheme, useAppReducedMotion } from '../theme/ThemeContext'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { createProgramId, MAX_CUE_DURATION_SECONDS, MAX_PATTERN_TRACKS, MAX_SEQUENCE_STEPS, MAX_VISIBLE_PATTERN_OFFSETS, formatCompactDurationSeconds } from '../lib/timerV2'
import { defaultUnifiedStepLabel } from '../lib/unified-timer'
import { hapticProfileSummary, HAPTIC_PATTERNS, HAPTIC_STRENGTHS } from '../lib/haptic-profiles'
import { previewHapticProfile, setAppHapticsEnabled, tapHaptic } from '../lib/haptics'
import { normalizeSubBellColor, subBellColorValue } from '../lib/subBellColors'
import { soundTitle } from '../lib/soundLibrary'
import { BellIcon, EyeIcon, VolumeIcon } from '../components/Icons'
import { parseUnifiedConfigurationTransfer, serializeUnifiedConfiguration } from '../lib/unified-configuration-transfer'
import { copyConfigurationText, pickConfigurationText, readConfigurationTextFromClipboard, saveConfigurationFile } from '../lib/configuration-transfer-io'
import { configurationTransferFilename } from '../lib/configuration-transfer'
import { UNNAMED_DRAFT_KEY, defaultUnifiedTimerName, type ConfigStateCommand, type UnifiedConfigState, type UnifiedTimerConfig, type UnifiedTimerDraft } from '../lib/unified-config-state'
import { useKeyboardVisible } from '../hooks/use-keyboard-visible'
import { unifiedCadenceOffsets, unifiedTrackCadencePatch } from '../lib/unified-editing'

export interface UnifiedTimerConfigScreenProps {
  state: UnifiedConfigState
  onCommand: (command: ConfigStateCommand) => void | boolean | Promise<boolean>
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

type ExtraAction = 'alignment' | 'run-length' | 'schedule' | 'haptics' | 'alarm' | 'focus' | 'notifications' | 'calls' | 'precision' | 'running-controls' | 'system' | 'device'
type CueTarget = { kind: 'step-end'; stepId: string } | { kind: 'track'; stepId: string; trackId: string } | { kind: 'alarm' } | { kind: 'completion' } | { kind: 'sound-library' }
type ModalKind = 'picker' | 'switch' | 'save-as' | 'settings' | 'step' | 'subbells' | 'track' | null
const ACTIONS: ReadonlyArray<{ id: ExtraAction; label: string }> = [
  { id: 'alignment', label: 'Clock alignment' }, { id: 'run-length', label: 'Run length' },
  { id: 'schedule', label: 'Schedule' }, { id: 'haptics', label: 'Default haptics' },
  { id: 'alarm', label: 'Alarm settings' }, { id: 'focus', label: 'Focus' },
  { id: 'notifications', label: 'Notifications' }, { id: 'calls', label: 'Call mute' },
  { id: 'precision', label: 'Seconds' }, { id: 'running-controls', label: 'Running controls' }, { id: 'system', label: 'System access' }, { id: 'device', label: 'Device appearance' },
]
const MAIN_DURATION_PRESETS = [5, 10, 15, 30, 45, 60] as const
const STEP_DURATION_PRESETS = [1, 2, 3, 5, 10, 15, 20, 25, 30, 45, 60] as const
const own = (object: object, key: PropertyKey) => Object.prototype.hasOwnProperty.call(object, key)

export function UnifiedTimerConfigScreen({ state, onCommand, onStart, starting, focusState, onFocusAutomationChange, onOpenFocusSettings, onOpenFocusRuleSettings, androidAccess, onOpenExactAlarmSettings, onOpenFullScreenIntentSettings, onRequestCallMuteAccess, onRequestNotificationAccess, onFeedback }: UnifiedTimerConfigScreenProps) {
  const { tokens, theme, toggleTheme, useEinkTheme, accentColor, setAccentColor } = useTheme()
  const insets = useSafeAreaInsets()
  const keyboardVisible = useKeyboardVisible()
  const reducedMotion = useAppReducedMotion()
  const confirm = useConfirmation()
  const [modal, setModal] = useState<ModalKind>(null)
  const [stepRail, setStepRail] = useState<'volume' | 'haptics' | 'alarm' | null>(null)
  const [settingsAction, setSettingsAction] = useState<ExtraAction | null>(null)
  const [editingTrackId, setEditingTrackId] = useState<string | null>(null)
  const [stepSheetRetained, setStepSheetRetained] = useState(false)
  const [settingsRetained, setSettingsRetained] = useState(false)
  const [nameEditing, setNameEditing] = useState(false)
  const [queuedConfigId, setQueuedConfigId] = useState<string | null>(null)
  const [saveAsForSwitch, setSaveAsForSwitch] = useState(false)
  const [saveAsReturnToPicker, setSaveAsReturnToPicker] = useState(false)
  const switchReturnModal = useRef<ModalKind>(null)
  const [saveAsName, setSaveAsName] = useState('')
  const [renameValues, setRenameValues] = useState<Record<string, string>>({})
  const [cueTarget, setCueTarget] = useState<CueTarget | null>(null)
  const [libraryPreviewCue, setLibraryPreviewCue] = useState<CueSettings>({ sound: { kind: 'builtin', id: 'clear-bell' }, volume: 1 })
  const [activeStepId, setActiveStepId] = useState<string | null>(null)
  const [stepNameDraft, setStepNameDraft] = useState('')
  const [transferBusy, setTransferBusy] = useState(false)
  const [commandPending, setCommandPending] = useState(false)
  const commandPendingRef = useRef(false)
  const [floatingOverlay, setFloatingOverlay] = useState(() => ChandasTimerService.getFloatingOverlayState())
  const [themeLongPressed, setThemeLongPressed] = useState(false)
  const [draftName, setDraftName] = useState('')
  const currentKey = state.selectedConfigId ?? UNNAMED_DRAFT_KEY
  const draft = own(state.drafts, currentKey) ? state.drafts[currentKey] : undefined
  const selectedConfig = state.configs.find(config => config.id === state.selectedConfigId)
  const program = draft?.program
  const activeStep = program?.steps.find(step => step.id === activeStepId) ?? program?.steps[0]
  const capabilities = ChandasTimerService.getCapabilities()
  const nativeSchemaReady = Platform.OS !== 'android' || !isNativeServiceAvailable || (capabilities?.programSchemaMax ?? 0) >= 4
  const soundPickerCue = cueTarget?.kind === 'sound-library' ? libraryPreviewCue : cueTarget ? getCue(draft, cueTarget) : null
  const floatingAvailable = capabilities?.supportsFloatingOverlay === true

  const performCommand = async (command: ConfigStateCommand): Promise<boolean> => {
    if (commandPendingRef.current) return false
    commandPendingRef.current = true
    setCommandPending(true)
    try {
      return (await onCommand(command)) !== false
    } catch {
      onFeedback({ title: 'Could not save timer changes', message: 'Your current draft remains open. Try again in a moment.', tone: 'attention' })
      return false
    } finally {
      commandPendingRef.current = false
      setCommandPending(false)
    }
  }

  useEffect(() => { setDraftName(draft?.name ?? '') }, [draft?.baseConfigId, draft?.name, state.selectedConfigId])
  useEffect(() => {
    if (!activeStepId || !program?.steps.some(step => step.id === activeStepId)) setActiveStepId(program?.steps[0]?.id ?? null)
  }, [activeStepId, program])
  useEffect(() => { setStepNameDraft(activeStep?.label ?? '') }, [activeStep?.id, activeStep?.label])
  useEffect(() => {
    if (!floatingAvailable) return
    setFloatingOverlay(ChandasTimerService.getFloatingOverlayState())
    const listener = ChandasTimerService.addFloatingOverlayStateListener(setFloatingOverlay)
    return () => listener?.remove()
  }, [floatingAvailable])

  if (!draft || !program || !activeStep) return <View testID="unified-config-screen" style={[styles.screen, { backgroundColor: tokens.bg }]}><GentleNotice title="Timer configuration needs recovery" message="The saved timer state could not be opened safely. Its source data is preserved for recovery." tone="attention" /></View>

  const edit = (changes: Partial<Pick<UnifiedTimerDraft, 'name' | 'program' | 'settings' | 'editorOptions'>>) => onCommand({ type: 'edit', changes })
  const patchSettings = (changes: Partial<AppTimerSettings>) => edit({ settings: { ...draft.settings, ...changes } })
  const patchProgram = (changes: Partial<UnifiedTimerProgram>) => edit({ program: { ...program, ...changes } })
  const patchStep = (stepId: string, changes: Partial<UnifiedTimerStep>) => patchProgram({ steps: program.steps.map(step => step.id === stepId ? { ...step, ...changes } : step) })
  const patchTrack = (stepId: string, trackId: string, changes: Partial<UnifiedSubBellTrack>) => patchStep(stepId, { subBellTracks: program.steps.find(step => step.id === stepId)!.subBellTracks.map(track => track.id === trackId ? { ...track, ...changes } : track) })
  const updateStepDuration = (stepId: string, durationSeconds: number) => {
    const step = program.steps.find(item => item.id === stepId)
    if (!step) return
    const label = program.steps.length === 1
      ? [...(draft.editorOptions.configurationNameIsCustom === false ? defaultUnifiedTimerName(durationSeconds) : draft.name)].slice(0, 60).join('')
      : step.labelIsCustom === false ? defaultUnifiedStepLabel(durationSeconds) : step.label
    const steps = program.steps.map(item => item.id === stepId ? { ...item, durationSeconds, label } : item)
    const changes: Partial<Pick<UnifiedTimerDraft, 'name' | 'program'>> = { program: { ...program, steps } }
    if (program.steps.length === 1 && draft.editorOptions.configurationNameIsCustom === false) changes.name = defaultUnifiedTimerName(durationSeconds)
    edit(changes)
  }
  const updateConfigurationName = (name: string) => {
    const bounded = [...name].slice(0, 80).join('')
    edit({ name: bounded, editorOptions: { ...draft.editorOptions, configurationNameIsCustom: true }, ...(program.steps.length === 1 ? { program: { ...program, steps: program.steps.map(step => ({ ...step, label: [...name].slice(0, 60).join(''), labelIsCustom: true })) } } : {}) })
  }
  const switchTo = (configId: string | null) => {
    if (configId === state.selectedConfigId) { setModal(null); return }
    if (draft.dirty) { switchReturnModal.current = modal; setQueuedConfigId(configId); setSaveAsForSwitch(false); setModal('switch'); return }
    void performCommand({ type: 'switch', configId, choice: 'keep' }).then(accepted => { if (accepted) setModal(null) })
  }
  const respondToSwitch = async (choice: 'save' | 'keep' | 'discard' | 'cancel') => {
    if (choice === 'save' && !draft.baseConfigId) {
      setSaveAsName(draft.name === 'New timer' ? '' : draft.name)
      setSaveAsForSwitch(true)
      setModal('save-as')
      return
    }
    if (choice === 'cancel') {
      onCommand({ type: 'switch', configId: queuedConfigId, choice })
      setModal(switchReturnModal.current)
      setQueuedConfigId(null)
      setSaveAsForSwitch(false)
      return
    }
    if (await performCommand({ type: 'switch', configId: queuedConfigId, choice })) {
      setModal(null)
      setQueuedConfigId(null)
      setSaveAsForSwitch(false)
    }
  }
  const saveAsAndSwitch = async () => {
    if (!saveAsName.trim()) return
    if (await performCommand({ type: 'switch', configId: queuedConfigId, choice: 'save-as', saveAsName: saveAsName.trim(), saveAsId: createProgramId() })) {
      setModal(null)
      setQueuedConfigId(null)
      setSaveAsForSwitch(false)
    }
  }
  const addStep = () => {
    if (program.steps.length >= MAX_SEQUENCE_STEPS) return
    const step: UnifiedTimerStep = {
      id: createProgramId(), label: defaultUnifiedStepLabel(300), labelIsCustom: false, durationSeconds: 300,
      endCue: cloneCue(program.steps.at(-1)!.endCue), endAlarmEnabled: false, subBellsEnabled: false, subBellTracks: [],
    }
    const previous = program.steps.length === 1 ? [{ ...program.steps[0], label: [...draft.name].slice(0, 60).join(''), labelIsCustom: draft.editorOptions.configurationNameIsCustom !== false }] : program.steps
    patchProgram({ steps: [...previous, step] })
    setActiveStepId(step.id)
  }
  const duplicateStep = (step: UnifiedTimerStep) => {
    if (program.steps.length >= MAX_SEQUENCE_STEPS) return
    const copy = { ...step, id: createProgramId(), label: copyLabel(step.label), endCue: cloneCue(step.endCue), subBellTracks: step.subBellTracks.map(track => ({ ...track, id: createProgramId(), sound: { ...track.sound }, sounds: track.sounds?.map(sound => ({ ...sound })), randomRepeat: track.randomRepeat ? { ...track.randomRepeat } : undefined, selectedOffsetsSeconds: [...track.selectedOffsetsSeconds] })) }
    const index = program.steps.findIndex(item => item.id === step.id)
    const steps = [...program.steps]
    steps.splice(index + 1, 0, copy)
    patchProgram({ steps })
    setActiveStepId(copy.id)
  }
  const removeStep = async (step: UnifiedTimerStep) => {
    if (program.steps.length <= 1) return
    if (!await confirm({ title: `Delete ${step.label}?`, message: 'This removes the step and its sub-bell settings from this draft.', confirmLabel: 'Delete step', cancelLabel: 'Keep step', destructive: true })) return
    const steps = program.steps.filter(item => item.id !== step.id)
    if (steps.length === 1) {
      const name = draft.editorOptions.configurationNameIsCustom === false ? defaultUnifiedTimerName(steps[0].durationSeconds) : draft.name
      steps[0] = { ...steps[0], label: [...name].slice(0, 60).join(''), labelIsCustom: draft.editorOptions.configurationNameIsCustom !== false }
      edit({ name, program: { ...program, steps } })
    } else patchProgram({ steps })
    setActiveStepId(steps[0]?.id ?? null)
    if (steps.length === 1) { setModal(null); setStepSheetRetained(false) }
  }
  const moveStep = (index: number, target: number) => {
    if (index < 0 || index >= program.steps.length || target < 0 || target >= program.steps.length) return
    const steps = [...program.steps]
    const [moved] = steps.splice(index, 1)
    steps.splice(target, 0, moved)
    patchProgram({ steps })
  }
  const patchCue = (patch: Partial<CueSettings>) => {
    if (!cueTarget) return
    if (cueTarget.kind === 'sound-library') {
      setLibraryPreviewCue(current => ({ ...current, ...patch }))
      const candidates = [...(patch.sound ? [patch.sound] : []), ...(patch.sounds ?? [])].filter(sound => sound.kind !== 'builtin')
      if (candidates.length) void performCommand({ type: 'setSoundLibrary', sounds: [...state.soundLibrary, ...candidates] })
    }
    else if (cueTarget.kind === 'alarm') patchSettings({ ...(patch.sound ? { alarmSound: patch.sound } : {}), ...(typeof patch.volume === 'number' ? { alarmVolume: patch.volume } : {}) })
    else if (cueTarget.kind === 'completion') patchProgram({ completionCue: program.completionCue ? { ...program.completionCue, ...patch } : null })
    else if (cueTarget.kind === 'step-end') patchStep(cueTarget.stepId, { endCue: { ...program.steps.find(step => step.id === cueTarget.stepId)!.endCue, ...patch } })
    else patchTrack(cueTarget.stepId, cueTarget.trackId, patch)
  }
  const openExternalImport = async (source: 'clipboard' | 'file') => {
    if (transferBusy) return
    setTransferBusy(true)
    try {
      const text = source === 'clipboard' ? await readConfigurationTextFromClipboard() : await pickConfigurationText()
      if (text === null) return
      const imported = parseUnifiedConfigurationTransfer(text, state.configs.map(config => config.name))
      if (!imported.ok) {
        onFeedback({ title: 'Could not import configuration', message: transferError(imported.error), tone: 'attention' })
        return
      }
      if (!await performCommand({ type: 'importConfig', config: imported.config, select: false })) return
      onFeedback({ title: 'Configuration imported', message: imported.hasDeviceSpecificSounds ? `“${imported.config.name}” was added. Device-specific sounds may need to be selected again.` : `“${imported.config.name}” was added to your configurations.`, tone: 'success' })
      setModal(null)
    } catch {
      onFeedback({ title: 'Could not open that configuration', message: 'Choose a Chandas configuration file or try the clipboard again.', tone: 'attention' })
    } finally { setTransferBusy(false) }
  }
  const exportConfig = async (config: UnifiedTimerConfig) => {
    if (transferBusy) return
    setTransferBusy(true)
    try {
      const exported = serializeUnifiedConfiguration(config)
      await copyConfigurationText(exported)
      await saveConfigurationFile(configurationTransferFilename(config.name), exported)
      onFeedback({ title: 'Configuration exported', message: `“${config.name}” is ready to share or save.`, tone: 'success' })
    } catch {
      onFeedback({ title: 'Could not export configuration', message: 'The setup remains saved. Try again in a moment.', tone: 'attention' })
    } finally { setTransferBusy(false) }
  }
  const cycleDurationSeconds = program.steps.reduce((sum, step) => sum + step.durationSeconds, 0)
  const alignmentValue = program.alignment.kind === 'local-clock' ? program.alignment.offsetMinutes : null
  return <KeyboardAvoidingView testID="unified-config-screen" style={[styles.screen, { backgroundColor: tokens.bg }]} behavior={Platform.OS === 'ios' ? 'padding' : Platform.OS === 'android' ? 'height' : undefined}>
    <ScrollView contentContainerStyle={[styles.setupPage, { paddingTop: insets.top + 12, paddingBottom: keyboardVisible ? 12 : insets.bottom + 18 }]} keyboardShouldPersistTaps="handled">
      <View style={styles.topBar}>
        {nameEditing ? <TextInput testID="unified-config-name" accessibilityLabel="Timer configuration name" autoFocus value={draftName} onChangeText={value => { const next = [...value].slice(0, 80).join(''); setDraftName(next); if (next.trim()) updateConfigurationName(next) }} onBlur={() => { const name = draftName.trim() || draft.name; setDraftName(name); updateConfigurationName(name); setNameEditing(false) }} placeholder="Timer name" placeholderTextColor={tokens.textMuted} style={[styles.nameInput, { color: tokens.text, borderBottomColor: tokens.accent }]} returnKeyType="done" /> : <Pressable testID="unified-config-name" accessibilityRole="button" accessibilityLabel={`Edit timer name, ${draft.name}`} onPress={() => setNameEditing(true)} style={styles.nameEdit}><Text numberOfLines={1} style={[styles.pageTitle, { color: tokens.text }]}>{draft.name}</Text><Text style={[styles.helperText, { color: draft.baseConfigId && draft.dirty ? tokens.warm : tokens.textMuted }]}>{!draft.baseConfigId ? 'Unsaved timer' : draft.dirty ? 'Draft changes' : 'Saved'}</Text></Pressable>}
        <View style={styles.topActions}>
          {selectedConfig ? <Pressable testID="unified-config-save" accessibilityRole="button" accessibilityLabel="Save configuration" disabled={!draft.dirty || commandPending} onPress={() => { void performCommand({ type: 'save' }) }} style={[styles.saveButton, { borderColor: tokens.border, opacity: !draft.dirty || commandPending ? 0.45 : 1 }]}><Text style={{ color: tokens.accent, fontWeight: '700' }}>{commandPending ? 'Saving…' : 'Save'}</Text></Pressable> : <Pressable testID="unified-config-save-as" accessibilityRole="button" accessibilityLabel="Save configuration" onPress={() => { setSaveAsName(draft.name); setModal('save-as') }} style={[styles.saveButton, { borderColor: tokens.border }]}><Text style={{ color: tokens.accent, fontWeight: '700' }}>Save</Text></Pressable>}
          <Pressable testID="unified-config-settings" accessibilityRole="button" accessibilityLabel="Settings" onPress={() => { setSettingsAction(null); setSettingsRetained(false); setModal('settings') }} style={[styles.iconButton, { borderColor: tokens.border }]}><Text style={[styles.overflowGlyph, { color: tokens.text }]}>•••</Text></Pressable>
        </View>
      </View>

      {program.steps.length === 1 ? <>
        <View style={styles.mainTimerFlat}>
          <Text style={[styles.mainIntervalLabel, { color: tokens.text }]}>Main interval</Text>
          <View testID="unified-main-duration"><DurationSelector value={Math.ceil(activeStep.durationSeconds / 60)} valueSeconds={activeStep.durationSeconds} secondPrecision={draft.settings.secondPrecisionEnabled || activeStep.durationSeconds % 60 !== 0} presets={MAIN_DURATION_PRESETS} minSeconds={1} maxSeconds={MAX_CUE_DURATION_SECONDS} onChange={minutes => updateStepDuration(activeStep.id, Math.min(MAX_CUE_DURATION_SECONDS, minutes * 60))} onChangeSeconds={seconds => updateStepDuration(activeStep.id, seconds)} /></View>
          <Pressable testID="unified-main-sound" accessibilityRole="button" accessibilityLabel="Choose main interval sound" onPress={() => setCueTarget({ kind: 'step-end', stepId: activeStep.id })} style={[styles.soundSummary, { borderColor: tokens.border }]}>
            <BellIcon on color={tokens.accent} /><View style={styles.flex}><Text style={[styles.rowTitle, { color: tokens.text }]}>At the end</Text><SoundName cue={activeStep.endCue} style={styles.soundName} /></View><VolumeIcon level={activeStep.endCue.volume} color={tokens.textMuted} /><Text style={{ color: tokens.textMuted }}>›</Text>
          </Pressable>
        </View>

      </> : <View style={styles.section}>
        <View style={[styles.sortableSteps, { height: Math.min(620, program.steps.length * 142) }]}><Sortable data={program.steps.map(step => ({ id: step.id }))} itemHeight={142} useFlatList={false} style={[styles.sortableStepsScroll, { backgroundColor: tokens.bg }]} contentContainerStyle={[styles.sortableStepsContent, { backgroundColor: tokens.bg }]} renderItem={props => { const step = program.steps.find(item => item.id === props.item.id); return step ? <UnifiedStepSortableCard {...props} step={step} stepNumber={program.steps.findIndex(item => item.id === step.id) + 1} itemCount={program.steps.length} onEdit={() => { setActiveStepId(step.id); setStepSheetRetained(false); setStepRail(null); setModal('step') }} onMove={moveStep} onDuplicate={() => duplicateStep(step)} onDelete={() => void removeStep(step)} canDuplicate={program.steps.length < MAX_SEQUENCE_STEPS} /> : null }} /></View>
      </View>}

      <TimerControlRail singleStep={program.steps.length === 1} program={program} settings={draft.settings} step={activeStep} cycleDurationSeconds={cycleDurationSeconds} onProgram={patchProgram} onSettings={patchSettings} onCueVolume={volume => patchStep(activeStep.id, { endCue: { ...activeStep.endCue, volume } })} onCueHaptics={hapticOverride => patchStep(activeStep.id, { endCue: { ...activeStep.endCue, hapticOverride } })} onAlarm={endAlarmEnabled => patchStep(activeStep.id, { endAlarmEnabled })} onOpenAlarmSettings={() => { setSettingsAction('alarm'); setModal('settings') }} />
      {program.steps.length === 1 ? <View style={styles.section}>
        <View style={[styles.subBellSummary, { backgroundColor: tokens.surface, borderColor: tokens.border }]}>
          <View style={styles.subBellHeader}><View style={styles.flex}><Text style={[styles.rowTitle, { color: tokens.text }]}>Sub-bells</Text><Text style={[styles.helperText, { color: tokens.textMuted }]}>{activeStep.subBellsEnabled ? `${activeStep.subBellTracks.filter(track => track.enabled).length} active · ${activeStep.subBellTracks.length} configured` : activeStep.subBellTracks.length ? 'Off · settings retained' : 'No sub-bells'}</Text></View><Toggle value={activeStep.subBellsEnabled} onChange={subBellsEnabled => patchStep(activeStep.id, { subBellsEnabled })} accessibilityLabel="Sub-bells during this interval" /></View>
          <PatternTimelinePreview tracks={asPatternTracks(activeStep.subBellsEnabled ? activeStep.subBellTracks : [])} mainDurationSeconds={activeStep.durationSeconds} onPress={() => setModal('subbells')} />
          <Pressable testID="unified-open-subbells" onPress={() => setModal('subbells')} accessibilityRole="button" style={styles.inlineLink}><Text style={{ color: tokens.accent }}>Edit sub-bells · {activeStep.subBellTracks.length}</Text><Text style={{ color: tokens.accent }}>›</Text></Pressable>
        </View>
      </View> : null}

      <View style={styles.mainActions}>
        <Pressable testID="unified-add-step" accessibilityRole="button" accessibilityState={{ disabled: program.steps.length >= MAX_SEQUENCE_STEPS }} disabled={program.steps.length >= MAX_SEQUENCE_STEPS} onPress={addStep} style={[styles.secondaryButton, { borderColor: tokens.border }]}><Text style={{ color: tokens.text }}>＋ Add step</Text></Pressable>
      </View>
      {program.completionCue ? <Pressable onPress={() => setCueTarget({ kind: 'completion' })} style={styles.secondaryLine}><Text style={[styles.helperText, { color: tokens.textMuted }]}>Completion sound · {soundTitle(program.completionCue.sound)}</Text><Text style={{ color: tokens.accent }}>›</Text></Pressable> : null}
      {!nativeSchemaReady ? <Text style={[styles.noticeText, { color: tokens.warm }]}>Update Chandas to start this timer.</Text> : null}
    </ScrollView>
    <View style={[styles.startDock, { borderColor: tokens.border, paddingBottom: Math.max(insets.bottom, 10), backgroundColor: tokens.bg }]}>
      <Pressable testID="unified-config-start" disabled={!nativeSchemaReady || starting} onPress={() => { tapHaptic(); onStart() }} accessibilityRole="button" accessibilityState={{ disabled: !nativeSchemaReady || starting, busy: starting }} style={({ pressed }) => [styles.startButton, { backgroundColor: theme === 'eink' ? tokens.surface : tokens.accent, borderColor: tokens.border, opacity: !nativeSchemaReady || starting ? 0.52 : pressed ? 0.8 : 1 }]}>
        {starting ? <ActivityIndicator color={theme === 'eink' ? tokens.text : '#fff'} /> : null}<Text style={[styles.startText, { color: theme === 'eink' ? tokens.text : '#fff' }]}>{starting ? 'Starting timer…' : 'Start timer'}</Text>
      </Pressable>
    </View>

    <DraggableSheet visible={modal === 'settings' || (modal === 'picker' && settingsRetained)} title={settingsAction ? (ACTIONS.find(action => action.id === settingsAction)?.label ?? 'Settings') : 'Settings'} testID="unified-settings-sheet" onClose={() => { setModal(null); setSettingsRetained(false) }}>
      {!settingsAction ? <View style={styles.settingsMenu}>
        {[{ id: 'picker', label: 'Configurations', detail: 'Save, switch, import and export' }, { id: 'sound-library', label: 'Sound library', detail: `${state.soundLibrary.length} shared imported sounds` }, ...ACTIONS.map(action => ({ id: action.id, label: action.label, detail: settingsDetail(action.id, draft.settings, program) }))].map(item => <Pressable key={item.id} testID={`unified-settings-${item.id}`} accessibilityRole="button" onPress={() => item.id === 'picker' ? (setSettingsRetained(true), setModal('picker')) : item.id === 'sound-library' ? setCueTarget({ kind: 'sound-library' }) : setSettingsAction(item.id as ExtraAction)} style={[styles.settingsRow, { borderColor: tokens.border }]}><View style={styles.flex}><Text style={[styles.rowTitle, { color: tokens.text }]}>{item.label}</Text><Text style={[styles.helperText, { color: tokens.textMuted }]}>{item.detail}</Text></View><Text style={{ color: tokens.accent }}>›</Text></Pressable>)}
        {program.completionCue ? <Pressable onPress={() => { setModal(null); setCueTarget({ kind: 'completion' }) }} style={[styles.settingsRow, { borderColor: tokens.border }]}><View><Text style={[styles.rowTitle, { color: tokens.text }]}>Completion sound</Text><SoundName cue={program.completionCue} style={styles.helperText} /></View><Text style={{ color: tokens.accent }}>›</Text></Pressable> : <Pressable onPress={() => patchProgram({ completionCue: { sound: { kind: 'builtin', id: 'temple-gong' }, volume: 1 } })} style={[styles.settingsRow, { borderColor: tokens.border }]}><Text style={[styles.rowTitle, { color: tokens.text }]}>Add completion sound</Text><Text style={{ color: tokens.accent }}>＋</Text></Pressable>}
      </View> : <SettingsSection action={settingsAction} draft={draft} program={program} cycleDurationSeconds={cycleDurationSeconds} focusState={focusState} androidAccess={androidAccess} floatingOverlay={floatingOverlay} floatingAvailable={floatingAvailable} theme={theme} tokens={tokens} onBack={() => setSettingsAction(null)} onSettings={patchSettings} onProgram={patchProgram} onCue={kind => setCueTarget(kind === 'alarm' ? { kind: 'alarm' } : { kind: 'completion' })} onFocusAutomationChange={onFocusAutomationChange} onOpenFocusSettings={onOpenFocusSettings} onOpenFocusRuleSettings={onOpenFocusRuleSettings} onOpenExactAlarmSettings={onOpenExactAlarmSettings} onOpenFullScreenIntentSettings={onOpenFullScreenIntentSettings} onRequestCallMuteAccess={onRequestCallMuteAccess} onRequestNotificationAccess={onRequestNotificationAccess} onFloatingChange={setFloatingOverlay} onFeedback={onFeedback} accentColor={accentColor} setAccentColor={setAccentColor} themeLongPressed={themeLongPressed} setThemeLongPressed={setThemeLongPressed} toggleTheme={toggleTheme} useEinkTheme={useEinkTheme} />}
    </DraggableSheet>

    <DraggableSheet visible={modal === 'step' || ((modal === 'subbells' || modal === 'track') && stepSheetRetained)} title={`Step ${program.steps.findIndex(step => step.id === activeStep.id) + 1}`} testID="unified-step-sheet" onClose={() => { setModal(null); setStepSheetRetained(false) }}>
      {program.steps.length > 1 ? <TextInput testID={`unified-config-step-name-${activeStep.id}`} accessibilityLabel="Step name" value={stepNameDraft} onChangeText={value => { const label = [...value].slice(0, 60).join(''); setStepNameDraft(label); if (label.trim()) patchStep(activeStep.id, { label, labelIsCustom: true }) }} onBlur={() => { const label = stepNameDraft.trim() || activeStep.label; setStepNameDraft(label); if (label !== activeStep.label) patchStep(activeStep.id, { label, labelIsCustom: true }) }} placeholder="Step name" placeholderTextColor={tokens.textMuted} style={[styles.input, { borderColor: tokens.border, color: tokens.text }]} /> : null}
      <Text style={[styles.mainIntervalLabel, { color: tokens.text }]}>Main interval</Text>
      <DurationSelector value={Math.ceil(activeStep.durationSeconds / 60)} valueSeconds={activeStep.durationSeconds} secondPrecision={draft.settings.secondPrecisionEnabled || activeStep.durationSeconds % 60 !== 0} presets={STEP_DURATION_PRESETS} minSeconds={1} maxSeconds={MAX_CUE_DURATION_SECONDS} onChange={minutes => updateStepDuration(activeStep.id, minutes * 60)} onChangeSeconds={seconds => updateStepDuration(activeStep.id, seconds)} />
      <Pressable onPress={() => setCueTarget({ kind: 'step-end', stepId: activeStep.id })} style={[styles.soundSummary, { borderColor: tokens.border }]}><Text style={[styles.rowTitle, { color: tokens.text }]}>At the end</Text><SoundName cue={activeStep.endCue} style={styles.soundName} /><Text style={{ color: tokens.accent }}>›</Text></Pressable>
      {program.steps.length > 1 ? <View style={styles.stepRailSection}><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.trackOptions}>{([{ id: 'volume', label: 'Volume' }, { id: 'haptics', label: 'Haptics' }, { id: 'alarm', label: 'Alarm' }] as const).map(item => <ActionChip key={item.id} label={item.label} active={stepRail === item.id} tokens={tokens} onPress={() => setStepRail(stepRail === item.id ? null : item.id)} />)}</ScrollView>{stepRail === 'volume' ? <LabelledSlider label="Ending cue volume" value={activeStep.endCue.volume} onChange={volume => patchStep(activeStep.id, { endCue: { ...activeStep.endCue, volume } })} /> : null}{stepRail === 'haptics' ? <CueHapticsEditor cue={activeStep.endCue} inherited={draft.settings.haptics.main} onChange={hapticOverride => patchStep(activeStep.id, { endCue: { ...activeStep.endCue, hapticOverride } })} /> : null}{stepRail === 'alarm' ? <View style={styles.row}><View style={styles.flex}><Text style={[styles.rowTitle, { color: tokens.text }]}>Alarm at step end</Text><Text style={[styles.helperText, { color: tokens.textMuted }]}>Ring until dismissed</Text></View><Toggle value={activeStep.endAlarmEnabled} onChange={endAlarmEnabled => patchStep(activeStep.id, { endAlarmEnabled })} accessibilityLabel="Alarm at step end" /></View> : null}</View> : <View style={styles.row}><Text style={[styles.rowTitle, { color: tokens.text }]}>Alarm at step end</Text><Toggle value={activeStep.endAlarmEnabled} onChange={endAlarmEnabled => patchStep(activeStep.id, { endAlarmEnabled })} accessibilityLabel="Alarm at step end" /></View>}
      <View style={styles.subBellSummary}><View style={styles.subBellHeader}><Text style={[styles.rowTitle, { color: tokens.text }]}>Sub-bells</Text><Toggle value={activeStep.subBellsEnabled} onChange={subBellsEnabled => patchStep(activeStep.id, { subBellsEnabled })} accessibilityLabel="Sub-bells for step" /></View><PatternTimelinePreview tracks={asPatternTracks(activeStep.subBellsEnabled ? activeStep.subBellTracks : [])} mainDurationSeconds={activeStep.durationSeconds} onPress={() => { setStepSheetRetained(true); setModal('subbells') }} /><Pressable onPress={() => { setStepSheetRetained(true); setModal('subbells') }} style={styles.inlineLink}><Text style={{ color: tokens.accent }}>Open sub-bell list</Text><Text style={{ color: tokens.accent }}>›</Text></Pressable></View>
      <View style={styles.buttonRow}><SheetTextButton disabled={program.steps.length >= MAX_SEQUENCE_STEPS} label="Duplicate step" onPress={() => duplicateStep(activeStep)} /><SheetTextButton disabled={program.steps.length <= 1} label="Delete step" tone="danger" onPress={() => void removeStep(activeStep)} /></View>
    </DraggableSheet>

    <DraggableSheet visible={modal === 'subbells' || modal === 'track'} title="Sub-bells" testID="unified-subbells-sheet" onClose={() => { setModal(stepSheetRetained ? 'step' : null); setStepSheetRetained(false) }}>
      <View style={styles.subBellHeader}><View style={styles.flex}><Text style={[styles.rowTitle, { color: tokens.text }]}>Sub-bells in {program.steps.length > 1 ? activeStep.label : 'this interval'}</Text><Text style={[styles.helperText, { color: tokens.textMuted }]}>Each sub-bell keeps its own sound and timing.</Text></View><Toggle value={activeStep.subBellsEnabled} onChange={subBellsEnabled => patchStep(activeStep.id, { subBellsEnabled })} accessibilityLabel="Enable sub-bells" /></View>
      <PatternTimelinePreview tracks={asPatternTracks(activeStep.subBellsEnabled ? activeStep.subBellTracks : [])} mainDurationSeconds={activeStep.durationSeconds} />
      {activeStep.subBellTracks.map((track, index) => <View key={track.id} testID={`unified-track-row-${track.id}`} style={[styles.trackListRow, { borderColor: tokens.border, backgroundColor: tokens.surface }]}>
        <Pressable accessibilityRole="button" accessibilityLabel={`Edit ${track.label}`} onPress={() => { setEditingTrackId(track.id); setModal('track') }} style={[styles.trackListEdit, styles.flex]}>
          <View style={[styles.trackDot, { backgroundColor: subBellColorValue(track.color, index, theme === 'eink') }]} /><View style={styles.flex}><Text style={[styles.rowTitle, { color: tokens.text }]}>{track.label}</Text><Text style={[styles.helperText, { color: tokens.textMuted }]}><SoundSummary cue={track} /> · {trackTimingSummary(track)}</Text></View>
        </Pressable>
        <Toggle value={track.enabled} onChange={enabled => patchTrack(activeStep.id, track.id, { enabled })} accessibilityLabel={`Enable ${track.label}`} /><Text accessible={false} style={{ color: tokens.accent }}>›</Text>
      </View>)}
      <Pressable testID="unified-add-subbell" accessibilityRole="button" disabled={activeStep.subBellTracks.length >= MAX_PATTERN_TRACKS} onPress={() => { const track = makeNewTrack(activeStep.subBellTracks.length, activeStep.durationSeconds); patchStep(activeStep.id, { subBellsEnabled: true, subBellTracks: [...activeStep.subBellTracks, track] }); setEditingTrackId(track.id); setModal('track') }} style={[styles.secondaryButton, { borderColor: tokens.border }]}><Text style={{ color: tokens.accent }}>＋ Add a sub-bell</Text></Pressable>
    </DraggableSheet>

    <DraggableSheet visible={modal === 'track'} title={editingTrackId ? activeStep.subBellTracks.find(track => track.id === editingTrackId)?.label ?? 'Sub-bell' : 'Sub-bell'} showTitle={false} testID="unified-track-sheet" onClose={() => setModal('subbells')}>
      {(() => { const track = activeStep.subBellTracks.find(item => item.id === editingTrackId); return track ? <TrackDetail track={track} durationSeconds={activeStep.durationSeconds} secondPrecision={draft.settings.secondPrecisionEnabled} settings={draft.settings} onPatch={changes => patchTrack(activeStep.id, track.id, changes)} onOpenSound={() => setCueTarget({ kind: 'track', stepId: activeStep.id, trackId: track.id })} onDuplicate={() => { const duplicate = cloneTrackWithNewId(track); if (activeStep.subBellTracks.length < MAX_PATTERN_TRACKS) { patchStep(activeStep.id, { subBellTracks: [...activeStep.subBellTracks, duplicate] }); setEditingTrackId(duplicate.id) } }} onDelete={async () => { if (await confirm({ title: `Delete ${track.label}?`, message: 'This removes the sub-bell from this timer step.', confirmLabel: 'Delete sub-bell', cancelLabel: 'Keep sub-bell', destructive: true })) { patchStep(activeStep.id, { subBellTracks: activeStep.subBellTracks.filter(item => item.id !== track.id) }); setModal('subbells') } }} /> : null })()}
    </DraggableSheet>

    <DraggableSheet visible={modal === 'picker'} title="Configurations" testID="unified-config-picker-sheet" onClose={() => { setModal(settingsRetained ? 'settings' : null); if (!settingsRetained) setSettingsAction(null) }} pinnedContent={<View style={styles.settingsMenu}><View style={styles.buttonRow}><SheetTextButton label={transferBusy ? 'Loading…' : 'Import from clipboard'} disabled={transferBusy} onPress={() => void openExternalImport('clipboard')} /><SheetTextButton label="Import file" disabled={transferBusy} onPress={() => void openExternalImport('file')} /><SheetTextButton label={own(state.drafts, UNNAMED_DRAFT_KEY) ? 'Return to unsaved timer' : 'New unsaved timer'} onPress={() => switchTo(null)} /></View><SheetTextButton testID="unified-config-save-copy" label="Save as…" onPress={() => { setSaveAsForSwitch(false); setSaveAsReturnToPicker(true); setSaveAsName(draft.name); setModal('save-as') }} /></View>}>
        {state.legacyRecoveries.length ? <View style={[styles.notice, { borderColor: tokens.warm }]}><Text style={[styles.rowTitle, { color: tokens.text }]}>Recovered legacy timers</Text><Text style={[styles.helperText, { color: tokens.textMuted }]}>Both original working copies are preserved here. Add either as a saved configuration.</Text>{state.legacyRecoveries.map(recovery => <SheetTextButton key={recovery.id} label={`Add recovered ${recovery.sourceMode === 'pattern' ? 'Cycle' : 'Sequence'}`} onPress={() => { const config: UnifiedTimerConfig = { id: createProgramId(), name: recovery.draft.name, createdAt: Date.now(), updatedAt: Date.now(), program: recovery.draft.program, settings: recovery.draft.settings, showInRunningSelector: true, editorOptions: recovery.draft.editorOptions }; void performCommand({ type: 'importConfig', config, select: false }) }} />)}</View> : null}
        {state.configs.map(config => <ConfigCard key={config.id} config={config} draft={own(state.drafts, config.id) ? state.drafts[config.id] : undefined} renameValue={own(renameValues, config.id) ? renameValues[config.id]! : config.name} onRenameChange={value => setRenameValues(current => ({ ...current, [config.id]: value }))} onRename={async () => { if (await performCommand({ type: 'rename', id: config.id, name: own(renameValues, config.id) ? renameValues[config.id]! : config.name })) setRenameValues(current => { const next = { ...current }; delete next[config.id]; return next }) }} onSelect={() => switchTo(config.id)} onDuplicate={() => { void performCommand({ type: 'duplicate', id: config.id, newId: createProgramId() }) }} onDelete={async () => {
        if (own(state.drafts, config.id) && state.drafts[config.id]!.dirty) { onFeedback({ title: 'Unsaved draft kept', message: 'Save, switch, or discard this configuration’s draft before deleting it.', tone: 'attention' }); return }
        if (await confirm({ title: `Delete ${config.name}?`, message: 'This removes the saved configuration and its clean draft.', confirmLabel: 'Delete', cancelLabel: 'Keep', destructive: true })) await performCommand({ type: 'delete', id: config.id })
      }} onVisibility={showInRunningSelector => { void performCommand({ type: 'setVisibility', id: config.id, showInRunningSelector }) }} onExport={() => void exportConfig(config)} transferBusy={transferBusy} />)}
    </DraggableSheet>

    <DraggableSheet visible={modal === 'switch'} title="Unsaved changes" testID="unified-config-switch-sheet" onClose={() => respondToSwitch('cancel')}>
      <Text style={[styles.copyText, { color: tokens.textMuted }]}>Choose what to do with this draft before switching configurations.</Text>
      <SheetTextButton testID="unified-config-switch-save" label="Save & switch" onPress={() => respondToSwitch('save')} />
      <SheetTextButton testID="unified-config-switch-keep" label="Keep draft & switch" onPress={() => respondToSwitch('keep')} />
      <SheetTextButton testID="unified-config-switch-discard" label="Discard & switch" onPress={() => respondToSwitch('discard')} tone="danger" />
      <SheetTextButton testID="unified-config-switch-cancel" label="Cancel" onPress={() => respondToSwitch('cancel')} tone="muted" />
    </DraggableSheet>

    <DraggableSheet visible={modal === 'save-as'} title={saveAsForSwitch ? 'Save draft & switch' : 'Save as'} testID="unified-config-save-as-sheet" onClose={() => { setModal(saveAsForSwitch ? 'switch' : saveAsReturnToPicker ? 'picker' : null); setSaveAsReturnToPicker(false) }} footer={<SheetTextButton disabled={!saveAsName.trim() || commandPending} label={commandPending ? 'Saving…' : saveAsForSwitch ? 'Save & switch' : 'Create configuration'} onPress={() => {
      if (saveAsForSwitch) void saveAsAndSwitch()
      else void performCommand({ type: 'saveAs', name: saveAsName.trim(), id: createProgramId() }).then(accepted => { if (accepted) { setModal(null); setSaveAsReturnToPicker(false) } })
    }} />}>
      <Text style={[styles.copyText, { color: tokens.textMuted }]}>This creates a saved snapshot and keeps your existing draft available.</Text>
      <TextInput testID="unified-config-save-as-name" value={saveAsName} onChangeText={value => setSaveAsName([...value].slice(0, 80).join(''))} placeholder="Configuration name" placeholderTextColor={tokens.textMuted} returnKeyType="done" style={[styles.input, { borderColor: tokens.border, color: tokens.text, backgroundColor: tokens.surface }]} accessibilityLabel="Save as configuration name" />
    </DraggableSheet>

    {soundPickerCue && cueTarget ? <SoundPickerSheet visible title={cueTarget.kind === 'alarm' ? 'Alarm sound' : cueTarget.kind === 'completion' ? 'Completion cue' : cueTarget.kind === 'track' ? 'Sub-bell sound' : cueTarget.kind === 'sound-library' ? 'Sound library' : 'Step ending cue'} cue={soundPickerCue} soundLibrary={state.soundLibrary} masterVolume={draft.settings.masterVolume} advanced={cueTarget.kind !== 'sound-library'} volumeLabel={cueTarget.kind === 'sound-library' ? 'Preview volume' : undefined} onChange={patchCue} onClose={() => setCueTarget(null)} onFeedback={onFeedback} /> : null}
  </KeyboardAvoidingView>
}

function asPatternTracks(tracks: UnifiedSubBellTrack[]) {
  return tracks.map(track => ({ ...track, cadenceMinutes: Math.max(1, Math.ceil(track.cadenceSeconds / 60)), selectedOffsetsMinutes: track.selectedOffsetsSeconds.map(offset => Math.ceil(offset / 60)) }))
}

function makeNewTrack(index: number, durationSeconds: number): UnifiedSubBellTrack {
  return { id: createProgramId(), label: `Sub-bell ${index + 1}`, enabled: true, color: normalizeSubBellColor(undefined, index), showOnWatchFace: true, cadenceSeconds: 300, repeatEnabled: true, selectedOffsetsSeconds: unifiedCadenceOffsets(durationSeconds, 300), sound: { kind: 'builtin', id: 'clear-bell' }, volume: 0.55 }
}

function cloneTrackWithNewId(track: UnifiedSubBellTrack): UnifiedSubBellTrack {
  return { ...track, id: createProgramId(), label: copyLabel(track.label), sound: { ...track.sound }, ...(track.sounds ? { sounds: track.sounds.map(sound => ({ ...sound })) } : {}), ...(track.hapticOverride && track.hapticOverride !== 'off' ? { hapticOverride: { ...track.hapticOverride } } : {}), ...(track.randomRepeat ? { randomRepeat: { ...track.randomRepeat } } : {}), selectedOffsetsSeconds: [...track.selectedOffsetsSeconds] }
}

function SoundSummary({ cue }: { cue: CueSettings }) {
  return <SoundName cue={cue} />
}

function trackTimingSummary(track: UnifiedSubBellTrack): string {
  const modes = [track.repeatEnabled ? `Repeat ${formatCompactDurationSeconds(track.cadenceSeconds)}` : 'One time', track.randomRepeat ? 'Random' : '', track.afterStartSeconds !== undefined ? `After ${formatCompactDurationSeconds(track.afterStartSeconds)}` : '', track.beforeEndSeconds !== undefined ? `Before ${formatCompactDurationSeconds(track.beforeEndSeconds)}` : ''].filter(Boolean)
  return modes.join(' · ')
}

function SettingsSection({ action, draft, program, cycleDurationSeconds, focusState, androidAccess, floatingOverlay, floatingAvailable, theme, tokens, onBack, onSettings, onProgram, onCue, onFocusAutomationChange, onOpenFocusSettings, onOpenFocusRuleSettings, onOpenExactAlarmSettings, onOpenFullScreenIntentSettings, onRequestCallMuteAccess, onRequestNotificationAccess, onFloatingChange, onFeedback, accentColor, setAccentColor, themeLongPressed, setThemeLongPressed, toggleTheme, useEinkTheme }: {
  action: ExtraAction; draft: UnifiedTimerDraft; program: UnifiedTimerProgram; cycleDurationSeconds: number; focusState: NativeFocusState;
  androidAccess: UnifiedTimerConfigScreenProps['androidAccess']; floatingOverlay: ReturnType<typeof ChandasTimerService.getFloatingOverlayState>; floatingAvailable: boolean;
  theme: string; tokens: ReturnType<typeof useTheme>['tokens']; onBack: () => void; onSettings: (changes: Partial<AppTimerSettings>) => void; onProgram: (changes: Partial<UnifiedTimerProgram>) => void; onCue: (kind: 'alarm' | 'completion') => void;
  onFocusAutomationChange: (enabled: boolean) => void; onOpenFocusSettings: () => void; onOpenFocusRuleSettings: () => void; onOpenExactAlarmSettings: () => void; onOpenFullScreenIntentSettings: () => void;
  onRequestCallMuteAccess: () => void; onRequestNotificationAccess: () => void; onFloatingChange: (value: ReturnType<typeof ChandasTimerService.getFloatingOverlayState>) => void; onFeedback: UnifiedTimerConfigScreenProps['onFeedback'];
  accentColor: SubBellColorId; setAccentColor: (value: SubBellColorId) => void; themeLongPressed: boolean; setThemeLongPressed: (value: boolean) => void; toggleTheme: () => void; useEinkTheme: () => void
}) {
  const { tokens: currentTokens } = useTheme()
  const setting = (key: ExtraAction) => {
    switch (key) {
      case 'alignment': return <Panel title="Align to clock" tokens={tokens}><View style={styles.row}><View style={styles.flex}><Text style={[styles.rowTitle, { color: tokens.text }]}>Align timer rounds to local clock</Text><Text style={[styles.helperText, { color: tokens.textMuted }]}>Keeps round boundaries aligned as the timer repeats.</Text></View><Toggle value={program.alignment.kind === 'local-clock'} onChange={enabled => onProgram({ alignment: enabled ? { kind: 'local-clock', offsetMinutes: 0 } : { kind: 'elapsed' } })} accessibilityLabel="Align timer to local clock" /></View>{program.alignment.kind === 'local-clock' ? <ClockSnapSelector cycleDurationSeconds={cycleDurationSeconds} value={program.alignment.offsetMinutes} onChange={offsetMinutes => onProgram({ alignment: { kind: 'local-clock', offsetMinutes } })} /> : null}</Panel>
      case 'run-length': return <Panel title="Run length" tokens={tokens}><RunLengthConfig mode={program.steps.length === 1 ? 'pattern' : 'sequence'} rounds value={program.runPolicy} cycleDurationSeconds={cycleDurationSeconds} secondPrecision={draft.settings.secondPrecisionEnabled} onChange={runPolicy => onProgram({ runPolicy })} /></Panel>
      case 'schedule': return <Panel title="Schedule" tokens={tokens}><View style={styles.row}><View style={styles.flex}><Text style={[styles.rowTitle, { color: tokens.text }]}>Use schedule</Text><Text style={[styles.helperText, { color: tokens.textMuted }]}>Limit when this timer can run.</Text></View><Toggle value={draft.settings.availability.enabled} onChange={enabled => onSettings({ availability: { ...draft.settings.availability, enabled } })} accessibilityLabel="Use timer schedule" /></View><ScheduleConfig showHeading={false} showEnabledControl={false} value={draft.settings.availability} onChange={availability => onSettings({ availability })} />{draft.settings.availability.enabled ? <ScheduleTimelinePreview value={draft.settings.availability} onPress={() => {}} /> : null}</Panel>
      case 'haptics': return <HapticsPanel value={draft.settings.haptics} onChange={haptics => { setAppHapticsEnabled(haptics.enabled); onSettings({ haptics }) }} />
      case 'alarm': return <Panel title="Alarm" tokens={tokens}><Pressable onPress={() => onCue('alarm')} style={[styles.soundSummary, { borderColor: tokens.border }]}><View style={styles.flex}><Text style={[styles.rowTitle, { color: tokens.text }]}>Alarm sound</Text><SoundName cue={{ sound: draft.settings.alarmSound, volume: draft.settings.alarmVolume }} style={styles.helperText} /></View><Text style={{ color: tokens.accent }}>›</Text></Pressable><LabelledSlider label="Alarm volume" value={draft.settings.alarmVolume} onChange={alarmVolume => onSettings({ alarmVolume })} /><DurationSelector label="Alarm duration" value={Math.ceil(draft.settings.alarmDurationSeconds / 60)} valueSeconds={draft.settings.alarmDurationSeconds} secondPrecision={draft.settings.secondPrecisionEnabled || draft.settings.alarmDurationSeconds % 60 !== 0} presets={[1, 2, 5, 10, 15, 30, 60]} minSeconds={5} maxSeconds={3_600} onChange={minutes => onSettings({ alarmDurationSeconds: Math.min(3_600, Math.max(5, minutes * 60)) })} onChangeSeconds={alarmDurationSeconds => onSettings({ alarmDurationSeconds })} /><View style={styles.row}><View style={styles.flex}><Text style={[styles.rowTitle, { color: tokens.text }]}>Completion cue</Text><Text style={[styles.helperText, { color: tokens.textMuted }]}>{program.completionCue ? soundTitle(program.completionCue.sound) : 'Off'}</Text></View>{program.completionCue ? <><SheetTextButton label="Edit" onPress={() => onCue('completion')} /><SheetTextButton label="Off" tone="muted" onPress={() => onProgram({ completionCue: null })} /></> : <SheetTextButton label="Add" onPress={() => onProgram({ completionCue: { sound: { kind: 'builtin', id: 'temple-gong' }, volume: 1 } })} />}</View></Panel>
      case 'focus': return <Panel title="Focus" tokens={tokens}><View style={styles.row}><View style={styles.flex}><Text style={[styles.rowTitle, { color: tokens.text }]}>Focus while timer runs</Text><Text style={[styles.helperText, { color: tokens.textMuted }]}>{focusState.reason === 'paused-by-android' ? 'Paused by Android' : focusState.reason === 'rule-disabled' ? 'Focus rule is disabled' : 'Manage Do Not Disturb while this timer runs.'}</Text></View><Toggle value={draft.settings.focusAutomationEnabled} onChange={enabled => { onSettings({ focusAutomationEnabled: enabled }); onFocusAutomationChange(enabled) }} accessibilityLabel="Chandas Focus" /></View><View style={styles.buttonRow}><SheetTextButton label="Focus settings" onPress={onOpenFocusSettings} /><SheetTextButton label="Focus rule" onPress={onOpenFocusRuleSettings} /></View></Panel>
      case 'notifications': return <Panel title="Notifications" tokens={tokens}><View style={styles.row}><View style={styles.flex}><Text style={[styles.rowTitle, { color: tokens.text }]}>Timer notifications</Text><Text style={[styles.helperText, { color: tokens.textMuted }]}>{androidAccess.notifications ? 'Available' : 'Access may be needed.'}</Text></View><Toggle value={draft.settings.notificationsEnabled} onChange={enabled => { onSettings({ notificationsEnabled: enabled }); if (enabled && Platform.OS === 'android' && !androidAccess.notifications) onRequestNotificationAccess() }} accessibilityLabel="Timer notifications" /></View><View style={styles.row}><View style={styles.flex}><Text style={[styles.rowTitle, { color: tokens.text }]}>Upcoming cue countdown</Text><Text style={[styles.helperText, { color: tokens.textMuted }]}>Show the next cue in the running notification.</Text></View><Toggle value={draft.settings.liveCountdownEnabled} onChange={enabled => { onSettings({ liveCountdownEnabled: enabled, ...(enabled ? { notificationsEnabled: true } : {}) }); if (enabled && Platform.OS === 'android' && !androidAccess.notifications) onRequestNotificationAccess() }} accessibilityLabel="Upcoming cue countdown" /></View></Panel>
      case 'calls': return <Panel title="During calls" tokens={tokens}><View style={styles.row}><View style={styles.flex}><Text style={[styles.rowTitle, { color: tokens.text }]}>Mute timer cues during calls</Text><Text style={[styles.helperText, { color: tokens.textMuted }]}>{androidAccess.callMute ? 'Available' : 'Phone access may be needed.'}</Text></View><Toggle value={draft.settings.muteDuringCallsEnabled} onChange={enabled => { onSettings({ muteDuringCallsEnabled: enabled }); if (enabled && Platform.OS === 'android' && !androidAccess.callMute) onRequestCallMuteAccess() }} accessibilityLabel="Mute timer during calls" /></View></Panel>
      case 'precision': return <Panel title="Precision" tokens={tokens}><View style={styles.row}><View style={styles.flex}><Text style={[styles.rowTitle, { color: tokens.text }]}>Edit in seconds</Text><Text style={[styles.helperText, { color: tokens.textMuted }]}>Keep exact seconds visible in duration controls.</Text></View><Toggle value={draft.settings.secondPrecisionEnabled} onChange={secondPrecisionEnabled => onSettings({ secondPrecisionEnabled })} accessibilityLabel="Use exact seconds" /></View></Panel>
      case 'running-controls': return <Panel title="Running controls" tokens={tokens}><View style={styles.row}><View style={styles.flex}><Text style={[styles.rowTitle, { color: tokens.text }]}>Show all timer controls</Text><Text style={[styles.helperText, { color: tokens.textMuted }]}>Keep alarm, mute and sound controls available.</Text></View><Toggle value={draft.settings.advancedModeEnabled} onChange={advancedModeEnabled => onSettings({ advancedModeEnabled })} accessibilityLabel="Show all running controls" /></View></Panel>
      case 'system': return <Panel title="Device access" tokens={tokens}>{!androidAccess.exactAlarms ? <View style={styles.row}><Text style={[styles.rowTitle, styles.flex, { color: tokens.text }]}>Exact timing</Text><SheetTextButton label="Set up" tone="danger" onPress={onOpenExactAlarmSettings} /></View> : null}{!androidAccess.fullScreenAlarms ? <View style={styles.row}><Text style={[styles.rowTitle, styles.flex, { color: tokens.text }]}>Full-screen alarms</Text><SheetTextButton label="Set up" tone="danger" onPress={onOpenFullScreenIntentSettings} /></View> : null}<Text style={[styles.helperText, { color: tokens.textMuted }]}>{androidAccess.checking ? 'Checking access…' : androidAccess.pending ? 'Waiting for Android…' : `Notifications ${androidAccess.notifications ? 'available' : 'not granted'} · calls ${androidAccess.callMute ? 'available' : 'not granted'}`}</Text></Panel>
      case 'device': return <Panel title="Appearance and overlay" tokens={tokens}><ColorSelector label="Accent color" detail="Applies across the app." value={accentColor} onChange={setAccentColor} accessibilityLabel="Accent color" trailing={<Pressable onPress={() => { if (themeLongPressed) return; toggleTheme() }} onLongPress={() => { setThemeLongPressed(true); useEinkTheme() }} onPressOut={() => setTimeout(() => setThemeLongPressed(false), 0)} delayLongPress={550} accessibilityRole="button" accessibilityLabel={`Change appearance from ${theme}`} style={[styles.themeButton, { borderColor: tokens.border }]}><Text style={{ color: tokens.accent }}>{theme === 'dark' ? 'Light' : theme === 'light' ? 'Dark' : 'E-ink'}</Text></Pressable>} />{floatingAvailable ? <FloatingOverlaySettings state={floatingOverlay} onChange={onFloatingChange} onFeedback={onFeedback} /> : null}</Panel>
      default: return null
    }
  }
  return <View style={styles.section}><View style={styles.sectionHeading}><Pressable accessibilityRole="button" accessibilityLabel="Back to settings" onPress={onBack} style={[styles.backButton, { borderColor: currentTokens.border }]}><Text style={{ color: currentTokens.accent }}>‹</Text></Pressable><Text style={[styles.sectionTitle, { color: currentTokens.text }]}>{ACTIONS.find(item => item.id === action)?.label ?? 'Settings'}</Text></View>{setting(action)}</View>
}

function TrackDetail({ track, durationSeconds, secondPrecision, settings, onPatch, onOpenSound, onDuplicate, onDelete }: {
  track: UnifiedSubBellTrack; durationSeconds: number; secondPrecision: boolean; settings: AppTimerSettings; onPatch: (changes: Partial<UnifiedSubBellTrack>) => void; onOpenSound: () => void; onDuplicate: () => void; onDelete: () => void
}) {
  const { tokens } = useTheme()
  const [section, setSection] = useState<'color' | 'volume' | 'offsets' | 'random' | 'after' | 'before' | 'haptics' | 'visibility' | null>(null)
  const [labelDraft, setLabelDraft] = useState(track.label)
  useEffect(() => { setLabelDraft(track.label) }, [track.id, track.label])
  const modes = [
    { id: 'repeat', label: 'Repeat', active: track.repeatEnabled, press: () => onPatch({ repeatEnabled: !track.repeatEnabled }) },
    { id: 'random', label: 'Random', active: !!track.randomRepeat, press: () => { if (!track.randomRepeat) onPatch({ randomRepeat: { minSeconds: 30, maxSeconds: 60 } }); setSection('random') } },
    { id: 'after', label: 'After', active: track.afterStartSeconds !== undefined, press: () => { if (track.afterStartSeconds === undefined) onPatch({ afterStartSeconds: Math.max(1, Math.min(30, durationSeconds - 1)) }); setSection('after') } },
    { id: 'before', label: 'Before', active: track.beforeEndSeconds !== undefined, press: () => { if (track.beforeEndSeconds === undefined) onPatch({ beforeEndSeconds: Math.max(1, Math.min(30, durationSeconds - 1)) }); setSection('before') } },
  ]
  const chooseSection = (value: typeof section) => setSection(section === value ? null : value)
  const inactiveOffsets = track.selectedOffsetsSeconds.filter(offset => offset >= durationSeconds)
  return <View style={styles.trackDetail}>
    <TextInput accessibilityLabel="Sub-bell name" value={labelDraft} onChangeText={value => { const label = [...value].slice(0, 60).join(''); setLabelDraft(label); if (label.trim()) onPatch({ label }) }} onBlur={() => { const label = labelDraft.trim() || track.label; setLabelDraft(label); if (label !== track.label) onPatch({ label }) }} style={[styles.trackNameInput, { color: tokens.text, borderBottomColor: tokens.accent }]} />
    <Pressable accessibilityRole="button" onPress={onOpenSound} style={[styles.soundSummary, { borderColor: tokens.border }]}><View style={styles.flex}><Text style={[styles.rowTitle, { color: tokens.text }]}>Sound</Text><SoundName cue={track} style={styles.soundName} /></View><Text style={{ color: tokens.accent }}>›</Text></Pressable>
    <Text style={[styles.eyebrow, { color: tokens.textMuted }]}>TIMING</Text>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.trackModes}>{modes.map(mode => <ActionChip key={mode.id} label={mode.label} active={mode.active} tokens={tokens} onPress={mode.press} />)}</ScrollView>
    {track.repeatEnabled ? <DurationSelector label="Repeat every" value={Math.ceil(track.cadenceSeconds / 60)} valueSeconds={track.cadenceSeconds} secondPrecision={secondPrecision || track.cadenceSeconds % 60 !== 0} presets={[1, 2, 3, 5, 10, 15, 20, 30, 60]} minSeconds={1} maxSeconds={MAX_CUE_DURATION_SECONDS} onChange={minutes => onPatch(unifiedTrackCadencePatch(track, durationSeconds, minutes * 60))} onChangeSeconds={cadenceSeconds => onPatch(unifiedTrackCadencePatch(track, durationSeconds, cadenceSeconds))} /> : <Text style={[styles.helperText, { color: tokens.textMuted }]}>One time · repeat interval and selected offsets are retained.</Text>}
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.trackOptions}>{([{ id: 'color', label: 'Color' }, { id: 'volume', label: 'Volume' }, { id: 'offsets', label: 'Offsets' }, { id: 'haptics', label: 'Haptics' }, { id: 'visibility', label: 'Watch face' }] as const).map(option => <ActionChip key={option.id} label={option.label} active={section === option.id || (option.id === 'offsets' && track.selectedOffsetsSeconds.length > 0)} tokens={tokens} onPress={() => chooseSection(option.id)} />)}</ScrollView>
    {section === 'color' ? <ColorSelector label="Sub-bell color" detail="Timeline and watch-face ring" value={normalizeSubBellColor(track.color, 0)} onChange={color => onPatch({ color })} accessibilityLabel={`${track.label} color`} /> : null}
    {section === 'volume' ? <LabelledSlider label="Sub-bell volume" value={track.volume} onChange={volume => onPatch({ volume })} /> : null}
    {section === 'offsets' ? <><Text style={[styles.helperText, { color: tokens.textMuted }]}>{inactiveOffsets.length ? `${inactiveOffsets.length} selected point${inactiveOffsets.length === 1 ? '' : 's'} beyond this interval stay saved and reactivate if lengthened.` : 'Choose repeat positions. Points beyond a shortened interval stay saved and reactivate if lengthened.'}</Text><OffsetGrid offsets={[...new Set([...unifiedCadenceOffsets(durationSeconds, track.cadenceSeconds).slice(0, MAX_VISIBLE_PATTERN_OFFSETS), ...inactiveOffsets])].sort((a, b) => a - b)} selected={track.selectedOffsetsSeconds} unit="seconds" onChange={selectedOffsetsSeconds => onPatch({ selectedOffsetsSeconds })} /></> : null}
    {section === 'random' ? <View style={styles.randomBox}><Text style={[styles.rowTitle, { color: tokens.text }]}>Random gap range</Text>{track.randomRepeat && track.randomRepeat.minSeconds >= durationSeconds ? <Text style={[styles.helperText, { color: tokens.warm }]}>No random bell fits until this interval is lengthened.</Text> : null}<Text style={[styles.helperText, { color: tokens.textMuted }]}>From {formatCompactDurationSeconds(track.randomRepeat?.minSeconds ?? 30)} to {formatCompactDurationSeconds(track.randomRepeat?.maxSeconds ?? 60)}</Text><DurationSelector compact value={Math.ceil((track.randomRepeat?.minSeconds ?? 30) / 60)} valueSeconds={track.randomRepeat?.minSeconds ?? 30} secondPrecision minSeconds={5} maxSeconds={MAX_CUE_DURATION_SECONDS} presets={[1, 2, 3, 5, 10]} onChange={minutes => onPatch({ randomRepeat: { minSeconds: Math.max(5, minutes * 60), maxSeconds: Math.max(minutes * 60, track.randomRepeat?.maxSeconds ?? 60) } })} onChangeSeconds={minSeconds => onPatch({ randomRepeat: { minSeconds: Math.max(5, minSeconds), maxSeconds: Math.max(minSeconds, track.randomRepeat?.maxSeconds ?? 60) } })} /><DurationSelector compact value={Math.ceil((track.randomRepeat?.maxSeconds ?? 60) / 60)} valueSeconds={track.randomRepeat?.maxSeconds ?? 60} secondPrecision minSeconds={5} maxSeconds={MAX_CUE_DURATION_SECONDS} presets={[1, 2, 3, 5, 10]} onChange={minutes => onPatch({ randomRepeat: { minSeconds: Math.min(track.randomRepeat?.minSeconds ?? 30, minutes * 60), maxSeconds: Math.max(5, minutes * 60) } })} onChangeSeconds={maxSeconds => onPatch({ randomRepeat: { minSeconds: Math.min(track.randomRepeat?.minSeconds ?? 30, maxSeconds), maxSeconds: Math.max(5, maxSeconds) } })} /><SheetTextButton label="Turn off random gaps" tone="muted" onPress={() => { onPatch({ randomRepeat: undefined }); setSection(null) }} /></View> : null}
    {section === 'after' ? <MarkerControl label="After start" value={track.afterStartSeconds} durationSeconds={durationSeconds} secondPrecision={secondPrecision} onChange={afterStartSeconds => onPatch({ afterStartSeconds })} /> : null}
    {section === 'before' ? <MarkerControl label="Before end" value={track.beforeEndSeconds} durationSeconds={durationSeconds} secondPrecision={secondPrecision} onChange={beforeEndSeconds => onPatch({ beforeEndSeconds })} /> : null}
    {section === 'haptics' ? <CueHapticsEditor cue={track} inherited={settings.haptics.subBell} onChange={hapticOverride => onPatch({ hapticOverride })} /> : null}
    {section === 'visibility' ? <View style={styles.row}><View style={styles.flex}><Text style={[styles.rowTitle, { color: tokens.text }]}>Show on watch face</Text><Text style={[styles.helperText, { color: tokens.textMuted }]}>Hidden bells still play and remain in the timeline.</Text></View><Toggle value={track.showOnWatchFace} onChange={showOnWatchFace => onPatch({ showOnWatchFace })} accessibilityLabel="Show sub-bell on watch face" /></View> : null}
    <View style={styles.buttonRow}><SheetTextButton label="Duplicate sub-bell" onPress={onDuplicate} /><SheetTextButton label="Delete sub-bell" tone="danger" onPress={onDelete} /></View>
  </View>
}

function ActionChip({ label, summary, active, tokens, onPress }: { label: string; summary?: string; active: boolean; tokens: ReturnType<typeof useTheme>['tokens']; onPress: () => void }) {
  return <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: active }} style={[styles.actionChip, { borderColor: active ? tokens.accent : tokens.border, backgroundColor: active ? tokens.accentGlow : tokens.surface }]}><Text style={[styles.actionLabel, { color: active ? tokens.text : tokens.textMuted }]}>{label}{summary ? ` · ${summary}` : ''}</Text></Pressable>
}

function TimerControlRail({ singleStep, program, settings, step, cycleDurationSeconds, onProgram, onSettings, onCueVolume, onCueHaptics, onAlarm, onOpenAlarmSettings }: {
  singleStep: boolean; program: UnifiedTimerProgram; settings: AppTimerSettings; step: UnifiedTimerStep; cycleDurationSeconds: number;
  onProgram: (changes: Partial<UnifiedTimerProgram>) => void; onSettings: (changes: Partial<AppTimerSettings>) => void; onCueVolume: (volume: number) => void; onCueHaptics: (value: CueSettings['hapticOverride']) => void; onAlarm: (enabled: boolean) => void; onOpenAlarmSettings: () => void
}) {
  const { tokens } = useTheme()
  const [active, setActive] = useState<ExtraAction | 'volume' | null>(null)
  useEffect(() => {
    if (!singleStep && (active === 'haptics' || active === 'alarm')) setActive(null)
  }, [singleStep, active])
  const actions: Array<ExtraAction | 'volume'> = singleStep ? ['run-length', 'alignment', 'volume', 'haptics', 'alarm'] : ['run-length', 'alignment', 'volume']
  return <View style={styles.section}>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.actionRail} accessibilityLabel="Timer controls">
      {actions.map(action => <ActionChip key={action} label={action === 'run-length' ? 'Run length' : action === 'alignment' ? 'Align to clock' : action === 'volume' ? 'Volume' : action === 'haptics' ? 'Haptics' : 'Alarm'} summary={mainActionSummary(action, program, settings, step.endAlarmEnabled, step.endCue.hapticOverride)} active={active === action} tokens={tokens} onPress={() => setActive(active === action ? null : action)} />)}
    </ScrollView>
    {active ? <View style={[styles.controlPanel, { borderColor: tokens.border, backgroundColor: tokens.surface }]}>
      {active === 'run-length' ? <RunLengthConfig mode={singleStep ? 'pattern' : 'sequence'} rounds value={program.runPolicy} cycleDurationSeconds={cycleDurationSeconds} secondPrecision={settings.secondPrecisionEnabled} onChange={runPolicy => onProgram({ runPolicy })} /> : null}
      {active === 'alignment' ? <><View style={styles.row}><View style={styles.flex}><Text style={[styles.rowTitle, { color: tokens.text }]}>Align to local clock</Text><Text style={[styles.helperText, { color: tokens.textMuted }]}>{program.alignment.kind === 'local-clock' ? `Offset ${program.alignment.offsetMinutes} min` : 'Start from elapsed time'}</Text></View><Toggle value={program.alignment.kind === 'local-clock'} onChange={enabled => onProgram({ alignment: enabled ? { kind: 'local-clock', offsetMinutes: 0 } : { kind: 'elapsed' } })} accessibilityLabel="Align timer rounds to clock" /></View>{program.alignment.kind === 'local-clock' ? <ClockSnapSelector cycleDurationSeconds={cycleDurationSeconds} value={program.alignment.offsetMinutes} onChange={offsetMinutes => onProgram({ alignment: { kind: 'local-clock', offsetMinutes } })} /> : null}</> : null}
      {active === 'volume' ? <>{singleStep ? <LabelledSlider label="Main sound" value={step.endCue.volume} onChange={onCueVolume} /> : null}<LabelledSlider label="Overall volume" value={settings.masterVolume} onChange={masterVolume => onSettings({ masterVolume })} /></> : null}
      {singleStep && active === 'haptics' ? <CueHapticsEditor cue={step.endCue} inherited={settings.haptics.main} onChange={onCueHaptics} /> : null}
      {singleStep && active === 'alarm' ? <><View style={styles.row}><View style={styles.flex}><Text style={[styles.rowTitle, { color: tokens.text }]}>Alarm after each interval</Text><Text style={[styles.helperText, { color: tokens.textMuted }]}>Keep ringing until dismissed</Text></View><Toggle value={step.endAlarmEnabled} onChange={onAlarm} accessibilityLabel="Alarm after this interval" /></View><Pressable accessibilityRole="button" onPress={onOpenAlarmSettings} style={styles.inlineLink}><Text style={[styles.helperText, { color: tokens.textMuted }]}>Sound and duration · {formatCompactDurationSeconds(settings.alarmDurationSeconds)}</Text><Text style={{ color: tokens.accent }}>Settings ›</Text></Pressable></> : null}
    </View> : null}
  </View>
}

function mainActionSummary(action: ExtraAction | 'volume', program: UnifiedTimerProgram, settings: AppTimerSettings, alarmEnabled: boolean, hapticOverride?: CueSettings['hapticOverride']): string {
  switch (action) {
    case 'run-length': return program.runPolicy.kind === 'continuous' ? 'Continuous' : program.runPolicy.kind === 'cycles' ? `${program.runPolicy.cycleCount} rounds` : formatCompactDurationSeconds(program.runPolicy.durationSeconds)
    case 'alignment': return program.alignment.kind === 'local-clock' ? `${program.alignment.offsetMinutes}m offset` : 'Off'
    case 'volume': return `${Math.round(settings.masterVolume * 100)}%`
    case 'haptics': return !settings.haptics.enabled || hapticOverride === 'off' ? 'Off' : hapticOverride ? hapticProfileSummary(hapticOverride) : 'Default'
    case 'alarm': return alarmEnabled ? 'On' : 'Off'
    default: return ''
  }
}

function UnifiedStepSortableCard({ item, index, id, positions, lowerBound, autoScrollDirection, itemsCount, itemHeight, gap, paddingHorizontal, isDynamicHeight, estimatedItemHeight, itemHeights, scheduleHeightUpdate, step, stepNumber, itemCount, onEdit, onMove, onDuplicate, onDelete, canDuplicate }: SortableRenderItemProps<{ id: string }> & {
  step: UnifiedTimerStep; stepNumber: number; itemCount: number; onEdit: () => void; onMove: (from: number, to: number) => void; onDuplicate: () => void; onDelete: () => void; canDuplicate: boolean
}) {
  const { tokens, theme } = useTheme()
  const adjust = (direction: 'increment' | 'decrement') => { const target = Math.max(0, Math.min(itemCount - 1, index + (direction === 'increment' ? 1 : -1))); if (target !== index) onMove(index, target) }
  const handleDrop = (_id: string, to: number) => onMove(index, to)
  return <SortableItem id={id} data={item} positions={positions} lowerBound={lowerBound} autoScrollDirection={autoScrollDirection} itemsCount={itemsCount} itemHeight={itemHeight ?? 142} gap={gap} paddingHorizontal={paddingHorizontal} containerHeight={itemCount * (itemHeight ?? 142)} isDynamicHeight={isDynamicHeight} estimatedItemHeight={estimatedItemHeight} itemHeights={itemHeights} scheduleHeightUpdate={scheduleHeightUpdate} onDrop={handleDrop} style={styles.sortableStepItem}>
    <View testID={`unified-config-step-row-${step.id}`} style={[styles.stepCard, { borderColor: tokens.border, backgroundColor: tokens.surface }]}>
      <SortableItem.Handle style={styles.stepHandle}><Pressable hitSlop={10} style={styles.stepHandlePressable} accessibilityRole="adjustable" accessibilityLabel={`Reorder ${step.label}`} accessibilityHint="Touch and hold to drag, or use accessibility actions to move it" accessibilityValue={{ text: `${stepNumber} of ${itemCount}` }} accessibilityActions={[{ name: 'increment', label: 'Move later' }, { name: 'decrement', label: 'Move earlier' }]} onAccessibilityAction={event => adjust(event.nativeEvent.actionName as 'increment' | 'decrement')}><Text style={[styles.stepHandleGlyph, { color: tokens.textMuted }]}>⠿</Text></Pressable></SortableItem.Handle>
      <Pressable testID={`unified-edit-step-${step.id}`} style={styles.stepCardMain} onPress={onEdit} accessibilityRole="button" accessibilityLabel={`Edit step ${stepNumber}, ${step.label}`}>
        <View style={styles.stepCardTop}><Text style={[styles.stepIndex, { color: tokens.accent }]}>{String(stepNumber).padStart(2, '0')}</Text><Text numberOfLines={1} style={[styles.stepCardTitle, { color: tokens.text }]}>{step.label}</Text><Text style={[styles.stepCardDuration, { color: tokens.text }]}>{formatCompactDurationSeconds(step.durationSeconds)}</Text></View>
        <View style={styles.stepSoundLine}><BellIcon on color={tokens.accent} /><SoundName cue={step.endCue} style={styles.helperText} /><Text style={[styles.helperText, { color: tokens.textMuted }]}>· {step.subBellTracks.length} {step.subBellTracks.length === 1 ? 'sub-bell' : 'sub-bells'}</Text></View>
            <PatternTimelinePreview tracks={asPatternTracks(step.subBellsEnabled ? step.subBellTracks : [])} mainDurationSeconds={step.durationSeconds} />
      </Pressable>
      <View style={styles.stepCardActions}><MiniButton label={`Duplicate ${step.label}`} glyph="＋" disabled={!canDuplicate} onPress={onDuplicate} /><MiniButton label={`Delete ${step.label}`} glyph="×" disabled={itemCount <= 1} onPress={onDelete} /></View>
    </View>
  </SortableItem>
}

function settingsDetail(action: ExtraAction, settings: AppTimerSettings, program: UnifiedTimerProgram): string {
  switch (action) {
    case 'alignment': return program.alignment.kind === 'local-clock' ? 'Aligned to local clock' : 'Elapsed from start'
    case 'run-length': return program.runPolicy.kind === 'continuous' ? 'Runs continuously' : program.runPolicy.kind === 'cycles' ? `${program.runPolicy.cycleCount} rounds` : 'Stops after a duration'
    case 'schedule': return settings.availability.enabled ? 'Schedule enabled' : 'No active schedule'
    case 'haptics': return settings.haptics.enabled ? 'Haptics enabled' : 'Haptics off'
    case 'alarm': return `${settings.alarmDurationSeconds}s alarm · ${soundTitle(settings.alarmSound)}`
    case 'focus': return settings.focusAutomationEnabled ? 'Enabled' : 'Off'
    case 'notifications': return settings.notificationsEnabled ? 'Enabled' : 'Off'
    case 'calls': return settings.muteDuringCallsEnabled ? 'Mute during calls' : 'Play during calls'
    case 'precision': return settings.secondPrecisionEnabled ? 'Exact seconds' : 'Minute controls'
    case 'running-controls': return settings.advancedModeEnabled ? 'All controls shown' : 'Compact controls'
    case 'system': return 'Permissions and device access'
    case 'device': return 'Theme and floating timer'
  }
}

function MarkerControl({ label, value, durationSeconds, secondPrecision, onChange }: { label: string; value?: number; durationSeconds: number; secondPrecision: boolean; onChange: (value: number | undefined) => void }) {
  const { tokens } = useTheme()
  const inactive = value !== undefined && value >= durationSeconds
  return <View style={styles.markerBox}>
    <View style={styles.row}><View style={styles.flex}><Text style={[styles.rowTitle, { color: tokens.text }]}>{label}</Text><Text style={[styles.helperText, { color: inactive ? tokens.warm : tokens.textMuted }]}>{value === undefined ? 'Off' : `${formatCompactDurationSeconds(value)}${inactive ? ' · inactive until step is lengthened' : ''}`}</Text></View><Toggle value={value !== undefined} onChange={enabled => onChange(enabled ? Math.min(60, Math.max(1, durationSeconds - 1)) : undefined)} accessibilityLabel={`${label} cue`} /></View>
    {value !== undefined ? <DurationSelector value={Math.ceil(value / 60)} valueSeconds={value} secondPrecision={secondPrecision || value % 60 !== 0} presets={[1, 2, 3, 5, 10]} minSeconds={1} maxSeconds={MAX_CUE_DURATION_SECONDS} onChange={minutes => onChange(minutes * 60)} onChangeSeconds={onChange} /> : null}
  </View>
}

function HapticsPanel({ value, onChange }: { value: AppTimerSettings['haptics']; onChange: (value: AppTimerSettings['haptics']) => void }) {
  const { tokens } = useTheme()
  const patch = (key: 'main' | 'subBell' | 'alarm', profile: HapticProfile) => onChange({ ...value, [key]: profile })
  return <Panel title="Vibration" tokens={tokens}>
    <View style={styles.row}><View style={styles.flex}><Text style={[styles.rowTitle, { color: tokens.text }]}>Use haptics</Text><Text style={[styles.helperText, { color: tokens.textMuted }]}>Cue, alarm and app feedback</Text></View><Toggle value={value.enabled} onChange={enabled => onChange({ ...value, enabled })} accessibilityLabel="Use haptics" /></View>
    {(['main', 'subBell', 'alarm'] as const).map(key => <View key={key} style={styles.profileBox}><Text style={[styles.rowTitle, { color: tokens.text }]}>{key === 'main' ? 'Main cues' : key === 'subBell' ? 'Sub-bells' : 'Alarms'}</Text><Text style={[styles.helperText, { color: tokens.textMuted }]}>{hapticProfileSummary(value[key])}</Text><SegmentedControl items={HAPTIC_PATTERNS} value={value[key].pattern} onChange={pattern => patch(key, { ...value[key], pattern })} accessibilityLabel={`${key} haptic pattern`} /><SegmentedControl items={HAPTIC_STRENGTHS} value={value[key].strength} onChange={strength => patch(key, { ...value[key], strength })} accessibilityLabel={`${key} haptic strength`} /><SheetTextButton feedback={false} label="Preview vibration" onPress={() => void previewHapticProfile(value[key])} accessibilityLabel={`Preview ${key} haptic profile`} /></View>)}
  </Panel>
}

function CueHapticsEditor({ cue, inherited, onChange }: { cue: CueSettings; inherited: HapticProfile; onChange: (value: CueSettings['hapticOverride']) => void }) {
  const { tokens } = useTheme()
  const current = cue.hapticOverride === undefined ? 'default' : cue.hapticOverride === 'off' ? 'off' : 'custom'
  const profile = cue.hapticOverride && cue.hapticOverride !== 'off' ? cue.hapticOverride : inherited
  return <View style={styles.markerBox}><Text style={[styles.rowTitle, { color: tokens.text }]}>Cue vibration</Text><SegmentedControl items={[{ value: 'default', label: 'Default' }, { value: 'custom', label: 'Custom' }, { value: 'off', label: 'Off' }]} value={current} onChange={mode => onChange(mode === 'default' ? undefined : mode === 'off' ? 'off' : profile)} accessibilityLabel="Cue vibration mode" />{current === 'custom' ? <><SegmentedControl items={HAPTIC_PATTERNS} value={profile.pattern} onChange={pattern => { const next = { ...profile, pattern }; onChange(next); void previewHapticProfile(next) }} accessibilityLabel="Cue haptic pattern" /><SegmentedControl items={HAPTIC_STRENGTHS} value={profile.strength} onChange={strength => { const next = { ...profile, strength }; onChange(next); void previewHapticProfile(next) }} accessibilityLabel="Cue haptic strength" /><SheetTextButton feedback={false} label="Preview vibration" onPress={() => void previewHapticProfile(profile)} accessibilityLabel="Preview cue vibration" /></> : null}</View>
}

function ConfigCard({ config, draft, renameValue, onRenameChange, onRename, onSelect, onDuplicate, onDelete, onVisibility, onExport, transferBusy }: {
  config: UnifiedTimerConfig; draft?: UnifiedTimerDraft; renameValue: string; onRenameChange: (value: string) => void; onRename: () => void; onSelect: () => void; onDuplicate: () => void;
  onDelete: () => void | Promise<void>; onVisibility: (value: boolean) => void; onExport: () => void; transferBusy: boolean
}) {
  const { tokens } = useTheme()
  return <View style={[styles.configCard, { borderColor: tokens.border, backgroundColor: tokens.surface }]}>
    <Pressable onPress={onSelect} accessibilityRole="button" accessibilityLabel={`Switch to ${config.name}`} style={styles.configTitle}><Text style={[styles.rowTitle, { color: tokens.text }]}>{config.name}</Text><Text style={[styles.helperText, { color: tokens.textMuted }]}>{config.program.steps.length} step{config.program.steps.length === 1 ? '' : 's'} · {draft?.dirty ? 'draft has edits' : 'saved'}</Text></Pressable>
    <View style={styles.row}><Text style={[styles.helperText, styles.flex, { color: tokens.textMuted }]}>Show in running selector</Text><Toggle value={config.showInRunningSelector} onChange={onVisibility} accessibilityLabel={`Show ${config.name} while running`} /></View>
    <TextInput value={renameValue} onChangeText={onRenameChange} placeholder="Rename configuration" placeholderTextColor={tokens.textMuted} style={[styles.input, { borderColor: tokens.border, color: tokens.text }]} accessibilityLabel={`Rename ${config.name}`} />
    <View style={styles.cardActions}><SheetTextButton label="Rename" onPress={onRename} /><SheetTextButton label="Duplicate" onPress={onDuplicate} /><SheetTextButton label={transferBusy ? 'Exporting…' : 'Export'} disabled={transferBusy} onPress={onExport} /><SheetTextButton label="Delete" tone="danger" onPress={() => void onDelete()} /></View>
  </View>
}

function FloatingOverlaySettings({ state, onChange, onFeedback }: { state: ReturnType<typeof ChandasTimerService.getFloatingOverlayState>; onChange: (value: ReturnType<typeof ChandasTimerService.getFloatingOverlayState>) => void; onFeedback: UnifiedTimerConfigScreenProps['onFeedback'] }) {
  const { tokens } = useTheme()
  return <View style={styles.profileBox}>
    <View style={styles.row}><View style={styles.flex}><Text style={[styles.rowTitle, { color: tokens.text }]}>Floating timer</Text><Text style={[styles.helperText, { color: tokens.textMuted }]}>{state.permissionGranted ? 'Permission available' : state.requested ? 'Display permission is needed' : 'Device preference'}</Text></View><Toggle value={state.requested} onChange={enabled => { ChandasTimerService.setFloatingOverlayRequested(enabled); const next = ChandasTimerService.getFloatingOverlayState(); onChange(next); if (enabled && !next.permissionGranted) ChandasTimerService.openFloatingOverlaySettings() }} accessibilityLabel="Floating timer" /></View>
    <View style={styles.row}><Text style={[styles.rowTitle, styles.flex, { color: tokens.text }]}>Widget appearance</Text><SheetTextButton label={state.appearance ?? 'System'} onPress={() => {
      const current = state.appearance ?? 'system'
      const appearance = current === 'system' ? 'dark' : current === 'dark' ? 'light' : 'system'
      ChandasTimerService.setFloatingOverlayAppearance(appearance)
      onChange({ ...state, appearance })
      onFeedback({ title: `Widget appearance: ${appearance}`, tone: 'success' })
    }} /></View>
    {state.requested && !state.permissionGranted ? <SheetTextButton label="Open display permission settings" tone="danger" onPress={ChandasTimerService.openFloatingOverlaySettings} /> : null}
    <SheetTextButton label={state.permissionGranted ? 'Preview floating timer' : 'Allow and preview'} onPress={() => state.permissionGranted ? ChandasTimerService.previewFloatingOverlay() : ChandasTimerService.openFloatingOverlaySettings()} />
  </View>
}

function Panel({ title, tokens, children }: { title: string; tokens: ReturnType<typeof useTheme>['tokens']; children: React.ReactNode }) {
  return <View style={[styles.panel, { borderColor: tokens.border, backgroundColor: tokens.surface }]}><Text style={[styles.sectionTitle, { color: tokens.text }]}>{title}</Text>{children}</View>
}

function LabelledSlider({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  const { tokens } = useTheme()
  return <View style={styles.sliderRow}><Text style={[styles.rowTitle, { color: tokens.text }]}>{label} · {Math.round(value * 100)}%</Text><Slider style={styles.slider} minimumValue={0} maximumValue={1} step={0.05} value={value} onValueChange={onChange} minimumTrackTintColor={tokens.accent} maximumTrackTintColor={tokens.surfaceHi} thumbTintColor={tokens.accent} accessibilityLabel={label} /></View>
}

function MiniButton({ glyph, label, disabled, onPress }: { glyph: string; label: string; disabled?: boolean; onPress: () => void }) {
  const { tokens } = useTheme()
  return <Pressable disabled={disabled} onPress={onPress} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} style={[styles.miniButton, { borderColor: tokens.border, opacity: disabled ? 0.35 : 1 }]}><Text style={{ color: tokens.accent }}>{glyph}</Text></Pressable>
}

function getCue(draft: UnifiedTimerDraft | undefined, target: CueTarget): CueSettings | null {
  if (!draft) return null
  if (target.kind === 'sound-library') return { sound: { kind: 'builtin', id: 'clear-bell' }, volume: 1 }
  if (target.kind === 'alarm') return { sound: draft.settings.alarmSound, volume: draft.settings.alarmVolume }
  if (target.kind === 'completion') return draft.program.completionCue
  const step = draft.program.steps.find(value => value.id === target.stepId)
  if (!step) return null
  return target.kind === 'step-end' ? step.endCue : step.subBellTracks.find(track => track.id === target.trackId) ?? null
}

function cloneCue(cue: CueSettings): CueSettings {
  return { sound: { ...cue.sound }, volume: cue.volume, ...(cue.sounds ? { sounds: cue.sounds.map(sound => ({ ...sound })) } : {}), ...(cue.soundMode ? { soundMode: cue.soundMode } : {}), ...(cue.hapticOverride !== undefined ? { hapticOverride: cue.hapticOverride === 'off' ? 'off' : { ...cue.hapticOverride } } : {}) }
}

function copyLabel(label: string): string {
  const suffix = ' copy'
  return `${[...label].slice(0, 60 - [...suffix].length).join('')}${suffix}`
}

function transferError(error: string): string {
  if (error === 'unsupported-version') return 'This configuration uses a newer transfer format.'
  if (error === 'unsupported-program-schema') return 'This configuration uses a timer format this app does not support.'
  if (error === 'too-large') return 'That configuration file is too large.'
  if (error === 'empty') return 'The clipboard or selected file was empty.'
  return 'The configuration is malformed or contains unsupported settings.'
}

const styles = StyleSheet.create({
  screen: { flex: 1 }, closedSummary: { flex: 1, paddingHorizontal: 24, justifyContent: 'center', gap: 16 }, pinned: { paddingHorizontal: 20, gap: 10 }, nameLine: { flexDirection: 'row', alignItems: 'center', gap: 8 }, currentName: { flex: 1, minWidth: 0, minHeight: 46, justifyContent: 'center', gap: 2 }, currentNameText: { fontSize: 22, fontWeight: '500' }, nameInput: { flex: 1, minWidth: 0, minHeight: 45, borderBottomWidth: 2, fontSize: 22, fontWeight: '500', paddingHorizontal: 2 }, namePicker: { minWidth: 44, minHeight: 44, borderWidth: 1.5, borderRadius: 22, alignItems: 'center', justifyContent: 'center' }, saveRow: { flexDirection: 'row', alignItems: 'center', gap: 6 }, statusSlot: { flex: 1, alignItems: 'flex-end' }, status: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase' }, footer: { paddingHorizontal: 20, paddingTop: 10, gap: 7 }, startButton: { minHeight: 52, borderWidth: 1, borderRadius: 18, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 10 }, startText: { fontSize: 17, fontWeight: '700' }, noticeText: { textAlign: 'center', fontSize: 12 }, section: { gap: 12 }, sectionTitle: { fontSize: 17, fontWeight: '700' }, helperText: { fontSize: 12, lineHeight: 17 }, copyText: { fontSize: 14, lineHeight: 21 }, rowTitle: { fontSize: 14, fontWeight: '600' }, row: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }, flex: { flex: 1, minWidth: 0 }, stepRow: { borderWidth: 1, borderRadius: 14, minHeight: 62, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 6 }, stepSummary: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 50 }, stepIndex: { fontSize: 13, fontWeight: '800', fontVariant: ['tabular-nums'] }, stepName: { fontSize: 14, fontWeight: '700' }, stepActions: { flexDirection: 'row', gap: 4 }, miniButton: { width: 36, height: 36, borderWidth: 1, borderRadius: 18, alignItems: 'center', justifyContent: 'center' }, buttonRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 }, stepEditor: { gap: 10 }, input: { minHeight: 44, borderWidth: 1.5, borderRadius: 12, paddingHorizontal: 12, fontSize: 15 }, cueRow: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 12 }, masterRow: { flexDirection: 'row', alignItems: 'center', gap: 12 }, slider: { flex: 1, height: 40 }, sliderRow: { gap: 4 }, actionBlock: { borderTopWidth: 1, paddingTop: 10, gap: 8 }, actionRail: { gap: 8, paddingVertical: 3, paddingRight: 24 }, trackOptionRail: { gap: 6, paddingVertical: 3, paddingRight: 20 }, actionChip: { minHeight: 38, borderWidth: 1.5, borderRadius: 22, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center' }, actionLabel: { fontSize: 12, fontWeight: '600' }, preview: { borderWidth: 1, borderRadius: 12, padding: 10 }, panel: { borderWidth: 1, borderRadius: 16, padding: 14, gap: 12 }, trackCard: { borderWidth: 1, borderRadius: 14, padding: 12, gap: 10 }, trackControls: { gap: 12 }, markerBox: { gap: 8 }, inlineFields: { gap: 10 }, eyeButton: { minWidth: 40, minHeight: 40, borderWidth: 1, borderRadius: 22, alignItems: 'center', justifyContent: 'center' }, profileBox: { gap: 8 }, themeButton: { minHeight: 42, minWidth: 70, borderWidth: 1, borderRadius: 22, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10 }, notice: { borderWidth: 1.5, borderRadius: 16, padding: 14, gap: 8 }, configCard: { borderWidth: 1, borderRadius: 16, padding: 12, gap: 8 }, configTitle: { minHeight: 50, justifyContent: 'center', gap: 4 }, cardActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 }, statusText: { fontSize: 11 }, markerValue: { fontSize: 12 },
  setupPage: { paddingHorizontal: 20, gap: 20 }, topBar: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 10 }, nameEdit: { flex: 1, minWidth: 0, justifyContent: 'center', gap: 2 }, pageTitle: { fontSize: 21, fontWeight: '600' }, topActions: { flexDirection: 'row', gap: 8 }, iconButton: { width: 42, height: 42, borderWidth: 1, borderRadius: 21, alignItems: 'center', justifyContent: 'center' }, saveButton: { minWidth: 60, height: 42, borderWidth: 1, borderRadius: 21, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 }, overflowGlyph: { fontSize: 16, fontWeight: '800', letterSpacing: 1 }, mainTimerCard: { borderWidth: 1, borderRadius: 18, padding: 16, gap: 12 }, mainTimerFlat: { gap: 10 }, mainIntervalLabel: { fontSize: 16, fontWeight: '600' }, eyebrow: { fontSize: 11, letterSpacing: 1.2, fontWeight: '700' }, durationHero: { fontSize: 42, fontWeight: '500', fontVariant: ['tabular-nums'] }, soundSummary: { minHeight: 52, borderTopWidth: 1, flexDirection: 'row', alignItems: 'center', gap: 12, paddingTop: 8 }, soundLeading: { fontSize: 21, width: 28, textAlign: 'center' }, soundName: { fontSize: 12, lineHeight: 17 }, subBellSummary: { borderWidth: 1, borderRadius: 16, padding: 12, gap: 10 }, subBellHeader: { minHeight: 42, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }, inlineLink: { minHeight: 36, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, stepCard: { minHeight: 130, borderWidth: 1, borderRadius: 16, paddingHorizontal: 10, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', gap: 8 }, stepCardMain: { flex: 1, minWidth: 0, gap: 7 }, stepCardTop: { flexDirection: 'row', alignItems: 'center', gap: 9 }, stepCardTitle: { flex: 1, fontSize: 15, fontWeight: '700' }, stepCardDuration: { fontSize: 15, fontWeight: '700', fontVariant: ['tabular-nums'] }, stepSoundLine: { flexDirection: 'row', alignItems: 'center', gap: 6 }, stepCardActions: { gap: 4 }, sortableSteps: { overflow: 'hidden' }, sortableStepsScroll: { flex: 1 }, sortableStepsContent: { paddingHorizontal: 0 }, sortableStepItem: { width: '100%' }, stepHandle: { alignSelf: 'stretch', justifyContent: 'center' }, stepHandlePressable: { width: 32, minHeight: 52, alignItems: 'center', justifyContent: 'center' }, stepHandleGlyph: { fontSize: 20, lineHeight: 24 }, mainActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, secondaryButton: { minHeight: 44, borderWidth: 1, borderRadius: 14, paddingHorizontal: 14, justifyContent: 'center', alignItems: 'center' }, secondaryLine: { minHeight: 36, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, controlPanel: { borderWidth: 1, borderRadius: 15, padding: 12, gap: 12 }, stepRailSection: { gap: 10, paddingVertical: 5 }, startDock: { borderTopWidth: 1, paddingTop: 10, paddingHorizontal: 18 }, settingsMenu: { gap: 6 }, settingsRow: { minHeight: 58, borderBottomWidth: 1, flexDirection: 'row', alignItems: 'center', paddingVertical: 8, gap: 12 }, sectionHeading: { flexDirection: 'row', alignItems: 'center', gap: 10 }, backButton: { width: 36, height: 36, borderWidth: 1, borderRadius: 18, alignItems: 'center', justifyContent: 'center' }, trackListRow: { minHeight: 62, borderWidth: 1, borderRadius: 13, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 10 }, trackListEdit: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 60 }, trackDot: { width: 9, height: 9, borderRadius: 5 }, trackDetail: { gap: 12 }, trackNameInput: { minHeight: 38, borderBottomWidth: 1.5, fontSize: 22, fontWeight: '500', paddingHorizontal: 1 }, trackModes: { gap: 7, paddingVertical: 3, paddingRight: 24 }, trackOptions: { gap: 6, paddingVertical: 3, paddingRight: 20 }, randomBox: { gap: 8 },
})

