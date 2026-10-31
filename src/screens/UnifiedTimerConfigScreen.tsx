import { useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, Keyboard, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import Slider from '@react-native-community/slider'
import type { AppTimerSettings, CueSettings, HapticProfile, SoundRef, UnifiedSubBellTrack, UnifiedTimerProgram, UnifiedTimerStep } from '../types'
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
import { SegmentedControl } from '../components/timer-v2/SegmentedControl'
import { SheetTextButton } from '../components/timer-v2/SheetTextButton'
import { GentleNotice, type AppNotice } from '../components/timer-v2/experience-feedback'
import { useConfirmation } from '../components/timer-v2/ConfirmationDialog'
import { useTheme, useAppReducedMotion } from '../theme/ThemeContext'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { createProgramId, defaultAppTimerSettings, defaultPatternLabel, MAX_CUE_DURATION_SECONDS, MAX_PATTERN_TRACKS, MAX_SEQUENCE_STEPS, MAX_VISIBLE_PATTERN_OFFSETS, formatCompactDurationSeconds } from '../lib/timerV2'
import { hapticProfileSummary, HAPTIC_PATTERNS, HAPTIC_STRENGTHS } from '../lib/haptic-profiles'
import { previewHapticProfile, setAppHapticsEnabled, tapHaptic } from '../lib/haptics'
import { normalizeSubBellColor } from '../lib/subBellColors'
import { soundTitle } from '../lib/soundLibrary'
import { EyeIcon } from '../components/Icons'
import { parseUnifiedConfigurationTransfer, serializeUnifiedConfiguration } from '../lib/unified-configuration-transfer'
import { copyConfigurationText, pickConfigurationText, readConfigurationTextFromClipboard, saveConfigurationFile } from '../lib/configuration-transfer-io'
import { configurationTransferFilename } from '../lib/configuration-transfer'
import { UNNAMED_DRAFT_KEY, type ConfigStateCommand, type UnifiedConfigState, type UnifiedTimerConfig, type UnifiedTimerDraft } from '../lib/unified-config-state'
import { nextProgramEvent, runEndAt } from '../lib/timeline'
import { programEventLabel } from '../lib/upcoming-events'
import { useKeyboardVisible } from '../hooks/use-keyboard-visible'

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

type ExtraAction = 'alignment' | 'run-length' | 'schedule' | 'haptics' | 'alarm' | 'focus' | 'notifications' | 'calls' | 'precision' | 'system' | 'device'
type CueTarget = { kind: 'step-end'; stepId: string } | { kind: 'track'; stepId: string; trackId: string } | { kind: 'alarm' } | { kind: 'completion' }
type ModalKind = 'picker' | 'switch' | 'save-as' | null
const ACTIONS: ReadonlyArray<{ id: ExtraAction; label: string }> = [
  { id: 'alignment', label: 'Clock alignment' }, { id: 'run-length', label: 'Run length' },
  { id: 'schedule', label: 'Schedule' }, { id: 'haptics', label: 'Haptics' },
  { id: 'alarm', label: 'Alarm settings' }, { id: 'focus', label: 'Focus' },
  { id: 'notifications', label: 'Notifications' }, { id: 'calls', label: 'Call mute' },
  { id: 'precision', label: 'Seconds' }, { id: 'system', label: 'System access' }, { id: 'device', label: 'Device appearance' },
]
const DURATION_PRESETS = [1, 2, 3, 5, 10, 15, 20, 25, 30, 45, 60, 90, 120] as const
const own = (object: object, key: PropertyKey) => Object.prototype.hasOwnProperty.call(object, key)

export function UnifiedTimerConfigScreen({ state, onCommand, onStart, starting, focusState, onFocusAutomationChange, onOpenFocusSettings, onOpenFocusRuleSettings, androidAccess, onOpenExactAlarmSettings, onOpenFullScreenIntentSettings, onRequestCallMuteAccess, onRequestNotificationAccess, onFeedback }: UnifiedTimerConfigScreenProps) {
  const { tokens, theme, toggleTheme, useEinkTheme, accentColor, setAccentColor } = useTheme()
  const insets = useSafeAreaInsets()
  const keyboardVisible = useKeyboardVisible()
  const reducedMotion = useAppReducedMotion()
  const confirm = useConfirmation()
  const [modal, setModal] = useState<ModalKind>(null)
  const [sheetOpen, setSheetOpen] = useState(true)
  const [queuedConfigId, setQueuedConfigId] = useState<string | null>(null)
  const [saveAsForSwitch, setSaveAsForSwitch] = useState(false)
  const [saveAsName, setSaveAsName] = useState('')
  const [renameValues, setRenameValues] = useState<Record<string, string>>({})
  const [cueTarget, setCueTarget] = useState<CueTarget | null>(null)
  const [activeStepId, setActiveStepId] = useState<string | null>(null)
  const [transferBusy, setTransferBusy] = useState(false)
  const [commandPending, setCommandPending] = useState(false)
  const commandPendingRef = useRef(false)
  const [floatingOverlay, setFloatingOverlay] = useState(() => ChandasTimerService.getFloatingOverlayState())
  const [themeLongPressed, setThemeLongPressed] = useState(false)
  const [draftName, setDraftName] = useState('')
  const [renameCurrent, setRenameCurrent] = useState(false)
  const currentKey = state.selectedConfigId ?? UNNAMED_DRAFT_KEY
  const draft = own(state.drafts, currentKey) ? state.drafts[currentKey] : undefined
  const selectedConfig = state.configs.find(config => config.id === state.selectedConfigId)
  const program = draft?.program
  const activeStep = program?.steps.find(step => step.id === activeStepId) ?? program?.steps[0]
  const capabilities = ChandasTimerService.getCapabilities()
  const nativeSchemaReady = Platform.OS !== 'android' || !isNativeServiceAvailable || (capabilities?.programSchemaMax ?? 0) >= 4
  const soundPickerCue = cueTarget ? getCue(draft, cueTarget) : null
  const floatingAvailable = capabilities?.supportsFloatingOverlay === true
  const enabledActions = useMemo(() => new Set<ExtraAction>([
    ...(draft?.editorOptions.enabledActionIds.filter((id): id is ExtraAction => ACTIONS.some(action => action.id === id)) ?? []),
    ...inferConfiguredActions(draft),
  ]), [draft, state])
  const mainVisible = sheetOpen && modal === null && cueTarget === null

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
  const switchTo = (configId: string | null) => {
    if (configId === state.selectedConfigId) { setModal(null); return }
    if (draft.dirty) { setQueuedConfigId(configId); setSaveAsForSwitch(false); setModal('switch'); return }
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
      setModal(null)
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
  const toggleAction = (action: ExtraAction) => {
    const next = new Set(draft.editorOptions.enabledActionIds)
    next.has(action) ? next.delete(action) : next.add(action)
    edit({ editorOptions: { enabledActionIds: [...next] } })
  }
  const addStep = () => {
    if (program.steps.length >= MAX_SEQUENCE_STEPS) return
    const step: UnifiedTimerStep = {
      id: createProgramId(), label: `Step ${program.steps.length + 1}`, durationSeconds: 300,
      endCue: cloneCue(program.steps.at(-1)!.endCue), endAlarmEnabled: false, subBellsEnabled: false, subBellTracks: [],
    }
    patchProgram({ steps: [...program.steps, step] })
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
    patchProgram({ steps })
    setActiveStepId(steps[0]?.id ?? null)
  }
  const moveStep = (stepId: string, direction: -1 | 1) => {
    const index = program.steps.findIndex(step => step.id === stepId)
    const target = index + direction
    if (target < 0 || target >= program.steps.length) return
    const steps = [...program.steps]
    ;[steps[index], steps[target]] = [steps[target]!, steps[index]!]
    patchProgram({ steps })
  }
  const patchCue = (patch: Partial<CueSettings>) => {
    if (!cueTarget) return
    if (cueTarget.kind === 'alarm') patchSettings({ ...(patch.sound ? { alarmSound: patch.sound } : {}), ...(typeof patch.volume === 'number' ? { alarmVolume: patch.volume } : {}) })
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
      await copyConfigurationText(serializeUnifiedConfiguration(config))
      await saveConfigurationFile(configurationTransferFilename(config.name), serializeUnifiedConfiguration(config))
      onFeedback({ title: 'Configuration exported', message: `“${config.name}” is ready to share or save.`, tone: 'success' })
    } catch {
      onFeedback({ title: 'Could not export configuration', message: 'The setup remains saved. Try again in a moment.', tone: 'attention' })
    } finally { setTransferBusy(false) }
  }
  const cycleDurationSeconds = program.steps.reduce((sum, step) => sum + step.durationSeconds, 0)
  const alignmentValue = program.alignment.kind === 'local-clock' ? program.alignment.offsetMinutes : null
  const previewAnchor = Date.now()
  const previewTerminal = runEndAt(program, previewAnchor, previewAnchor)
  const previewEvent = nextProgramEvent(program, previewAnchor, previewAnchor, previewAnchor, previewTerminal)

  return <KeyboardAvoidingView testID="unified-config-screen" style={[styles.screen, { backgroundColor: tokens.bg }]} behavior={Platform.OS === 'ios' ? 'padding' : Platform.OS === 'android' ? 'height' : undefined}>
    {!sheetOpen ? <View style={[styles.closedSummary, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]}><Text style={[styles.sectionTitle, { color: tokens.text }]}>{draft.name}</Text><Text style={[styles.helperText, { color: tokens.textMuted }]}>{program.steps.length} steps · {draft.dirty ? 'Draft changes saved' : 'Saved configuration'}</Text><SheetTextButton label="Continue editing" onPress={() => setSheetOpen(true)} /><Pressable testID="unified-config-start" disabled={!nativeSchemaReady || starting} onPress={() => { tapHaptic(); onStart() }} style={[styles.startButton, { backgroundColor: tokens.accent, opacity: !nativeSchemaReady || starting ? 0.5 : 1 }]}><Text style={[styles.startText, { color: '#fff' }]}>{starting ? 'Starting timer…' : 'Start timer'}</Text></Pressable></View> : null}
    <DraggableSheet visible={mainVisible} title="Timer setup" testID="unified-config-main-sheet" initialSnap="full" onClose={() => { Keyboard.dismiss(); setSheetOpen(false) }} pinnedContent={<View style={[styles.pinned, { borderColor: tokens.border, paddingTop: insets.top > 0 ? 2 : 0 }]}>
      <View style={styles.nameLine}>
        {renameCurrent ? <TextInput testID="unified-config-name" accessibilityLabel="Timer configuration name" value={draftName} onChangeText={value => { const next = [...value].slice(0, 80).join(''); setDraftName(next); if (next.trim()) edit({ name: next }) }} onBlur={() => { const name = draftName.trim() || draft.name; setDraftName(name); edit({ name }); setRenameCurrent(false) }} placeholder="Name this timer" placeholderTextColor={tokens.textMuted} style={[styles.nameInput, { color: tokens.text, borderBottomColor: tokens.accent }]} returnKeyType="done" /> : <Pressable testID="unified-config-name" accessibilityLabel={`Choose configuration, current ${draft.name}`} accessibilityRole="button" onPress={() => setModal('picker')} style={styles.currentName}><Text numberOfLines={1} style={[styles.currentNameText, { color: tokens.text }]}>{draft.name}</Text><Text style={[styles.helperText, { color: tokens.textMuted }]}>{selectedConfig ? 'Saved configuration' : 'Unnamed draft'}</Text></Pressable>}
        <SheetTextButton label={renameCurrent ? 'Done' : 'Rename'} onPress={() => setRenameCurrent(value => !value)} />
        <Pressable testID="unified-config-picker" onPress={() => setModal('picker')} accessibilityRole="button" accessibilityLabel="Open configuration picker" style={[styles.namePicker, { borderColor: tokens.border }]}><Text style={{ color: tokens.accent, fontSize: 20 }}>⌄</Text></Pressable>
      </View>
      <View style={styles.saveRow}>
        {selectedConfig ? <SheetTextButton testID="unified-config-save" disabled={!draft.dirty || commandPending} label={commandPending ? 'Saving…' : 'Save'} onPress={() => { void performCommand({ type: 'save' }) }} /> : <SheetTextButton testID="unified-config-save" label="Save as" onPress={() => { setSaveAsName(draft.name === 'New timer' ? '' : draft.name); setModal('save-as') }} />}
        <SheetTextButton testID="unified-config-save-as" label="Save as" onPress={() => { setSaveAsName(draft.name === 'New timer' ? '' : `${draft.name} copy`); setModal('save-as') }} />
        <View style={styles.statusSlot}><Text accessibilityLabel={draft.dirty ? 'Unsaved changes' : 'Saved'} style={[styles.status, { color: draft.dirty ? tokens.warm : tokens.textMuted }]}>{draft.dirty ? 'Draft' : 'Saved'}</Text></View>
      </View>
    </View>} footer={<View style={[styles.footer, { paddingBottom: keyboardVisible ? 8 : Math.max(insets.bottom, 12), borderColor: tokens.border }]}>
      {!nativeSchemaReady ? <Text style={[styles.noticeText, { color: tokens.warm }]}>Update Chandas to start this timer.</Text> : null}
      <Pressable testID="unified-config-start" disabled={!nativeSchemaReady || starting} onPress={() => { tapHaptic(); onStart() }} accessibilityRole="button" accessibilityState={{ disabled: !nativeSchemaReady || starting, busy: starting }} style={({ pressed }) => [styles.startButton, { backgroundColor: theme === 'eink' ? tokens.surface : tokens.accent, borderColor: tokens.border, opacity: !nativeSchemaReady || starting ? 0.52 : pressed ? 0.8 : 1 }]}>
        {starting ? <ActivityIndicator color={theme === 'eink' ? tokens.text : '#fff'} /> : null}
        <Text style={[styles.startText, { color: theme === 'eink' ? tokens.text : '#fff' }]}>{starting ? 'Starting timer…' : 'Start timer'}</Text>
      </Pressable>
    </View>}>
      {state.legacyRecoveries.length ? <View style={[styles.notice, { borderColor: tokens.warm }]}><Text style={[styles.sectionTitle, { color: tokens.text }]}>Recovered legacy timer</Text><Text style={[styles.copyText, { color: tokens.textMuted }]}>The other legacy working copy is kept here. Add it to your configurations when you are ready.</Text>{state.legacyRecoveries.map(recovery => <SheetTextButton key={recovery.id} label={`Add recovered ${recovery.sourceMode === 'pattern' ? 'Cycle' : 'Sequence'}`} onPress={() => {
        const config: UnifiedTimerConfig = { id: createProgramId(), name: recovery.draft.name, createdAt: Date.now(), updatedAt: Date.now(), program: recovery.draft.program, settings: recovery.draft.settings, showInRunningSelector: true, editorOptions: recovery.draft.editorOptions }
        void performCommand({ type: 'importConfig', config, select: false })
      }} />)}</View> : null}

      <View style={styles.section}>
        {program.steps.length > 1 ? <Text style={[styles.sectionTitle, { color: tokens.text }]}>Steps</Text> : null}
        {program.steps.length > 1 ? program.steps.map((step, index) => <View key={step.id} testID={`unified-config-step-row-${step.id}`} style={[styles.stepRow, { borderColor: tokens.border, backgroundColor: activeStep.id === step.id ? tokens.accentGlow : tokens.surface }]}>
          <Pressable style={styles.stepSummary} onPress={() => setActiveStepId(step.id)} accessibilityRole="button" accessibilityState={{ selected: activeStep.id === step.id }} accessibilityLabel={`Edit step ${index + 1}, ${step.label}`}><Text style={[styles.stepIndex, { color: tokens.accent }]}>{String(index + 1).padStart(2, '0')}</Text><View style={styles.flex}><Text numberOfLines={1} style={[styles.stepName, { color: tokens.text }]}>{step.label}</Text><Text style={[styles.helperText, { color: tokens.textMuted }]}>{formatCompactDurationSeconds(step.durationSeconds)} · {step.subBellTracks.length} sub-bells</Text></View></Pressable>
          <View style={styles.stepActions}><MiniButton label={`Move ${step.label} earlier`} glyph="↑" disabled={index === 0} onPress={() => moveStep(step.id, -1)} /><MiniButton label={`Move ${step.label} later`} glyph="↓" disabled={index === program.steps.length - 1} onPress={() => moveStep(step.id, 1)} /></View>
        </View>) : null}
        <View style={styles.buttonRow}><SheetTextButton disabled={program.steps.length >= MAX_SEQUENCE_STEPS} label="Add step" onPress={addStep} />{program.steps.length > 1 ? <><SheetTextButton disabled={program.steps.length >= MAX_SEQUENCE_STEPS} label="Duplicate step" onPress={() => duplicateStep(activeStep)} /><SheetTextButton disabled={program.steps.length <= 1} label="Delete step" onPress={() => void removeStep(activeStep)} /></> : null}</View>
      </View>

      {previewEvent ? <View style={[styles.preview, { borderColor: tokens.border, backgroundColor: tokens.surface }]}><Text style={[styles.helperText, { color: tokens.textMuted }]}>NEXT CUE · {programEventLabel(program, previewEvent)} · {formatCompactDurationSeconds(Math.max(0, Math.ceil((previewEvent.at - previewAnchor) / 1_000)))}</Text></View> : null}

      <StepEditor step={activeStep} stepIndex={program.steps.findIndex(step => step.id === activeStep.id)} program={program} settings={draft.settings} enabledActions={enabledActions} soundLibrary={state.soundLibrary} onPatch={patch => patchStep(activeStep.id, patch)} onPatchTrack={patch => patchTrack(activeStep.id, patch.id, patch)} onOpenCue={() => setCueTarget({ kind: 'step-end', stepId: activeStep.id })} onOpenTrackCue={track => setCueTarget({ kind: 'track', stepId: activeStep.id, trackId: track.id })} onDeleteTrack={trackId => patchStep(activeStep.id, { subBellTracks: activeStep.subBellTracks.filter(track => track.id !== trackId) })} />

      <View style={styles.section}>
        <View style={styles.masterRow}><View style={styles.flex}><Text style={[styles.sectionTitle, { color: tokens.text }]}>Overall volume</Text><Text style={[styles.helperText, { color: tokens.textMuted }]}>{Math.round(draft.settings.masterVolume * 100)}%</Text></View><Slider style={styles.slider} minimumValue={0} maximumValue={1} step={0.05} value={draft.settings.masterVolume} onValueChange={masterVolume => patchSettings({ masterVolume })} minimumTrackTintColor={tokens.accent} maximumTrackTintColor={tokens.surfaceHi} thumbTintColor={tokens.accent} accessibilityLabel="Overall timer volume" /></View>
        <View style={styles.cueRow}><View style={styles.flex}><Text style={[styles.rowTitle, { color: tokens.text }]}>Completion cue</Text><Text style={[styles.helperText, { color: tokens.textMuted }]}>{program.completionCue ? soundTitle(program.completionCue.sound) : 'Off'}</Text></View>{program.completionCue ? <><SheetTextButton label="Edit" onPress={() => setCueTarget({ kind: 'completion' })} /><SheetTextButton label="Turn off" tone="muted" onPress={() => patchProgram({ completionCue: null })} /></> : <SheetTextButton label="Add" onPress={() => patchProgram({ completionCue: { sound: { kind: 'builtin', id: 'temple-gong' }, volume: 1 } })} />}</View>
      </View>

      <View style={[styles.actionBlock, { borderColor: tokens.border }]}>
        <Text style={[styles.sectionTitle, { color: tokens.text }]}>More settings</Text>
        <ScrollView testID="unified-config-action-rail" horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.actionRail} accessibilityLabel="Optional timer settings">
          {ACTIONS.map(action => <Pressable key={action.id} testID={`unified-config-action-${action.id}`} onPress={() => toggleAction(action.id)} accessibilityRole="switch" accessibilityState={{ checked: enabledActions.has(action.id) }} accessibilityLabel={`${enabledActions.has(action.id) ? 'Hide' : 'Show'} ${action.label}`} style={[styles.actionChip, { borderColor: enabledActions.has(action.id) ? tokens.accent : tokens.border, backgroundColor: enabledActions.has(action.id) ? tokens.accentGlow : tokens.surface }]}><Text style={[styles.actionLabel, { color: enabledActions.has(action.id) ? tokens.text : tokens.textMuted }]}>{action.label}</Text></Pressable>)}
        </ScrollView>
      </View>

      {enabledActions.has('alignment') ? <Panel title="Align whole rounds to the clock" tokens={tokens}>
        <View style={styles.row}><Text style={[styles.rowTitle, { color: tokens.text }]}>Clock alignment</Text><Toggle value={program.alignment.kind === 'local-clock'} onChange={enabled => patchProgram({ alignment: enabled ? { kind: 'local-clock', offsetMinutes: 0 } : { kind: 'elapsed' } })} accessibilityLabel="Align full timer rounds to clock" /></View>
        {program.alignment.kind === 'local-clock' ? <ClockSnapSelector cycleDurationSeconds={cycleDurationSeconds} value={alignmentValue} onChange={offsetMinutes => patchProgram({ alignment: { kind: 'local-clock', offsetMinutes } })} /> : null}
      </Panel> : null}

      {enabledActions.has('run-length') ? <Panel title="Run length" tokens={tokens}>
        <RunLengthConfig mode={program.steps.length === 1 ? 'pattern' : 'sequence'} value={program.runPolicy} cycleDurationSeconds={cycleDurationSeconds} secondPrecision={draft.settings.secondPrecisionEnabled} onChange={runPolicy => patchProgram({ runPolicy })} />
      </Panel> : null}

      {enabledActions.has('schedule') ? <Panel title="Active and quiet times" tokens={tokens}>
        <View style={styles.row}><View style={styles.flex}><Text style={[styles.rowTitle, { color: tokens.text }]}>Use schedule</Text><Text style={[styles.helperText, { color: tokens.textMuted }]}>Continuous timers follow these weekly windows.</Text></View><Toggle value={draft.settings.availability.enabled} onChange={enabled => patchSettings({ availability: { ...draft.settings.availability, enabled } })} accessibilityLabel="Use timer schedule" /></View>
        <ScheduleConfig showHeading={false} showEnabledControl={false} value={draft.settings.availability} onChange={availability => patchSettings({ availability })} />
        {draft.settings.availability.enabled ? <ScheduleTimelinePreview value={draft.settings.availability} onPress={() => toggleAction('schedule')} /> : null}
      </Panel> : null}

      {enabledActions.has('haptics') ? <HapticsPanel value={draft.settings.haptics} onChange={haptics => { setAppHapticsEnabled(haptics.enabled); patchSettings({ haptics }) }} /> : null}

      {enabledActions.has('alarm') ? <Panel title="Alarm settings" tokens={tokens}>
        <View style={styles.row}><View style={styles.flex}><Text style={[styles.rowTitle, { color: tokens.text }]}>Alarm sound</Text><Text style={[styles.helperText, { color: tokens.textMuted }]}>{soundTitle(draft.settings.alarmSound)}</Text></View><SheetTextButton label="Choose" onPress={() => setCueTarget({ kind: 'alarm' })} /></View>
        <LabelledSlider label="Alarm volume" value={draft.settings.alarmVolume} onChange={alarmVolume => patchSettings({ alarmVolume })} />
        <DurationSelector label="Alarm duration" value={Math.ceil(draft.settings.alarmDurationSeconds / 60)} valueSeconds={draft.settings.alarmDurationSeconds} secondPrecision={draft.settings.secondPrecisionEnabled || draft.settings.alarmDurationSeconds % 60 !== 0} presets={[1, 2, 5, 10, 15, 30, 60]} minSeconds={5} maxSeconds={3_600} onChange={minutes => patchSettings({ alarmDurationSeconds: Math.min(3_600, Math.max(5, minutes * 60)) })} onChangeSeconds={alarmDurationSeconds => patchSettings({ alarmDurationSeconds })} />
      </Panel> : null}

      {enabledActions.has('focus') && Platform.OS === 'android' ? <Panel title="Chandas Focus" tokens={tokens}>
        <View style={styles.row}><View style={styles.flex}><Text style={[styles.rowTitle, { color: tokens.text }]}>Focus while timer runs</Text><Text style={[styles.helperText, { color: tokens.textMuted }]}>{focusState.reason === 'paused-by-android' ? 'Paused by Android' : focusState.reason === 'rule-disabled' ? 'Focus rule is disabled' : 'Manages Do Not Disturb while the timer runs.'}</Text></View><Toggle value={draft.settings.focusAutomationEnabled} onChange={enabled => { patchSettings({ focusAutomationEnabled: enabled }); onFocusAutomationChange(enabled) }} accessibilityLabel="Chandas Focus" /></View>
        <View style={styles.buttonRow}><SheetTextButton label="Focus settings" onPress={onOpenFocusSettings} /><SheetTextButton label="Focus rule" onPress={onOpenFocusRuleSettings} /></View>
      </Panel> : null}

      {enabledActions.has('notifications') ? <Panel title="Timer notifications" tokens={tokens}>
        <View style={styles.row}><View style={styles.flex}><Text style={[styles.rowTitle, { color: tokens.text }]}>Notifications</Text><Text style={[styles.helperText, { color: tokens.textMuted }]}>{androidAccess.notifications ? 'Timer notifications are available.' : 'Notification access is not currently available.'}</Text></View><Toggle value={draft.settings.notificationsEnabled} onChange={enabled => { patchSettings({ notificationsEnabled: enabled }); if (enabled && Platform.OS === 'android' && !androidAccess.notifications) onRequestNotificationAccess() }} accessibilityLabel="Timer notifications" /></View>
        <View style={styles.row}><View style={styles.flex}><Text style={[styles.rowTitle, { color: tokens.text }]}>Next cue countdown</Text><Text style={[styles.helperText, { color: tokens.textMuted }]}>Show the upcoming cue in the running notification.</Text></View><Toggle value={draft.settings.liveCountdownEnabled} onChange={enabled => { patchSettings({ liveCountdownEnabled: enabled, ...(enabled ? { notificationsEnabled: true } : {}) }); if (enabled && Platform.OS === 'android' && !androidAccess.notifications) onRequestNotificationAccess() }} accessibilityLabel="Next cue countdown" /></View>
      </Panel> : null}

      {enabledActions.has('calls') ? <Panel title="During phone calls" tokens={tokens}>
        <View style={styles.row}><View style={styles.flex}><Text style={[styles.rowTitle, { color: tokens.text }]}>Mute timer during calls</Text><Text style={[styles.helperText, { color: tokens.textMuted }]}>{androidAccess.callMute ? 'Timer cues pause while a call is active.' : 'Phone-state permission may be needed.'}</Text></View><Toggle value={draft.settings.muteDuringCallsEnabled} onChange={enabled => { patchSettings({ muteDuringCallsEnabled: enabled }); if (enabled && Platform.OS === 'android' && !androidAccess.callMute) onRequestCallMuteAccess() }} accessibilityLabel="Mute cues during calls" /></View>
      </Panel> : null}

      {enabledActions.has('precision') ? <Panel title="Exact seconds" tokens={tokens}>
        <View style={styles.row}><View style={styles.flex}><Text style={[styles.rowTitle, { color: tokens.text }]}>Show seconds</Text><Text style={[styles.helperText, { color: tokens.textMuted }]}>Keep duration and run-length editors at second precision.</Text></View><Toggle value={draft.settings.secondPrecisionEnabled} onChange={secondPrecisionEnabled => patchSettings({ secondPrecisionEnabled })} accessibilityLabel="Use second precision" /></View>
      </Panel> : null}

      {enabledActions.has('system') && Platform.OS === 'android' ? <Panel title="Android system access" tokens={tokens}>
        {!androidAccess.exactAlarms ? <View style={styles.row}><View style={styles.flex}><Text style={[styles.rowTitle, { color: tokens.text }]}>Exact timing</Text><Text style={[styles.helperText, { color: tokens.warm }]}>Needed for precise background timing.</Text></View><SheetTextButton label="Set up" tone="danger" onPress={onOpenExactAlarmSettings} /></View> : null}
        {!androidAccess.fullScreenAlarms ? <View style={styles.row}><View style={styles.flex}><Text style={[styles.rowTitle, { color: tokens.text }]}>Full-screen alarms</Text><Text style={[styles.helperText, { color: tokens.warm }]}>Allow alarms to appear over the lock screen.</Text></View><SheetTextButton label="Set up" tone="danger" onPress={onOpenFullScreenIntentSettings} /></View> : null}
        <Text style={[styles.helperText, { color: tokens.textMuted }]}>{androidAccess.checking ? 'Checking Android access…' : androidAccess.pending ? 'Waiting for Android…' : `Notifications ${androidAccess.notifications ? 'available' : 'not granted'} · call mute ${androidAccess.callMute ? 'available' : 'not granted'}.`}</Text>
      </Panel> : null}

      {enabledActions.has('device') ? <Panel title="Device appearance" tokens={tokens}>
        <ColorSelector label="Accent color" detail="Applies across the app." value={accentColor} onChange={setAccentColor} accessibilityLabel="Accent color" trailing={<Pressable onPress={() => { if (themeLongPressed) return; toggleTheme() }} onLongPress={() => { setThemeLongPressed(true); useEinkTheme() }} onPressOut={() => setTimeout(() => setThemeLongPressed(false), 0)} delayLongPress={550} accessibilityRole="button" accessibilityLabel={`Change appearance from ${theme}`} style={[styles.themeButton, { borderColor: tokens.border }]}><Text style={{ color: tokens.accent }}>{theme === 'dark' ? 'Light' : theme === 'light' ? 'Dark' : 'E-ink'}</Text></Pressable>} />
        {floatingAvailable ? <FloatingOverlaySettings state={floatingOverlay} onChange={setFloatingOverlay} onFeedback={onFeedback} /> : null}
      </Panel> : null}
    </DraggableSheet>

    <DraggableSheet visible={modal === 'picker'} title="Configurations" testID="unified-config-picker-sheet" onClose={() => setModal(null)} pinnedContent={<View style={styles.buttonRow}><SheetTextButton label={transferBusy ? 'Loading…' : 'Import from clipboard'} disabled={transferBusy} onPress={() => void openExternalImport('clipboard')} /><SheetTextButton label="Import file" disabled={transferBusy} onPress={() => void openExternalImport('file')} /><SheetTextButton label={own(state.drafts, UNNAMED_DRAFT_KEY) ? 'Return to unnamed draft' : 'New unnamed timer'} onPress={() => switchTo(null)} /></View>}>
        {state.configs.map(config => <ConfigCard key={config.id} config={config} draft={own(state.drafts, config.id) ? state.drafts[config.id] : undefined} renameValue={own(renameValues, config.id) ? renameValues[config.id]! : config.name} onRenameChange={value => setRenameValues(current => ({ ...current, [config.id]: value }))} onRename={async () => { if (await performCommand({ type: 'rename', id: config.id, name: own(renameValues, config.id) ? renameValues[config.id]! : config.name })) setRenameValues(current => ({ ...current, [config.id]: config.name })) }} onSelect={() => switchTo(config.id)} onDuplicate={() => { void performCommand({ type: 'duplicate', id: config.id, newId: createProgramId() }) }} onDelete={async () => {
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

    <DraggableSheet visible={modal === 'save-as'} title={saveAsForSwitch ? 'Save draft & switch' : 'Save as'} testID="unified-config-save-as-sheet" onClose={() => setModal(saveAsForSwitch ? 'switch' : null)} footer={<SheetTextButton disabled={!saveAsName.trim() || commandPending} label={commandPending ? 'Saving…' : saveAsForSwitch ? 'Save & switch' : 'Create configuration'} onPress={() => {
      if (saveAsForSwitch) void saveAsAndSwitch()
      else void performCommand({ type: 'saveAs', name: saveAsName.trim(), id: createProgramId() }).then(accepted => { if (accepted) setModal(null) })
    }} />}>
      <Text style={[styles.copyText, { color: tokens.textMuted }]}>This creates a saved snapshot and keeps your existing draft available.</Text>
      <TextInput testID="unified-config-save-as-name" value={saveAsName} onChangeText={value => setSaveAsName([...value].slice(0, 80).join(''))} placeholder="Configuration name" placeholderTextColor={tokens.textMuted} returnKeyType="done" style={[styles.input, { borderColor: tokens.border, color: tokens.text, backgroundColor: tokens.surface }]} accessibilityLabel="Save as configuration name" />
    </DraggableSheet>

    {soundPickerCue && cueTarget ? <SoundPickerSheet visible title={cueTarget.kind === 'alarm' ? 'Alarm sound' : cueTarget.kind === 'completion' ? 'Completion cue' : cueTarget.kind === 'track' ? 'Sub-bell sound' : 'Step ending cue'} cue={soundPickerCue} soundLibrary={state.soundLibrary} masterVolume={draft.settings.masterVolume} advanced onChange={patchCue} onClose={() => setCueTarget(null)} onFeedback={onFeedback} /> : null}
  </KeyboardAvoidingView>
}

function StepEditor({ step, stepIndex, program, settings, enabledActions, soundLibrary, onPatch, onPatchTrack, onOpenCue, onOpenTrackCue, onDeleteTrack }: {
  step: UnifiedTimerStep; stepIndex: number; program: UnifiedTimerProgram; settings: AppTimerSettings; enabledActions: Set<ExtraAction>; soundLibrary: SoundRef[];
  onPatch: (patch: Partial<UnifiedTimerStep>) => void;
  onPatchTrack: (patch: Partial<UnifiedSubBellTrack> & { id: string }) => void; onOpenCue: () => void; onOpenTrackCue: (track: UnifiedSubBellTrack) => void; onDeleteTrack: (trackId: string) => void
}) {
  const { tokens } = useTheme()
  const confirm = useConfirmation()
  const duration = step.durationSeconds
  const updateStepDuration = (durationSeconds: number) => onPatch({ durationSeconds, ...(step.labelIsCustom === false ? { label: defaultPatternLabel(durationSeconds) } : {}) })
  const addTrack = () => {
    if (step.subBellTracks.length >= MAX_PATTERN_TRACKS) return
    const index = step.subBellTracks.length
    const track: UnifiedSubBellTrack = { id: createProgramId(), label: `Sub-bell ${index + 1}`, enabled: true, color: normalizeSubBellColor(undefined, index), showOnWatchFace: true, cadenceSeconds: 300, repeatEnabled: true, selectedOffsetsSeconds: [300, 600, 900].filter(offset => offset < duration), sound: { kind: 'builtin', id: 'clear-bell' }, volume: 0.55 }
    onPatch({ subBellsEnabled: true, subBellTracks: [...step.subBellTracks, track] })
  }
  const duplicateTrack = (trackId: string) => {
    if (step.subBellTracks.length >= MAX_PATTERN_TRACKS) return
    const source = step.subBellTracks.find(track => track.id === trackId)
    if (!source) return
    const duplicate: UnifiedSubBellTrack = {
      ...source,
      id: createProgramId(),
      label: copyLabel(source.label),
      sound: { ...source.sound },
      ...(source.sounds ? { sounds: source.sounds.map(sound => ({ ...sound })) } : {}),
      ...(source.hapticOverride && source.hapticOverride !== 'off' ? { hapticOverride: { ...source.hapticOverride } } : {}),
      ...(source.randomRepeat ? { randomRepeat: { ...source.randomRepeat } } : {}),
      selectedOffsetsSeconds: [...source.selectedOffsetsSeconds],
    }
    const index = step.subBellTracks.findIndex(track => track.id === trackId)
    const subBellTracks = [...step.subBellTracks]
    subBellTracks.splice(index + 1, 0, duplicate)
    onPatch({ subBellTracks })
  }
  const deleteTrack = async (trackId: string) => {
    const track = step.subBellTracks.find(item => item.id === trackId)
    if (!track) return
    if (!await confirm({ title: `Delete ${track.label}?`, message: 'This removes the sub-bell and its saved sound, cadence and visibility settings.', confirmLabel: 'Delete sub-bell', cancelLabel: 'Keep sub-bell', destructive: true })) return
    onDeleteTrack(trackId)
  }
  return <View testID="unified-config-step-editor" style={styles.section}>
    <Text style={[styles.sectionTitle, { color: tokens.text }]}>{program.steps.length > 1 ? `Edit step ${stepIndex + 1}` : 'Timer'}</Text>
    <TextInput testID={`unified-config-step-name-${step.id}`} accessibilityLabel={`Step ${stepIndex + 1} name`} value={step.label} onChangeText={label => onPatch({ label: [...label].slice(0, 60).join(''), labelIsCustom: true })} placeholder="Step name" placeholderTextColor={tokens.textMuted} style={[styles.input, { borderColor: tokens.border, color: tokens.text, backgroundColor: tokens.surface }]} />
    <DurationSelector label="Duration" value={Math.ceil(duration / 60)} valueSeconds={duration} secondPrecision={settings.secondPrecisionEnabled || duration % 60 !== 0} presets={DURATION_PRESETS} minSeconds={1} maxSeconds={MAX_CUE_DURATION_SECONDS} onChange={minutes => updateStepDuration(Math.min(MAX_CUE_DURATION_SECONDS, minutes * 60))} onChangeSeconds={updateStepDuration} />
    <View style={styles.row}><View style={styles.flex}><Text style={[styles.rowTitle, { color: tokens.text }]}>Ending cue</Text><Text style={[styles.helperText, { color: tokens.textMuted }]}>{soundTitle(step.endCue.sound)} · {Math.round(step.endCue.volume * 100)}%</Text></View><SheetTextButton label="Choose sound" onPress={onOpenCue} /></View>
    <LabelledSlider label="Ending cue volume" value={step.endCue.volume} onChange={volume => onPatch({ endCue: { ...step.endCue, volume } })} />
    {enabledActions.has('haptics') ? <CueHapticsEditor cue={step.endCue} inherited={settings.haptics.main} onChange={hapticOverride => onPatch({ endCue: { ...step.endCue, hapticOverride } })} /> : null}
    <View style={styles.row}><View style={styles.flex}><Text style={[styles.rowTitle, { color: tokens.text }]}>Alarm at step end</Text><Text style={[styles.helperText, { color: tokens.textMuted }]}>This step can ring until dismissed.</Text></View><Toggle value={step.endAlarmEnabled} onChange={endAlarmEnabled => onPatch({ endAlarmEnabled })} accessibilityLabel={`Alarm at end of ${step.label}`} /></View>
    <View style={styles.row}><View style={styles.flex}><Text style={[styles.rowTitle, { color: tokens.text }]}>Sub-bells</Text><Text style={[styles.helperText, { color: tokens.textMuted }]}>{step.subBellsEnabled ? `${step.subBellTracks.filter(track => track.enabled).length} active of ${step.subBellTracks.length}` : 'Quiet · settings retained'}</Text></View><Toggle value={step.subBellsEnabled} onChange={subBellsEnabled => onPatch({ subBellsEnabled })} accessibilityLabel={`Sub-bells in ${step.label}`} /></View>
    {step.subBellTracks.map((track, index) => <TrackEditor key={track.id} track={track} index={index} durationSeconds={duration} secondPrecision={settings.secondPrecisionEnabled} haptics={settings.haptics} showHaptics={enabledActions.has('haptics')} sharedSounds={soundLibrary} onChange={onPatchTrack} onOpenCue={() => onOpenTrackCue(track)} onDelete={trackId => { void deleteTrack(trackId) }} onDuplicate={duplicateTrack} duplicateDisabled={step.subBellTracks.length >= MAX_PATTERN_TRACKS} />)}
    <SheetTextButton disabled={step.subBellTracks.length >= MAX_PATTERN_TRACKS} label="Add sub-bell" onPress={addTrack} />
    {step.subBellsEnabled && !step.subBellTracks.some(track => track.enabled) ? <Text style={[styles.helperText, { color: tokens.warm }]}>The layer is on, but all tracks are disabled.</Text> : null}
  </View>
}

function TrackEditor({ track, index, durationSeconds, secondPrecision, haptics, showHaptics, sharedSounds, onChange, onOpenCue, onDelete, onDuplicate, duplicateDisabled }: {
  track: UnifiedSubBellTrack; index: number; durationSeconds: number; secondPrecision: boolean; haptics: AppTimerSettings['haptics']; showHaptics: boolean; sharedSounds: SoundRef[];
  onChange: (patch: Partial<UnifiedSubBellTrack> & { id: string }) => void; onOpenCue: () => void; onDelete: (trackId: string) => void; onDuplicate: (trackId: string) => void; duplicateDisabled: boolean
}) {
  const { tokens } = useTheme()
  const [expanded, setExpanded] = useState(false)
  const [showOffsets, setShowOffsets] = useState(false)
  const [shownOptions, setShownOptions] = useState<Set<'random' | 'after' | 'before' | 'offsets'>>(() => new Set([
    ...(track.randomRepeat ? ['random' as const] : []), ...(track.afterStartSeconds !== undefined ? ['after' as const] : []),
    ...(track.beforeEndSeconds !== undefined ? ['before' as const] : []), ...(track.selectedOffsetsSeconds.length ? ['offsets' as const] : []),
  ]))
  const cadence = track.cadenceSeconds
  const offsetCount = track.repeatEnabled ? Math.floor((durationSeconds - 1) / cadence) : 0
  const offsets = offsetCount <= MAX_VISIBLE_PATTERN_OFFSETS ? Array.from({ length: Math.max(0, offsetCount) }, (_, offsetIndex) => (offsetIndex + 1) * cadence) : []
  const dormant = track.selectedOffsetsSeconds.filter(offset => offset >= durationSeconds)
  const randomInactive = track.randomRepeat !== undefined && durationSeconds <= track.randomRepeat.minSeconds
  const patch = (value: Partial<UnifiedSubBellTrack>) => onChange({ id: track.id, ...value })
  const toggleOption = (option: 'random' | 'after' | 'before' | 'offsets') => setShownOptions(current => { const next = new Set(current); next.has(option) ? next.delete(option) : next.add(option); return next })
  return <View style={[styles.trackCard, { borderColor: tokens.border, backgroundColor: tokens.surface }]}>
    <View style={styles.row}>
      <Pressable style={styles.flex} onPress={() => setExpanded(value => !value)} accessibilityRole="button" accessibilityState={{ expanded }} accessibilityLabel={`${expanded ? 'Collapse' : 'Edit'} ${track.label}`}>
        <Text style={[styles.rowTitle, { color: tokens.text }]}>{track.label}</Text>
        <Text style={[styles.helperText, { color: tokens.textMuted }]}>{track.enabled ? 'Enabled' : 'Disabled'} · {soundTitle(track.sound)} · {track.showOnWatchFace ? 'Visible' : 'Hidden on watch face'}</Text>
      </Pressable>
      <Toggle value={track.enabled} onChange={enabled => patch({ enabled })} accessibilityLabel={`Enable ${track.label}`} />
    </View>
    {expanded ? <View style={styles.trackControls}>
      <TextInput value={track.label} onChangeText={label => patch({ label: [...label].slice(0, 60).join('') })} placeholder="Sub-bell name" placeholderTextColor={tokens.textMuted} style={[styles.input, { color: tokens.text, borderColor: tokens.border }]} accessibilityLabel={`${track.label} name`} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.trackOptionRail} accessibilityLabel={`${track.label} optional settings`}>
        {([{ id: 'random', label: 'Random gaps' }, { id: 'after', label: 'After start' }, { id: 'before', label: 'Before end' }, { id: 'offsets', label: 'Cadence offsets' }] as const).map(option => <Pressable key={option.id} onPress={() => toggleOption(option.id)} accessibilityRole="switch" accessibilityLabel={`${shownOptions.has(option.id) ? 'Hide' : 'Show'} ${option.label}`} accessibilityState={{ checked: shownOptions.has(option.id) }} style={[styles.actionChip, { borderColor: shownOptions.has(option.id) ? tokens.accent : tokens.border, backgroundColor: shownOptions.has(option.id) ? tokens.accentGlow : tokens.surface }]}><Text style={[styles.actionLabel, { color: shownOptions.has(option.id) ? tokens.text : tokens.textMuted }]}>{option.label}</Text></Pressable>)}
      </ScrollView>
      <View style={styles.row}><View style={styles.flex}><Text style={[styles.rowTitle, { color: tokens.text }]}>Repeat cadence</Text><Text style={[styles.helperText, { color: tokens.textMuted }]}>{track.repeatEnabled ? formatCompactDurationSeconds(cadence) : 'Off · retained'}</Text></View><Toggle value={track.repeatEnabled} onChange={repeatEnabled => patch({ repeatEnabled })} accessibilityLabel={`Repeat ${track.label}`} /></View>
      {track.repeatEnabled ? <DurationSelector label="Repeat every" value={Math.ceil(cadence / 60)} valueSeconds={cadence} secondPrecision={secondPrecision || cadence % 60 !== 0} presets={[1, 2, 3, 5, 10, 15, 20, 30, 60]} minSeconds={1} maxSeconds={MAX_CUE_DURATION_SECONDS} onChange={minutes => patch({ cadenceSeconds: Math.min(MAX_CUE_DURATION_SECONDS, minutes * 60) })} onChangeSeconds={cadenceSeconds => patch({ cadenceSeconds })} /> : null}
      {shownOptions.has('random') ? <><View style={styles.row}><View style={styles.flex}><Text style={[styles.rowTitle, { color: tokens.text }]}>Random gaps</Text><Text style={[styles.helperText, { color: tokens.textMuted }]}>{track.randomRepeat ? `${formatCompactDurationSeconds(track.randomRepeat.minSeconds)}–${formatCompactDurationSeconds(track.randomRepeat.maxSeconds)}` : 'Off · independent of cadence'}</Text></View><Toggle value={!!track.randomRepeat} onChange={enabled => patch({ randomRepeat: enabled ? { minSeconds: 10, maxSeconds: 60 } : undefined })} accessibilityLabel={`Random gaps for ${track.label}`} /></View>{track.randomRepeat ? <View style={styles.inlineFields}><DurationSelector label="Shortest gap" value={Math.ceil(track.randomRepeat.minSeconds / 60)} valueSeconds={track.randomRepeat.minSeconds} secondPrecision={secondPrecision || track.randomRepeat.minSeconds % 60 !== 0} presets={[1, 2, 3, 5]} minSeconds={5} maxSeconds={MAX_CUE_DURATION_SECONDS} onChangeSeconds={minSeconds => patch({ randomRepeat: { ...track.randomRepeat!, minSeconds: Math.min(minSeconds, track.randomRepeat!.maxSeconds) } })} onChange={minutes => patch({ randomRepeat: { ...track.randomRepeat!, minSeconds: Math.min(minutes * 60, track.randomRepeat!.maxSeconds) } })} /><DurationSelector label="Longest gap" value={Math.ceil(track.randomRepeat.maxSeconds / 60)} valueSeconds={track.randomRepeat.maxSeconds} secondPrecision={secondPrecision || track.randomRepeat.maxSeconds % 60 !== 0} presets={[1, 2, 3, 5, 10]} minSeconds={Math.max(5, track.randomRepeat.minSeconds)} maxSeconds={MAX_CUE_DURATION_SECONDS} onChangeSeconds={maxSeconds => patch({ randomRepeat: { ...track.randomRepeat!, maxSeconds: Math.max(maxSeconds, track.randomRepeat!.minSeconds) } })} onChange={minutes => patch({ randomRepeat: { ...track.randomRepeat!, maxSeconds: Math.max(minutes * 60, track.randomRepeat!.minSeconds) } })} />{randomInactive ? <Text style={[styles.helperText, { color: tokens.warm }]}>This random range is inactive until the step is long enough.</Text> : null}</View> : null}</> : null}
      {shownOptions.has('after') ? <MarkerControl label="After start" value={track.afterStartSeconds} durationSeconds={durationSeconds} secondPrecision={secondPrecision} onChange={afterStartSeconds => patch({ afterStartSeconds })} /> : null}
      {shownOptions.has('before') ? <MarkerControl label="Before end" value={track.beforeEndSeconds} durationSeconds={durationSeconds} secondPrecision={secondPrecision} onChange={beforeEndSeconds => patch({ beforeEndSeconds })} /> : null}
      <ColorSelector label="Color" detail="Watch-face ring" value={normalizeSubBellColor(track.color, index)} onChange={color => patch({ color })} accessibilityLabel={`${track.label} color`} trailing={<Pressable onPress={() => patch({ showOnWatchFace: !track.showOnWatchFace })} accessibilityRole="switch" accessibilityState={{ checked: track.showOnWatchFace }} accessibilityLabel={`${track.label} visibility on watch face`} style={[styles.eyeButton, { borderColor: tokens.border }]}><EyeIcon visible={track.showOnWatchFace} color={tokens.accent} /></Pressable>} />
      <LabelledSlider label="Sub-bell volume" value={track.volume} onChange={volume => patch({ volume })} />
      <View style={styles.row}><View style={styles.flex}><Text style={[styles.rowTitle, { color: tokens.text }]}>Sound</Text><Text style={[styles.helperText, { color: tokens.textMuted }]}>{soundTitle(track.sound)}{track.sounds && track.sounds.length > 1 ? ` · ${track.sounds.length} choices` : ''}</Text></View><SheetTextButton label="Choose" onPress={onOpenCue} /></View>
      {showHaptics ? <CueHapticsEditor cue={track} inherited={haptics.subBell} onChange={hapticOverride => patch({ hapticOverride })} /> : null}
      {track.repeatEnabled && shownOptions.has('offsets') ? <>
        <View style={styles.row}><View style={styles.flex}><Text style={[styles.rowTitle, { color: tokens.text }]}>Selected cadence offsets</Text><Text style={[styles.helperText, { color: tokens.textMuted }]}>{track.selectedOffsetsSeconds.length} selected{dormant.length ? ` · ${dormant.length} inactive after shortening` : ''}</Text></View><SheetTextButton label={showOffsets ? 'Hide' : 'Edit'} onPress={() => setShowOffsets(value => !value)} /></View>
        {dormant.length ? <Text style={[styles.helperText, { color: tokens.warm }]}>Offsets beyond this step are retained and become active if you lengthen it.</Text> : null}
        {showOffsets && offsetCount > MAX_VISIBLE_PATTERN_OFFSETS ? <GentleNotice title="Too many offsets to show" message="Choose a longer cadence to customize individual repeating cues." /> : null}
        {showOffsets && offsetCount <= MAX_VISIBLE_PATTERN_OFFSETS ? <OffsetGrid offsets={[...new Set([...offsets, ...dormant])].sort((a, b) => a - b)} selected={track.selectedOffsetsSeconds} unit="seconds" onChange={selectedOffsetsSeconds => patch({ selectedOffsetsSeconds })} /> : null}
      </> : null}
      <View style={styles.buttonRow}><SheetTextButton disabled={duplicateDisabled} label="Duplicate sub-bell" onPress={() => onDuplicate(track.id)} /><SheetTextButton label="Delete sub-bell" tone="danger" onPress={() => onDelete(track.id)} /></View>
      {sharedSounds.length > 0 ? <Text style={[styles.helperText, { color: tokens.textMuted }]}>Imported sounds are shared by all configurations.</Text> : null}
    </View> : null}
  </View>
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
  if (target.kind === 'alarm') return { sound: draft.settings.alarmSound, volume: draft.settings.alarmVolume }
  if (target.kind === 'completion') return draft.program.completionCue
  const step = draft.program.steps.find(value => value.id === target.stepId)
  if (!step) return null
  return target.kind === 'step-end' ? step.endCue : step.subBellTracks.find(track => track.id === target.trackId) ?? null
}

function inferConfiguredActions(draft: UnifiedTimerDraft | undefined): ExtraAction[] {
  if (!draft) return []
  const actions: ExtraAction[] = []
  const program = draft.program
  if (program.alignment.kind === 'local-clock') actions.push('alignment')
  if (program.runPolicy.kind !== 'continuous') actions.push('run-length')
  if (draft.settings.availability.enabled) actions.push('schedule')
  const defaults = defaultAppTimerSettings().haptics
  const profileChanged = (key: 'main' | 'subBell' | 'alarm') => draft.settings.haptics[key].pattern !== defaults[key].pattern || draft.settings.haptics[key].strength !== defaults[key].strength
  if (!draft.settings.haptics.enabled || profileChanged('main') || profileChanged('subBell') || profileChanged('alarm') || program.steps.some(step => step.endCue.hapticOverride !== undefined || step.subBellTracks.some(track => track.hapticOverride !== undefined))) actions.push('haptics')
  if (draft.settings.alarmDurationSeconds !== 60 || draft.settings.alarmVolume !== 1 || draft.settings.alarmSound.kind !== 'builtin' || draft.settings.alarmSound.id !== 'alarm-tone') actions.push('alarm')
  if (draft.settings.focusAutomationEnabled) actions.push('focus')
  if (!draft.settings.notificationsEnabled || draft.settings.liveCountdownEnabled) actions.push('notifications')
  if (!draft.settings.muteDuringCallsEnabled) actions.push('calls')
  if (draft.settings.secondPrecisionEnabled) actions.push('precision')
  if (Platform.OS === 'android') actions.push('system')
  return actions
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
})

