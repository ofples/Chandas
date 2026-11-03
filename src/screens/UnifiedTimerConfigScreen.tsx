import { useCallback, useEffect, useRef, useState } from 'react'
import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native'
import { VolumeControl } from '../components/timer-v2/volume-control'
import type { AppTimerSettings, AvailabilityPolicy, CueSettings, HapticProfile, SubBellColorId, UnifiedSubBellTrack, UnifiedTimerProgram, UnifiedTimerStep } from '../types'
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
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated'
import { SwipeActionRow } from '../components/timer-v2/swipe-action-row'
import { ReorderHandle } from '../components/timer-v2/ReorderHandle'
import { edgeAutoScrollStep, previewOffsetForItem, type ReorderPreview } from '../lib/reorder-preview'
import { UnifiedIntervalEditor } from '../components/timer-v2/unified-interval-editor'
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
import { BellIcon, CheckIcon, ConfigurationIcon, EyeIcon, OverflowIcon, TimerTransportIcon, VolumeIcon, LightbulbIcon } from '../components/Icons'
import { parseUnifiedConfigurationTransfer, serializeUnifiedConfiguration } from '../lib/unified-configuration-transfer'
import { copyConfigurationText, pickConfigurationText, readConfigurationTextFromClipboard, saveConfigurationFile } from '../lib/configuration-transfer-io'
import { configurationTransferFilename } from '../lib/configuration-transfer'
import { UNNAMED_DRAFT_KEY, defaultUnifiedTimerName, type ConfigStateCommand, type UnifiedConfigState, type UnifiedTimerConfig, type UnifiedTimerDraft } from '../lib/unified-config-state'
import { useKeyboardVisible } from '../hooks/use-keyboard-visible'
import { unifiedCadenceOffsets, unifiedTrackCadencePatch, unifiedTrackDurationPatch } from '../lib/unified-editing'

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
type ModalKind = 'picker' | 'switch' | 'settings' | 'step' | 'subbells' | 'track' | null
const ACTIONS: ReadonlyArray<{ id: ExtraAction; label: string }> = [
  { id: 'schedule', label: 'Schedule' }, { id: 'haptics', label: 'Default haptics' },
  { id: 'alarm', label: 'Alarm settings' }, { id: 'focus', label: 'Focus' },
  { id: 'notifications', label: 'Notifications' }, { id: 'calls', label: 'Call mute' },
  { id: 'precision', label: 'Seconds' }, { id: 'running-controls', label: 'Running controls' }, { id: 'system', label: 'System access' }, { id: 'device', label: 'Device appearance' },
]
const own = (object: object, key: PropertyKey) => Object.prototype.hasOwnProperty.call(object, key)

export function UnifiedTimerConfigScreen({ state, onCommand, onStart, starting, focusState, onFocusAutomationChange, onOpenFocusSettings, onOpenFocusRuleSettings, androidAccess, onOpenExactAlarmSettings, onOpenFullScreenIntentSettings, onRequestCallMuteAccess, onRequestNotificationAccess, onFeedback }: UnifiedTimerConfigScreenProps) {
  const { tokens, theme, toggleTheme, useEinkTheme, accentColor, setAccentColor } = useTheme()
  const insets = useSafeAreaInsets()
  const keyboardVisible = useKeyboardVisible()
  const confirm = useConfirmation()
  const [modal, setModal] = useState<ModalKind>(null)
  const [mixerOpen, setMixerOpen] = useState(false)
  const [reorderPreview, setReorderPreview] = useState<ReorderPreview | null>(null)
  const pageScroll = useRef<ScrollView>(null)
  const pageScrollY = useRef(0)
  const pageScrollMax = useRef(0)
  const pageViewport = useRef({ top: 0, bottom: 0, height: 0 })
  const autoScrollSteps = useCallback((pageY: number, earlier: boolean, later: boolean) => {
    const viewport = pageViewport.current
    const delta = edgeAutoScrollStep(pageY, viewport.top, viewport.bottom, 60, earlier, later, 8)
    const next = Math.max(0, Math.min(pageScrollMax.current, pageScrollY.current + delta))
    const applied = next - pageScrollY.current
    if (applied) { pageScrollY.current = next; pageScroll.current?.scrollTo({ y: next, animated: false }) }
    return applied
  }, [])
  const [settingsAction, setSettingsAction] = useState<ExtraAction | null>(null)
  const [editingTrackId, setEditingTrackId] = useState<string | null>(null)
  const [stepSheetRetained, setStepSheetRetained] = useState(false)
  const [settingsRetained, setSettingsRetained] = useState(false)
  const [nameEditing, setNameEditing] = useState(false)
  const [queuedConfigId, setQueuedConfigId] = useState<string | null>(null)
  const switchReturnModal = useRef<ModalKind>(null)
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
    const steps = program.steps.map(item => item.id === stepId ? { ...item, durationSeconds, label, subBellTracks: item.subBellTracks.map(track => ({ ...track, ...unifiedTrackDurationPatch(track, item.durationSeconds, durationSeconds) })) } : item)
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
    if (draft.dirty) { switchReturnModal.current = modal; setQueuedConfigId(configId); setModal('switch'); return }
    void performCommand({ type: 'switch', configId, choice: 'keep' }).then(accepted => { if (accepted) setModal(null) })
  }
  const respondToSwitch = async (choice: 'save' | 'keep' | 'discard' | 'cancel') => {
    if (choice === 'save' && !draft.baseConfigId) {
      if (await performCommand({ type: 'switch', configId: queuedConfigId, choice: 'save-as', saveAsName: draft.name, saveAsId: createProgramId() })) { setModal(null); setQueuedConfigId(null) }
      return
    }
    if (choice === 'cancel') {
      onCommand({ type: 'switch', configId: queuedConfigId, choice })
      setModal(switchReturnModal.current)
      setQueuedConfigId(null)
      return
    }
    if (await performCommand({ type: 'switch', configId: queuedConfigId, choice })) {
      setModal(null)
      setQueuedConfigId(null)
    }
  }
  const saveCurrent = () => performCommand(draft.baseConfigId ? { type: 'save' } : { type: 'saveAs', name: draft.name, id: createProgramId() })
  const saveCopy = () => {
    const names = new Set(state.configs.map(config => config.name))
    let suffix = ' copy', index = 1
    let name = [...draft.name].slice(0, 80 - suffix.length).join('') + suffix
    while (names.has(name)) { suffix = ` copy ${++index}`; name = [...draft.name].slice(0, 80 - suffix.length).join('') + suffix }
    void performCommand({ type: 'saveAs', name, id: createProgramId() })
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
  const duplicateTrack = (track: UnifiedSubBellTrack) => {
    if (activeStep.subBellTracks.length >= MAX_PATTERN_TRACKS) return null
    const copy = cloneTrackWithNewId(track)
    const index = activeStep.subBellTracks.findIndex(item => item.id === track.id)
    const tracks = [...activeStep.subBellTracks]
    tracks.splice(index + 1, 0, copy)
    patchStep(activeStep.id, { subBellTracks: tracks })
    return copy.id
  }
  const removeTrack = async (track: UnifiedSubBellTrack) => {
    if (!await confirm({ title: `Delete ${track.label}?`, message: 'This removes the sub-bell from this timer step.', confirmLabel: 'Delete sub-bell', cancelLabel: 'Keep sub-bell', destructive: true })) return
    patchStep(activeStep.id, { subBellTracks: activeStep.subBellTracks.filter(item => item.id !== track.id) })
    if (modal === 'track') setModal('subbells')
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
  return <KeyboardAvoidingView testID="unified-config-screen" style={[styles.screen, { backgroundColor: tokens.bg }]} behavior={Platform.OS === 'ios' ? 'padding' : Platform.OS === 'android' ? 'height' : undefined}>
    <ScrollView ref={pageScroll} showsVerticalScrollIndicator={false} scrollEnabled={!reorderPreview} onScroll={event => { pageScrollY.current = event.nativeEvent.contentOffset.y }} scrollEventThrottle={16} onLayout={event => { const height = event.nativeEvent.layout.height; pageViewport.current.height = height; pageScroll.current?.getNativeScrollRef()?.measureInWindow((_x: number, y: number) => { pageViewport.current = { top: y, bottom: y + height, height } }) }} onContentSizeChange={(_width, height) => { pageScrollMax.current = Math.max(0, height - pageViewport.current.height) }} contentContainerStyle={[styles.setupPage, { paddingTop: insets.top + 12, paddingBottom: keyboardVisible ? 12 : insets.bottom + 18 }]} keyboardShouldPersistTaps="handled">
      <View style={styles.topBar}>
        {nameEditing ? <TextInput testID="unified-config-name" accessibilityLabel="Timer configuration name" autoFocus value={draftName} onChangeText={value => { const next = [...value].slice(0, 80).join(''); setDraftName(next); if (next.trim()) updateConfigurationName(next) }} onBlur={() => { const name = draftName.trim() || draft.name; setDraftName(name); if (name !== draft.name) updateConfigurationName(name); setNameEditing(false) }} placeholder="Timer name" placeholderTextColor={tokens.textMuted} style={[styles.nameInput, { color: tokens.text, borderBottomColor: tokens.accent }]} returnKeyType="done" /> : <Pressable testID="unified-config-name" accessibilityRole="button" accessibilityLabel={`Edit timer name, ${draft.name}`} onPress={() => setNameEditing(true)} style={styles.nameEdit}><Text numberOfLines={1} style={[styles.pageTitle, { color: tokens.text }]}>{draft.name}</Text></Pressable>}
        <View style={styles.topActions}>

          <Pressable testID="unified-config-open-picker" accessibilityRole="button" accessibilityLabel="Configurations" onPress={() => { setSettingsRetained(false); setModal('picker') }} style={[styles.iconButton, { borderColor: tokens.border }]}><ConfigurationIcon color={tokens.text} /></Pressable>
          <Pressable testID="unified-config-settings" accessibilityRole="button" accessibilityLabel="Settings" onPress={() => { setSettingsAction(null); setSettingsRetained(false); setModal('settings') }} style={[styles.iconButton, { borderColor: tokens.border }]}><OverflowIcon color={tokens.text} /></Pressable>
        </View>
      </View>

      {program.steps.length > 1 ? <TimerControlRail singleStep={program.steps.length === 1} showGlobal={true} program={program} settings={draft.settings} step={activeStep} cycleDurationSeconds={cycleDurationSeconds} onProgram={patchProgram} onSettings={patchSettings} onOpenMixer={() => setMixerOpen(true)} onCueHaptics={hapticOverride => patchStep(activeStep.id, { endCue: { ...activeStep.endCue, hapticOverride } })} onAlarm={endAlarmEnabled => patchStep(activeStep.id, { endAlarmEnabled })} /> : null}
      {program.steps.length === 1 ? <UnifiedIntervalEditor step={activeStep} secondPrecision={draft.settings.secondPrecisionEnabled} onDuration={seconds => updateStepDuration(activeStep.id, seconds)} onSound={() => setCueTarget({ kind: 'step-end', stepId: activeStep.id })} onSubBells={() => { setStepSheetRetained(false); setModal('subbells') }} onSubBellsEnabled={subBellsEnabled => patchStep(activeStep.id, { subBellsEnabled })} controls={<TimerControlRail singleStep={program.steps.length === 1} showGlobal={true} program={program} settings={draft.settings} step={activeStep} cycleDurationSeconds={cycleDurationSeconds} onProgram={patchProgram} onSettings={patchSettings} onOpenMixer={() => setMixerOpen(true)} onCueHaptics={hapticOverride => patchStep(activeStep.id, { endCue: { ...activeStep.endCue, hapticOverride } })} onAlarm={endAlarmEnabled => patchStep(activeStep.id, { endAlarmEnabled })} />} /> : <View style={styles.section}>
        <View style={{ gap: 12 }}>{program.steps.map((step, index) => <UnifiedStepCard key={step.id} step={step} index={index} itemCount={program.steps.length} preview={reorderPreview} onPreview={setReorderPreview} onAutoScroll={autoScrollSteps} onMove={moveStep} onDuplicate={program.steps.length < MAX_SEQUENCE_STEPS ? () => duplicateStep(step) : undefined} onDelete={program.steps.length > 1 ? () => removeStep(step) : undefined} onEdit={() => { setActiveStepId(step.id); setStepSheetRetained(false); setModal('step') }} />)}</View>

      </View>}

      {state.globalAvailability?.enabled ? <ScheduleTimelinePreview value={state.globalAvailability} onPress={() => { setSettingsAction('schedule'); setModal('settings') }} /> : null}

      <View style={styles.mainActions}>
        <Pressable testID="unified-add-step" accessibilityRole="button" accessibilityState={{ disabled: program.steps.length >= MAX_SEQUENCE_STEPS }} disabled={program.steps.length >= MAX_SEQUENCE_STEPS} onPress={addStep} style={[styles.secondaryButton, { borderColor: tokens.border }]}><Text style={{ color: tokens.text }}>＋ Add step</Text></Pressable>
        {program.runPolicy.kind !== 'continuous' ? <Pressable testID="unified-completion-sound" accessibilityRole="button" onPress={() => { if (!program.completionCue) patchProgram({ completionCue: { sound: { kind: 'builtin', id: 'temple-gong' }, volume: 1 } }); setCueTarget({ kind: 'completion' }) }} style={[styles.secondaryButton, { borderColor: tokens.border }]}><Text style={{ color: tokens.text }}>{program.completionCue ? `Completion · ${soundTitle(program.completionCue.sound)}` : '＋ Add completion sound'}</Text></Pressable> : null}
        {program.runPolicy.kind !== 'continuous' && program.completionCue ? <OverflowMenu label="Completion sound options" items={[{ label: 'Remove completion sound', destructive: true, onPress: () => patchProgram({ completionCue: null }) }]} /> : null}
      </View>
      {!nativeSchemaReady ? <Text style={[styles.noticeText, { color: tokens.warm }]}>Update Chandas to start this timer.</Text> : null}
    </ScrollView>
    <View style={[styles.startDock, { borderColor: tokens.border, paddingBottom: Math.max(insets.bottom, 10), backgroundColor: tokens.bg }]}>
      <Pressable testID="unified-config-start" disabled={!nativeSchemaReady || starting} onPress={() => { tapHaptic(); onStart() }} accessibilityRole="button" accessibilityState={{ disabled: !nativeSchemaReady || starting, busy: starting }} style={({ pressed }) => [styles.startButton, { backgroundColor: theme === 'eink' ? tokens.surface : tokens.accent, borderColor: tokens.border, opacity: !nativeSchemaReady || starting ? 0.52 : pressed ? 0.8 : 1 }]}>
        {starting ? <ActivityIndicator color={theme === 'eink' ? tokens.text : '#fff'} /> : null}<Text style={[styles.startText, { color: theme === 'eink' ? tokens.text : '#fff' }]}>{starting ? 'Starting timer…' : 'Start timer'}</Text>
      </Pressable>
    </View>

    <DraggableSheet visible={modal === 'settings' || (modal === 'picker' && settingsRetained)} title="Settings" testID="unified-settings-sheet" scrollKey="menu" onClose={() => { setSettingsAction(null); setModal(null); setSettingsRetained(false) }}>
      <View style={styles.settingsMenu}>
        {[{ id: 'picker', label: 'Configurations', detail: 'Save, switch, import and export' }, { id: 'sound-library', label: 'Sound library', detail: `${state.soundLibrary.length} shared imported sounds` }, ...ACTIONS.map(action => ({ id: action.id, label: action.label, detail: settingsDetail(action.id, draft.settings, program, state.globalAvailability) }))].map(item => <Pressable key={item.id} testID={`unified-settings-${item.id}`} accessibilityRole="button" onPress={() => item.id === 'picker' ? (setSettingsRetained(true), setModal('picker')) : item.id === 'sound-library' ? setCueTarget({ kind: 'sound-library' }) : setSettingsAction(item.id as ExtraAction)} style={[styles.settingsRow, { borderColor: tokens.border }]}><View style={styles.flex}><Text style={[styles.rowTitle, { color: tokens.text }]}>{item.label}</Text><Text style={[styles.helperText, { color: tokens.textMuted }]}>{item.detail}</Text></View><Text style={{ color: tokens.accent }}>›</Text></Pressable>)}

      </View>
    </DraggableSheet>

    <DraggableSheet visible={modal === 'settings' && settingsAction !== null} title={ACTIONS.find(action => action.id === settingsAction)?.label ?? 'Settings'} testID="unified-settings-detail-sheet" partialHeightFraction={0.44} presentation="center" onClose={() => setSettingsAction(null)}>
      {settingsAction ? <SettingsSection action={settingsAction!} draft={draft} program={program} availability={state.globalAvailability} cycleDurationSeconds={cycleDurationSeconds} focusState={focusState} androidAccess={androidAccess} floatingOverlay={floatingOverlay} floatingAvailable={floatingAvailable} theme={theme} tokens={tokens} onSettings={patchSettings} onProgram={patchProgram} onAvailability={availability => onCommand({ type: 'setGlobalAvailability', availability })} onCue={kind => setCueTarget(kind === 'alarm' ? { kind: 'alarm' } : { kind: 'completion' })} onFocusAutomationChange={onFocusAutomationChange} onOpenFocusSettings={onOpenFocusSettings} onOpenFocusRuleSettings={onOpenFocusRuleSettings} onOpenExactAlarmSettings={onOpenExactAlarmSettings} onOpenFullScreenIntentSettings={onOpenFullScreenIntentSettings} onRequestCallMuteAccess={onRequestCallMuteAccess} onRequestNotificationAccess={onRequestNotificationAccess} onFloatingChange={setFloatingOverlay} onFeedback={onFeedback} accentColor={accentColor} setAccentColor={setAccentColor} themeLongPressed={themeLongPressed} setThemeLongPressed={setThemeLongPressed} toggleTheme={toggleTheme} useEinkTheme={useEinkTheme} /> : null}
    </DraggableSheet>

    <DraggableSheet visible={modal === 'step' || ((modal === 'subbells' || modal === 'track') && stepSheetRetained)} title={activeStep.label} showTitle={false} testID="unified-step-sheet" onClose={() => { setModal(null); setStepSheetRetained(false) }}>
      <View style={[styles.row, { zIndex: 30 }]}><TextInput testID={`unified-config-step-name-${activeStep.id}`} accessibilityLabel="Step name" value={stepNameDraft} onChangeText={value => { const label = [...value].slice(0, 60).join(''); setStepNameDraft(label); if (label.trim()) patchStep(activeStep.id, { label, labelIsCustom: true }) }} onBlur={() => { const label = stepNameDraft.trim() || activeStep.label; setStepNameDraft(label); if (label !== activeStep.label) patchStep(activeStep.id, { label, labelIsCustom: true }) }} placeholder="Step name" placeholderTextColor={tokens.textMuted} style={[styles.trackNameInput, styles.flex, { borderBottomColor: tokens.accent, color: tokens.text }]} /><OverflowMenu label="Step options" items={[{ label: 'Duplicate step', disabled: program.steps.length >= MAX_SEQUENCE_STEPS, onPress: () => duplicateStep(activeStep) }, { label: 'Delete step', disabled: program.steps.length <= 1, destructive: true, onPress: () => void removeStep(activeStep) }]} /></View>
      <UnifiedIntervalEditor step={activeStep} secondPrecision={draft.settings.secondPrecisionEnabled} onDuration={seconds => updateStepDuration(activeStep.id, seconds)} onSound={() => setCueTarget({ kind: 'step-end', stepId: activeStep.id })} onSubBells={() => { setStepSheetRetained(true); setModal('subbells') }} onSubBellsEnabled={subBellsEnabled => patchStep(activeStep.id, { subBellsEnabled })} controls={<TimerControlRail singleStep={program.steps.length === 1} showGlobal={false} program={program} settings={draft.settings} step={activeStep} cycleDurationSeconds={cycleDurationSeconds} onProgram={patchProgram} onSettings={patchSettings} onOpenMixer={() => setMixerOpen(true)} onCueHaptics={hapticOverride => patchStep(activeStep.id, { endCue: { ...activeStep.endCue, hapticOverride } })} onAlarm={endAlarmEnabled => patchStep(activeStep.id, { endAlarmEnabled })} />} />
    </DraggableSheet>

    <DraggableSheet visible={modal === 'subbells' || modal === 'track'} title="Sub-bells" testID="unified-subbells-sheet" onClose={() => { setModal(stepSheetRetained ? 'step' : null); setStepSheetRetained(false) }}>
      <View style={styles.subBellHeader}><View style={styles.flex}><Text style={[styles.rowTitle, { color: tokens.text }]}>Sub-bells in {program.steps.length > 1 ? activeStep.label : 'this interval'}</Text><Text style={[styles.helperText, { color: tokens.textMuted }]}>Each sub-bell keeps its own sound and timing.</Text></View><Toggle value={activeStep.subBellsEnabled} onChange={subBellsEnabled => patchStep(activeStep.id, { subBellsEnabled })} accessibilityLabel="Enable sub-bells" /></View>
      <PatternTimelinePreview tracks={asPatternTracks(activeStep.subBellsEnabled ? activeStep.subBellTracks : [])} mainDurationSeconds={activeStep.durationSeconds} />
      {activeStep.subBellTracks.map((track, index) => <SwipeActionRow key={track.id} testID={`unified-track-swipe-${track.id}`} accessibilityLabel={track.label} onDuplicate={activeStep.subBellTracks.length < MAX_PATTERN_TRACKS ? () => { duplicateTrack(track) } : undefined} onDelete={() => removeTrack(track)}>{canPress => <View testID={`unified-track-row-${track.id}`} style={[styles.trackListRow, { borderColor: tokens.border, backgroundColor: tokens.surface }]}>
        <Pressable accessibilityRole="button" accessibilityLabel={`Edit ${track.label}`} onPress={() => { if (canPress()) { setEditingTrackId(track.id); setModal('track') } }} style={[styles.trackListEdit, styles.flex]}>
          <View style={[styles.trackDot, { backgroundColor: subBellColorValue(track.color, index, theme === 'eink') }]} /><View style={styles.flex}><Text style={[styles.rowTitle, { color: tokens.text }]}>{track.label}</Text><Text style={[styles.helperText, { color: tokens.textMuted }]}><SoundSummary cue={track} /> · {trackTimingSummary(track)}</Text></View>
        </Pressable>
        <Toggle value={track.enabled} onChange={enabled => { if (canPress()) patchTrack(activeStep.id, track.id, { enabled }) }} accessibilityLabel={`Enable ${track.label}`} /><Text accessible={false} style={{ color: tokens.accent }}>›</Text>
      </View>}</SwipeActionRow>)}
      <Pressable testID="unified-add-subbell" accessibilityRole="button" disabled={activeStep.subBellTracks.length >= MAX_PATTERN_TRACKS} onPress={() => { const track = makeNewTrack(activeStep.subBellTracks.length, activeStep.durationSeconds); patchStep(activeStep.id, { subBellsEnabled: true, subBellTracks: [...activeStep.subBellTracks, track] }); setEditingTrackId(track.id); setModal('track') }} style={[styles.secondaryButton, { borderColor: tokens.border }]}><Text style={{ color: tokens.accent }}>＋ Add a sub-bell</Text></Pressable>
    </DraggableSheet>

    <DraggableSheet visible={modal === 'track'} title={editingTrackId ? activeStep.subBellTracks.find(track => track.id === editingTrackId)?.label ?? 'Sub-bell' : 'Sub-bell'} showTitle={false} testID="unified-track-sheet" onClose={() => setModal('subbells')}>
      {(() => { const track = activeStep.subBellTracks.find(item => item.id === editingTrackId); return track ? <TrackDetail track={track} durationSeconds={activeStep.durationSeconds} secondPrecision={draft.settings.secondPrecisionEnabled} settings={draft.settings} onPatch={changes => patchTrack(activeStep.id, track.id, changes)} onOpenSound={() => setCueTarget({ kind: 'track', stepId: activeStep.id, trackId: track.id })} onDuplicate={() => { const id = duplicateTrack(track); if (id) setEditingTrackId(id) }} onDelete={() => void removeTrack(track)} /> : null })()}
    </DraggableSheet>

    <DraggableSheet visible={modal === 'picker'} title="Configurations" testID="unified-config-picker-sheet" onClose={() => { setModal(settingsRetained ? 'settings' : null); if (!settingsRetained) setSettingsAction(null) }} titleAction={<OverflowMenu label="Configuration actions" items={[{ label: transferBusy ? 'Loading…' : 'Import from clipboard', disabled: transferBusy, testID: 'unified-config-import-clipboard', onPress: () => void openExternalImport('clipboard') }, { label: 'Import file', disabled: transferBusy, testID: 'unified-config-import-file', onPress: () => void openExternalImport('file') }, { label: own(state.drafts, UNNAMED_DRAFT_KEY) ? 'Return to unsaved timer' : 'New unsaved timer', testID: 'unified-config-return-unsaved', onPress: () => switchTo(null) }, { label: 'Save a copy', testID: 'unified-config-save-copy', onPress: saveCopy }]} />}>
        <View testID="unified-current-configuration" style={[styles.configCard, { borderColor: tokens.accent, backgroundColor: tokens.surface }]}>
          <View style={styles.row}><View style={styles.flex}><Text style={[styles.helperText, { color: tokens.textMuted }]}>Current timer · {!draft.baseConfigId ? 'Working copy' : draft.dirty ? 'Unsaved changes' : 'Saved'}</Text><Pressable accessibilityRole="button" accessibilityLabel="Edit current timer name" onPress={() => { setModal(null); setNameEditing(true) }}><Text style={[styles.sectionTitle, { color: tokens.text }]}>{draft.name}</Text></Pressable></View>
            <Pressable testID="unified-config-save" accessibilityRole="button" accessibilityLabel="Save current configuration" disabled={!draft.dirty || commandPending} onPress={() => void saveCurrent()} style={[styles.saveButton, { borderColor: tokens.border, opacity: !draft.dirty || commandPending ? 0.4 : 1 }]}><Text style={{ color: tokens.text }}>{commandPending ? 'Saving…' : 'Save'}</Text></Pressable>
            <OverflowMenu label="Current configuration options" items={[{ label: 'Save a copy', onPress: saveCopy }, ...(selectedConfig ? [{ label: `${selectedConfig.showInRunningSelector ? '✓ ' : ''}Available while running`, onPress: () => { void performCommand({ type: 'setVisibility', id: selectedConfig.id, showInRunningSelector: !selectedConfig.showInRunningSelector }) } }, { label: 'Export saved configuration', disabled: transferBusy, onPress: () => void exportConfig(selectedConfig) }, { label: 'Delete saved configuration', disabled: draft.dirty, destructive: true, onPress: async () => { if (await confirm({ title: `Delete ${selectedConfig.name}?`, message: 'This removes the saved configuration and its clean draft.', confirmLabel: 'Delete', cancelLabel: 'Keep', destructive: true })) void performCommand({ type: 'delete', id: selectedConfig.id }) } }] : [])]} />
          </View>
          <ConfigPreview program={program} />
        </View>
        {state.legacyRecoveries.length ? <View style={[styles.notice, { borderColor: tokens.warm }]}><Text style={[styles.rowTitle, { color: tokens.text }]}>Recovered legacy timers</Text><Text style={[styles.helperText, { color: tokens.textMuted }]}>Both original working copies are preserved here. Add either as a saved configuration.</Text>{state.legacyRecoveries.map(recovery => <SheetTextButton key={recovery.id} label={`Add recovered ${recovery.sourceMode === 'pattern' ? 'Cycle' : 'Sequence'}`} onPress={() => { const config: UnifiedTimerConfig = { id: createProgramId(), name: recovery.draft.name, createdAt: Date.now(), updatedAt: Date.now(), program: recovery.draft.program, settings: recovery.draft.settings, showInRunningSelector: true, editorOptions: recovery.draft.editorOptions }; void performCommand({ type: 'importConfig', config, select: false }) }} />)}</View> : null}
        {state.configs.filter(config => config.id !== state.selectedConfigId).map(config => <ConfigCard key={config.id} config={config} draft={own(state.drafts, config.id) ? state.drafts[config.id] : undefined} renameValue={own(renameValues, config.id) ? renameValues[config.id]! : config.name} onRenameChange={value => setRenameValues(current => ({ ...current, [config.id]: value }))} onRename={async () => { if (await performCommand({ type: 'rename', id: config.id, name: own(renameValues, config.id) ? renameValues[config.id]! : config.name })) setRenameValues(current => { const next = { ...current }; delete next[config.id]; return next }) }} onSelect={() => switchTo(config.id)} onDuplicate={() => { void performCommand({ type: 'duplicate', id: config.id, newId: createProgramId() }) }} onDelete={async () => {
        if (own(state.drafts, config.id) && state.drafts[config.id]!.dirty) { onFeedback({ title: 'Unsaved draft kept', message: 'Save, switch, or discard this configuration’s draft before deleting it.', tone: 'attention' }); return }
        if (await confirm({ title: `Delete ${config.name}?`, message: 'This removes the saved configuration and its clean draft.', confirmLabel: 'Delete', cancelLabel: 'Keep', destructive: true })) await performCommand({ type: 'delete', id: config.id })
      }} onVisibility={showInRunningSelector => { void performCommand({ type: 'setVisibility', id: config.id, showInRunningSelector }) }} onExport={() => void exportConfig(config)} transferBusy={transferBusy} />)}
    </DraggableSheet>

    <DraggableSheet visible={modal === 'switch'} title="Unsaved changes" testID="unified-config-switch-sheet" onClose={() => respondToSwitch('cancel')}>
      <Text style={[styles.copyText, { color: tokens.textMuted }]}>Choose what to do with this draft before switching configurations.</Text>
      <SheetTextButton testID="unified-config-switch-save" label="Save & switch" onPress={() => respondToSwitch('save')} />
      <SheetTextButton testID="unified-config-switch-keep" label="Keep draft & switch" onPress={() => respondToSwitch('keep')} />
      <SheetTextButton testID="unified-config-switch-discard" label="Discard & switch" onPress={() => respondToSwitch('discard')} tone="danger" />
    </DraggableSheet>

    <DraggableSheet visible={mixerOpen} title="Volume mixer" testID="unified-volume-mixer" onClose={() => setMixerOpen(false)}>
      <VolumeControl cue={activeStep.endCue} masterVolume={draft.settings.masterVolume} masterControl label="Overall volume" value={draft.settings.masterVolume} onChange={masterVolume => patchSettings({ masterVolume })} />
      {program.steps.map(step => <View key={step.id} style={styles.section}>
        {program.steps.length > 1 ? <Text style={[styles.helperText, { color: tokens.textMuted, fontSize: 13, paddingTop: 8 }]}>{step.label}</Text> : null}
        <VolumeControl accessibilityLabel={`${step.label} ending cue`} cue={step.endCue} masterVolume={draft.settings.masterVolume} label="At the end" value={step.endCue.volume} onChange={volume => patchStep(step.id, { endCue: { ...step.endCue, volume } })} />
        {step.subBellTracks.map(track => <VolumeControl key={track.id} accessibilityLabel={`${step.label}, ${track.label}`} cue={track} masterVolume={draft.settings.masterVolume} label={track.label} value={track.volume} onChange={volume => patchTrack(step.id, track.id, { volume })} />)}
      </View>)}
      {program.completionCue ? <VolumeControl cue={program.completionCue} masterVolume={draft.settings.masterVolume} label="Completion sound" value={program.completionCue.volume} onChange={volume => patchProgram({ completionCue: { ...program.completionCue!, volume } })} /> : null}
      <VolumeControl cue={{ sound: draft.settings.alarmSound, volume: draft.settings.alarmVolume }} masterVolume={draft.settings.masterVolume} label="Alarm" value={draft.settings.alarmVolume} onChange={alarmVolume => patchSettings({ alarmVolume })} />
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

function SettingsSection({ action, draft, program, availability, cycleDurationSeconds, focusState, androidAccess, floatingOverlay, floatingAvailable, theme, tokens, onSettings, onProgram, onAvailability, onCue, onFocusAutomationChange, onOpenFocusSettings, onOpenFocusRuleSettings, onOpenExactAlarmSettings, onOpenFullScreenIntentSettings, onRequestCallMuteAccess, onRequestNotificationAccess, onFloatingChange, onFeedback, accentColor, setAccentColor, themeLongPressed, setThemeLongPressed, toggleTheme, useEinkTheme }: {
  action: ExtraAction; draft: UnifiedTimerDraft; program: UnifiedTimerProgram; availability: AvailabilityPolicy; cycleDurationSeconds: number; focusState: NativeFocusState;
  androidAccess: UnifiedTimerConfigScreenProps['androidAccess']; floatingOverlay: ReturnType<typeof ChandasTimerService.getFloatingOverlayState>; floatingAvailable: boolean;
  theme: string; tokens: ReturnType<typeof useTheme>['tokens']; onSettings: (changes: Partial<AppTimerSettings>) => void; onProgram: (changes: Partial<UnifiedTimerProgram>) => void; onAvailability: (availability: AvailabilityPolicy) => void; onCue: (kind: 'alarm' | 'completion') => void;
  onFocusAutomationChange: (enabled: boolean) => void; onOpenFocusSettings: () => void; onOpenFocusRuleSettings: () => void; onOpenExactAlarmSettings: () => void; onOpenFullScreenIntentSettings: () => void;
  onRequestCallMuteAccess: () => void; onRequestNotificationAccess: () => void; onFloatingChange: (value: ReturnType<typeof ChandasTimerService.getFloatingOverlayState>) => void; onFeedback: UnifiedTimerConfigScreenProps['onFeedback'];
  accentColor: SubBellColorId; setAccentColor: (value: SubBellColorId) => void; themeLongPressed: boolean; setThemeLongPressed: (value: boolean) => void; toggleTheme: () => void; useEinkTheme: () => void
}) {
  const setting = (key: ExtraAction) => {
    switch (key) {
      case 'schedule': return <Panel title="Schedule" tokens={tokens}><View style={styles.row}><View style={styles.flex}><Text style={[styles.rowTitle, { color: tokens.text }]}>Use schedule</Text><Text style={[styles.helperText, { color: tokens.textMuted }]}>Applies across the app.</Text></View><Toggle value={availability.enabled} onChange={enabled => onAvailability({ ...availability, enabled })} accessibilityLabel="Use app schedule" /></View><ScheduleConfig showHeading={false} showEnabledControl={false} value={availability} onChange={onAvailability} />{availability.enabled ? <ScheduleTimelinePreview value={availability} onPress={() => {}} /> : null}</Panel>
      case 'haptics': return <HapticsPanel value={draft.settings.haptics} onChange={haptics => { setAppHapticsEnabled(haptics.enabled); onSettings({ haptics }) }} />
      case 'alarm': return <Panel title="Alarm" tokens={tokens}><Text style={[styles.rowTitle, { color: tokens.text }]}>Timer alarm mode</Text><SegmentedControl items={[{ value: 'off', label: 'Off' }, { value: 'once', label: 'Once' }, { value: 'locked', label: 'Locked' }]} value={program.alarmBehavior} onChange={alarmBehavior => onProgram({ alarmBehavior })} accessibilityLabel="Timer alarm mode" /><Text style={[styles.helperText, { color: tokens.textMuted }]}>{program.alarmBehavior === 'locked' ? 'The ending alarm rings until dismissed.' : program.alarmBehavior === 'once' ? 'Arm one dismissible alarm for this timer.' : 'This timer uses its ending cue without an alarm.'}</Text><Pressable onPress={() => onCue('alarm')} style={[styles.soundSummary, { borderColor: tokens.border }]}><View style={styles.flex}><Text style={[styles.rowTitle, { color: tokens.text }]}>Alarm sound</Text><SoundName cue={{ sound: draft.settings.alarmSound, volume: draft.settings.alarmVolume }} style={styles.helperText} /></View><Text style={{ color: tokens.accent }}>›</Text></Pressable><VolumeControl cue={{ sound: draft.settings.alarmSound, volume: draft.settings.alarmVolume }} masterVolume={draft.settings.masterVolume} label="Alarm volume" value={draft.settings.alarmVolume} onChange={alarmVolume => onSettings({ alarmVolume })} /><DurationSelector label="Alarm duration" value={Math.ceil(draft.settings.alarmDurationSeconds / 60)} valueSeconds={draft.settings.alarmDurationSeconds} secondPrecision={draft.settings.secondPrecisionEnabled || draft.settings.alarmDurationSeconds % 60 !== 0} presets={[1, 2, 5, 10, 15, 30, 60]} minSeconds={5} maxSeconds={3_600} onChange={minutes => onSettings({ alarmDurationSeconds: Math.min(3_600, Math.max(5, minutes * 60)) })} onChangeSeconds={alarmDurationSeconds => onSettings({ alarmDurationSeconds })} /></Panel>
      case 'focus': return <Panel title="Focus" tokens={tokens}><View style={styles.row}><View style={styles.flex}><Text style={[styles.rowTitle, { color: tokens.text }]}>Focus while timer runs</Text><Text style={[styles.helperText, { color: tokens.textMuted }]}>{focusState.reason === 'paused-by-android' ? 'Paused by Android' : focusState.reason === 'rule-disabled' ? 'Focus rule is disabled' : 'Manage Do Not Disturb while this timer runs.'}</Text></View><Toggle value={draft.settings.focusAutomationEnabled} onChange={enabled => { onSettings({ focusAutomationEnabled: enabled }); onFocusAutomationChange(enabled) }} accessibilityLabel="Chandas Focus" /></View>{[{ label: 'Focus settings', detail: 'Manage Do Not Disturb access', onPress: onOpenFocusSettings }, { label: 'Focus rule', detail: 'Choose when Chandas manages Focus', onPress: onOpenFocusRuleSettings }].map(item => <Pressable key={item.label} accessibilityRole="button" accessibilityLabel={item.label} onPress={item.onPress} style={[styles.settingsRow, { borderColor: tokens.border }]}><View style={styles.flex}><Text style={[styles.rowTitle, { color: tokens.text }]}>{item.label}</Text><Text style={[styles.helperText, { color: tokens.textMuted }]}>{item.detail}</Text></View><Text style={{ color: tokens.accent }}>›</Text></Pressable>)}</Panel>
      case 'notifications': return <Panel title="Notifications" tokens={tokens}><View style={styles.row}><View style={styles.flex}><Text style={[styles.rowTitle, { color: tokens.text }]}>Timer notifications</Text><Text style={[styles.helperText, { color: tokens.textMuted }]}>{androidAccess.notifications ? 'Available' : 'Access may be needed.'}</Text></View><Toggle value={draft.settings.notificationsEnabled} onChange={enabled => { onSettings({ notificationsEnabled: enabled }); if (enabled && Platform.OS === 'android' && !androidAccess.notifications) onRequestNotificationAccess() }} accessibilityLabel="Timer notifications" /></View><View style={styles.row}><View style={styles.flex}><Text style={[styles.rowTitle, { color: tokens.text }]}>Upcoming cue countdown</Text><Text style={[styles.helperText, { color: tokens.textMuted }]}>Show the next cue in the running notification.</Text></View><Toggle value={draft.settings.liveCountdownEnabled} onChange={enabled => { onSettings({ liveCountdownEnabled: enabled, ...(enabled ? { notificationsEnabled: true } : {}) }); if (enabled && Platform.OS === 'android' && !androidAccess.notifications) onRequestNotificationAccess() }} accessibilityLabel="Upcoming cue countdown" /></View></Panel>
      case 'calls': return <Panel title="During calls" tokens={tokens}><View style={styles.row}><View style={styles.flex}><Text style={[styles.rowTitle, { color: tokens.text }]}>Mute timer cues during calls</Text><Text style={[styles.helperText, { color: tokens.textMuted }]}>{androidAccess.callMute ? 'Available' : 'Phone access may be needed.'}</Text></View><Toggle value={draft.settings.muteDuringCallsEnabled} onChange={enabled => { onSettings({ muteDuringCallsEnabled: enabled }); if (enabled && Platform.OS === 'android' && !androidAccess.callMute) onRequestCallMuteAccess() }} accessibilityLabel="Mute timer during calls" /></View></Panel>
      case 'precision': return <Panel title="Precision" tokens={tokens}><View style={styles.row}><View style={styles.flex}><Text style={[styles.rowTitle, { color: tokens.text }]}>Edit in seconds</Text><Text style={[styles.helperText, { color: tokens.textMuted }]}>Keep exact seconds visible in duration controls.</Text></View><Toggle value={draft.settings.secondPrecisionEnabled} onChange={secondPrecisionEnabled => onSettings({ secondPrecisionEnabled })} accessibilityLabel="Use exact seconds" /></View></Panel>
      case 'running-controls': return <Panel title="Running controls" tokens={tokens}><View style={styles.row}><View style={styles.flex}><Text style={[styles.rowTitle, { color: tokens.text }]}>Show all timer controls</Text><Text style={[styles.helperText, { color: tokens.textMuted }]}>Keep alarm, mute and sound controls available.</Text></View><Toggle value={draft.settings.advancedModeEnabled} onChange={advancedModeEnabled => onSettings({ advancedModeEnabled })} accessibilityLabel="Show all running controls" /></View></Panel>
      case 'system': return <Panel title="Device access" tokens={tokens}>{!androidAccess.exactAlarms ? <Pressable accessibilityRole="button" accessibilityLabel="Set up exact timing" onPress={onOpenExactAlarmSettings} style={[styles.settingsRow, { borderColor: tokens.border }]}><View style={styles.flex}><Text style={[styles.rowTitle, { color: tokens.text }]}>Exact timing</Text><Text style={[styles.helperText, { color: tokens.warm }]}>Set up</Text></View><Text style={{ color: tokens.accent }}>›</Text></Pressable> : null}{!androidAccess.fullScreenAlarms ? <Pressable accessibilityRole="button" accessibilityLabel="Set up full-screen alarms" onPress={onOpenFullScreenIntentSettings} style={[styles.settingsRow, { borderColor: tokens.border }]}><View style={styles.flex}><Text style={[styles.rowTitle, { color: tokens.text }]}>Full-screen alarms</Text><Text style={[styles.helperText, { color: tokens.warm }]}>Set up</Text></View><Text style={{ color: tokens.accent }}>›</Text></Pressable> : null}<Text style={[styles.helperText, { color: tokens.textMuted }]}>{androidAccess.checking ? 'Checking access…' : androidAccess.pending ? 'Waiting for Android…' : `Notifications ${androidAccess.notifications ? 'available' : 'not granted'} · calls ${androidAccess.callMute ? 'available' : 'not granted'}`}</Text></Panel>
      case 'device': return <Panel title="Appearance and overlay" tokens={tokens}><ColorSelector label="Accent color" detail="Applies across the app." value={accentColor} onChange={setAccentColor} accessibilityLabel="Accent color" trailing={<Pressable onPress={() => { if (themeLongPressed) return; toggleTheme() }} onLongPress={() => { setThemeLongPressed(true); useEinkTheme() }} onPressOut={() => setTimeout(() => setThemeLongPressed(false), 0)} delayLongPress={550} accessibilityRole="button" accessibilityLabel={`Change appearance from ${theme}`} style={[styles.themeButton, { borderColor: tokens.border }]}><LightbulbIcon color={tokens.accent} /></Pressable>} />{floatingAvailable ? <FloatingOverlaySettings state={floatingOverlay} onChange={onFloatingChange} onFeedback={onFeedback} /> : null}</Panel>
      default: return null
    }
  }
  return <View style={styles.section}>{setting(action)}</View>
}

function TrackDetail({ track, durationSeconds, secondPrecision, settings, onPatch, onOpenSound, onDuplicate, onDelete }: {
  track: UnifiedSubBellTrack; durationSeconds: number; secondPrecision: boolean; settings: AppTimerSettings; onPatch: (changes: Partial<UnifiedSubBellTrack>) => void; onOpenSound: () => void; onDuplicate: () => void; onDelete: () => void
}) {
  const { tokens } = useTheme()
  const [panel, setPanel] = useState<'color' | 'offsets' | 'haptics' | 'visibility' | 'random' | 'after' | 'before' | null>(null)
  const [labelDraft, setLabelDraft] = useState(track.label)
  useEffect(() => { setLabelDraft(track.label) }, [track.id, track.label])
  const modes = [
    { id: 'repeat', label: 'Repeat', active: track.repeatEnabled, press: () => onPatch({ repeatEnabled: !track.repeatEnabled }) },
    { id: 'random', label: 'Random', active: !!track.randomRepeat, press: () => { if (track.randomRepeat) { onPatch({ randomRepeat: undefined }); setPanel(null) } else { onPatch({ randomRepeat: { minSeconds: 30, maxSeconds: 60 } }); setPanel('random') } } },
    { id: 'after', label: 'After', active: track.afterStartSeconds !== undefined, press: () => { if (track.afterStartSeconds !== undefined) { onPatch({ afterStartSeconds: undefined }); setPanel(null) } else { onPatch({ afterStartSeconds: Math.max(1, Math.min(30, durationSeconds - 1)) }); setPanel('after') } } },
    { id: 'before', label: 'Before', active: track.beforeEndSeconds !== undefined, press: () => { if (track.beforeEndSeconds !== undefined) { onPatch({ beforeEndSeconds: undefined }); setPanel(null) } else { onPatch({ beforeEndSeconds: Math.max(1, Math.min(30, durationSeconds - 1)) }); setPanel('before') } } },
  ]
  const choosePanel = (value: typeof panel) => setPanel(panel === value ? null : value)
  const inactiveOffsets = track.selectedOffsetsSeconds.filter(offset => offset >= durationSeconds)
  return <View style={styles.trackDetail}>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, zIndex: 30 }}>
      <TextInput accessibilityLabel="Sub-bell name" value={labelDraft} onChangeText={value => { const label = [...value].slice(0, 60).join(''); setLabelDraft(label); if (label.trim()) onPatch({ label }) }} onBlur={() => { const label = labelDraft.trim() || track.label; setLabelDraft(label); if (label !== track.label) onPatch({ label }) }} style={[styles.trackNameInput, { flex: 1, color: tokens.text, borderBottomColor: tokens.accent }]} />
      <OverflowMenu label="Sub-bell actions" items={[{ label: 'Duplicate sub-bell', testID: 'unified-track-duplicate', onPress: onDuplicate }, { label: 'Delete sub-bell', testID: 'unified-track-delete', destructive: true, onPress: onDelete }]} />
    </View>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.trackModes}>{modes.map(mode => <ActionChip key={mode.id} label={mode.label} active={mode.active} tokens={tokens} onPress={mode.press} />)}{([{ id: 'color', label: 'Color' }, { id: 'offsets', label: 'Offsets' }, { id: 'haptics', label: 'Haptics' }, { id: 'visibility', label: 'Watch face' }] as const).map(option => <ActionChip key={option.id} label={option.label} active={panel === option.id} tokens={tokens} onPress={() => choosePanel(option.id)} />)}</ScrollView>
    <Pressable accessibilityRole="button" onPress={onOpenSound} style={[styles.soundSummary, { borderColor: tokens.border }]}><View style={styles.flex}><Text style={[styles.rowTitle, { color: tokens.text }]}>Sound</Text><SoundName cue={track} style={styles.soundName} /></View><Text style={{ color: tokens.accent }}>›</Text></Pressable>
    {track.repeatEnabled ? <DurationSelector label="Repeat every" value={Math.ceil(track.cadenceSeconds / 60)} valueSeconds={track.cadenceSeconds} secondPrecision={secondPrecision || track.cadenceSeconds % 60 !== 0} presets={[1, 2, 3, 5, 10, 15, 20, 30, 60]} minSeconds={1} maxSeconds={MAX_CUE_DURATION_SECONDS} onChange={minutes => onPatch(unifiedTrackCadencePatch(track, durationSeconds, minutes * 60))} onChangeSeconds={cadenceSeconds => onPatch(unifiedTrackCadencePatch(track, durationSeconds, cadenceSeconds))} /> : <Text style={[styles.helperText, { color: tokens.textMuted }]}>One time · repeat interval and selected offsets are retained.</Text>}
    <VolumeControl cue={track} masterVolume={settings.masterVolume} label="Volume" value={track.volume} onChange={volume => onPatch({ volume })} />
    {track.randomRepeat ? <Pressable accessibilityRole="button" accessibilityLabel="Edit random spacing" onPress={() => setPanel('random')} style={styles.inlineLink}><Text style={[styles.helperText, { color: tokens.textMuted }]}>Random gap · {formatCompactDurationSeconds(track.randomRepeat.minSeconds)}–{formatCompactDurationSeconds(track.randomRepeat.maxSeconds)}</Text><Text style={{ color: tokens.accent }}>›</Text></Pressable> : null}
    {track.afterStartSeconds !== undefined ? <Pressable accessibilityRole="button" accessibilityLabel="Edit after start timing" onPress={() => setPanel('after')} style={styles.inlineLink}><Text style={[styles.helperText, { color: tokens.textMuted }]}>After start · {formatCompactDurationSeconds(track.afterStartSeconds)}</Text><Text style={{ color: tokens.accent }}>›</Text></Pressable> : null}
    {track.beforeEndSeconds !== undefined ? <Pressable accessibilityRole="button" accessibilityLabel="Edit before end timing" onPress={() => setPanel('before')} style={styles.inlineLink}><Text style={[styles.helperText, { color: tokens.textMuted }]}>Before end · {formatCompactDurationSeconds(track.beforeEndSeconds)}</Text><Text style={{ color: tokens.accent }}>›</Text></Pressable> : null}
    <DraggableSheet visible={panel !== null} title={panel === 'random' ? 'Random gaps' : panel === 'after' ? 'After start' : panel === 'before' ? 'Before end' : panel === 'color' ? 'Sub-bell color' : panel === 'offsets' ? 'Cue selection' : panel === 'haptics' ? 'Cue vibration' : 'Watch face'} testID="unified-track-option-sheet" presentation="center" initialSnap="partial" partialHeightFraction={0.42} onClose={() => setPanel(null)}>
      {panel === 'random' ? <View style={styles.randomBox}>{track.randomRepeat && track.randomRepeat.minSeconds >= durationSeconds ? <Text style={[styles.helperText, { color: tokens.warm }]}>No random bell fits until this interval is lengthened.</Text> : null}<Text style={[styles.helperText, { color: tokens.textMuted }]}>Gap range · {formatCompactDurationSeconds(track.randomRepeat?.minSeconds ?? 30)}–{formatCompactDurationSeconds(track.randomRepeat?.maxSeconds ?? 60)}</Text><DurationSelector compact label="Shortest gap" value={Math.ceil((track.randomRepeat?.minSeconds ?? 30) / 60)} valueSeconds={track.randomRepeat?.minSeconds ?? 30} secondPrecision minSeconds={5} maxSeconds={MAX_CUE_DURATION_SECONDS} presets={[1, 2, 3, 5, 10]} onChange={minutes => onPatch({ randomRepeat: { minSeconds: Math.max(5, minutes * 60), maxSeconds: Math.max(minutes * 60, track.randomRepeat?.maxSeconds ?? 60) } })} onChangeSeconds={minSeconds => onPatch({ randomRepeat: { minSeconds: Math.max(5, minSeconds), maxSeconds: Math.max(minSeconds, track.randomRepeat?.maxSeconds ?? 60) } })} /><DurationSelector compact label="Longest gap" value={Math.ceil((track.randomRepeat?.maxSeconds ?? 60) / 60)} valueSeconds={track.randomRepeat?.maxSeconds ?? 60} secondPrecision minSeconds={5} maxSeconds={MAX_CUE_DURATION_SECONDS} presets={[1, 2, 3, 5, 10]} onChange={minutes => onPatch({ randomRepeat: { minSeconds: Math.min(track.randomRepeat?.minSeconds ?? 30, minutes * 60), maxSeconds: Math.max(5, minutes * 60) } })} onChangeSeconds={maxSeconds => onPatch({ randomRepeat: { minSeconds: Math.min(track.randomRepeat?.minSeconds ?? 30, maxSeconds), maxSeconds: Math.max(5, maxSeconds) } })} /></View> : null}
      {panel === 'after' ? <MarkerControl label="After start" value={track.afterStartSeconds} durationSeconds={durationSeconds} secondPrecision={secondPrecision} onChange={afterStartSeconds => onPatch({ afterStartSeconds })} /> : null}
      {panel === 'before' ? <MarkerControl label="Before end" value={track.beforeEndSeconds} durationSeconds={durationSeconds} secondPrecision={secondPrecision} onChange={beforeEndSeconds => onPatch({ beforeEndSeconds })} /> : null}
      {panel === 'color' ? <ColorSelector paletteOnly label="" value={normalizeSubBellColor(track.color, 0)} onChange={color => onPatch({ color })} accessibilityLabel={`${track.label} color`} /> : null}
      {panel === 'offsets' ? <OffsetGrid offsets={[...new Set([...unifiedCadenceOffsets(durationSeconds, track.cadenceSeconds).slice(0, MAX_VISIBLE_PATTERN_OFFSETS), ...inactiveOffsets])].sort((a, b) => a - b)} selected={track.selectedOffsetsSeconds} unit="seconds" onChange={selectedOffsetsSeconds => onPatch({ selectedOffsetsSeconds })} /> : null}
      {panel === 'haptics' ? <CueHapticsEditor cue={track} inherited={settings.haptics.subBell} inheritedEnabled={settings.haptics.enabled} onChange={hapticOverride => onPatch({ hapticOverride })} /> : null}
      {panel === 'visibility' ? <View style={styles.row}><View style={styles.flex}><Text style={[styles.rowTitle, { color: tokens.text }]}>Show on watch face</Text><Text style={[styles.helperText, { color: tokens.textMuted }]}>Hidden bells still play and remain in the timeline.</Text></View><Toggle value={track.showOnWatchFace} onChange={showOnWatchFace => onPatch({ showOnWatchFace })} accessibilityLabel="Show sub-bell on watch face" /></View> : null}
    </DraggableSheet>
  </View>
}

function ActionChip({ label, summary, active, tokens, onPress }: { label: string; summary?: string; active: boolean; tokens: ReturnType<typeof useTheme>['tokens']; onPress: () => void }) {
  return <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: active }} aria-pressed={active} style={[styles.actionChip, { borderColor: active ? tokens.accent : tokens.border, backgroundColor: active ? tokens.accentGlow : tokens.surface }]}><Text style={[styles.actionLabel, { color: tokens.text }]}>{label}{summary ? ` · ${summary}` : ''}</Text></Pressable>
}

function TimerControlRail({ singleStep, showGlobal, program, settings, step, cycleDurationSeconds, onProgram, onSettings, onOpenMixer, onCueHaptics, onAlarm }: {
  singleStep: boolean; showGlobal: boolean; program: UnifiedTimerProgram; settings: AppTimerSettings; step: UnifiedTimerStep; cycleDurationSeconds: number;
  onProgram: (changes: Partial<UnifiedTimerProgram>) => void; onSettings: (changes: Partial<AppTimerSettings>) => void; onOpenMixer: () => void; onCueHaptics: (value: CueSettings['hapticOverride']) => void; onAlarm: (enabled: boolean) => void
}) {
  const { tokens } = useTheme()
  const [active, setActive] = useState<ExtraAction | 'volume' | null>(null)
  useEffect(() => {
    if (showGlobal && !singleStep && (active === 'haptics' || active === 'alarm')) setActive(null)
  }, [singleStep, showGlobal, active])
  const actions: Array<ExtraAction | 'volume'> = !showGlobal ? ['volume', 'haptics', 'alarm'] : singleStep ? ['run-length', 'alignment', 'volume', 'haptics', 'alarm'] : ['run-length', 'alignment', 'volume']
  return <View style={styles.section}>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.actionRail} accessibilityLabel="Timer controls">
      {actions.map(action => <ActionChip key={action} label={action === 'run-length' ? 'Run length' : action === 'alignment' ? 'Align to clock' : action === 'volume' ? 'Volume' : action === 'haptics' ? 'Haptics' : 'Alarm'} summary={mainActionSummary(action, program, settings, step.endAlarmEnabled, step.endCue.hapticOverride)} active={active === action} tokens={tokens} onPress={() => action === 'volume' ? onOpenMixer() : setActive(active === action ? null : action)} />)}
    </ScrollView>
    <DraggableSheet visible={active !== null} title={active === 'run-length' ? 'Run length' : active === 'alignment' ? 'Align to clock' : active === 'haptics' ? 'Ending cue vibration' : active === 'alarm' ? 'Step ending alarm' : 'Timer control'} testID="unified-timer-control-sheet" presentation="center" initialSnap="partial" partialHeightFraction={0.42} onClose={() => setActive(null)}>
      {active === 'run-length' ? <RunLengthConfig mode={singleStep ? 'pattern' : 'sequence'} rounds value={program.runPolicy} cycleDurationSeconds={cycleDurationSeconds} secondPrecision={settings.secondPrecisionEnabled} onChange={runPolicy => onProgram({ runPolicy })} /> : null}
      {active === 'alignment' ? <><View style={styles.row}><View style={styles.flex}><Text style={[styles.rowTitle, { color: tokens.text }]}>Align to local clock</Text><Text style={[styles.helperText, { color: tokens.textMuted }]}>{program.alignment.kind === 'local-clock' ? `Offset ${program.alignment.offsetMinutes} min` : 'Start from elapsed time'}</Text></View><Toggle value={program.alignment.kind === 'local-clock'} onChange={enabled => onProgram({ alignment: enabled ? { kind: 'local-clock', offsetMinutes: 0 } : { kind: 'elapsed' } })} accessibilityLabel="Align timer rounds to clock" /></View>{program.alignment.kind === 'local-clock' ? <ClockSnapSelector cycleDurationSeconds={cycleDurationSeconds} value={program.alignment.offsetMinutes} onChange={offsetMinutes => onProgram({ alignment: { kind: 'local-clock', offsetMinutes } })} /> : null}</> : null}
      {(singleStep || !showGlobal) && active === 'haptics' ? <CueHapticsEditor cue={step.endCue} inherited={settings.haptics.main} inheritedEnabled={settings.haptics.enabled} onChange={onCueHaptics} /> : null}
      {(singleStep || !showGlobal) && active === 'alarm' ? <><View style={styles.row}><View style={styles.flex}><Text style={[styles.rowTitle, { color: tokens.text }]}>Alarm after each interval</Text><Text style={[styles.helperText, { color: tokens.textMuted }]}>Keep ringing until dismissed</Text></View><Toggle value={step.endAlarmEnabled} onChange={onAlarm} accessibilityLabel="Alarm after this interval" /></View></> : null}
    </DraggableSheet>
  </View>
}

function mainActionSummary(action: ExtraAction | 'volume', program: UnifiedTimerProgram, settings: AppTimerSettings, alarmEnabled: boolean, hapticOverride?: CueSettings['hapticOverride']): string {
  switch (action) {
    case 'run-length': return program.runPolicy.kind === 'continuous' ? 'Continuous' : program.runPolicy.kind === 'cycles' ? `${program.runPolicy.cycleCount} ${program.runPolicy.cycleCount === 1 ? 'round' : 'rounds'}` : formatCompactDurationSeconds(program.runPolicy.durationSeconds)
    case 'alignment': return program.alignment.kind === 'local-clock' ? `${program.alignment.offsetMinutes}m offset` : 'Off'
    case 'volume': return `${Math.round(settings.masterVolume * 100)}%`
    case 'haptics': return !settings.haptics.enabled || hapticOverride === 'off' ? 'Off' : hapticOverride ? hapticProfileSummary(hapticOverride) : hapticProfileSummary(settings.haptics.main)
    case 'alarm': return alarmEnabled ? 'On' : 'Off'
    default: return ''
  }
}

function UnifiedStepCard({ step, index, itemCount, preview, onPreview, onAutoScroll, onMove, onDuplicate, onDelete, onEdit }: {
  onDelete?: () => void | Promise<void>; onDuplicate?: () => void; step: UnifiedTimerStep; index: number; itemCount: number; preview: ReorderPreview | null;
  onAutoScroll: (pageY: number, earlier: boolean, later: boolean) => number; onPreview: (preview: ReorderPreview | null) => void; onMove: (from: number, to: number) => void; onEdit: () => void
}) {
  const { tokens } = useTheme()
  const reducedMotion = useAppReducedMotion()
  const translation = useSharedValue(0)
  const offset = useSharedValue(0)
  const dragging = preview?.stepId === step.id
  const moveRef = useRef(onMove)
  moveRef.current = onMove
  const commitMove = useCallback((from: number, to: number) => moveRef.current(from, to), [])
  const previewMove = useCallback((from: number, to: number, rowHeight: number) => onPreview({ stepId: step.id, from, to, rowHeight }), [step.id, onPreview])
  const endPreview = useCallback(() => onPreview(null), [onPreview])
  useEffect(() => { const next = preview ? previewOffsetForItem(index, preview.from, preview.to, 142) : 0; offset.value = reducedMotion ? next : withTiming(next, { duration: 150 }) }, [preview, index, reducedMotion])
  const previewActive = preview !== null
  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ translateY: previewActive ? translation.value + offset.value : 0 }] }))
  return <Animated.View testID={`unified-config-step-row-${step.id}`} style={[{ height: 130, zIndex: dragging ? 20 : 0 }, animatedStyle]}>
    <SwipeActionRow testID={`unified-step-swipe-${step.id}`} accessibilityLabel={step.label} onDuplicate={onDuplicate} onDelete={onDelete}>{canPress => <View style={[styles.stepCard, { height: 130, borderColor: dragging ? tokens.accent : tokens.border, backgroundColor: tokens.surface, elevation: dragging ? 8 : 0 }]}>
      <ReorderHandle index={index} itemCount={itemCount} rowHeight={142} rowTranslation={translation} onAutoScroll={onAutoScroll} label={`Reorder ${step.label}`} onMove={commitMove} onPreviewChange={previewMove} onPreviewEnd={endPreview} />
      <Pressable testID={`unified-edit-step-${step.id}`} style={styles.stepCardMain} onPress={() => { if (canPress()) onEdit() }} accessibilityRole="button" accessibilityLabel={`Edit step ${index + 1}, ${step.label}`}>
        <View style={styles.stepCardTop}><Text style={[styles.stepIndex, { color: tokens.accent }]}>{String(index + 1).padStart(2, '0')}</Text><Text numberOfLines={1} style={[styles.stepCardTitle, { color: tokens.text }]}>{step.label}</Text><Text style={[styles.stepCardDuration, { color: tokens.text }]}>{formatCompactDurationSeconds(step.durationSeconds)}</Text></View>
        <View style={styles.stepSoundLine}><BellIcon on color={tokens.accent} /><SoundName cue={step.endCue} style={styles.helperText} /><Text style={[styles.helperText, { color: tokens.textMuted }]}>· {step.subBellTracks.length} sub-bells</Text></View>
        <PatternTimelinePreview tracks={asPatternTracks(step.subBellsEnabled ? step.subBellTracks : [])} mainDurationSeconds={step.durationSeconds} />
      </Pressable>
    </View>}</SwipeActionRow>
  </Animated.View>
}

function OverflowMenu({ label, items }: { label: string; items: Array<{ label: string; onPress: () => void; disabled?: boolean; destructive?: boolean; testID?: string }> }) {
  const { tokens } = useTheme()
  const { width, height } = useWindowDimensions()
  const anchor = useRef<View>(null)
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null)
  const close = () => setPosition(null)
  return <>
    <Pressable ref={anchor} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ expanded: position !== null }} onPress={() => anchor.current?.measureInWindow((x, y, w, h) => setPosition({ left: Math.max(12, Math.min(width - 202, x + w - 190)), top: Math.max(12, Math.min(height - items.length * 44 - 24, y + h + 4)) }))} style={[styles.iconButton, { borderColor: tokens.border }]}><OverflowIcon color={tokens.text} /></Pressable>
    <Modal visible={position !== null} transparent animationType="none" onRequestClose={close}>
      <View style={StyleSheet.absoluteFill}>
        <Pressable style={StyleSheet.absoluteFill} accessibilityRole="button" accessibilityLabel={`Close ${label}`} onPress={close} />
        {position ? <View accessibilityViewIsModal style={{ position: 'absolute', ...position, width: 190, padding: 6, borderWidth: 1, borderRadius: 12, borderColor: tokens.border, backgroundColor: tokens.surfaceHi, elevation: 10 }}>{items.map(item => <Pressable key={item.label} testID={item.testID} accessibilityRole="button" disabled={item.disabled} onPress={() => { close(); item.onPress() }} style={{ minHeight: 44, paddingHorizontal: 12, justifyContent: 'center', opacity: item.disabled ? 0.4 : 1 }}><Text style={{ color: item.destructive ? tokens.warm : tokens.text }}>{item.label}</Text></Pressable>)}</View> : null}
      </View>
    </Modal>
  </>
}

function settingsDetail(action: ExtraAction, settings: AppTimerSettings, program: UnifiedTimerProgram, availability: AvailabilityPolicy): string {
  switch (action) {
    case 'alignment': return program.alignment.kind === 'local-clock' ? 'Aligned to local clock' : 'Elapsed from start'
    case 'run-length': return program.runPolicy.kind === 'continuous' ? 'Runs continuously' : program.runPolicy.kind === 'cycles' ? `${program.runPolicy.cycleCount} ${program.runPolicy.cycleCount === 1 ? 'round' : 'rounds'}` : 'Stops after a duration'
    case 'schedule': return availability.enabled ? 'Schedule enabled' : 'No active schedule'
    case 'haptics': return settings.haptics.enabled ? 'Haptics enabled' : 'Haptics off'
    case 'alarm': return `${program.alarmBehavior === 'locked' ? 'Locked alarm' : program.alarmBehavior === 'once' ? 'Alarm once' : 'Alarm off'} · ${settings.alarmDurationSeconds}s`
    case 'focus': return settings.focusAutomationEnabled ? 'Enabled' : 'Off'
    case 'notifications': return settings.notificationsEnabled ? 'Enabled' : 'Off'
    case 'calls': return settings.muteDuringCallsEnabled ? 'Mute during calls' : 'Play during calls'
    case 'precision': return settings.secondPrecisionEnabled ? 'Exact seconds' : 'Minute controls'
    case 'running-controls': return settings.advancedModeEnabled ? 'All controls shown' : 'Compact controls'
    case 'system': return 'Permissions and device access'
    case 'device': return 'Theme and floating timer'
  }
}

function MarkerControl({ value, durationSeconds, secondPrecision, onChange }: { label: string; value?: number; durationSeconds: number; secondPrecision: boolean; onChange: (value: number | undefined) => void }) {
  const { tokens } = useTheme()
  const inactive = value !== undefined && value >= durationSeconds
  return <View style={styles.markerBox}>
    {inactive ? <Text style={[styles.helperText, { color: tokens.warm }]}>{formatCompactDurationSeconds(value!)} · inactive until step is lengthened</Text> : null}
    {value !== undefined ? <DurationSelector value={Math.ceil(value / 60)} valueSeconds={value} secondPrecision={secondPrecision || value % 60 !== 0} presets={[1, 2, 3, 5, 10]} minSeconds={1} maxSeconds={MAX_CUE_DURATION_SECONDS} onChange={minutes => onChange(minutes * 60)} onChangeSeconds={onChange} /> : null}
  </View>
}

function HapticsPanel({ value, onChange }: { value: AppTimerSettings['haptics']; onChange: (value: AppTimerSettings['haptics']) => void }) {
  const { tokens } = useTheme()
  const patch = (key: 'main' | 'subBell' | 'alarm', profile: HapticProfile) => onChange({ ...value, [key]: profile })
  return <Panel title="Vibration" tokens={tokens}>
    <View style={styles.row}><View style={styles.flex}><Text style={[styles.rowTitle, { color: tokens.text }]}>Use haptics</Text><Text style={[styles.helperText, { color: tokens.textMuted }]}>Cue, alarm and app feedback</Text></View><Toggle value={value.enabled} onChange={enabled => onChange({ ...value, enabled })} accessibilityLabel="Use haptics" /></View>
    {(['main', 'subBell', 'alarm'] as const).map(key => <View key={key} style={styles.profileBox}><Text style={[styles.rowTitle, { color: tokens.text }]}>{key === 'main' ? 'Main cues' : key === 'subBell' ? 'Sub-bells' : 'Alarms'}</Text><Text style={[styles.helperText, { color: tokens.textMuted }]}>{hapticProfileSummary(value[key])}</Text><SegmentedControl items={HAPTIC_PATTERNS} value={value[key].pattern} onChange={pattern => patch(key, { ...value[key], pattern })} accessibilityLabel={`${key} haptic pattern`} /><SegmentedControl items={HAPTIC_STRENGTHS} value={value[key].strength} onChange={strength => patch(key, { ...value[key], strength })} accessibilityLabel={`${key} haptic strength`} /><Pressable accessibilityRole="button" accessibilityLabel={`Preview ${key} haptic profile`} onPress={() => void previewHapticProfile(value[key])} style={[styles.iconButton, { alignSelf: 'flex-start', borderColor: tokens.border }]}><TimerTransportIcon kind="play" color={tokens.accent} /></Pressable></View>)}
  </Panel>
}

function CueHapticsEditor({ cue, inherited, inheritedEnabled, onChange }: { cue: CueSettings; inherited: HapticProfile; inheritedEnabled: boolean; onChange: (value: CueSettings['hapticOverride']) => void }) {
  const { tokens } = useTheme()
  const current = cue.hapticOverride === undefined ? 'default' : cue.hapticOverride === 'off' ? 'off' : 'custom'
  const profile = cue.hapticOverride && cue.hapticOverride !== 'off' ? cue.hapticOverride : inherited
  return <View style={styles.markerBox}><SegmentedControl items={[{ value: 'default', label: 'Default' }, { value: 'custom', label: 'Custom' }, { value: 'off', label: 'Off' }]} value={current} onChange={mode => onChange(mode === 'default' ? undefined : mode === 'off' ? 'off' : profile)} accessibilityLabel="Cue vibration mode" />{current === 'default' ? <Text style={[styles.helperText, { color: tokens.textMuted }]}>{inheritedEnabled ? `Using ${hapticProfileSummary(inherited)}` : 'Default haptics are off'}</Text> : null}{current === 'custom' ? <><SegmentedControl items={HAPTIC_PATTERNS} value={profile.pattern} onChange={pattern => { const next = { ...profile, pattern }; onChange(next); void previewHapticProfile(next) }} accessibilityLabel="Cue haptic pattern" /><SegmentedControl items={HAPTIC_STRENGTHS} value={profile.strength} onChange={strength => { const next = { ...profile, strength }; onChange(next); void previewHapticProfile(next) }} accessibilityLabel="Cue haptic strength" /><Pressable accessibilityRole="button" accessibilityLabel="Preview cue vibration" onPress={() => void previewHapticProfile(profile)} style={[styles.iconButton, { alignSelf: 'flex-start', borderColor: tokens.border }]}><TimerTransportIcon kind="play" color={tokens.accent} /></Pressable></> : null}</View>
}

function ConfigPreview({ program }: { program: UnifiedTimerProgram }) {
  const { tokens } = useTheme()
  return <View style={{ gap: 8 }}>{program.steps.map((step, index) => <View key={step.id} style={{ gap: 2 }}><View style={styles.row}><Text numberOfLines={1} style={[styles.helperText, styles.flex, { color: tokens.text }]}>{program.steps.length > 1 ? `${index + 1}. ${step.label}` : soundTitle(step.endCue.sound)}</Text><Text style={[styles.helperText, { color: tokens.textMuted }]}>{formatCompactDurationSeconds(step.durationSeconds)}</Text></View><PatternTimelinePreview tracks={asPatternTracks(step.subBellsEnabled ? step.subBellTracks : [])} mainDurationSeconds={step.durationSeconds} /></View>)}</View>
}

function ConfigCard({ config, draft, renameValue, onRenameChange, onRename, onSelect, onDuplicate, onDelete, onVisibility, onExport, transferBusy }: {
  config: UnifiedTimerConfig; draft?: UnifiedTimerDraft; renameValue: string; onRenameChange: (value: string) => void; onRename: () => void; onSelect: () => void; onDuplicate: () => void;
  onDelete: () => void | Promise<void>; onVisibility: (value: boolean) => void; onExport: () => void; transferBusy: boolean
}) {
  const { tokens } = useTheme()
  const [renaming, setRenaming] = useState(false)
  const preview = draft?.program ?? config.program
  return <View style={[styles.configCard, { borderColor: tokens.border, backgroundColor: tokens.surface }]}>
    <View style={[styles.row, { zIndex: 5 }]}><Pressable onPress={onSelect} accessibilityRole="button" accessibilityLabel={`Switch to ${config.name}`} style={[styles.configTitle, styles.flex]}><Text style={[styles.rowTitle, { color: tokens.text }]}>{config.name}</Text><Text style={[styles.helperText, { color: tokens.textMuted }]}>{preview.steps.length} {preview.steps.length === 1 ? 'step' : 'steps'} · {formatCompactDurationSeconds(preview.steps.reduce((sum, step) => sum + step.durationSeconds, 0))}{draft?.dirty ? ' · Unsaved edits' : ''}</Text></Pressable><OverflowMenu label={`Options for ${config.name}`} items={[{ label: 'Rename', onPress: () => setRenaming(!renaming) }, { label: 'Duplicate', onPress: onDuplicate }, { label: `${config.showInRunningSelector ? '✓ ' : ''}Available while running`, onPress: () => onVisibility(!config.showInRunningSelector) }, { label: 'Export', disabled: transferBusy, onPress: onExport }, { label: 'Delete', destructive: true, onPress: () => void onDelete() }]} /></View>
    <Pressable onPress={onSelect} accessibilityRole="button" accessibilityLabel={`Open ${config.name} timeline`}><ConfigPreview program={preview} /></Pressable>
    {renaming ? <View style={styles.row}><TextInput value={renameValue} onChangeText={onRenameChange} placeholder="Rename configuration" placeholderTextColor={tokens.textMuted} style={[styles.input, styles.flex, { borderColor: tokens.border, color: tokens.text }]} accessibilityLabel={`Rename ${config.name}`} /><Pressable accessibilityRole="button" accessibilityLabel="Save name" onPress={() => { onRename(); setRenaming(false) }} style={[styles.iconButton, { borderColor: tokens.border }]}><CheckIcon color={tokens.accent} /></Pressable></View> : null}

  </View>
}

function FloatingOverlaySettings({ state, onChange, onFeedback }: { state: ReturnType<typeof ChandasTimerService.getFloatingOverlayState>; onChange: (value: ReturnType<typeof ChandasTimerService.getFloatingOverlayState>) => void; onFeedback: UnifiedTimerConfigScreenProps['onFeedback'] }) {
  const { tokens } = useTheme()
  return <View style={styles.profileBox}>
    <View style={styles.row}><View style={styles.flex}><Text style={[styles.rowTitle, { color: tokens.text }]}>Floating timer</Text><Text style={[styles.helperText, { color: tokens.textMuted }]}>{state.permissionGranted ? 'Permission available' : state.requested ? 'Display permission is needed' : 'Device preference'}</Text></View><Toggle value={state.requested} onChange={enabled => { ChandasTimerService.setFloatingOverlayRequested(enabled); const next = ChandasTimerService.getFloatingOverlayState(); onChange(next); if (enabled && !next.permissionGranted) ChandasTimerService.openFloatingOverlaySettings() }} accessibilityLabel="Floating timer" /></View>
    <Pressable accessibilityRole="button" accessibilityLabel={`Widget appearance, ${state.appearance ?? 'System'}`} onPress={() => {
      const current = state.appearance ?? 'system'
      const appearance = current === 'system' ? 'dark' : current === 'dark' ? 'light' : 'system'
      ChandasTimerService.setFloatingOverlayAppearance(appearance)
      onChange({ ...state, appearance })
      onFeedback({ title: `Widget appearance: ${appearance}`, tone: 'success' })
    }} style={[styles.settingsRow, { borderColor: tokens.border }]}><View style={styles.flex}><Text style={[styles.rowTitle, { color: tokens.text }]}>Widget appearance</Text><Text style={[styles.helperText, { color: tokens.textMuted }]}>{state.appearance ?? 'System'}</Text></View><Text style={{ color: tokens.accent }}>›</Text></Pressable>
    {state.requested && !state.permissionGranted ? <Pressable accessibilityRole="button" accessibilityLabel="Open display permission settings" onPress={ChandasTimerService.openFloatingOverlaySettings} style={[styles.settingsRow, { borderColor: tokens.border }]}><View style={styles.flex}><Text style={[styles.rowTitle, { color: tokens.text }]}>Display permission</Text><Text style={[styles.helperText, { color: tokens.warm }]}>Open settings</Text></View><Text style={{ color: tokens.accent }}>›</Text></Pressable> : null}
    <Pressable accessibilityRole="button" accessibilityLabel={state.permissionGranted ? 'Preview floating timer' : 'Allow and preview floating timer'} onPress={() => state.permissionGranted ? ChandasTimerService.previewFloatingOverlay() : ChandasTimerService.openFloatingOverlaySettings()} style={[styles.row, { justifyContent: 'flex-end' }]}><View style={[styles.iconButton, { borderColor: tokens.border }]}><TimerTransportIcon kind="play" color={tokens.accent} /></View></Pressable>
  </View>
}

function Panel({ title, tokens, children }: { title: string; tokens: ReturnType<typeof useTheme>['tokens']; children: React.ReactNode }) {
  return <View style={styles.panel}>{children}</View>
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
  screen: { flex: 1 }, closedSummary: { flex: 1, paddingHorizontal: 24, justifyContent: 'center', gap: 16 }, pinned: { paddingHorizontal: 20, gap: 10 }, nameLine: { flexDirection: 'row', alignItems: 'center', gap: 8 }, currentName: { flex: 1, minWidth: 0, minHeight: 46, justifyContent: 'center', gap: 2 }, currentNameText: { fontSize: 22, fontWeight: '500' }, nameInput: { flex: 1, minWidth: 0, minHeight: 45, borderBottomWidth: 2, fontSize: 22, fontWeight: '500', paddingHorizontal: 2 }, namePicker: { minWidth: 44, minHeight: 44, borderWidth: 1.5, borderRadius: 22, alignItems: 'center', justifyContent: 'center' }, saveRow: { flexDirection: 'row', alignItems: 'center', gap: 6 }, statusSlot: { flex: 1, alignItems: 'flex-end' }, status: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase' }, footer: { paddingHorizontal: 20, paddingTop: 10, gap: 7 }, startButton: { minHeight: 52, borderWidth: 1, borderRadius: 18, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 10 }, startText: { fontSize: 17, fontWeight: '700' }, noticeText: { textAlign: 'center', fontSize: 12 }, section: { gap: 12 }, sectionTitle: { fontSize: 17, fontWeight: '700' }, helperText: { fontSize: 12, lineHeight: 17 }, copyText: { fontSize: 14, lineHeight: 21 }, rowTitle: { fontSize: 14, fontWeight: '600' }, row: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }, flex: { flex: 1, minWidth: 0 }, stepRow: { borderWidth: 1, borderRadius: 14, minHeight: 62, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 6 }, stepSummary: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 50 }, stepIndex: { fontSize: 13, fontWeight: '800', fontVariant: ['tabular-nums'] }, stepName: { fontSize: 14, fontWeight: '700' }, stepActions: { flexDirection: 'row', gap: 4 }, miniButton: { width: 36, height: 36, borderWidth: 1, borderRadius: 18, alignItems: 'center', justifyContent: 'center' }, buttonRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 }, stepEditor: { gap: 10 }, input: { minHeight: 44, borderWidth: 1.5, borderRadius: 12, paddingHorizontal: 12, fontSize: 15 }, cueRow: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 12 }, masterRow: { flexDirection: 'row', alignItems: 'center', gap: 12 }, slider: { flex: 1, height: 40 }, sliderRow: { gap: 4 }, actionBlock: { borderTopWidth: 1, paddingTop: 10, gap: 8 }, actionRail: { gap: 8, paddingVertical: 3, paddingRight: 24 }, trackOptionRail: { gap: 6, paddingVertical: 3, paddingRight: 20 }, actionChip: { minHeight: 38, borderWidth: 1.5, borderRadius: 22, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center' }, actionLabel: { fontSize: 12, fontWeight: '600' }, preview: { borderWidth: 1, borderRadius: 12, padding: 10 }, panel: { gap: 12 }, trackCard: { borderWidth: 1, borderRadius: 14, padding: 12, gap: 10 }, trackControls: { gap: 12 }, markerBox: { gap: 8 }, inlineFields: { gap: 10 }, eyeButton: { minWidth: 40, minHeight: 40, borderWidth: 1, borderRadius: 22, alignItems: 'center', justifyContent: 'center' }, profileBox: { gap: 8 }, themeButton: { minHeight: 42, minWidth: 44, borderWidth: 1, borderRadius: 22, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10 }, notice: { borderWidth: 1.5, borderRadius: 16, padding: 14, gap: 8 }, configCard: { borderWidth: 1, borderRadius: 16, padding: 12, gap: 8 }, configTitle: { minHeight: 50, justifyContent: 'center', gap: 4 }, cardActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 }, statusText: { fontSize: 11 }, markerValue: { fontSize: 12 },
  setupPage: { paddingHorizontal: 20, gap: 20 }, topBar: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 10 }, nameEdit: { flex: 1, minWidth: 0, justifyContent: 'center', gap: 2 }, pageTitle: { fontSize: 21, fontWeight: '600' }, topActions: { flexDirection: 'row', gap: 8 }, iconButton: { width: 42, height: 42, borderWidth: 1, borderRadius: 21, alignItems: 'center', justifyContent: 'center' }, saveButton: { minWidth: 60, height: 42, borderWidth: 1, borderRadius: 21, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 }, overflowGlyph: { fontSize: 16, fontWeight: '800', letterSpacing: 1 }, mainTimerCard: { borderWidth: 1, borderRadius: 18, padding: 16, gap: 12 }, mainTimerFlat: { gap: 10 }, mainIntervalLabel: { fontSize: 16, fontWeight: '600' }, eyebrow: { fontSize: 11, letterSpacing: 1.2, fontWeight: '700' }, durationHero: { fontSize: 42, fontWeight: '500', fontVariant: ['tabular-nums'] }, soundSummary: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 12, paddingTop: 8 }, soundLeading: { fontSize: 21, width: 28, textAlign: 'center' }, soundName: { fontSize: 12, lineHeight: 17 }, subBellSummary: { borderWidth: 1, borderRadius: 16, padding: 12, gap: 10 }, subBellHeader: { minHeight: 42, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }, inlineLink: { minHeight: 36, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, stepCard: { minHeight: 130, borderWidth: 1, borderRadius: 16, paddingHorizontal: 10, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', gap: 8 }, stepCardMain: { flex: 1, minWidth: 0, gap: 7 }, stepCardTop: { flexDirection: 'row', alignItems: 'center', gap: 9 }, stepCardTitle: { flex: 1, fontSize: 15, fontWeight: '700' }, stepCardDuration: { fontSize: 15, fontWeight: '700', fontVariant: ['tabular-nums'] }, stepSoundLine: { flexDirection: 'row', alignItems: 'center', gap: 6 }, stepCardActions: { gap: 4 }, sortableSteps: { overflow: 'hidden' }, sortableStepsScroll: { flex: 1 }, sortableStepsContent: { paddingHorizontal: 0 }, sortableStepItem: { width: '100%' }, stepHandle: { alignSelf: 'stretch', justifyContent: 'center' }, stepHandlePressable: { width: 32, minHeight: 52, alignItems: 'center', justifyContent: 'center' }, stepHandleGlyph: { fontSize: 20, lineHeight: 24 }, mainActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, secondaryButton: { minHeight: 44, borderWidth: 1, borderRadius: 14, paddingHorizontal: 14, justifyContent: 'center', alignItems: 'center' }, secondaryLine: { minHeight: 36, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, controlPanel: { borderWidth: 1, borderRadius: 15, padding: 12, gap: 12 }, stepRailSection: { gap: 10, paddingVertical: 5 }, startDock: { borderTopWidth: 1, paddingTop: 10, paddingHorizontal: 18 }, settingsMenu: { gap: 6 }, settingsRow: { minHeight: 58, borderBottomWidth: 1, flexDirection: 'row', alignItems: 'center', paddingVertical: 8, gap: 12 }, sectionHeading: { flexDirection: 'row', alignItems: 'center', gap: 10 }, backButton: { width: 36, height: 36, borderWidth: 1, borderRadius: 18, alignItems: 'center', justifyContent: 'center' }, trackListRow: { minHeight: 62, borderWidth: 1, borderRadius: 13, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 10 }, trackListEdit: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 60 }, trackDot: { width: 9, height: 9, borderRadius: 5 }, trackDetail: { gap: 12 }, trackNameInput: { minHeight: 38, borderBottomWidth: 1.5, fontSize: 22, fontWeight: '500', paddingHorizontal: 1 }, trackModes: { gap: 7, paddingVertical: 3, paddingRight: 24 }, trackOptions: { gap: 6, paddingVertical: 3, paddingRight: 20 }, randomBox: { gap: 8 },
})

