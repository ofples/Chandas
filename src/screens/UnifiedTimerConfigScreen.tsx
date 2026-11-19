import { TourTarget, useGuidedTour } from '../components/timer-v2/guided-tour'
import { BellPointsEditor } from '../components/timer-v2/bell-points-editor'
import { bellPoints } from '../lib/bell-points'
import Svg, { Circle, Path } from 'react-native-svg'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ActivityIndicator, BackHandler, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import { VolumeControl } from '../components/timer-v2/volume-control'
import type { AppTimerSettings, AvailabilityPolicy, CueSettings, HapticProfile, SubBellColorId, UnifiedSubBellTrack, UnifiedTimerProgram, UnifiedTimerStep } from '../types'
import type { NativeFocusState } from '../native/ChandasTimerService'
import { ChandasTimerService, isNativeServiceAvailable } from '../native/ChandasTimerService'
import { Toggle } from '../components/Toggle'
import { AudioOutputSettings } from '../components/timer-v2/AudioOutputSettings'
import { AudioMixSettings, audioMixLabel } from '../components/timer-v2/audio-mix-settings'
import { DraggableSheet } from '../components/timer-v2/DraggableSheet'
import { BottomSheet } from '../components/timer-v2/BottomSheet'
import { TimerMuteControls } from '../components/timer-v2/running/TimerMuteControls'
import { clockMinutePhaseCount } from '../lib/clockAlignment'
import { DurationSelector } from '../components/timer-v2/DurationSelector'
import { ClockSnapSelector } from '../components/timer-v2/ClockSnapSelector'
import { OffsetGrid } from '../components/timer-v2/OffsetGrid'
import { SoundPickerSheet } from '../components/timer-v2/SoundPickerSheet'
import { ColorSelector } from '../components/timer-v2/ColorSelector'
import { RunLengthConfig } from '../components/timer-v2/run-length-config'
import { ScheduleConfig } from '../components/timer-v2/schedule-config'
import { formatClockTime } from '../lib/time-inputs'
import { ScheduleTimelinePreview } from '../components/timer-v2/ScheduleTimelinePreview'
import { PatternTimelinePreview } from '../components/timer-v2/PatternTimelinePreview'
import { SoundName } from '../components/timer-v2/SoundName'
import Animated, { FadeIn, LinearTransition, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated'
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
import { createProgramId, defaultAppTimerSettings, MAX_CUE_DURATION_SECONDS, MAX_PATTERN_TRACKS, MAX_SEQUENCE_STEPS, MAX_VISIBLE_PATTERN_OFFSETS, formatCompactDurationSeconds, trackEventOffsetsSeconds } from '../lib/timerV2'
import { defaultUnifiedStepLabel } from '../lib/unified-timer'
import { hapticProfileSummary, HAPTIC_PATTERNS, HAPTIC_STRENGTHS } from '../lib/haptic-profiles'
import { previewHapticProfile, selectionHaptic, setAppHapticsEnabled, tapHaptic } from '../lib/haptics'
import { normalizeSubBellColor, subBellColorValue, timerIdentityColor } from '../lib/subBellColors'
import { soundTitle } from '../lib/soundLibrary'
import { AlarmIcon, BellIcon, ClockIcon, ConfigurationIcon, DuplicateIcon, EyeIcon, FocusIcon, MixerIcon, OverflowIcon, RestartIcon, TimerTransportIcon, TrashIcon, VolumeIcon, LightbulbIcon, SaveIcon } from '../components/Icons'
import { parseUnifiedConfigurationTransfer, serializeUnifiedConfiguration } from '../lib/unified-configuration-transfer'
import { copyConfigurationText, pickConfigurationText, readConfigurationTextFromClipboard, saveConfigurationFile } from '../lib/configuration-transfer-io'
import { configurationTransferFilename } from '../lib/configuration-transfer'
import { UNNAMED_DRAFT_KEY, defaultUnifiedTimerName, effectiveAlarmSettings, hasUnifiedDraftChanges, stableJson, type ConfigStateCommand, type UnifiedConfigState, type UnifiedTimerConfig, type UnifiedTimerDraft } from '../lib/unified-config-state'
import { useKeyboardVisible } from '../hooks/use-keyboard-visible'
import { insertUnifiedStepAfter, unifiedCadenceOffsets, unifiedTrackCadencePatch, unifiedTrackDurationPatch } from '../lib/unified-editing'
import { RunningControlSettingsList } from '../components/timer-v2/RunningControlSettingsList'
import { TimerWatchfaceRings } from '../components/timer-v2/running/TimerWatchface'
import { TimerControlButton } from '../components/timer-v2/running/TimerControlButton'
import type { TimelinePosition } from '../lib/timeline'
import { formatEventLocalTime, type CueMuteSuggestion } from '../lib/upcoming-events'

export interface LibraryRun {
  id: string
  configurationId: string | null
  program: UnifiedTimerProgram
  position: TimelinePosition | null
  eventPulse: number
  muted: boolean
  mutedUntil: number
  paused: boolean
  countdown: string
  progress: number
}

interface UnifiedTimerConfigScreenProps {
  onStartTutorial?: () => void
  onOpenStarterTimers?: () => void
  liveRuns?: LibraryRun[]
  onOpenRun?: (id: string) => void
  onGroupPause?: (paused: boolean) => void
  onGroupReset?: () => void
  onRunReset?: (id: string) => void
  onRunSkip?: (id: string, direction: 'next' | 'previous') => void
  onRunSnap?: (id: string, offset: number) => void
  onGroupAlign?: (offset: number) => Promise<void>
  onGroupMute?: (action: GroupMuteAction) => void
  getGroupMuteSuggestions?: (now: number, limit?: number) => CueMuteSuggestion[]
  onStopRuns?: (ids: string[]) => void
  libraryOriginRunId?: string | null
  openLibraryOnMount?: boolean
  alarmRinging?: boolean
  state: UnifiedConfigState
  onCommand: (command: ConfigStateCommand) => void | boolean | Promise<boolean>
  onStart: () => void
  onDeleteConfiguration: (id: string) => Promise<void>
  onStartConfiguration?: (configId: string | null) => void
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

export type GroupMuteAction = { kind: 'clear' } | { kind: 'seconds' | 'iterations' | 'until'; value: number }

type ExtraAction = 'alignment' | 'run-length' | 'schedule' | 'haptics' | 'alarm' | 'focus' | 'notifications' | 'calls' | 'audio-output' | 'precision' | 'running-controls' | 'system' | 'device' | 'audio-mix'
type CueTarget = { kind: 'step-end'; stepId: string } | { kind: 'track'; stepId: string; trackId: string } | { kind: 'alarm' } | { kind: 'completion' }
type ModalKind = 'picker' | 'settings' | 'step' | 'subbells' | 'track' | null
type SettingsAction = Exclude<ExtraAction, 'alignment' | 'run-length'>
const ACTIONS: ReadonlyArray<{ id: SettingsAction; label: string }> = [
  { id: 'schedule', label: 'Schedule' }, { id: 'haptics', label: 'Default haptics' },
  { id: 'alarm', label: 'Default alarm' }, { id: 'focus', label: 'Focus' },
  { id: 'audio-output', label: 'Audio output' }, { id: 'notifications', label: 'Notifications' }, { id: 'calls', label: 'Call mute' },
  { id: 'precision', label: 'Seconds' }, { id: 'running-controls', label: 'Running controls' }, { id: 'system', label: 'System access' }, { id: 'device', label: 'Device appearance' },
  { id: 'audio-mix', label: 'Sound mixing' },
]
const own = (object: object, key: PropertyKey) => Object.prototype.hasOwnProperty.call(object, key)

export function UnifiedTimerConfigScreen({ state, onCommand, onStart, onStartConfiguration, onDeleteConfiguration, liveRuns = [], onOpenRun, onGroupPause, onGroupReset, onRunReset, onRunSkip, onRunSnap, onGroupAlign, onGroupMute, getGroupMuteSuggestions, onStopRuns, libraryOriginRunId, openLibraryOnMount, alarmRinging, starting, focusState, onFocusAutomationChange, onOpenFocusSettings, onOpenFocusRuleSettings, androidAccess, onOpenExactAlarmSettings, onOpenFullScreenIntentSettings, onRequestCallMuteAccess, onRequestNotificationAccess, onFeedback, onStartTutorial, onOpenStarterTimers }: UnifiedTimerConfigScreenProps) {
  const { tokens, theme } = useTheme()
  const tour = useGuidedTour()
  const insets = useSafeAreaInsets()
  const { height: windowHeight, width: windowWidth } = useWindowDimensions()
  const [gridWidth, setGridWidth] = useState(0)
  const tileWidth = ((gridWidth || Math.min(windowWidth, 640) - 32) - 10) / 2
  const [groupSheet, setGroupSheet] = useState<'align' | 'mute' | null>(null)
  const [groupAligning, setGroupAligning] = useState(false)
  const keyboardVisible = useKeyboardVisible()
  const confirm = useConfirmation()
  const [modal, setModal] = useState<ModalKind>(openLibraryOnMount ? 'picker' : null)
  useEffect(() => { if (openLibraryOnMount) setModal('picker') }, [openLibraryOnMount])
  const [mixerOpen, setMixerOpen] = useState(false)
  const [reorderPreview, setReorderPreview] = useState<ReorderPreview | null>(null)
  const [draggingConfig, setDraggingConfig] = useState<string | null>(null)
  const libraryScroll = useRef<ScrollView>(null)
  const libraryScrollY = useRef(0)
  const libraryContentHeight = useRef(0)
  const libraryViewportHeight = useRef(0)
  const deleteTarget = useRef<View>(null)
  const savedTiles = useRef(new Map<string, View>())
  const dragGrid = useRef<{ id: string; scrollY: number; slots: Map<string, { x: number; y: number; width: number; height: number }> } | null>(null)
  const [gridPreview, setGridPreview] = useState<string | null>(null)
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
  const [legacyRecoveryOpen, setLegacyRecoveryOpen] = useState(false)
  const [librarySettingsOpen, setLibrarySettingsOpen] = useState(false)
  const [editingTrackId, setEditingTrackId] = useState<string | null>(null)
  const [stepSheetRetained, setStepSheetRetained] = useState(false)
  const [nameEditing, setNameEditing] = useState(false)
  const [cueTarget, setCueTarget] = useState<CueTarget | null>(null)
  const [activeStepId, setActiveStepId] = useState<string | null>(null)
  const [stepNameDraft, setStepNameDraft] = useState('')
  const [transferBusy, setTransferBusy] = useState(false)
  const [commandPending, setCommandPending] = useState(false)
  const commandPendingRef = useRef(false)
  const [draftName, setDraftName] = useState('')
  const currentRun = liveRuns.find(run => run.configurationId === state.selectedConfigId)
  const unnamedRun = liveRuns.find(run => run.configurationId === null)
  const storedUnnamed = state.drafts[UNNAMED_DRAFT_KEY]
  // Older saves left an exact copy behind under the unnamed key.
  const duplicateUnnamed = storedUnnamed && state.configs.some(config =>
    config.name === storedUnnamed.name && stableJson(config.program) === stableJson(storedUnnamed.program)
    && stableJson(config.settings) === stableJson(storedUnnamed.settings))
  const unnamedDraft = storedUnnamed && !storedUnnamed.baseConfigId && (unnamedRun || !duplicateUnnamed &&
    (state.selectedConfigId === null || hasUnifiedDraftChanges(storedUnnamed))) ? storedUnnamed : undefined
  const newestRuns = [...liveRuns].reverse()
  const savedConfigs = state.configs.filter(config => !liveRuns.some(run => run.configurationId === config.id))
  const originRun = liveRuns.find(run => run.id === libraryOriginRunId)
  const closeLibrary = () => {
    setLibrarySettingsOpen(false)
    setLegacyRecoveryOpen(false)
    setModal(null)
    const run = originRun ?? currentRun
    if (run) onOpenRun?.(run.id)
  }
  const currentKey = state.selectedConfigId ?? UNNAMED_DRAFT_KEY
  const storedDraft = own(state.drafts, currentKey) ? state.drafts[currentKey] : undefined
  const draft = storedDraft ? { ...storedDraft, settings: { ...storedDraft.settings, secondPrecisionEnabled: state.globalSecondPrecision ?? storedDraft.settings.secondPrecisionEnabled } } : undefined
  const hasDraftChanges = useMemo(() => !!draft && hasUnifiedDraftChanges(draft), [draft])
  const program = draft?.program
  const noMainInterval = program?.noMainInterval === true
  const activeStep = program?.steps.find(step => step.id === activeStepId) ?? program?.steps[0]
  const capabilities = ChandasTimerService.getCapabilities()
  const supportsInfinity = Platform.OS !== 'android' || !isNativeServiceAvailable || capabilities?.supportsNoMainInterval === true
  const nativeSchemaReady = Platform.OS !== 'android' || !isNativeServiceAvailable || (capabilities?.programSchemaMax ?? 0) >= 4
  const factory = defaultAppTimerSettings()
  const alarmDefaults = state.alarmDefaults ?? { sound: factory.alarmSound, durationSeconds: factory.alarmDurationSeconds }
  const effectiveAlarm = draft ? effectiveAlarmSettings(draft.program, draft.settings, alarmDefaults) : { alarmSound: alarmDefaults.sound, alarmDurationSeconds: alarmDefaults.durationSeconds }
  const soundPickerCue = cueTarget?.kind === 'alarm' ? { sound: effectiveAlarm.alarmSound, volume: draft?.settings.alarmVolume ?? 1 } : cueTarget ? getCue(draft, cueTarget) : null

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
    if (!modal && currentRun) onOpenRun?.(currentRun.id)
  }, [currentRun?.id, modal, onOpenRun])
  useEffect(() => {
    if (modal !== 'picker' || librarySettingsOpen) return
    const back = BackHandler.addEventListener('hardwareBackPress', () => { closeLibrary(); return true })
    return () => back.remove()
  }, [modal, librarySettingsOpen, currentRun?.id, originRun?.id, onOpenRun])
  useEffect(() => {
    if (!activeStepId || !program?.steps.some(step => step.id === activeStepId)) setActiveStepId(program?.steps[0]?.id ?? null)
  }, [activeStepId, program])
  useEffect(() => { setStepNameDraft(activeStep?.label ?? '') }, [activeStep?.id, activeStep?.label])

  useEffect(() => {
    if (!tour?.step) return
    if (tour.step === 'new') setModal('picker')
    if (tour.step === 'duration' || tour.step === 'bells') { setModal((program?.steps.length ?? 0) > 1 ? 'step' : null); setStepSheetRetained(false) }
    if (tour.step === 'start') { setModal(null); setStepSheetRetained(false) }
    if (tour.step === 'save' && draft && !draft.dirty) tour.go('gallery')
    if (tour.step === 'library' && state.selectedConfigId) {
      const timer = setTimeout(() => savedTiles.current.get(state.selectedConfigId!)?.measureInWindow((_x, y) => libraryScroll.current?.scrollTo({ y: Math.max(0, libraryScrollY.current + y - insets.top - 100), animated: true })), 350)
      return () => clearTimeout(timer)
    }
  }, [tour?.step, draft?.dirty, state.selectedConfigId])

  if (!draft || !program || !activeStep) return <View testID="unified-config-screen" style={[styles.screen, { backgroundColor: tokens.bg }]}><GentleNotice title="Timer configuration needs recovery" message="The saved timer state could not be opened safely. Its source data is preserved for recovery." tone="attention" /></View>

  const edit = (changes: Partial<Pick<UnifiedTimerDraft, 'name' | 'program' | 'settings' | 'editorOptions'>>) => onCommand({ type: 'edit', changes })
  const patchSettings = ({ secondPrecisionEnabled, ...changes }: Partial<AppTimerSettings>) => {
    if (secondPrecisionEnabled !== undefined) void onCommand({ type: 'setGlobalSecondPrecision', enabled: secondPrecisionEnabled })
    if (Object.keys(changes).length) edit({ settings: { ...storedDraft!.settings, ...changes } })
  }
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
    const changes: Partial<Pick<UnifiedTimerDraft, 'name' | 'program'>> = { program: { ...program, steps, ...(noMainInterval ? { noMainInterval: undefined } : {}) } }
    if (program.steps.length === 1 && draft.editorOptions.configurationNameIsCustom === false) changes.name = defaultUnifiedTimerName(durationSeconds)
    edit(changes)
  }
  const selectInfinity = () => {
    if (noMainInterval) return
    const tracks = activeStep.subBellTracks.length ? activeStep.subBellTracks : [makeNewTrack([], activeStep.durationSeconds)]
    const runPolicy = program.runPolicy.kind === 'cycles' ? { ...program.runPolicy, kind: 'continuous' as const } : program.runPolicy
    const name = draft.editorOptions.configurationNameIsCustom === false ? 'Sub-bell timer' : draft.name
    edit({ name, program: { ...program, noMainInterval: true, alignment: { kind: 'elapsed' }, runPolicy, steps: [{ ...activeStep, label: [...name].slice(0, 60).join(''), subBellsEnabled: true, subBellTracks: tracks }] } })
  }
  const updateConfigurationName = (name: string) => {
    const bounded = [...name].slice(0, 80).join('')
    edit({ name: bounded, editorOptions: { ...draft.editorOptions, configurationNameIsCustom: true }, ...(program.steps.length === 1 ? { program: { ...program, steps: program.steps.map(step => ({ ...step, label: [...name].slice(0, 60).join(''), labelIsCustom: true })) } } : {}) })
  }
  const switchTo = (configId: string | null, fresh = false) => {
    const choice = fresh && state.selectedConfigId === null ? 'discard' : 'keep'
    void performCommand({ type: 'switch', configId, fresh, choice }).then(accepted => { if (accepted) { setModal(null); tour?.advance('new') } })
  }
  const newSetup = () => {
    if (unnamedRun) {
      tour?.go('controls')
      onOpenRun?.(unnamedRun.id)
      return
    }
    switchTo(null, !unnamedDraft)
  }
  const saveCurrent = async () => { const accepted = await performCommand(draft.baseConfigId ? { type: 'save' } : { type: 'saveAs', name: draft.name, id: createProgramId() }); if (accepted) tour?.advance('save'); return accepted }
  const saveCopy = () => {
    const names = new Set(state.configs.map(config => config.name))
    let suffix = ' copy', index = 1
    let name = [...draft.name].slice(0, 80 - suffix.length).join('') + suffix
    while (names.has(name)) { suffix = ` copy ${++index}`; name = [...draft.name].slice(0, 80 - suffix.length).join('') + suffix }
    return performCommand({ type: 'saveAs', name, id: createProgramId() })
  }
  const discardLabel = draft.baseConfigId ? 'Discard draft' : 'Reset setup'
  const discardDraft = async () => {
    const accepted = await confirm({
      title: `${discardLabel}?`,
      message: draft.baseConfigId ? 'Restore the last saved version of this timer.' : 'Replace this timer’s setup with the defaults.',
      confirmLabel: discardLabel,
      cancelLabel: 'Keep editing',
      destructive: true,
    })
    if (accepted && await performCommand({ type: 'discardDraft', configId: state.selectedConfigId })) setModal(null)
  }
  const addStep = () => {
    if (program.steps.length >= MAX_SEQUENCE_STEPS) return
    const step: UnifiedTimerStep = {
      id: createProgramId(), label: defaultUnifiedStepLabel(300), labelIsCustom: false, durationSeconds: 300,
      endCue: cloneCue(program.steps.at(-1)!.endCue), endAlarmEnabled: false, subBellsEnabled: false, subBellTracks: [],
    }
    const previous = program.steps.length === 1 ? [{ ...program.steps[0], label: [...draft.name].slice(0, 60).join(''), labelIsCustom: draft.editorOptions.configurationNameIsCustom !== false }] : program.steps
    patchProgram({ steps: [...previous, step], noMainInterval: undefined })
    setActiveStepId(step.id)
  }
  const duplicateStep = (step: UnifiedTimerStep) => {
    if (program.steps.length >= MAX_SEQUENCE_STEPS) return
    const copy = { ...step, id: createProgramId(), label: copyLabel(step.label), endCue: cloneCue(step.endCue), subBellTracks: step.subBellTracks.map(track => ({ ...track, ...(track.points ? { points: track.points.map(point => ({ ...point })) } : {}), id: createProgramId(), sound: { ...track.sound }, sounds: track.sounds?.map(sound => ({ ...sound })), randomRepeat: track.randomRepeat ? { ...track.randomRepeat } : undefined, selectedOffsetsSeconds: [...track.selectedOffsetsSeconds] })) }
    patchProgram({ steps: insertUnifiedStepAfter(program.steps, step.id, copy) })
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
    if (cueTarget.kind === 'alarm') {
      if (patch.sound) patchProgram({ alarmOverrides: { ...program.alarmOverrides, sound: patch.sound } })
      if (typeof patch.volume === 'number') patchSettings({ alarmVolume: patch.volume })
    }
    else if (cueTarget.kind === 'completion') patchProgram({ completionCue: program.completionCue ? { ...program.completionCue, ...patch } : null })
    else if (cueTarget.kind === 'step-end') patchStep(cueTarget.stepId, { endCue: {
      ...program.steps.find(step => step.id === cueTarget.stepId)!.endCue,
      ...patch,
      // A new sound or volume explicitly replaces the retired inline mute setting.
      ...(patch.sound || patch.volume !== undefined ? { soundMuted: false } : {}),
    } })
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
      if (!await performCommand({ type: 'importConfig', config: imported.config, select: true })) return
      onFeedback({ title: 'Configuration imported', message: imported.hasDeviceSpecificSounds ? `“${imported.config.name}” was added. Device-specific sounds may need to be selected again.` : `“${imported.config.name}” was added to your configurations.`, tone: 'success' })
      setLibrarySettingsOpen(false)
      setModal(null)
    } catch {
      onFeedback({ title: 'Could not open that configuration', message: 'Choose a Chandas configuration file or try the clipboard again.', tone: 'attention' })
    } finally { setTransferBusy(false) }
  }
  const legacyRecoveryActions = state.legacyRecoveries.map(recovery => {
    const label = recovery.sourceMode === 'pattern' ? 'Cycle' : 'Sequence'
    const discard = async () => {
      const accepted = await confirm({ title: `Discard recovered ${label}?`, message: 'This hides the recovered copy from Configurations.', confirmLabel: 'Discard', cancelLabel: 'Cancel', destructive: true })
      if (accepted && await performCommand({ type: 'discardLegacyRecovery', id: recovery.id }) && state.legacyRecoveries.length === 1) setLegacyRecoveryOpen(false)
    }
    return <View key={recovery.id} style={styles.recoveryRow}>
      <View style={styles.flex}><SheetTextButton label={`Add recovered ${label}`} onPress={() => {
        const { name, program, settings, editorOptions } = recovery.draft
        const now = Date.now()
        const config: UnifiedTimerConfig = { id: createProgramId(), name, createdAt: now, updatedAt: now, program, settings, showInRunningSelector: true, editorOptions }
        void performCommand({ type: 'importConfig', config, select: false })
      }} /></View>
      <TimerControlButton size={44} label={`Discard recovered ${label}`} disabled={commandPending} onPress={() => void discard()}><TrashIcon color={tokens.warm} /></TimerControlButton>
    </View>
  })
  const exportConfig = async (config: Parameters<typeof serializeUnifiedConfiguration>[0]) => {
    if (transferBusy) return
    setTransferBusy(true)
    try {
      const exported = serializeUnifiedConfiguration(config)
      await copyConfigurationText(exported)
      await saveConfigurationFile(configurationTransferFilename(config.name), exported)
      onFeedback({ title: 'Configuration exported', message: `“${config.name}” is ready to share or save.`, tone: 'success' })
    } catch {
      onFeedback({ title: 'Could not export configuration', message: 'Try again in a moment.', tone: 'attention' })
    } finally { setTransferBusy(false) }
  }
  const exportDraft = () => {
    const saved = state.configs.find(config => config.id === draft.baseConfigId)
    void exportConfig({ ...draft, createdAt: saved?.createdAt ?? draft.updatedAt, showInRunningSelector: saved?.showInRunningSelector ?? true })
  }
  const automaticColor = timerIdentityColor(program.steps[0].id)
  const intervalColor = (step: UnifiedTimerStep) => theme === 'eink' ? tokens.accent : subBellColorValue(step.color ?? automaticColor, 0)
  const cycleDurationSeconds = program.steps.reduce((sum, step) => sum + step.durationSeconds, 0)
  const settingsProps: Omit<TimerSettingsSheetProps, 'visible' | 'onClose' | 'actions'> = {
    onStartTutorial, onOpenStarterTimers,
    state, onCommand, settings: draft.settings, onSettings: patchSettings,
    focusState, onFocusAutomationChange, onOpenFocusSettings, onOpenFocusRuleSettings,
    androidAccess, onOpenExactAlarmSettings, onOpenFullScreenIntentSettings,
    onRequestCallMuteAccess, onRequestNotificationAccess, onFeedback,
  }
  const settingsSheet = <TimerSettingsSheet {...settingsProps} visible={!alarmRinging && modal === 'settings'} onClose={() => setModal(null)} actions={
      <View style={[styles.setupMenuActions, { borderColor: tokens.border }]}>
        <SetupMenuAction label="Duplicate" disabled={commandPending} onPress={() => void saveCopy().then(saved => { if (saved) setModal(null) })}><SaveIcon color={tokens.text} /></SetupMenuAction>
        <SetupMenuAction label="Export" disabled={transferBusy} onPress={exportDraft}>
          <Svg width={18} height={18} viewBox="0 0 24 24" fill="none"><Path d="M12 16V3m-4 4 4-4 4 4M5 12v8h14v-8" stroke={tokens.text} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" /></Svg>
        </SetupMenuAction>
        {hasDraftChanges ? <SetupMenuAction label={discardLabel} destructive disabled={commandPending} onPress={() => void discardDraft()}>{draft.baseConfigId ? <TrashIcon color={tokens.warm} /> : <RestartIcon color={tokens.warm} />}</SetupMenuAction> : null}
      </View>
  } />
  if (modal === 'picker') {
    const allPaused = newestRuns.every(run => run.paused)
    const anyMuted = newestRuns.some(run => run.muted)
    const muteDeadlines = [...new Set(newestRuns.filter(run => run.muted && run.mutedUntil > Date.now()).map(run => run.mutedUntil))].sort((a, b) => a - b)
    const muteSummary = muteDeadlines.length === 1 ? `Muted until ${formatEventLocalTime(muteDeadlines[0])}` : muteDeadlines.length > 1 ? `Muted until ${formatEventLocalTime(muteDeadlines[0])}–${formatEventLocalTime(muteDeadlines[muteDeadlines.length - 1])}` : undefined
    const controlSize = Math.min(48, Math.floor((windowWidth - 52) / 6))
    const alignableRuns = newestRuns.filter(run => !run.program.noMainInterval)
    const groupCycleSeconds = alignableRuns.map(run => run.program.steps.reduce((sum, step) => sum + step.durationSeconds, 0))
      .reduce((smallest, seconds) => clockMinutePhaseCount(seconds) < clockMinutePhaseCount(smallest) ? seconds : smallest, 3600)
    const tooltip = (title: string) => { selectionHaptic(); onFeedback({ title, tone: 'info' }) }
    const alignGroup = async (offset: number) => {
      if (groupAligning) return
      setGroupAligning(true)
      try { await onGroupAlign?.(offset) }
      finally { setGroupAligning(false); setGroupSheet(null) }
    }
    const deleteSaved = async (config: UnifiedTimerConfig, run?: LibraryRun) => {
      const message = [run && 'Its running timer will stop.', state.drafts[config.id]?.dirty && 'Its saved configuration and draft edits will be removed.'].filter(Boolean).join(' ')
      if (await confirm({ title: 'Delete ' + config.name + '?', message: message || 'This removes the saved configuration.', confirmLabel: 'Delete', cancelLabel: 'Keep', destructive: true })) await onDeleteConfiguration(config.id)
    }
    const moveSaved = async (id: string, targetId: string) => {
      if (id !== targetId) await performCommand({ type: 'moveConfig', id, targetId })
    }
    const gridTarget = (x: number, y: number) => {
      const grid = dragGrid.current
      if (!grid) return
      const originalY = y + libraryScrollY.current - grid.scrollY
      for (const [id, box] of grid.slots) {
        if (x >= box.x && x < box.x + box.width && originalY >= box.y && originalY < box.y + box.height) return id
      }
    }
    const startGridDrag = (id: string) => {
      const grid = { id, scrollY: libraryScrollY.current, slots: new Map<string, { x: number; y: number; width: number; height: number }>() }
      dragGrid.current = grid
      for (const [tileId, tile] of savedTiles.current) {
        tile.measureInWindow((x, y, width, height) => { if (width > 0 && height > 0) grid.slots.set(tileId, { x, y, width, height }) })
      }
      setDraggingConfig(id)
    }
    const finishGridDrag = () => {
      dragGrid.current = null
      setGridPreview(null)
      setDraggingConfig(null)
    }
    const dropSaved = async (config: UnifiedTimerConfig, x: number, y: number) => {
      const target = deleteTarget.current
      const overDelete = target && await new Promise<boolean>(resolve => {
        target.measureInWindow((left, top, width, height) => resolve(width > 0 && height > 0 && x >= left && x <= left + width && y >= top && y <= top + height))
      })
      if (overDelete) {
        finishGridDrag()
        void deleteSaved(config)
        return
      }
      const targetId = gridTarget(x, y)
      if (targetId) await moveSaved(config.id, targetId)
    }
    const from = savedConfigs.findIndex(config => config.id === draggingConfig)
    const to = savedConfigs.findIndex(config => config.id === gridPreview)
    const renderConfig = (config: UnifiedTimerConfig, run?: LibraryRun) => {
      const savedIndex = savedConfigs.findIndex(item => item.id === config.id)
      const targetIndex = from >= 0 && to >= 0 && from !== to
        ? savedIndex + (from < to && savedIndex > from && savedIndex <= to ? -1 : from > to && savedIndex >= to && savedIndex < from ? 1 : 0)
        : savedIndex
      const currentBox = dragGrid.current?.slots.get(config.id)
      const targetBox = dragGrid.current?.slots.get(savedConfigs[targetIndex]?.id)
      return <ConfigCard key={config.id} config={config} tileWidth={tileWidth} onTooltip={tooltip} onRunReset={onRunReset} onRunSkip={onRunSkip} onRunSnap={onRunSnap} selected={config.id === state.selectedConfigId} run={run} onOpenRun={onOpenRun} draft={state.drafts[config.id]} startDisabled={!nativeSchemaReady || starting} onSelect={() => switchTo(config.id)} onStart={() => onStartConfiguration?.(config.id)} onDuplicate={() => { void performCommand({ type: 'duplicate', id: config.id, newId: createProgramId() }) }} onVisibility={showInRunningSelector => { void performCommand({ type: 'setVisibility', id: config.id, showInRunningSelector }) }} onDelete={() => deleteSaved(config, run)} onExport={() => void exportConfig(config)} transferBusy={transferBusy} onStop={run ? () => onStopRuns?.([run.id]) : undefined} reorder={run ? undefined : {
        active: draggingConfig === config.id,
        bind: view => { if (view) savedTiles.current.set(config.id, view); else savedTiles.current.delete(config.id) },
        start: () => startGridDrag(config.id),
        preview: (x, y) => {
          const target = gridTarget(x, y)
          if (target) setGridPreview(target === config.id ? null : target)
        },
        offsetX: currentBox && targetBox ? targetBox.x - currentBox.x : 0,
        offsetY: currentBox && targetBox ? targetBox.y - currentBox.y : 0,
        previewing: draggingConfig !== null,
        scroll: y => {
          const bottom = windowHeight - insets.bottom - 82
          if (y >= bottom) return 0
          const delta = edgeAutoScrollStep(y, insets.top + 64, bottom, 42, true, true, 12)
          const next = Math.max(0, Math.min(libraryContentHeight.current - libraryViewportHeight.current, libraryScrollY.current + delta))
          const applied = next - libraryScrollY.current
          if (applied) {
            libraryScrollY.current = next
            libraryScroll.current?.scrollTo({ y: next, animated: false })
          }
          return applied
        },
        drop: (x, y) => dropSaved(config, x, y),
        finish: finishGridDrag,
        adjust: delta => {
          const target = savedConfigs[savedIndex + delta]
          if (target) void moveSaved(config.id, target.id)
        },
      }} />
    }
    const renderUnnamed = (run?: LibraryRun) => unnamedDraft ? <ConfigurationTile key={UNNAMED_DRAFT_KEY} tileWidth={tileWidth} onTooltip={tooltip} onRunReset={onRunReset} onRunSkip={onRunSkip} onRunSnap={onRunSnap} defaultAlignment={unnamedDraft.program.alignment} name={unnamedDraft.name} program={unnamedDraft.program} menuLabel="Working copy options" selected={state.selectedConfigId === null} dirty={hasUnifiedDraftChanges(unnamedDraft)} run={run} onOpen={() => run ? onOpenRun?.(run.id) : switchTo(null)} onPlay={state.selectedConfigId === null || run || onOpenRun ? () => onStartConfiguration?.(UNNAMED_DRAFT_KEY) : undefined} playDisabled={!nativeSchemaReady || starting} onStop={run ? () => onStopRuns?.([run.id]) : undefined} menuItems={state.selectedConfigId === null && !run ? [{ label: 'Duplicate', onPress: saveCopy }] : []} /> : null
    return <View testID="unified-config-picker-sheet" style={[styles.screen, { backgroundColor: tokens.bg, paddingTop: insets.top + 8 }]}>
      <View style={[styles.libraryHeader, { borderColor: tokens.border }]}>
        <Pressable accessibilityRole="button" accessibilityLabel="Return to timer" onPress={closeLibrary} style={styles.libraryHeaderButton}><Text style={{ color: tokens.text, fontSize: 24 }}>‹</Text></Pressable>
        <Text numberOfLines={1} style={[styles.pageTitle, styles.flex, { color: tokens.text }]}>Configurations</Text>
        <TourTarget id="tour-new"><Pressable accessibilityRole="button" accessibilityLabel="New configuration" onPress={() => void newSetup()} style={styles.libraryHeaderButton}><Svg width={18} height={18} viewBox="0 0 24 24" fill="none"><Path d="M12 5v14M5 12h14" stroke={tokens.text} strokeWidth={2} strokeLinecap="round" /></Svg></Pressable></TourTarget>
        <SettingsButton compact onPress={() => setLibrarySettingsOpen(true)} />
      </View>
      <ScrollView ref={libraryScroll} showsVerticalScrollIndicator={false} scrollEnabled={!draggingConfig} onLayout={event => { libraryViewportHeight.current = event.nativeEvent.layout.height }} onContentSizeChange={(_, height) => { libraryContentHeight.current = height }} onScroll={event => { libraryScrollY.current = event.nativeEvent.contentOffset.y }} scrollEventThrottle={16} contentContainerStyle={[styles.libraryContent, { paddingBottom: insets.bottom + 144 }]}>
        {newestRuns.length > 0 ? <View style={styles.section}>
          <View style={styles.groupControls}>
            <TimerControlButton size={controlSize} onTooltip={tooltip} label="Back to running timer" onPress={() => onOpenRun?.((originRun ?? newestRuns[0]).id)}>
              <Svg width={18} height={18} viewBox="0 0 24 24"><Circle cx={12} cy={12} r={9} stroke={tokens.text} strokeWidth={1.8} fill="none" /><Circle cx={12} cy={12} r={5} stroke={tokens.text} strokeWidth={1.8} fill="none" strokeDasharray="24 8" /></Svg>
            </TimerControlButton>
            <TimerControlButton size={controlSize} onTooltip={tooltip} label={allPaused ? 'Resume all timers' : 'Pause all timers'} onPress={() => onGroupPause?.(!allPaused)}><TimerTransportIcon color={tokens.text} kind={allPaused ? 'play' : 'pause'} /></TimerControlButton>
            <TimerControlButton size={controlSize} onTooltip={tooltip} label="Reset all timers" onPress={async () => { if (await confirm({ title: 'Reset all timers?', message: 'Every active timer will restart immediately, including paused timers.', confirmLabel: 'Reset all', cancelLabel: 'Cancel' })) onGroupReset?.() }}><RestartIcon color={tokens.text} /></TimerControlButton>
            {alignableRuns.length > 0 ? <TimerControlButton size={controlSize} onTooltip={tooltip} label="Align timers to clock" onPress={() => setGroupSheet('align')}><ClockIcon color={tokens.text} /></TimerControlButton> : null}
            <TimerControlButton size={controlSize} onTooltip={tooltip} active={anyMuted} label="Mute timers" onPress={() => setGroupSheet('mute')}><VolumeIcon muted={anyMuted} color={tokens.text} /></TimerControlButton>
            <TimerControlButton size={controlSize} onTooltip={tooltip} label="Stop all timers" onPress={async () => { if (await confirm({ title: 'Stop all timers?', message: 'All active countdowns will stop.', confirmLabel: 'Stop all', cancelLabel: 'Cancel', destructive: true })) onStopRuns?.(newestRuns.map(run => run.id)) }}><TimerTransportIcon kind="stop" color={tokens.text} /></TimerControlButton>
          </View>
          <View style={styles.configurationGrid} onLayout={event => setGridWidth(event.nativeEvent.layout.width)}>{newestRuns.map(run => {
            const config = state.configs.find(item => item.id === run.configurationId)
            return config ? renderConfig(config, run) : renderUnnamed(run)
          })}</View>
        </View> : null}
        {newestRuns.length > 0 && (savedConfigs.length > 0 || (unnamedDraft && !unnamedRun)) ? <View style={[styles.libraryDivider, { backgroundColor: tokens.border }]} /> : null}
        <View style={styles.section}>
          <View style={styles.configurationGrid} onLayout={event => setGridWidth(event.nativeEvent.layout.width)}>{!unnamedRun ? renderUnnamed() : null}{savedConfigs.map(config => renderConfig(config))}</View>
        </View>
        {state.legacyRecoveries.length > 0 && !state.legacyRecoveryNoticeDismissed ? <View style={[styles.notice, { borderColor: tokens.warm }]}>
          <View style={styles.row}>
            <Text style={[styles.rowTitle, styles.flex, { color: tokens.text }]}>Recovered legacy timers</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Dismiss legacy timer notice" onPress={() => void performCommand({ type: 'dismissLegacyRecoveryNotice' })} style={styles.libraryHeaderButton}><Text style={{ color: tokens.textMuted, fontSize: 22 }}>×</Text></Pressable>
          </View>
          <Text style={[styles.helperText, { color: tokens.textMuted }]}>Add a recovered working copy as a saved configuration.</Text>
          {legacyRecoveryActions}
        </View> : null}
      </ScrollView>
      <TimerSettingsSheet {...settingsProps} visible={!alarmRinging && librarySettingsOpen} onClose={() => setLibrarySettingsOpen(false)} actions={
        <View style={[styles.setupMenuActions, { borderColor: tokens.border }]}>
          <SetupMenuAction label="Import file" testID="unified-config-import-file" disabled={transferBusy} onPress={() => void openExternalImport('file')}><ImportIcon color={tokens.text} /></SetupMenuAction>
          <SetupMenuAction label="Paste" testID="unified-config-import-clipboard" accessibilityLabel="Import from clipboard" disabled={transferBusy} onPress={() => void openExternalImport('clipboard')}><ClipboardIcon color={tokens.text} /></SetupMenuAction>
          {state.legacyRecoveries.length > 0 && state.legacyRecoveryNoticeDismissed ? <SetupMenuAction label="Recovered timers" onPress={() => setLegacyRecoveryOpen(true)}><RestartIcon color={tokens.text} /></SetupMenuAction> : null}
        </View>
      } />
      <BottomSheet visible={!alarmRinging && legacyRecoveryOpen && state.legacyRecoveries.length > 0} fitContent title="Recovered legacy timers" onClose={() => setLegacyRecoveryOpen(false)}>{legacyRecoveryActions}</BottomSheet>
      <BottomSheet visible={!alarmRinging && groupSheet === 'align' && alignableRuns.length > 0} title="Align timers to clock" fitContent onClose={() => { if (!groupAligning) setGroupSheet(null) }}>
        <Text style={[styles.helperText, { color: tokens.textMuted }]}>{alignableRuns.some(run => run.paused) ? 'Choose a clock offset. Changing a paused timer’s alignment resumes it.' : 'Choose a clock offset for active interval timers.'}</Text>
        <ClockSnapSelector cycleDurationSeconds={groupCycleSeconds} value={null} disabled={groupAligning} onChange={offset => void alignGroup(offset)} />
      </BottomSheet>
      <BottomSheet visible={!alarmRinging && groupSheet === 'mute' && newestRuns.length > 0} title="Mute timers" fitContent partialHeightFraction={0.8} onClose={() => setGroupSheet(null)}>
        {groupSheet === 'mute' ? <TimerMuteControls muted={anyMuted} muteSummary={muteSummary} secondPrecision={state.globalSecondPrecision} getSuggestions={getGroupMuteSuggestions} onMuteForSeconds={value => onGroupMute?.({ kind: 'seconds', value })} onMuteUntil={value => onGroupMute?.({ kind: 'until', value })} onClearMute={() => onGroupMute?.({ kind: 'clear' })} /> : null}
      </BottomSheet>
      <View ref={deleteTarget} collapsable={false} pointerEvents="none" accessibilityElementsHidden={!draggingConfig} importantForAccessibility={draggingConfig ? 'auto' : 'no-hide-descendants'} style={[styles.configDropTarget, { bottom: insets.bottom + 8, opacity: draggingConfig ? 1 : 0, backgroundColor: tokens.surfaceHi, borderColor: tokens.warm }]}><Text style={{ color: tokens.warm, fontSize: 22 }}>×</Text><Text style={{ color: tokens.text }}>Drop to delete</Text></View>
    </View>
  }
  return <KeyboardAvoidingView testID="unified-config-screen" style={[styles.screen, { backgroundColor: tokens.bg }]} behavior={Platform.OS === 'ios' ? 'padding' : Platform.OS === 'android' ? 'height' : undefined}>
    <ScrollView ref={pageScroll} showsVerticalScrollIndicator={false} scrollEnabled={!reorderPreview} onScroll={event => { pageScrollY.current = event.nativeEvent.contentOffset.y }} scrollEventThrottle={16} onLayout={event => { const height = event.nativeEvent.layout.height; pageViewport.current.height = height; pageScroll.current?.getNativeScrollRef()?.measureInWindow((_x: number, y: number) => { pageViewport.current = { top: y, bottom: y + height, height } }) }} onContentSizeChange={(_width, height) => { pageScrollMax.current = Math.max(0, height - pageViewport.current.height) }} contentContainerStyle={[styles.setupPage, { paddingTop: insets.top + 12, paddingBottom: keyboardVisible ? 12 : insets.bottom + 18 }]} keyboardShouldPersistTaps="handled">
      <View style={styles.topBar}>
        {currentRun ? <Text numberOfLines={1} style={[styles.pageTitle, styles.nameEdit, { color: tokens.text }]}>{draft.name}</Text> : nameEditing ? <TextInput testID="unified-config-name" accessibilityLabel="Timer configuration name" autoFocus value={draftName} onChangeText={value => { const next = [...value].slice(0, 80).join(''); setDraftName(next); if (next.trim()) updateConfigurationName(next) }} onBlur={() => { const name = draftName.trim() || draft.name; setDraftName(name); if (name !== draft.name) updateConfigurationName(name); setNameEditing(false) }} placeholder="Timer name" placeholderTextColor={tokens.textMuted} style={[styles.nameInput, { color: tokens.text, borderBottomColor: tokens.accent }]} returnKeyType="done" /> : <Pressable testID="unified-config-name" accessibilityRole="button" accessibilityLabel={`Edit timer name, ${draft.name}`} onPress={() => setNameEditing(true)} style={styles.nameEdit}><Text numberOfLines={1} style={[styles.pageTitle, { color: tokens.text }]}>{draft.name}</Text></Pressable>}
        <View style={styles.topActions}>
          {draft.dirty && !currentRun ? <TourTarget id="tour-save"><Pressable testID="unified-config-save" accessibilityRole="button" accessibilityLabel="Save current configuration" accessibilityHint="Long press to save a copy" disabled={commandPending} onPress={() => void saveCurrent()} onLongPress={saveCopy} style={[styles.iconButton, { borderColor: tokens.border }]}><SaveIcon color={tokens.text} /></Pressable></TourTarget> : null}
          <TourTarget id="tour-gallery"><Pressable testID="unified-config-open-picker" accessibilityRole="button" accessibilityLabel="Configurations" onPress={() => { setModal('picker'); tour?.advance('gallery') }} style={[styles.iconButton, { borderColor: tokens.border }]}><ConfigurationIcon color={tokens.text} /></Pressable></TourTarget>
          {!currentRun ? <SettingsButton onPress={() => setModal('settings')} /> : null}
        </View>
      </View>

      {!currentRun && newestRuns[0] ? <Pressable accessibilityRole="button" accessibilityLabel="Return to running timer" onPress={() => onOpenRun?.(newestRuns[0].id)} style={[styles.runningShortcut, { borderColor: tokens.border }]}><ClockIcon color={tokens.text} /><Text style={{ color: tokens.text }}>{newestRuns[0].countdown} · {newestRuns.length === 1 ? newestRuns[0].paused ? 'Paused timer' : 'Running timer' : `${newestRuns.length} active timers`}</Text><Text style={{ color: tokens.text }}>›</Text></Pressable> : null}

      {!currentRun ? <>
      {program.steps.length > 1 ? <TimerControlRail singleStep={program.steps.length === 1} showGlobal={true} program={program} settings={{ ...draft.settings, ...effectiveAlarm }} onAlarmSound={() => setCueTarget({ kind: 'alarm' })} step={activeStep} cycleDurationSeconds={cycleDurationSeconds} onProgram={patchProgram} onSettings={patchSettings} onOpenMixer={() => setMixerOpen(true)} onCueHaptics={hapticOverride => patchStep(activeStep.id, { endCue: { ...activeStep.endCue, hapticOverride } })} onAlarm={endAlarmEnabled => patchStep(activeStep.id, { endAlarmEnabled })} /> : null}
      {program.steps.length === 1 ? <UnifiedIntervalEditor noMainInterval={noMainInterval} onInfinity={supportsInfinity || noMainInterval ? selectInfinity : undefined} step={activeStep} automaticColor={automaticColor} onColor={color => patchStep(activeStep.id, { color })} secondPrecision={draft.settings.secondPrecisionEnabled} onDuration={seconds => { updateStepDuration(activeStep.id, seconds); tour?.advance('duration') }} onSound={() => setCueTarget({ kind: 'step-end', stepId: activeStep.id })} onSubBells={() => { setStepSheetRetained(false); setModal('subbells'); tour?.advance('bells') }} onSubBellsEnabled={subBellsEnabled => patchStep(activeStep.id, { subBellsEnabled })} controls={<TimerControlRail singleStep={program.steps.length === 1} showGlobal={true} program={program} settings={{ ...draft.settings, ...effectiveAlarm }} onAlarmSound={() => setCueTarget({ kind: 'alarm' })} step={activeStep} cycleDurationSeconds={cycleDurationSeconds} onProgram={patchProgram} onSettings={patchSettings} onOpenMixer={() => setMixerOpen(true)} onCueHaptics={hapticOverride => patchStep(activeStep.id, { endCue: { ...activeStep.endCue, hapticOverride } })} onAlarm={endAlarmEnabled => patchStep(activeStep.id, { endAlarmEnabled })} />} /> : <View style={styles.section}>
        <View style={{ gap: 12 }}>{program.steps.map((step, index) => <UnifiedStepCard key={step.id} step={step} boundaryColor={intervalColor(step)} index={index} itemCount={program.steps.length} preview={reorderPreview} onPreview={setReorderPreview} onAutoScroll={autoScrollSteps} onMove={moveStep} onDuplicate={program.steps.length < MAX_SEQUENCE_STEPS ? () => duplicateStep(step) : undefined} onDelete={program.steps.length > 1 ? () => removeStep(step) : undefined} onEdit={() => { setActiveStepId(step.id); setStepSheetRetained(false); setModal('step') }} />)}</View>

      </View>}


      <View style={styles.mainActions}>
        <Pressable testID="unified-add-step" accessibilityRole="button" accessibilityState={{ disabled: program.steps.length >= MAX_SEQUENCE_STEPS }} disabled={program.steps.length >= MAX_SEQUENCE_STEPS} onPress={addStep} style={[styles.secondaryButton, { borderColor: tokens.border }]}><Text style={{ color: tokens.text }}>＋ Add step</Text></Pressable>
        {program.runPolicy.kind !== 'continuous' ? <Pressable testID="unified-completion-sound" accessibilityRole="button" onPress={() => { if (!program.completionCue) patchProgram({ completionCue: { sound: { kind: 'builtin', id: 'temple-gong' }, volume: 1 } }); setCueTarget({ kind: 'completion' }) }} style={[styles.secondaryButton, { borderColor: tokens.border }]}><Text style={{ color: tokens.text }}>{program.completionCue ? `Completion · ${soundTitle(program.completionCue.sound)}` : '＋ Add completion sound'}</Text></Pressable> : null}
        {program.runPolicy.kind !== 'continuous' && program.completionCue ? <OverflowMenu label="Completion sound options" items={[{ label: 'Remove completion sound', destructive: true, onPress: () => patchProgram({ completionCue: null }) }]} /> : null}
      </View>
      {!nativeSchemaReady ? <Text style={[styles.noticeText, { color: tokens.warm }]}>Update Chandas to start this timer.</Text> : null}
      </> : null}
    </ScrollView>
    {!currentRun ? <TourTarget id="tour-start"><View style={[styles.startDock, { borderColor: tokens.border, paddingBottom: Math.max(insets.bottom, 10), backgroundColor: tokens.bg }]}>
      <Pressable testID="unified-config-start" disabled={!nativeSchemaReady || starting} onPress={() => { tapHaptic(); onStart() }} accessibilityRole="button" accessibilityState={{ disabled: !nativeSchemaReady || starting, busy: starting }} style={({ pressed }) => [styles.startButton, { backgroundColor: theme === 'eink' ? tokens.surface : tokens.accent, borderColor: tokens.border, opacity: !nativeSchemaReady || starting ? 0.52 : pressed ? 0.8 : 1 }]}>
        {starting ? <ActivityIndicator color={theme === 'eink' ? tokens.text : '#fff'} /> : null}<Text style={[styles.startText, { color: theme === 'eink' ? tokens.text : '#fff' }]}>{starting ? 'Starting timer…' : 'Start timer'}</Text>
      </Pressable>
    </View></TourTarget> : null}

    {settingsSheet}

    <DraggableSheet visible={modal === 'step' || ((modal === 'subbells' || modal === 'track') && stepSheetRetained)} title={activeStep.label} showTitle={false} pinnedContent={<View style={[styles.row, { zIndex: 30 }]}><TextInput testID={`unified-config-step-name-${activeStep.id}`} accessibilityLabel="Step name" value={stepNameDraft} onChangeText={value => { const label = [...value].slice(0, 60).join(''); setStepNameDraft(label); if (label.trim()) patchStep(activeStep.id, { label, labelIsCustom: true }) }} onBlur={() => { const label = stepNameDraft.trim() || activeStep.label; setStepNameDraft(label); if (label !== activeStep.label) patchStep(activeStep.id, { label, labelIsCustom: true }) }} placeholder="Step name" placeholderTextColor={tokens.textMuted} style={[styles.trackNameInput, styles.flex, { borderBottomColor: tokens.accent, color: tokens.text }]} /><OverflowMenu label="Step options" items={[{ label: 'Duplicate', icon: 'duplicate', disabled: program.steps.length >= MAX_SEQUENCE_STEPS, onPress: () => duplicateStep(activeStep) }, { label: 'Delete', icon: 'delete', disabled: program.steps.length <= 1, destructive: true, onPress: () => void removeStep(activeStep) }]} /></View>} testID="unified-step-sheet" onClose={() => { setModal(null); setStepSheetRetained(false) }}>
      <UnifiedIntervalEditor isStep step={activeStep} automaticColor={automaticColor} onColor={color => patchStep(activeStep.id, { color })} secondPrecision={draft.settings.secondPrecisionEnabled} onDuration={seconds => { updateStepDuration(activeStep.id, seconds); tour?.advance('duration') }} onSound={() => setCueTarget({ kind: 'step-end', stepId: activeStep.id })} onSubBells={() => { setStepSheetRetained(true); setModal('subbells'); tour?.advance('bells') }} onSubBellsEnabled={subBellsEnabled => patchStep(activeStep.id, { subBellsEnabled })} controls={<TimerControlRail singleStep={program.steps.length === 1} showGlobal={false} program={program} settings={{ ...draft.settings, ...effectiveAlarm }} onAlarmSound={() => setCueTarget({ kind: 'alarm' })} step={activeStep} cycleDurationSeconds={cycleDurationSeconds} onProgram={patchProgram} onSettings={patchSettings} onOpenMixer={() => setMixerOpen(true)} onCueHaptics={hapticOverride => patchStep(activeStep.id, { endCue: { ...activeStep.endCue, hapticOverride } })} onAlarm={endAlarmEnabled => patchStep(activeStep.id, { endAlarmEnabled })} />} />
    </DraggableSheet>

    <DraggableSheet visible={modal === 'subbells' || modal === 'track'} title="Sub-bells" testID="unified-subbells-sheet" onClose={() => { setModal(stepSheetRetained ? 'step' : null); setStepSheetRetained(false) }}>
      {!noMainInterval ? <View style={styles.subBellHeader}><View style={styles.flex}><Text style={[styles.rowTitle, { color: tokens.text }]}>Sub-bells in {program.steps.length > 1 ? activeStep.label : 'this interval'}</Text><Text style={[styles.helperText, { color: tokens.textMuted }]}>Each sub-bell keeps its own sound and timing.</Text></View><Toggle value={activeStep.subBellsEnabled} onChange={subBellsEnabled => patchStep(activeStep.id, { subBellsEnabled })} accessibilityLabel="Enable sub-bells" /></View> : null}
      {!noMainInterval ? <PatternTimelinePreview tracks={asPatternTracks(activeStep.subBellsEnabled ? activeStep.subBellTracks : [])} mainDurationSeconds={activeStep.durationSeconds} boundaryColor={intervalColor(activeStep)} /> : null}
      {activeStep.subBellTracks.map((track, index) => <SwipeActionRow key={track.id} testID={`unified-track-swipe-${track.id}`} accessibilityLabel={track.label} onDuplicate={activeStep.subBellTracks.length < MAX_PATTERN_TRACKS ? () => { duplicateTrack(track) } : undefined} onDelete={() => removeTrack(track)}>{canPress => <View testID={`unified-track-row-${track.id}`} style={[styles.trackListRow, { borderColor: tokens.border, backgroundColor: tokens.surface }]}>
        <Pressable accessibilityRole="button" accessibilityLabel={`Edit ${track.label}`} onPress={() => { if (canPress()) { setEditingTrackId(track.id); setModal('track') } }} style={[styles.trackListEdit, styles.flex]}>
          <View style={[styles.trackDot, { backgroundColor: subBellColorValue(track.color, index, theme === 'eink') }]} /><View style={styles.flex}><Text style={[styles.rowTitle, { color: tokens.text }]}>{track.label}</Text><Text style={[styles.helperText, { color: tokens.textMuted }]}><SoundSummary cue={track} /> · {trackTimingSummary(track, noMainInterval)}</Text></View>
        </Pressable>
        <Toggle value={track.enabled} onChange={enabled => { if (canPress()) patchTrack(activeStep.id, track.id, { enabled }) }} accessibilityLabel={`Enable ${track.label}`} /><Text accessible={false} style={{ color: tokens.accent }}>›</Text>
      </View>}</SwipeActionRow>)}
      <TourTarget id="tour-add-bell"><Pressable testID="unified-add-subbell" accessibilityRole="button" disabled={activeStep.subBellTracks.length >= MAX_PATTERN_TRACKS} onPress={() => { const track = makeNewTrack(activeStep.subBellTracks, activeStep.durationSeconds); patchStep(activeStep.id, { subBellsEnabled: true, subBellTracks: [...activeStep.subBellTracks, track] }); setEditingTrackId(track.id); setModal('track'); tour?.advance('add-bell') }} style={[styles.secondaryButton, { borderColor: tokens.border }]}><Text style={{ color: tokens.accent }}>＋ Add a sub-bell</Text></Pressable></TourTarget>
    </DraggableSheet>

    <DraggableSheet visible={modal === 'track'} title={editingTrackId ? activeStep.subBellTracks.find(track => track.id === editingTrackId)?.label ?? 'Sub-bell' : 'Sub-bell'} showTitle={false} pinnedContent={(() => { const track = activeStep.subBellTracks.find(item => item.id === editingTrackId); return track ? <TrackNameHeader key={track.id} track={track} onRename={label => patchTrack(activeStep.id, track.id, { label })} onDuplicate={() => { const id = duplicateTrack(track); if (id) setEditingTrackId(id) }} onDelete={() => void removeTrack(track)} /> : null })()} testID="unified-track-sheet" onClose={() => setModal('subbells')}>
      {(() => { const track = activeStep.subBellTracks.find(item => item.id === editingTrackId); return track ? <TrackDetail noMainInterval={noMainInterval} track={track} durationSeconds={activeStep.durationSeconds} secondPrecision={draft.settings.secondPrecisionEnabled} settings={draft.settings} onPatch={changes => patchTrack(activeStep.id, track.id, changes)} onOpenSound={() => setCueTarget({ kind: 'track', stepId: activeStep.id, trackId: track.id })} /> : null })()}
    </DraggableSheet>

    <DraggableSheet visible={mixerOpen} title="Volume mixer" initialSnap={program.steps.length > 1 || activeStep.subBellTracks.length > 2 ? "full" : "partial"} testID="unified-volume-mixer" onClose={() => setMixerOpen(false)}>
      <VolumeControl cue={noMainInterval ? activeStep.subBellTracks[0] ?? activeStep.endCue : activeStep.endCue} masterVolume={draft.settings.masterVolume} masterControl label="Overall volume" value={draft.settings.masterVolume} onChange={masterVolume => patchSettings({ masterVolume })} />
      {program.steps.map(step => <View key={step.id} style={styles.section}>
        {program.steps.length > 1 ? <Text style={[styles.helperText, { color: tokens.textMuted, fontSize: 13, paddingTop: 8 }]}>{step.label}</Text> : null}
        {!noMainInterval ? <VolumeControl accessibilityLabel={`${step.label} ending cue`} cue={step.endCue} masterVolume={draft.settings.masterVolume} label="At the end" value={step.endCue.volume} onChange={volume => patchStep(step.id, { endCue: { ...step.endCue, volume } })} /> : null}
        {step.subBellTracks.map(track => <VolumeControl key={track.id} accessibilityLabel={`${step.label}, ${track.label}`} cue={track} masterVolume={draft.settings.masterVolume} label={track.label} value={track.volume} onChange={volume => patchTrack(step.id, track.id, { volume })} />)}
      </View>)}
      {program.completionCue ? <VolumeControl cue={program.completionCue} masterVolume={draft.settings.masterVolume} label="Completion sound" value={program.completionCue.volume} onChange={volume => patchProgram({ completionCue: { ...program.completionCue!, volume } })} /> : null}
      {!noMainInterval ? <VolumeControl cue={{ sound: effectiveAlarm.alarmSound, volume: draft.settings.alarmVolume }} masterVolume={draft.settings.masterVolume} alarmPreview label="Alarm" value={draft.settings.alarmVolume} onChange={alarmVolume => patchSettings({ alarmVolume })} /> : null}
    </DraggableSheet>

    {soundPickerCue && cueTarget ? <SoundPickerSheet visible title={cueTarget.kind === 'alarm' ? 'Alarm sound' : cueTarget.kind === 'completion' ? 'Completion cue' : cueTarget.kind === 'track' ? 'Sub-bell sound' : 'Step ending cue'} cue={soundPickerCue} soundLibrary={state.soundLibrary} masterVolume={draft.settings.masterVolume} advanced={cueTarget.kind !== 'alarm'} alarmPreview={cueTarget.kind === 'alarm'} onChange={patchCue} onClose={() => setCueTarget(null)} onFeedback={onFeedback} /> : null}
  </KeyboardAvoidingView>
}

function asPatternTracks(tracks: UnifiedSubBellTrack[]) {
  return tracks.map(track => ({ ...track, cadenceMinutes: Math.max(1, Math.ceil(track.cadenceSeconds / 60)), selectedOffsetsMinutes: track.selectedOffsetsSeconds.map(offset => Math.ceil(offset / 60)) }))
}

function makeNewTrack(tracks: UnifiedSubBellTrack[], durationSeconds: number): UnifiedSubBellTrack {
  const id = createProgramId()
  const color = timerIdentityColor(id, tracks.map((track, index) => normalizeSubBellColor(track.color, index)))
  const cadenceSeconds = durationSeconds > 300 ? 300 : durationSeconds > 60 ? 60 : Math.max(1, Math.floor(durationSeconds / 2))
  return { id, label: `Sub-bell ${tracks.length + 1}`, enabled: true, color, showOnWatchFace: true, cadenceSeconds, repeatEnabled: true, selectedOffsetsSeconds: unifiedCadenceOffsets(durationSeconds, cadenceSeconds), sound: { kind: 'builtin', id: 'clear-bell' }, volume: 0.55 }
}

function cloneTrackWithNewId(track: UnifiedSubBellTrack): UnifiedSubBellTrack {
  return { ...track, id: createProgramId(), label: copyLabel(track.label), sound: { ...track.sound }, ...(track.sounds ? { sounds: track.sounds.map(sound => ({ ...sound })) } : {}), ...(track.hapticOverride && track.hapticOverride !== 'off' ? { hapticOverride: { ...track.hapticOverride } } : {}), ...(track.randomRepeat ? { randomRepeat: { ...track.randomRepeat } } : {}), selectedOffsetsSeconds: [...track.selectedOffsetsSeconds] }
}

function SoundSummary({ cue }: { cue: CueSettings }) {
  return <SoundName cue={cue} />
}

function trackTimingSummary(track: UnifiedSubBellTrack, noMainInterval = false): string {
  if (noMainInterval) return [track.repeatEnabled ? `Every ${formatCompactDurationSeconds(track.cadenceSeconds)}` : '', track.randomRepeat ? 'Random' : ''].filter(Boolean).join(' · ') || 'No timing selected'
  const modes = [track.repeatEnabled ? `Every ${formatCompactDurationSeconds(track.cadenceSeconds)}` : '', track.randomRepeat ? 'Random' : '', bellPoints(track).length ? `${bellPoints(track).length} points` : ''].filter(Boolean)
  return modes.join(' · ') || 'No timing selected'
}

export type TimerSettingsSheetProps = Pick<UnifiedTimerConfigScreenProps,
  'state' | 'onCommand' | 'focusState' | 'onFocusAutomationChange' | 'onOpenFocusSettings' | 'onOpenFocusRuleSettings'
  | 'androidAccess' | 'onOpenExactAlarmSettings' | 'onOpenFullScreenIntentSettings'
  | 'onRequestCallMuteAccess' | 'onRequestNotificationAccess' | 'onFeedback' | 'onStartTutorial' | 'onOpenStarterTimers'
> & { settings: AppTimerSettings; onSettings: (changes: Partial<AppTimerSettings>) => void; visible: boolean; onClose: () => void; actions?: ReactNode }

export function SettingsButton({ compact, onPress }: { compact?: boolean; onPress: () => void }) {
  const { tokens } = useTheme()
  return <Pressable testID="unified-config-settings" accessibilityRole="button" accessibilityLabel="Settings" onPress={onPress} style={compact ? styles.libraryHeaderButton : [styles.iconButton, { borderColor: tokens.border }]}><OverflowIcon color={tokens.text} /></Pressable>
}

function ImportIcon({ color }: { color: string }) {
  return <Svg width={18} height={18} viewBox="0 0 24 24" fill="none"><Path d="M12 3v13m-4-4 4 4 4-4M5 15v6h14v-6" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" /></Svg>
}

function ClipboardIcon({ color }: { color: string }) {
  return <Svg width={18} height={18} viewBox="0 0 24 24" fill="none"><Path d="M9 5H6v16h12V5h-3M9 3h6v5H9zM9 13h6m-6 4h6" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" /></Svg>
}

export function TimerSettingsSheet({
  state, onCommand, settings, onSettings, visible, onClose, actions, focusState, onFocusAutomationChange,
  onOpenFocusSettings, onOpenFocusRuleSettings, androidAccess, onOpenExactAlarmSettings, onOpenFullScreenIntentSettings,
  onRequestCallMuteAccess, onRequestNotificationAccess, onFeedback, onStartTutorial, onOpenStarterTimers,
}: TimerSettingsSheetProps) {
  const { tokens, theme, toggleTheme, useEinkTheme, accentColor, setAccentColor } = useTheme()
  const [settingsAction, setSettingsAction] = useState<SettingsAction | null>(null)
  const [cueTarget, setCueTarget] = useState<{ kind: 'alarm-default' | 'sound-library' } | null>(null)
  const [libraryPreviewCue, setLibraryPreviewCue] = useState<CueSettings>({ sound: { kind: 'builtin', id: 'clear-bell' }, volume: 1 })
  const [audioMixMode, setAudioMixMode] = useState(() => ChandasTimerService.getAudioMixMode())
  const [floatingOverlay, setFloatingOverlay] = useState(() => ChandasTimerService.getFloatingOverlayState())
  const [themeLongPressed, setThemeLongPressed] = useState(false)
  const factory = defaultAppTimerSettings()
  const alarmDefaults = state.alarmDefaults ?? { sound: factory.alarmSound, durationSeconds: factory.alarmDurationSeconds }
  const floatingAvailable = ChandasTimerService.getCapabilities()?.supportsFloatingOverlay === true
  useEffect(() => {
    if (!visible) { setSettingsAction(null); setCueTarget(null); return }
    setAudioMixMode(ChandasTimerService.getAudioMixMode())
    if (!floatingAvailable) return
    setFloatingOverlay(ChandasTimerService.getFloatingOverlayState())
    const listener = ChandasTimerService.addFloatingOverlayStateListener(setFloatingOverlay)
    return () => listener?.remove()
  }, [visible, floatingAvailable])
  const changeLibraryPreview = (patch: Partial<CueSettings>) => {
    setLibraryPreviewCue(current => ({ ...current, ...patch }))
    const candidates = [...(patch.sound ? [patch.sound] : []), ...(patch.sounds ?? [])].filter(sound => sound.kind !== 'builtin')
    if (candidates.length) void onCommand({ type: 'setSoundLibrary', sounds: [...state.soundLibrary, ...candidates] })
  }
  const changeDefaultAlarm = (patch: Partial<CueSettings>) => {
    if (patch.sound) void onCommand({ type: 'setAlarmDefaults', changes: { sound: patch.sound } })
  }
  const openMenuItem = (id: string) => {
    if (id === 'quick-tour') { onClose(); onStartTutorial?.(); return }
    if (id === 'starter-timers') { onClose(); onOpenStarterTimers?.(); return }
    if (id === 'sound-library') setCueTarget({ kind: 'sound-library' })
    else setSettingsAction(id as SettingsAction)
  }
  return <>
    <DraggableSheet visible={visible} title="Settings" showTitle={false} testID="unified-settings-sheet" scrollKey="menu" onClose={() => { setSettingsAction(null); onClose() }} pinnedContent={<>
      {actions}
      <Text accessibilityRole="header" style={[styles.setupMenuTitle, { color: tokens.text }]}>Settings</Text>
    </>}>
      <View style={styles.settingsMenu}>
        {[...(onStartTutorial ? [{ id: 'quick-tour', label: 'Quick tour', detail: 'Create, run, save, and find your timers' }] : []), ...(onOpenStarterTimers ? [{ id: 'starter-timers', label: 'Starter timers', detail: 'Pomodoro, workout, and meditation' }] : []), { id: 'sound-library', label: 'Sound library', detail: `${state.soundLibrary.length} shared imported sounds` }, ...ACTIONS.filter(action => (action.id !== 'audio-output' || ChandasTimerService.getAudioOutputs() !== null)
          && (action.id !== 'audio-mix' || audioMixMode !== null)
          && (action.id !== 'system' || Platform.OS === 'android' && !androidAccess.checking && (!androidAccess.exactAlarms || !androidAccess.fullScreenAlarms))).map(action => {
          const { id, label } = action
          return { id, label, detail: id === 'audio-mix' ? audioMixLabel(audioMixMode) : settingsDetail(id, { ...settings, alarmDurationSeconds: alarmDefaults.durationSeconds, runningControlIds: state.globalRunningControlIds }, state.globalAvailability) }
        })].map(item => <Pressable key={item.id} testID={`unified-settings-${item.id}`} accessibilityRole="button" onPress={() => openMenuItem(item.id)} style={[styles.settingsRow, { borderColor: tokens.border }]}><View style={[styles.settingIcon, { borderColor: tokens.border }]}>{settingsRowIcon(item.id, tokens.textMuted)}</View><View style={styles.flex}><Text style={[styles.rowTitle, { color: tokens.text }]}>{item.label}</Text><Text style={[styles.helperText, { color: tokens.textMuted }]}>{item.detail}</Text></View><Text style={{ color: tokens.accent }}>›</Text></Pressable>)}

      </View>
    </DraggableSheet>

    <DraggableSheet visible={visible && settingsAction === 'audio-mix' && audioMixMode !== null} title="Sound mixing" presentation="center" fitContent onClose={() => setSettingsAction(null)}>
      {audioMixMode !== null ? <AudioMixSettings mode={audioMixMode} onChange={mode => {
        if (!ChandasTimerService.setAudioMixMode(mode)) return false
        setAudioMixMode(mode)
        return true
      }} /> : null}
    </DraggableSheet>

    <DraggableSheet visible={visible && settingsAction !== null && settingsAction !== 'audio-mix'} title={ACTIONS.find(action => action.id === settingsAction)?.label ?? 'Settings'} testID="unified-settings-detail-sheet" fitContent presentation={settingsAction === 'schedule' || settingsAction === 'running-controls' ? 'bottom' : 'center'} partialHeightFraction={settingsAction === 'schedule' || settingsAction === 'running-controls' || settingsAction === 'alarm' || settingsAction === 'system' ? 0.85 : 0.64} onClose={() => setSettingsAction(null)}>
      {settingsAction ? <SettingsSection alarmDefaults={alarmDefaults} onDefaultAlarmDuration={durationSeconds => { void onCommand({ type: 'setAlarmDefaults', changes: { durationSeconds } }) }} action={settingsAction} settings={settings} availability={state.globalAvailability} runningControlIds={state.globalRunningControlIds} scrubbingEnabled={state.globalScrubbingEnabled} onRunningControls={(id, enabled) => { void onCommand({ type: 'setGlobalRunningControl', id, enabled }) }} focusState={focusState} androidAccess={androidAccess} floatingOverlay={floatingOverlay} floatingAvailable={floatingAvailable} theme={theme} tokens={tokens} onSettings={onSettings} onAvailability={availability => onCommand({ type: 'setGlobalAvailability', availability })} onDefaultAlarmSound={() => setCueTarget({ kind: 'alarm-default' })} onFocusAutomationChange={onFocusAutomationChange} onOpenFocusSettings={onOpenFocusSettings} onOpenFocusRuleSettings={onOpenFocusRuleSettings} onOpenExactAlarmSettings={onOpenExactAlarmSettings} onOpenFullScreenIntentSettings={onOpenFullScreenIntentSettings} onRequestCallMuteAccess={onRequestCallMuteAccess} onRequestNotificationAccess={onRequestNotificationAccess} onFloatingChange={setFloatingOverlay} onFeedback={onFeedback} accentColor={accentColor} setAccentColor={setAccentColor} themeLongPressed={themeLongPressed} setThemeLongPressed={setThemeLongPressed} toggleTheme={toggleTheme} useEinkTheme={useEinkTheme} /> : null}
    </DraggableSheet>

    {visible && cueTarget ? <SoundPickerSheet visible title={cueTarget.kind === 'alarm-default' ? 'Default alarm sound' : 'Sound library'}
      cue={cueTarget.kind === 'alarm-default' ? { sound: alarmDefaults.sound, volume: settings.alarmVolume } : libraryPreviewCue}
      soundLibrary={state.soundLibrary} masterVolume={settings.masterVolume}
      advanced={false} alarmPreview={cueTarget.kind === 'alarm-default'} volumeLabel={cueTarget.kind === 'sound-library' ? 'Preview volume' : undefined}
      onChange={cueTarget.kind === 'sound-library' ? changeLibraryPreview : changeDefaultAlarm} onClose={() => setCueTarget(null)} onFeedback={onFeedback} /> : null}
  </>
}

function SettingsSection({ alarmDefaults, onDefaultAlarmDuration, action, settings, availability, runningControlIds, scrubbingEnabled, onRunningControls, focusState, androidAccess, floatingOverlay, floatingAvailable, theme, tokens, onSettings, onAvailability, onDefaultAlarmSound, onFocusAutomationChange, onOpenFocusSettings, onOpenFocusRuleSettings, onOpenExactAlarmSettings, onOpenFullScreenIntentSettings, onRequestCallMuteAccess, onRequestNotificationAccess, onFloatingChange, onFeedback, accentColor, setAccentColor, themeLongPressed, setThemeLongPressed, toggleTheme, useEinkTheme }: {
  alarmDefaults: { sound: AppTimerSettings['alarmSound']; durationSeconds: number }; onDefaultAlarmDuration: (duration: number) => void;
  action: ExtraAction; settings: AppTimerSettings; availability: AvailabilityPolicy; runningControlIds: AppTimerSettings['runningControlIds']; scrubbingEnabled?: boolean; onRunningControls: (id: NonNullable<AppTimerSettings['runningControlIds']>[number], enabled: boolean) => void; focusState: NativeFocusState;
  androidAccess: UnifiedTimerConfigScreenProps['androidAccess']; floatingOverlay: ReturnType<typeof ChandasTimerService.getFloatingOverlayState>; floatingAvailable: boolean;
  theme: string; tokens: ReturnType<typeof useTheme>['tokens']; onSettings: (changes: Partial<AppTimerSettings>) => void; onAvailability: (availability: AvailabilityPolicy) => void; onDefaultAlarmSound: () => void;
  onFocusAutomationChange: (enabled: boolean) => void; onOpenFocusSettings: () => void; onOpenFocusRuleSettings: () => void; onOpenExactAlarmSettings: () => void; onOpenFullScreenIntentSettings: () => void;
  onRequestCallMuteAccess: () => void; onRequestNotificationAccess: () => void; onFloatingChange: (value: ReturnType<typeof ChandasTimerService.getFloatingOverlayState>) => void; onFeedback: UnifiedTimerConfigScreenProps['onFeedback'];
  accentColor: SubBellColorId; setAccentColor: (value: SubBellColorId) => void; themeLongPressed: boolean; setThemeLongPressed: (value: boolean) => void; toggleTheme: () => void; useEinkTheme: () => void
}) {
  const setting = (key: ExtraAction) => {
    switch (key) {
      case 'schedule': return <Panel title="Schedule" tokens={tokens}><View style={styles.row}><View style={styles.flex}><Text style={[styles.rowTitle, { color: tokens.text }]}>Use schedule</Text><Text style={[styles.helperText, { color: tokens.textMuted }]}>Applies across the app.</Text></View><Toggle value={availability.enabled} onChange={enabled => onAvailability({ ...availability, enabled })} accessibilityLabel="Use app schedule" /></View>{availability.enabled ? <ScheduleTimelinePreview value={availability} /> : null}<ScheduleConfig showHeading={false} showEnabledControl={false} value={availability} onChange={onAvailability} /></Panel>
      case 'haptics': return <HapticsPanel value={settings.haptics} onChange={haptics => { setAppHapticsEnabled(haptics.enabled); onSettings({ haptics }) }} />
      case 'alarm': return <AlarmSoundAndDuration sound={alarmDefaults.sound} duration={alarmDefaults.durationSeconds} secondPrecision={settings.secondPrecisionEnabled} onSound={onDefaultAlarmSound} onDuration={onDefaultAlarmDuration} />
      case 'focus': return <Panel title="Focus" tokens={tokens}><View style={styles.row}><View style={styles.flex}><Text style={[styles.rowTitle, { color: tokens.text }]}>Focus while timer runs</Text><Text style={[styles.helperText, { color: tokens.textMuted }]}>{focusState.reason === 'paused-by-android' ? 'Paused by Android' : focusState.reason === 'rule-disabled' ? 'Focus rule is disabled' : 'Manage Do Not Disturb while this timer runs.'}</Text></View><Toggle value={settings.focusAutomationEnabled} onChange={enabled => { onSettings({ focusAutomationEnabled: enabled }); onFocusAutomationChange(enabled) }} accessibilityLabel="Chandas Focus" /></View>{[{ label: 'Focus settings', detail: 'Manage Do Not Disturb access', onPress: onOpenFocusSettings }, { label: 'Focus rule', detail: 'Choose when Chandas manages Focus', onPress: onOpenFocusRuleSettings }].map(item => <Pressable key={item.label} accessibilityRole="button" accessibilityLabel={item.label} onPress={item.onPress} style={[styles.settingsRow, { borderColor: tokens.border }]}><View style={styles.flex}><Text style={[styles.rowTitle, { color: tokens.text }]}>{item.label}</Text><Text style={[styles.helperText, { color: tokens.textMuted }]}>{item.detail}</Text></View><Text style={{ color: tokens.accent }}>›</Text></Pressable>)}</Panel>
      case 'notifications': return <View style={styles.section}>
        <Text style={[styles.helperText, { color: tokens.textMuted }]}>Chandas shows your active timers in the notification drawer. Live Updates show the timer you last opened in the status bar when Android allows it.</Text>
        {Platform.OS === 'android' && !androidAccess.notifications ? <Pressable accessibilityRole="button" onPress={onRequestNotificationAccess} style={[styles.settingsRow, { borderColor: tokens.border }]}><Text style={[styles.rowTitle, { color: tokens.text }]}>Enable notifications</Text></Pressable> : null}
        {Platform.OS === 'android' && androidAccess.notifications ? <Pressable accessibilityRole="button" onPress={() => ChandasTimerService.openNotificationSettings()} style={[styles.settingsRow, { borderColor: tokens.border }]}><Text style={[styles.rowTitle, { color: tokens.text }]}>Android notification settings</Text><Text style={{ color: tokens.text }}>›</Text></Pressable> : null}
      </View>
      case 'audio-output': return <AudioOutputSettings onSaveError={() => onFeedback({ tone: 'attention', title: 'Could not change the audio output' })} />
      case 'calls': return <Panel title="During calls" tokens={tokens}><View style={styles.row}><View style={styles.flex}><Text style={[styles.rowTitle, { color: tokens.text }]}>Mute timer cues during calls</Text><Text style={[styles.helperText, { color: tokens.textMuted }]}>{androidAccess.callMute ? 'Available' : 'Phone access may be needed.'}</Text></View><Toggle value={settings.muteDuringCallsEnabled} onChange={enabled => { onSettings({ muteDuringCallsEnabled: enabled }); if (enabled && Platform.OS === 'android' && !androidAccess.callMute) onRequestCallMuteAccess() }} accessibilityLabel="Mute timer during calls" /></View></Panel>
      case 'precision': return <Panel title="Precision" tokens={tokens}><View style={styles.row}><View style={styles.flex}><Text style={[styles.rowTitle, { color: tokens.text }]}>Edit in seconds</Text><Text style={[styles.helperText, { color: tokens.textMuted }]}>Keep exact seconds visible in duration controls.</Text></View><Toggle value={settings.secondPrecisionEnabled} onChange={secondPrecisionEnabled => onSettings({ secondPrecisionEnabled })} accessibilityLabel="Use exact seconds" /></View></Panel>
      case 'running-controls': return <Panel title="Running controls" tokens={tokens}><RunningControlSettingsList settings={{ advancedModeEnabled: false, runningControlIds, scrubbingEnabled }} onChange={onRunningControls} /></Panel>
      case 'system': return <Panel title="Device access" tokens={tokens}>{!androidAccess.exactAlarms ? <Pressable accessibilityRole="button" accessibilityLabel="Set up exact timing" onPress={onOpenExactAlarmSettings} style={[styles.settingsRow, { borderColor: tokens.border }]}><View style={styles.flex}><Text style={[styles.rowTitle, { color: tokens.text }]}>Exact timing</Text><Text style={[styles.helperText, { color: tokens.warm }]}>Set up</Text></View><Text style={{ color: tokens.accent }}>›</Text></Pressable> : null}{!androidAccess.fullScreenAlarms ? <Pressable accessibilityRole="button" accessibilityLabel="Set up full-screen alarms" onPress={onOpenFullScreenIntentSettings} style={[styles.settingsRow, { borderColor: tokens.border }]}><View style={styles.flex}><Text style={[styles.rowTitle, { color: tokens.text }]}>Full-screen alarms</Text><Text style={[styles.helperText, { color: tokens.warm }]}>Set up</Text></View><Text style={{ color: tokens.accent }}>›</Text></Pressable> : null}<Text style={[styles.helperText, { color: tokens.textMuted }]}>{androidAccess.checking ? 'Checking access…' : androidAccess.pending ? 'Waiting for Android…' : `Notifications ${androidAccess.notifications ? 'available' : 'not granted'} · calls ${androidAccess.callMute ? 'available' : 'not granted'}`}</Text></Panel>
      case 'device': return <Panel title="Appearance and overlay" tokens={tokens}><ColorSelector label="Accent color" detail="Applies across the app." value={accentColor} onChange={setAccentColor} accessibilityLabel="Accent color" trailing={<Pressable onPress={() => { if (themeLongPressed) return; toggleTheme() }} onLongPress={() => { setThemeLongPressed(true); useEinkTheme() }} onPressOut={() => setTimeout(() => setThemeLongPressed(false), 0)} delayLongPress={550} accessibilityRole="button" accessibilityLabel={`Change appearance from ${theme}`} style={[styles.themeButton, { borderColor: tokens.border }]}><LightbulbIcon color={tokens.accent} /></Pressable>} />{floatingAvailable ? <FloatingOverlaySettings state={floatingOverlay} onChange={onFloatingChange} onFeedback={onFeedback} /> : null}</Panel>
      default: return null
    }
  }
  return <View style={styles.section}>{setting(action)}</View>
}

function TrackDetail({ noMainInterval, track, durationSeconds, secondPrecision, settings, onPatch, onOpenSound }: {
  noMainInterval: boolean; track: UnifiedSubBellTrack; durationSeconds: number; secondPrecision: boolean; settings: AppTimerSettings; onPatch: (changes: Partial<UnifiedSubBellTrack>) => void; onOpenSound: () => void
}) {
  const { tokens, theme } = useTheme()
  const tour = useGuidedTour()
  const [panel, setPanel] = useState<'points' | 'offsets' | 'haptics' | 'visibility' | 'random' | null>(null)
  const points = bellPoints(track)
  const modes = [
    { id: 'repeat', label: 'Repeat', summary: track.repeatEnabled ? formatCompactDurationSeconds(track.cadenceSeconds) : 'Off', active: track.repeatEnabled, press: () => onPatch({ repeatEnabled: !track.repeatEnabled }) },
    { id: 'random', label: 'Random', summary: track.randomRepeat ? `${formatCompactDurationSeconds(track.randomRepeat.minSeconds)}–${formatCompactDurationSeconds(track.randomRepeat.maxSeconds)}` : undefined, active: !!track.randomRepeat, press: () => { if (!track.randomRepeat) onPatch({ randomRepeat: { minSeconds: 30, maxSeconds: 60 } }); setPanel('random') } },
    { id: 'points', label: 'Points', summary: points.length ? `${points.length}` : undefined, active: points.length > 0, press: () => setPanel('points') },
  ]
  const choosePanel = (value: typeof panel) => setPanel(panel === value ? null : value)
  const inactiveOffsets = track.selectedOffsetsSeconds.filter(offset => offset >= durationSeconds)
  return <View style={styles.trackDetail}>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.actionRail} accessibilityLabel="Sub-bell controls">{modes.filter(mode => !noMainInterval || mode.id === 'repeat' || mode.id === 'random').map(mode => <ActionChip key={mode.id} label={mode.label} summary={mode.summary} active={mode.active} tokens={tokens} onPress={mode.press} />)}{([{ id: 'offsets', label: 'Offsets' }, { id: 'haptics', label: 'Haptics' }, { id: 'visibility', label: 'Visibility' }] as const).filter(option => option.id !== 'offsets' || !noMainInterval && track.repeatEnabled && (track.cadenceSeconds < durationSeconds || inactiveOffsets.length > 0)).map(option => <ActionChip key={option.id} label={option.label} active={panel === option.id} tokens={tokens} onPress={() => choosePanel(option.id)} />)}</ScrollView>
    <Pressable accessibilityRole="button" onPress={onOpenSound} style={[styles.soundSummary, { borderColor: tokens.border }]}><View style={styles.flex}><Text style={[styles.rowTitle, { color: tokens.text }]}>Sound</Text><SoundName cue={track} style={styles.soundName} /></View><Text style={{ color: tokens.accent }}>›</Text></Pressable>
    {track.repeatEnabled ? <TourTarget id="tour-repeat"><DurationSelector label="Repeat every" value={Math.ceil(track.cadenceSeconds / 60)} valueSeconds={track.cadenceSeconds} secondPrecision={secondPrecision} presets={[1, 2, 3, 5, 10, 15, 20, 30, 60]} minSeconds={1} maxSeconds={MAX_CUE_DURATION_SECONDS} onChange={minutes => { onPatch(unifiedTrackCadencePatch(track, durationSeconds, minutes * 60)); tour?.advance('repeat') }} onChangeSeconds={cadenceSeconds => { onPatch(unifiedTrackCadencePatch(track, durationSeconds, cadenceSeconds)); tour?.advance('repeat') }} /></TourTarget> : <Text style={[styles.helperText, { color: tokens.textMuted }]}>{noMainInterval ? (track.randomRepeat ? null : 'Set a repeat interval or random gaps.') : 'Choose Random or Points, or turn Repeat on.'}</Text>}
    <VolumeControl cue={track} masterVolume={settings.masterVolume} label="Volume" value={track.volume} onChange={volume => onPatch({ volume })} />
    <DraggableSheet visible={panel !== null} title={panel === 'random' ? 'Random gaps' : panel === 'points' ? 'Bell points' : panel === 'offsets' ? 'Cue selection' : panel === 'haptics' ? 'Cue vibration' : 'Visibility'} testID="unified-track-option-sheet" fitContent presentation="center" initialSnap="partial" partialHeightFraction={0.62} onClose={() => setPanel(null)}>
      {panel === 'random' ? <View style={styles.randomBox}>{!noMainInterval && track.randomRepeat && track.randomRepeat.minSeconds >= durationSeconds ? <Text style={[styles.helperText, { color: tokens.warm }]}>No random bell fits until this interval is lengthened.</Text> : null}<Text style={[styles.helperText, { color: tokens.textMuted }]}>Gap range · {formatCompactDurationSeconds(track.randomRepeat?.minSeconds ?? 30)}–{formatCompactDurationSeconds(track.randomRepeat?.maxSeconds ?? 60)}</Text><DurationSelector compact label="Shortest gap" value={Math.ceil((track.randomRepeat?.minSeconds ?? 30) / 60)} valueSeconds={track.randomRepeat?.minSeconds ?? 30} secondPrecision={secondPrecision} minSeconds={5} maxSeconds={MAX_CUE_DURATION_SECONDS} presets={[1, 2, 3, 5, 10]} onChange={minutes => onPatch({ randomRepeat: { minSeconds: Math.max(5, minutes * 60), maxSeconds: Math.max(minutes * 60, track.randomRepeat?.maxSeconds ?? 60) } })} onChangeSeconds={minSeconds => onPatch({ randomRepeat: { minSeconds: Math.max(5, minSeconds), maxSeconds: Math.max(minSeconds, track.randomRepeat?.maxSeconds ?? 60) } })} /><DurationSelector compact label="Longest gap" value={Math.ceil((track.randomRepeat?.maxSeconds ?? 60) / 60)} valueSeconds={track.randomRepeat?.maxSeconds ?? 60} secondPrecision={secondPrecision} minSeconds={5} maxSeconds={MAX_CUE_DURATION_SECONDS} presets={[1, 2, 3, 5, 10]} onChange={minutes => onPatch({ randomRepeat: { minSeconds: Math.min(track.randomRepeat?.minSeconds ?? 30, minutes * 60), maxSeconds: Math.max(5, minutes * 60) } })} onChangeSeconds={maxSeconds => onPatch({ randomRepeat: { minSeconds: Math.min(track.randomRepeat?.minSeconds ?? 30, maxSeconds), maxSeconds: Math.max(5, maxSeconds) } })} /></View> : null}
      {panel === 'random' ? <Pressable accessibilityRole="button" style={[styles.secondaryButton, { borderColor: tokens.border }]} onPress={() => { onPatch({ randomRepeat: undefined }); setPanel(null) }}><Text style={{ color: tokens.text }}>Remove random timing</Text></Pressable> : null}
      {panel === 'points' ? <BellPointsEditor points={points} durationSeconds={durationSeconds} secondPrecision={secondPrecision} color={theme === 'eink' ? tokens.accent : subBellColorValue(track.color, 0)} onChange={points => onPatch({ points, afterStartSeconds: undefined, beforeEndSeconds: undefined })} /> : null}
      {panel === 'offsets' ? <OffsetGrid offsets={[...new Set([...unifiedCadenceOffsets(durationSeconds, track.cadenceSeconds).slice(0, MAX_VISIBLE_PATTERN_OFFSETS), ...inactiveOffsets])].sort((a, b) => a - b)} selected={track.selectedOffsetsSeconds} unit="seconds" onChange={selectedOffsetsSeconds => onPatch({ selectedOffsetsSeconds })} /> : null}
      {panel === 'haptics' ? <CueHapticsEditor cue={track} inherited={settings.haptics.subBell} inheritedEnabled={settings.haptics.enabled} onChange={hapticOverride => onPatch({ hapticOverride })} /> : null}
      {panel === 'visibility' ? <View style={{ gap: 20 }}><ColorSelector paletteOnly value={normalizeSubBellColor(track.color, 0)} onChange={color => onPatch({ color })} accessibilityLabel={`${track.label} color`} /><View style={styles.row}><View style={styles.flex}><Text style={[styles.rowTitle, { color: tokens.text }]}>Show on watch face</Text><Text style={[styles.helperText, { color: tokens.textMuted }]}>Hidden bells still play and remain in the timeline.</Text></View><Toggle value={track.showOnWatchFace} onChange={showOnWatchFace => onPatch({ showOnWatchFace })} accessibilityLabel="Show sub-bell on watch face" /></View></View> : null}
    </DraggableSheet>
  </View>
}

function TrackNameHeader({ track, onRename, onDuplicate, onDelete }: { track: UnifiedSubBellTrack; onRename: (label: string) => void; onDuplicate: () => void; onDelete: () => void }) {
  const { tokens } = useTheme()
  const [labelDraft, setLabelDraft] = useState(track.label)
  useEffect(() => setLabelDraft(track.label), [track.id, track.label])
  return <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, zIndex: 30 }}>
    <TextInput testID={`unified-config-track-name-${track.id}`} accessibilityLabel="Sub-bell name" value={labelDraft} onChangeText={value => { const label = [...value].slice(0, 60).join(''); setLabelDraft(label); if (label.trim()) onRename(label) }} onBlur={() => { const label = labelDraft.trim() || track.label; setLabelDraft(label); if (label !== track.label) onRename(label) }} style={[styles.trackNameInput, { flex: 1, color: tokens.text, borderBottomColor: tokens.accent }]} />
      <OverflowMenu label={`Actions for ${track.label}`} items={[{ label: 'Duplicate', icon: 'duplicate', testID: 'unified-track-duplicate', onPress: onDuplicate }, { label: 'Delete', icon: 'delete', testID: 'unified-track-delete', destructive: true, onPress: onDelete }]} />
  </View>
}

function ActionChip({ label, summary, active, tokens, onPress }: { label: string; summary?: string; active: boolean; tokens: ReturnType<typeof useTheme>['tokens']; onPress: () => void }) {
  return <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: active }} aria-pressed={active} style={[styles.actionChip, { borderColor: active ? tokens.accent : tokens.border, backgroundColor: active ? tokens.accentGlow : tokens.surface }]}><Text style={[styles.actionLabel, { color: tokens.text }]}>{label}{summary ? ` · ${summary}` : ''}</Text></Pressable>
}

function TimerControlRail({ singleStep, showGlobal, program, settings, step, cycleDurationSeconds, onProgram, onSettings, onOpenMixer, onCueHaptics, onAlarm, onAlarmSound }: {
  singleStep: boolean; showGlobal: boolean; program: UnifiedTimerProgram; settings: AppTimerSettings; step: UnifiedTimerStep; cycleDurationSeconds: number;
  onProgram: (changes: Partial<UnifiedTimerProgram>) => void; onSettings: (changes: Partial<AppTimerSettings>) => void; onOpenMixer: () => void; onCueHaptics: (value: CueSettings['hapticOverride']) => void; onAlarm: (enabled: boolean) => void; onAlarmSound: () => void
}) {
  const { tokens } = useTheme()
  const [active, setActive] = useState<ExtraAction | 'volume' | null>(null)
  useEffect(() => {
    if (showGlobal && !singleStep && active === 'haptics') setActive(null)
  }, [singleStep, showGlobal, active])
  const actions: Array<ExtraAction | 'volume'> = program.noMainInterval ? ['run-length', 'volume'] : !showGlobal ? ['volume', 'haptics', 'alarm'] : singleStep ? ['run-length', 'alignment', 'volume', 'haptics', 'alarm'] : ['run-length', 'alignment', 'volume', 'alarm']
  return <View style={styles.section}>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.actionRail} accessibilityLabel="Timer controls">
      {actions.map(action => <ActionChip key={action} label={action === 'run-length' ? 'Run length' : action === 'alignment' ? 'Align to clock' : action === 'volume' ? 'Volume' : action === 'haptics' ? 'Haptics' : 'Alarm'} summary={mainActionSummary(action, program, settings, step.endAlarmEnabled, step.endCue.hapticOverride)} active={active === action} tokens={tokens} onPress={() => action === 'volume' ? onOpenMixer() : setActive(active === action ? null : action)} />)}
    </ScrollView>
    <DraggableSheet visible={active !== null} fitContent title={active === 'run-length' ? 'Run length' : active === 'alignment' ? 'Align to clock' : active === 'haptics' ? 'Ending cue vibration' : active === 'alarm' ? 'Alarm' : 'Timer control'} testID="unified-timer-control-sheet" presentation="center" initialSnap="partial" partialHeightFraction={active === 'alarm' ? 0.68 : active === 'run-length' ? 0.65 : 0.48} onClose={() => setActive(null)}>
      {active === 'run-length' ? <RunLengthConfig allowCycles={!program.noMainInterval} mode={singleStep ? 'pattern' : 'sequence'} allowUntil={!isNativeServiceAvailable || ChandasTimerService.getCapabilities()?.supportsUntilRunLength === true} rounds value={program.runPolicy} cycleDurationSeconds={cycleDurationSeconds} secondPrecision={settings.secondPrecisionEnabled} onChange={runPolicy => onProgram({ runPolicy })} /> : null}
      {active === 'alignment' ? <><View style={styles.row}><View style={styles.flex}><Text style={[styles.rowTitle, { color: tokens.text }]}>Align to local clock</Text><Text style={[styles.helperText, { color: tokens.textMuted }]}>{program.alignment.kind === 'local-clock' ? `Offset ${program.alignment.offsetMinutes} min` : 'Start from elapsed time'}</Text></View><Toggle value={program.alignment.kind === 'local-clock'} onChange={enabled => onProgram({ alignment: enabled ? { kind: 'local-clock', offsetMinutes: 0 } : { kind: 'elapsed' } })} accessibilityLabel="Align timer rounds to clock" /></View>{program.alignment.kind === 'local-clock' ? <ClockSnapSelector cycleDurationSeconds={cycleDurationSeconds} value={program.alignment.offsetMinutes} onChange={offsetMinutes => onProgram({ alignment: { kind: 'local-clock', offsetMinutes } })} /> : null}</> : null}
      {(singleStep || !showGlobal) && active === 'haptics' ? <CueHapticsEditor cue={step.endCue} inherited={settings.haptics.main} inheritedEnabled={settings.haptics.enabled} onChange={onCueHaptics} /> : null}
      {active === 'alarm' ? <>
        {!singleStep && !showGlobal ? <View style={styles.row}><Text style={[styles.rowTitle, styles.flex, { color: tokens.text }]}>Alarm after this interval</Text><Toggle value={step.endAlarmEnabled} onChange={onAlarm} accessibilityLabel="Alarm after this interval" /></View> : null}
        {singleStep ? <SegmentedControl items={[{ value: 'off', label: 'Off' }, { value: 'once', label: 'Once' }, { value: 'locked', label: 'Every interval' }]} value={step.endAlarmEnabled ? 'locked' : program.alarmBehavior} onChange={mode => onProgram({ alarmBehavior: mode === 'once' ? 'once' : 'off', steps: [{ ...step, endAlarmEnabled: mode === 'locked' }] })} accessibilityLabel="Timer alarm mode" /> : null}
        <AlarmSoundAndDuration sound={settings.alarmSound} duration={settings.alarmDurationSeconds} secondPrecision={settings.secondPrecisionEnabled} onSound={onAlarmSound} onDuration={durationSeconds => onProgram({ alarmOverrides: { ...program.alarmOverrides, durationSeconds } })} />
        <Pressable accessibilityRole="button" onPress={() => onProgram({ alarmOverrides: { sound: null, durationSeconds: null } })} style={[styles.secondaryButton, { borderColor: tokens.border }]}><Text style={{ color: tokens.text }}>Use default alarm sound and duration</Text></Pressable>
      </> : null}
    </DraggableSheet>
  </View>
}

function AlarmSoundAndDuration({ sound, duration, secondPrecision, onSound, onDuration }: { sound: AppTimerSettings['alarmSound']; duration: number; secondPrecision: boolean; onSound: () => void; onDuration: (duration: number) => void }) {
  const { tokens } = useTheme()
  return <View style={styles.section}>
    <Pressable accessibilityRole="button" accessibilityLabel="Choose alarm sound" onPress={onSound} style={[styles.soundSummary, { borderColor: tokens.border }]}><View style={styles.flex}><Text style={[styles.rowTitle, { color: tokens.text }]}>Alarm sound</Text><SoundName cue={{ sound, volume: 1 }} style={styles.helperText} /></View><Text style={{ color: tokens.accent }}>›</Text></Pressable>
    <DurationSelector label="Ring duration" value={Math.ceil(duration / 60)} valueSeconds={duration} secondPrecision={secondPrecision} presets={[1, 2, 5, 10, 15, 30, 60]} minSeconds={5} maxSeconds={3600} onChange={minutes => onDuration(minutes * 60)} onChangeSeconds={onDuration} />
  </View>
}

function mainActionSummary(action: ExtraAction | 'volume', program: UnifiedTimerProgram, settings: AppTimerSettings, alarmEnabled: boolean, hapticOverride?: CueSettings['hapticOverride']): string {
  switch (action) {
    case 'alignment': return program.alignment.kind === 'local-clock' ? `${program.alignment.offsetMinutes}m offset` : 'Off'
    case 'run-length': {
      const policy = program.runPolicy
      if (policy.kind === 'continuous') return 'Continuous'
      if (policy.kind === 'cycles') return `${policy.cycleCount} ${policy.cycleCount === 1 ? 'round' : 'rounds'}`
      if (policy.kind === 'until') return `Until ${formatClockTime(policy.untilMinutes ?? 0)}`
      return formatCompactDurationSeconds(policy.durationSeconds)
    }
    case 'volume': return `${Math.round(settings.masterVolume * 100)}%`
    case 'haptics': return !settings.haptics.enabled || hapticOverride === 'off' ? 'Off' : hapticOverride ? hapticProfileSummary(hapticOverride) : hapticProfileSummary(settings.haptics.main)
    case 'alarm': return program.steps.length > 1 ? '' : alarmEnabled || program.alarmBehavior !== 'off' ? 'On' : 'Off'
    default: return ''
  }
}

function UnifiedStepCard({ step, boundaryColor, index, itemCount, preview, onPreview, onAutoScroll, onMove, onDuplicate, onDelete, onEdit }: {
  boundaryColor: string;
  onDelete?: () => void | Promise<void>; onDuplicate?: () => void; step: UnifiedTimerStep; index: number; itemCount: number; preview: ReorderPreview | null;
  onAutoScroll: (pageY: number, earlier: boolean, later: boolean) => number; onPreview: (preview: ReorderPreview | null) => void; onMove: (from: number, to: number) => void; onEdit: () => void
}) {
  const { tokens } = useTheme()
  const reducedMotion = useAppReducedMotion()
  const translation = useSharedValue(0)
  const offset = useSharedValue(0)
  const dragging = preview?.stepId === step.id
  const activeSubBells = step.subBellsEnabled ? step.subBellTracks.filter(track => track.enabled).length : 0
  const moveRef = useRef(onMove)
  moveRef.current = onMove
  const commitMove = useCallback((from: number, to: number) => moveRef.current(from, to), [])
  const previewMove = useCallback((from: number, to: number, rowHeight: number) => onPreview({ stepId: step.id, from, to, rowHeight }), [step.id, onPreview])
  const endPreview = useCallback(() => onPreview(null), [onPreview])
  useEffect(() => { const next = preview ? previewOffsetForItem(index, preview.from, preview.to, 142) : 0; offset.value = reducedMotion ? next : withTiming(next, { duration: 150 }) }, [preview, index, reducedMotion])
  const previewActive = preview !== null
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: dragging ? translation.value : previewActive ? offset.value : 0 }],
  }))
  return <Animated.View testID={`unified-config-step-row-${step.id}`} style={[{ height: 130, zIndex: dragging ? 20 : 0 }, animatedStyle]}>
    <SwipeActionRow testID={`unified-step-swipe-${step.id}`} accessibilityLabel={step.label} onDuplicate={onDuplicate} onDelete={onDelete}>{canPress => <View style={[styles.stepCard, { height: 130, borderColor: dragging ? tokens.accent : tokens.border, backgroundColor: tokens.surface, elevation: dragging ? 8 : 0 }]}>
      <ReorderHandle index={index} itemCount={itemCount} rowHeight={142} rowTranslation={translation} onAutoScroll={onAutoScroll} label={`Reorder ${step.label}`} onMove={commitMove} onPreviewChange={previewMove} onPreviewEnd={endPreview} />
      <Pressable testID={`unified-edit-step-${step.id}`} style={styles.stepCardMain} onPress={() => { if (canPress()) onEdit() }} accessibilityRole="button" accessibilityLabel={`Edit step ${index + 1}, ${step.label}`}>
        <View style={styles.stepCardTop}><Text style={[styles.stepIndex, { color: tokens.accent }]}>{String(index + 1).padStart(2, '0')}</Text><Text numberOfLines={1} style={[styles.stepCardTitle, { color: tokens.text }]}>{step.label}</Text><Text style={[styles.stepCardDuration, { color: tokens.text }]}>{formatCompactDurationSeconds(step.durationSeconds)}</Text></View>
        <View style={styles.stepSoundLine}>
          <BellIcon on color={boundaryColor} />
          <SoundName cue={step.endCue} style={styles.helperText} />
          {activeSubBells > 0 && <Text style={[styles.helperText, { color: tokens.textMuted }]}>· {activeSubBells} {activeSubBells === 1 ? 'sub-bell' : 'sub-bells'}</Text>}
        </View>
        <PatternTimelinePreview tracks={asPatternTracks(step.subBellsEnabled ? step.subBellTracks : [])} mainDurationSeconds={step.durationSeconds} boundaryColor={boundaryColor} />
      </Pressable>
    </View>}</SwipeActionRow>
  </Animated.View>
}

function SetupMenuAction({ label, testID, accessibilityLabel = label, disabled, destructive, onPress, children }: { label: string; testID?: string; accessibilityLabel?: string; disabled?: boolean; destructive?: boolean; onPress: () => void; children: React.ReactNode }) {
  const { tokens } = useTheme()
  return <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={accessibilityLabel} disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.setupMenuAction, { borderColor: tokens.border, opacity: disabled ? 0.45 : pressed ? 0.72 : 1 }]}>
    {children}
    <Text style={[styles.setupMenuActionText, { color: destructive ? tokens.warm : tokens.text }]}>{label}</Text>
  </Pressable>
}

function MenuItemIcon({ item, color }: { item: { label: string; destructive?: boolean; icon?: 'duplicate' | 'delete' }; color: string }) {
  const icon = item.icon ?? (item.destructive || /^(delete|remove)/i.test(item.label) ? 'delete' : /duplicate/i.test(item.label) ? 'duplicate' : /save/i.test(item.label) ? 'save' : 'configuration')
  if (icon === 'delete') return <TrashIcon color={color} size={17} />
  if (icon === 'duplicate') return <DuplicateIcon color={color} size={17} />
  if (icon === 'save') return <SaveIcon color={color} size={17} />
  return <ConfigurationIcon color={color} size={17} />
}

function OverflowMenu({ label, items, compact = false, menuWidth }: { compact?: boolean; menuWidth?: number; label: string; items: Array<{ label: string; onPress: () => void; disabled?: boolean; destructive?: boolean; testID?: string; icon?: 'duplicate' | 'delete' }> }) {
  const { tokens } = useTheme()
  const { width, height } = useWindowDimensions()
  const popoverWidth = Math.min(menuWidth ?? 240, width - 24)
  const anchor = useRef<View>(null)
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null)
  const close = () => setPosition(null)
  return <>
    <Pressable ref={anchor} hitSlop={compact ? 4 : undefined} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ expanded: position !== null }} onPress={event => { event.stopPropagation(); anchor.current?.measureInWindow((x, y, w, h) => setPosition({ left: Math.max(12, Math.min(width - popoverWidth - 12, x + w + (compact ? 4 : 0) - popoverWidth)), top: Math.max(12, Math.min(height - items.length * 48 - 24, y + h + 4)) })); }} style={[styles.iconButton, { borderColor: tokens.border }, compact && styles.tileMenu]}><OverflowIcon color={tokens.text} /></Pressable>
    <Modal visible={position !== null} statusBarTranslucent transparent animationType="none" onRequestClose={close}>
      <View style={StyleSheet.absoluteFill}>
        <Pressable style={StyleSheet.absoluteFill} accessibilityRole="button" accessibilityLabel={`Close ${label}`} onPress={close} />
        {position ? <View testID="configuration-action-menu" accessibilityViewIsModal style={{ position: 'absolute', ...position, width: popoverWidth, padding: 6, borderWidth: 1, borderRadius: 12, borderColor: tokens.border, backgroundColor: tokens.surfaceHi, elevation: 10 }}>{items.map(item => <Pressable key={item.label} testID={item.testID} accessibilityRole="button" disabled={item.disabled} onPress={event => { event.stopPropagation(); close(); item.onPress() }} style={{ minHeight: 44, paddingHorizontal: 12, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', gap: 10, opacity: item.disabled ? 0.4 : 1 }}><MenuItemIcon item={item} color={item.destructive ? tokens.warm : tokens.text} /><Text style={{ flexShrink: 1, color: item.destructive ? tokens.warm : tokens.text }}>{item.label}</Text></Pressable>)}</View> : null}
      </View>
    </Modal>
  </>
}

function settingsRowIcon(id: string, color: string) {
  if (id === 'quick-tour') return <TimerTransportIcon kind="play" color={color} />
  if (id === 'starter-timers') return <ConfigurationIcon color={color} />
  if (id === 'schedule' || id === 'precision' || id === 'alignment') return <ClockIcon color={color} />
  if (id === 'alarm') return <AlarmIcon color={color} />
  if (id === 'focus') return <FocusIcon color={color} />
  if (id === 'calls') return <BellIcon muted color={color} />
  if (id === 'notifications' || id === 'haptics') return <BellIcon on color={color} />
  if (id === 'device') return <LightbulbIcon color={color} />
  if (id === 'sound-library' || id === 'audio-output') return <VolumeIcon muted={false} color={color} />
  if (id === 'audio-mix') return <MixerIcon color={color} />
  return <ConfigurationIcon color={color} size={17} />
}

function settingsDetail(action: Exclude<SettingsAction, 'audio-mix'>, settings: AppTimerSettings, availability: AvailabilityPolicy): string {
  switch (action) {
    case 'schedule': return availability.enabled ? 'Schedule enabled' : 'No active schedule'
    case 'haptics': return settings.haptics.enabled ? 'Haptics enabled' : 'Haptics off'
    case 'alarm': return formatCompactDurationSeconds(settings.alarmDurationSeconds) + ' ring duration'
    case 'focus': return settings.focusAutomationEnabled ? 'Enabled' : 'Off'
    case 'notifications': return 'Active timers and Live Updates'
    case 'audio-output': return 'Choose where Chandas plays sound'
    case 'calls': return settings.muteDuringCallsEnabled ? 'Mute during calls' : 'Play during calls'
    case 'precision': return settings.secondPrecisionEnabled ? 'Exact seconds' : 'Minute controls'
    case 'running-controls': return settings.runningControlIds ? `${settings.runningControlIds.length} optional controls shown` : 'Choose running controls'
    case 'system': return 'Permissions and device access'
    case 'device': return 'Theme and floating timer'
  }
}

function MarkerControl({ value, durationSeconds, secondPrecision, onChange }: { label: string; value?: number; durationSeconds: number; secondPrecision: boolean; onChange: (value: number | undefined) => void }) {
  const { tokens } = useTheme()
  const inactive = value !== undefined && value >= durationSeconds
  return <View style={styles.markerBox}>
    {inactive ? <Text style={[styles.helperText, { color: tokens.warm }]}>{formatCompactDurationSeconds(value!)} · inactive until step is lengthened</Text> : null}
    {value !== undefined ? <DurationSelector value={Math.ceil(value / 60)} valueSeconds={value} secondPrecision={secondPrecision} presets={[1, 2, 3, 5, 10]} minSeconds={1} maxSeconds={MAX_CUE_DURATION_SECONDS} onChange={minutes => onChange(minutes * 60)} onChangeSeconds={onChange} /> : null}
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

interface TileReorder {
  active: boolean
  bind: (view: View | null) => void
  start: () => void
  scroll: (y: number) => number
  preview: (x: number, y: number) => void
  offsetX: number
  offsetY: number
  previewing: boolean
  drop: (x: number, y: number) => Promise<void>
  finish: () => void
  adjust: (delta: number) => void
}


const AnimatedConfigurationCard = Animated.createAnimatedComponent(Pressable)

export function ConfigurationTile({ name, program, tileWidth, onTooltip, defaultAlignment, onRunReset, onRunSkip, onRunSnap, menuLabel, selected, dirty, run, onOpen, onPlay, onStop, playDisabled, menuItems, reorder }: {
  name: string
  program: UnifiedTimerProgram
  tileWidth: number
  onTooltip?: (message: string) => void
  defaultAlignment?: UnifiedTimerProgram['alignment']
  onRunReset?: (id: string) => void
  onRunSkip?: (id: string, direction: 'next' | 'previous') => void
  onRunSnap?: (id: string, offset: number) => void
  menuLabel: string
  selected: boolean
  dirty?: boolean
  run?: LibraryRun
  onOpen: () => void
  onPlay?: () => void
  onStop?: () => void
  playDisabled: boolean
  reorder?: TileReorder
  menuItems: Parameters<typeof OverflowMenu>[0]['items']
}) {
  const { tokens, theme } = useTheme()
  const reducedMotion = useAppReducedMotion()
  const automaticColor = timerIdentityColor(program.steps[0].id)
  const interval = run?.program.steps[run.position?.currentStepIndex ?? 0] ?? program.steps[0]
  const accent = theme === 'eink' ? tokens.accent : subBellColorValue(interval.color ?? automaticColor, 0)
  const [ringSize, setRingSize] = useState(132)
  const [actionsOpen, setActionsOpen] = useState(false)
  const drawerProgress = useSharedValue(0)
  const drawerHeight = 60
  useEffect(() => {
    drawerProgress.value = reducedMotion ? Number(actionsOpen) : withTiming(Number(actionsOpen), { duration: 160 })
  }, [actionsOpen, drawerProgress, reducedMotion])
  const drawerStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: drawerHeight * (1 - drawerProgress.value) }],
    opacity: drawerProgress.value,
  }))
  const caretStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: -drawerHeight * drawerProgress.value }],
  }))
  const actionSize = Math.min(48, Math.floor((tileWidth - 24) / 3))
  const dragX = useSharedValue(0)
  const dragY = useSharedValue(0)
  const previewX = useSharedValue(0)
  const previewY = useSharedValue(0)
  const dragging = useRef(false)
  const dragScroll = useRef(0)
  const ignoreTapUntil = useRef(0)
  const reorderRef = useRef(reorder)
  reorderRef.current = reorder
  const reorderEnabled = !!reorder
  const offsetX = reorder?.offsetX ?? 0
  const offsetY = reorder?.offsetY ?? 0
  const gridDragging = reorder?.previewing === true
  useLayoutEffect(() => {
    previewX.value = reducedMotion || !gridDragging ? offsetX : withTiming(offsetX, { duration: 135 })
    previewY.value = reducedMotion || !gridDragging ? offsetY : withTiming(offsetY, { duration: 135 })
  }, [gridDragging, offsetX, offsetY, previewX, previewY, reducedMotion])
  const drag = useMemo(() => Gesture.Pan().enabled(reorderEnabled).activateAfterLongPress(260).runOnJS(true)
    .onStart(() => { dragging.current = true; dragScroll.current = 0; reorderRef.current?.start() })
    .onUpdate(event => {
      dragScroll.current += reorderRef.current?.scroll(event.absoluteY) ?? 0
      dragX.value = event.translationX
      dragY.value = event.translationY + dragScroll.current
      reorderRef.current?.preview(event.absoluteX, event.absoluteY)
    })
    .onEnd((event, success) => {
      if (success) void reorderRef.current?.drop(event.absoluteX, event.absoluteY).finally(() => {
        dragX.value = 0
        dragY.value = 0
        dragging.current = false
        ignoreTapUntil.current = Date.now() + 150
        reorderRef.current?.finish()
      })
    })
    .onFinalize((_, success) => {
      if (success || !dragging.current) return
      dragX.value = reducedMotion ? 0 : withTiming(0, { duration: 120 })
      dragY.value = reducedMotion ? 0 : withTiming(0, { duration: 120 })
      dragging.current = false
      ignoreTapUntil.current = Date.now() + 150
      reorderRef.current?.finish()
    }), [dragX, dragY, reorderEnabled, reducedMotion])
  const dragStyle = useAnimatedStyle(() => ({ transform: [{ translateX: dragX.value + previewX.value }, { translateY: dragY.value + previewY.value }] }))
  const duration = program.steps.reduce((sum, step) => sum + step.durationSeconds, 0)
  const radius = 44
  const circumference = 2 * Math.PI * radius
  let elapsed = 0
  const durationLabel = program.noMainInterval ? '∞' : run
    ? formatCompactDurationSeconds(run.program.steps[run.position?.currentStepIndex ?? 0]?.durationSeconds ?? duration)
    : program.steps.length <= 3 ? program.steps.map(step => formatCompactDurationSeconds(step.durationSeconds)).join(' · ') : `${program.steps.length} steps · ${formatCompactDurationSeconds(duration)}`
  const openCard = () => { if (!dragging.current && Date.now() >= ignoreTapUntil.current) onOpen() }
  const tile = <AnimatedConfigurationCard ref={reorder?.bind} accessible={false} focusable={false} onPress={openCard} collapsable={Platform.OS === 'web' ? undefined : false} layout={reducedMotion || reorder ? undefined : LinearTransition.duration(240)} entering={run && !reducedMotion ? FadeIn.duration(260) : undefined} style={[styles.configurationTile, dragStyle, { width: tileWidth, borderColor: run || selected || reorder?.active ? accent : tokens.border, backgroundColor: run ? tokens.surfaceHi : tokens.surface, zIndex: reorder?.active ? 3 : 0, elevation: reorder?.active ? 8 : 0 }]}>
    {run ? <Animated.View entering={reducedMotion ? undefined : FadeIn.duration(280)} pointerEvents="none" style={StyleSheet.absoluteFill}>
      <View style={[StyleSheet.absoluteFill, styles.tileGlow, { backgroundColor: accent, opacity: run.paused ? 0.05 : 0.13 }]} />
    </Animated.View> : null}
    <Pressable accessibilityRole="button" accessibilityLabel={`Open ${name}${dirty ? ', draft available' : ''}`}
      accessibilityState={{ selected }} accessibilityHint={reorder ? 'Hold and drag to reorder' : undefined}
      accessibilityActions={reorder ? [{ name: 'increment', label: 'Move later' }, { name: 'decrement', label: 'Move earlier' }] : undefined}
      onAccessibilityAction={event => reorder?.adjust(event.nativeEvent.actionName === 'increment' ? 1 : -1)}
      onPress={event => { event.stopPropagation(); openCard() }} style={StyleSheet.absoluteFill} />
    <View style={styles.tileTitleRow} pointerEvents="box-none">
      <Text pointerEvents="none" numberOfLines={1} style={[styles.tileTitle, { color: tokens.text }]}>{name}</Text>
      {menuItems.length ? <OverflowMenu label={menuLabel} items={menuItems} compact menuWidth={tileWidth} /> : null}
    </View>
    <View style={styles.tileRing} pointerEvents="box-none" onLayout={event => setRingSize(Math.round(event.nativeEvent.layout.width))}>
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        {run ? <TimerWatchfaceRings size={ringSize} position={run.position} program={run.program} progress={run.progress} eventPulse={run.eventPulse} muted={run.muted} card trackColor={tokens.border} /> : <Svg width="100%" height="100%" viewBox="0 0 112 112">
          <Circle cx={56} cy={56} r={radius} stroke={tokens.border} strokeWidth={3} fill="none" />
          {!program.noMainInterval && program.steps.map(step => {
            const offset = elapsed
            elapsed += step.durationSeconds
            const length = circumference * step.durationSeconds / duration
            const gap = program.steps.length > 1 ? Math.min(3, length * 0.35) : 0
            return <Circle key={step.id} cx={56} cy={56} r={radius} transform="rotate(-90 56 56)" fill="none" stroke={theme === 'eink' ? tokens.accent : subBellColorValue(step.color ?? automaticColor, 0)} strokeWidth={3} strokeDasharray={`${length - gap} ${circumference}`} strokeDashoffset={-circumference * offset / duration} />
          })}
          {!program.noMainInterval && program.steps.flatMap((step, index) => {
            if (!step.subBellsEnabled) return []
            const start = program.steps.slice(0, index).reduce((sum, item) => sum + item.durationSeconds, 0)
            return asPatternTracks(step.subBellTracks).flatMap((track, trackIndex) => {
              if (!track.enabled || !track.showOnWatchFace) return []
              const offsets = trackEventOffsetsSeconds(track, step.durationSeconds)
              const marksPerTrack = Math.max(1, Math.floor(96 / (program.steps.length * step.subBellTracks.length)))
              const stride = Math.max(1, Math.ceil(offsets.length / marksPerTrack))
              return offsets.filter((_, i) => i % stride === 0).map(offset => {
                const angle = 2 * Math.PI * (start + offset) / duration - Math.PI / 2
                return <Circle key={`${step.id}:${track.id}:${offset}`} cx={56 + 36 * Math.cos(angle)} cy={56 + 36 * Math.sin(angle)} r={1.6} fill={subBellColorValue(track.color, trackIndex, theme === 'eink')} />
              })
            })
          })}
        </Svg>}
      </View>
      {run ? <Text pointerEvents="none" numberOfLines={1} adjustsFontSizeToFit style={[styles.tileTime, { color: tokens.text }]}>{run.countdown}</Text> : null}
      <View style={styles.tileTransport} pointerEvents="box-none">
        {run && program.steps.length > 1 && onRunSkip ? <Pressable accessibilityRole="button" accessibilityLabel={`Previous step in ${name}`} onPress={event => { event.stopPropagation(); tapHaptic(); onRunSkip(run.id, 'previous') }} style={styles.tileStepButton}><TimerTransportIcon kind="previous" size={15} color={tokens.text} /></Pressable> : null}
        {onPlay ? <Pressable accessibilityRole="button" accessibilityLabel={run ? `${run.paused ? 'Resume' : 'Pause'} ${name}` : menuLabel === 'Working copy options' ? 'Start current timer' : `Start saved ${name}`} disabled={playDisabled} onPress={event => { event.stopPropagation(); onPlay() }} style={[styles.tilePlay, { opacity: playDisabled ? 0.4 : 1 }]}><TimerTransportIcon kind={run && !run.paused ? 'pause' : 'play'} size={27} color={tokens.text} /></Pressable> : null}
        {run && program.steps.length > 1 && onRunSkip ? <Pressable accessibilityRole="button" accessibilityLabel={`Next step in ${name}`} onPress={event => { event.stopPropagation(); tapHaptic(); onRunSkip(run.id, 'next') }} style={styles.tileStepButton}><TimerTransportIcon kind="next" size={15} color={tokens.text} /></Pressable> : null}
      </View>
    </View>
    <View style={[styles.tileFooter, run && styles.liveTileFooter]} pointerEvents="box-none">
      <Text pointerEvents="none" numberOfLines={1} style={[styles.tileStatus, { color: tokens.text, opacity: 0.66 }]}>{run ? `${run.paused ? 'Paused' : program.steps.length > 1 ? program.steps[run.position?.currentStepIndex ?? 0]?.label || 'Running' : 'Running'} · ${durationLabel}` : dirty && menuLabel !== 'Working copy options' ? `${durationLabel} · Modified` : durationLabel}</Text>
    </View>
    {run && (onRunReset || onRunSnap || onStop) ? <>
      <View style={styles.tileDrawerClip} pointerEvents={actionsOpen ? 'box-none' : 'none'} accessibilityElementsHidden={!actionsOpen} importantForAccessibility={actionsOpen ? 'auto' : 'no-hide-descendants'}>
        <Animated.View style={[styles.tileDrawer, drawerStyle, { borderColor: tokens.border, backgroundColor: tokens.surfaceHi }]}>
          {onRunReset ? <TimerControlButton size={actionSize} onTooltip={onTooltip} label={`Reset ${name}`} onPress={() => { setActionsOpen(false); onRunReset(run.id) }}><RestartIcon color={tokens.text} /></TimerControlButton> : null}
          {onRunSnap && !run.program.noMainInterval && defaultAlignment?.kind === 'local-clock' ? <TimerControlButton size={actionSize} onTooltip={onTooltip} label={`Snap ${name} to clock`} onPress={() => { setActionsOpen(false); onRunSnap(run.id, defaultAlignment.offsetMinutes) }}><ClockIcon color={tokens.text} /></TimerControlButton> : null}
          {onStop ? <TimerControlButton size={actionSize} onTooltip={onTooltip} label={`Stop ${name}`} onPress={() => { setActionsOpen(false); onStop() }}><TimerTransportIcon kind="stop" color={tokens.text} /></TimerControlButton> : null}
        </Animated.View>
      </View>
      <Animated.View style={[styles.tileCaret, caretStyle]} pointerEvents="box-none">
        <Pressable accessibilityRole="button" accessibilityLabel={`Controls for ${name}`} accessibilityState={{ expanded: actionsOpen }} onPress={event => { event.stopPropagation(); tapHaptic(); setActionsOpen(open => !open) }} style={styles.tileCaretButton}>
          <Svg width={18} height={18} viewBox="0 0 24 24" fill="none"><Path d={actionsOpen ? 'm6 9 6 6 6-6' : 'm6 15 6-6 6 6'} stroke={tokens.text} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" /></Svg>
        </Pressable>
      </Animated.View>
    </> : null}
  </AnimatedConfigurationCard>
  const content = reorder ? <GestureDetector gesture={drag} touchAction="pan-y">{tile}</GestureDetector> : tile
  return selected ? <TourTarget id="tour-library" style={{ width: tileWidth }}>{content}</TourTarget> : content
}

function ConfigCard({ config, tileWidth, onTooltip, onRunReset, onRunSkip, onRunSnap, draft, selected, run, onOpenRun, startDisabled, onSelect, onStart, onDuplicate, onVisibility, onDelete, onExport, transferBusy, onStop, reorder }: {
  config: UnifiedTimerConfig; tileWidth: number; onTooltip?: (message: string) => void; onRunReset?: (id: string) => void; onRunSkip?: (id: string, direction: 'next' | 'previous') => void; onRunSnap?: (id: string, offset: number) => void; draft?: UnifiedTimerDraft; selected: boolean; run?: LibraryRun; onOpenRun?: (id: string) => void; startDisabled: boolean; onSelect: () => void; onStart: () => void; onDuplicate: () => void; onVisibility: (value: boolean) => void;
  onDelete: () => void | Promise<void>; onExport: () => void; transferBusy: boolean; onStop?: () => void; reorder?: TileReorder
}) {
  return <ConfigurationTile tileWidth={tileWidth} onTooltip={onTooltip} defaultAlignment={config.program.alignment} onRunReset={onRunReset} onRunSkip={onRunSkip} onRunSnap={onRunSnap} name={config.name} program={run?.program ?? config.program} selected={selected} dirty={draft?.dirty} run={run} onOpen={run ? () => onOpenRun?.(run.id) : onSelect} onPlay={onStart} onStop={onStop} reorder={reorder} playDisabled={startDisabled} menuLabel={`Options for ${config.name}`} menuItems={[
    { label: 'Duplicate', onPress: onDuplicate },
    ...(!onOpenRun ? [{ label: config.showInRunningSelector ? 'Hide while running' : 'Show while running', onPress: () => onVisibility(!config.showInRunningSelector) }] : []),
    { label: 'Export', disabled: transferBusy, onPress: onExport },
    { label: 'Delete', destructive: true, onPress: () => void onDelete() },
  ]} />
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
  recoveryRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  setupMenuActions: { flexDirection: 'row', gap: 8, paddingBottom: 12, borderBottomWidth: 1 },
  setupMenuAction: { flex: 1, minWidth: 0, minHeight: 54, paddingVertical: 6, paddingHorizontal: 4, gap: 5, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderRadius: 12 },
  setupMenuActionText: { fontSize: 12, textAlign: 'center' },
  setupMenuTitle: { fontSize: 23, fontWeight: '500', marginTop: 12, marginBottom: 2 },
  libraryHeader: { flexDirection: 'row', minHeight: 56, alignItems: 'center', paddingHorizontal: 12, borderBottomWidth: 1, gap: 4 },
  libraryHeaderButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  libraryContent: { width: '100%', maxWidth: 640, alignSelf: 'center', paddingHorizontal: 16, paddingTop: 16, gap: 24 },
  groupControls: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 },
  runningShortcut: { minHeight: 44, borderWidth: 1, borderRadius: 14, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 9, alignSelf: 'flex-start' },
  configDropTarget: { position: 'absolute', left: 16, right: 16, height: 52, borderWidth: 1, borderRadius: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, zIndex: 20 },
  configurationGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-start', gap: 10 },
  libraryDivider: { height: StyleSheet.hairlineWidth, marginVertical: -12 },
  configurationTile: { minWidth: 0, paddingHorizontal: 8, paddingBottom: 8, borderWidth: 1, borderRadius: 16 },
  tileTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 44 },
  tileMenu: { width: 40, height: 44, borderWidth: 0, marginRight: -5 },
  tileGlow: { borderRadius: 15 },
  tileStatus: { textAlign: 'center', fontSize: 11, flexShrink: 1 },
  tileTitle: { flex: 1, minWidth: 0, fontSize: 14 },
  tileRing: { width: '100%', maxWidth: 166, aspectRatio: 1, alignSelf: 'center', alignItems: 'center', justifyContent: 'center' },
  tileTime: { fontSize: 21, fontVariant: ['tabular-nums'], maxWidth: '75%' },
  tileFooter: { minHeight: 24, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  liveTileFooter: { minHeight: 26, justifyContent: 'flex-start', paddingLeft: 4, paddingRight: 44 },
  tileCaret: { position: 'absolute', right: 4, bottom: 0, width: 44, height: 44, zIndex: 2 },
  tileCaretButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  tileTransport: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  tileStepButton: { width: 32, height: 44, alignItems: 'center', justifyContent: 'center' },
  tileDrawerClip: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 60, overflow: 'hidden', borderBottomLeftRadius: 15, borderBottomRightRadius: 15, zIndex: 1 },
  tileDrawer: { height: 60, borderTopWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5, gap: 4 },
  tilePlay: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  screen: { flex: 1 }, closedSummary: { flex: 1, paddingHorizontal: 24, justifyContent: 'center', gap: 16 }, pinned: { paddingHorizontal: 20, gap: 10 }, nameLine: { flexDirection: 'row', alignItems: 'center', gap: 8 }, currentName: { flex: 1, minWidth: 0, minHeight: 46, justifyContent: 'center', gap: 2 }, currentNameText: { fontSize: 22, fontWeight: '500' }, nameInput: { flex: 1, minWidth: 0, minHeight: 45, borderBottomWidth: 2, fontSize: 22, fontWeight: '500', paddingHorizontal: 2 }, namePicker: { minWidth: 44, minHeight: 44, borderWidth: 1.5, borderRadius: 22, alignItems: 'center', justifyContent: 'center' }, saveRow: { flexDirection: 'row', alignItems: 'center', gap: 6 }, statusSlot: { flex: 1, alignItems: 'flex-end' }, status: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase' }, footer: { paddingHorizontal: 20, paddingTop: 10, gap: 7 }, startButton: { minHeight: 52, borderWidth: 1, borderRadius: 18, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 10 }, startText: { fontSize: 17, fontWeight: '700' }, noticeText: { textAlign: 'center', fontSize: 12 }, section: { gap: 12 }, sectionTitle: { fontSize: 17, fontWeight: '700' }, helperText: { fontSize: 12, lineHeight: 17 }, copyText: { fontSize: 14, lineHeight: 21 }, rowTitle: { fontSize: 14, fontWeight: '600' }, row: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }, flex: { flex: 1, minWidth: 0 }, stepRow: { borderWidth: 1, borderRadius: 14, minHeight: 62, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 6 }, stepSummary: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 50 }, stepIndex: { fontSize: 13, fontWeight: '800', fontVariant: ['tabular-nums'] }, stepName: { fontSize: 14, fontWeight: '700' }, stepActions: { flexDirection: 'row', gap: 4 }, miniButton: { width: 36, height: 36, borderWidth: 1, borderRadius: 18, alignItems: 'center', justifyContent: 'center' }, buttonRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 }, stepEditor: { gap: 10 }, input: { minHeight: 44, borderWidth: 1.5, borderRadius: 12, paddingHorizontal: 12, fontSize: 15 }, cueRow: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 12 }, masterRow: { flexDirection: 'row', alignItems: 'center', gap: 12 }, slider: { flex: 1, height: 40 }, sliderRow: { gap: 4 }, actionBlock: { borderTopWidth: 1, paddingTop: 10, gap: 8 }, actionRail: { gap: 8, paddingVertical: 3, paddingRight: 24 }, trackOptionRail: { gap: 6, paddingVertical: 3, paddingRight: 20 }, actionChip: { minHeight: 38, borderWidth: 1.5, borderRadius: 22, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center' }, actionLabel: { fontSize: 12, fontWeight: '600' }, preview: { borderWidth: 1, borderRadius: 12, padding: 10 }, panel: { gap: 12 }, trackCard: { borderWidth: 1, borderRadius: 14, padding: 12, gap: 10 }, trackControls: { gap: 12 }, markerBox: { gap: 8 }, inlineFields: { gap: 10 }, eyeButton: { minWidth: 40, minHeight: 40, borderWidth: 1, borderRadius: 22, alignItems: 'center', justifyContent: 'center' }, profileBox: { gap: 8 }, themeButton: { minHeight: 42, minWidth: 44, borderWidth: 1, borderRadius: 22, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10 }, notice: { borderWidth: 1.5, borderRadius: 16, padding: 14, gap: 8 }, cardActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 }, statusText: { fontSize: 11 }, markerValue: { fontSize: 12 },
  setupPage: { paddingHorizontal: 20, gap: 20 }, topBar: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 10 }, nameEdit: { flex: 1, minWidth: 0, justifyContent: 'center', gap: 2 }, pageTitle: { fontSize: 21, fontWeight: '600' }, topActions: { flexDirection: 'row', gap: 8 }, iconButton: { width: 42, height: 42, borderWidth: 1, borderRadius: 21, alignItems: 'center', justifyContent: 'center' }, runningControlRow: { minHeight: 60, flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 }, runningControlIcon: { width: 32, alignItems: 'center', justifyContent: 'center' }, saveButton: { minWidth: 60, height: 42, borderWidth: 1, borderRadius: 21, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 }, overflowGlyph: { fontSize: 16, fontWeight: '800', letterSpacing: 1 }, mainTimerCard: { borderWidth: 1, borderRadius: 18, padding: 16, gap: 12 }, mainTimerFlat: { gap: 10 }, mainIntervalLabel: { fontSize: 16, fontWeight: '600' }, eyebrow: { fontSize: 11, letterSpacing: 1.2, fontWeight: '700' }, durationHero: { fontSize: 42, fontWeight: '500', fontVariant: ['tabular-nums'] }, soundSummary: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 12, paddingTop: 8 }, soundLeading: { fontSize: 21, width: 28, textAlign: 'center' }, soundName: { fontSize: 12, lineHeight: 17 }, subBellSummary: { borderWidth: 1, borderRadius: 16, padding: 12, gap: 10 }, subBellHeader: { minHeight: 42, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }, inlineLink: { minHeight: 36, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, stepCard: { minHeight: 130, borderWidth: 1, borderRadius: 16, paddingHorizontal: 10, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', gap: 8 }, stepCardMain: { flex: 1, minWidth: 0, gap: 7 }, stepCardTop: { flexDirection: 'row', alignItems: 'center', gap: 9 }, stepCardTitle: { flex: 1, fontSize: 15, fontWeight: '700' }, stepCardDuration: { fontSize: 15, fontWeight: '700', fontVariant: ['tabular-nums'] }, stepSoundLine: { flexDirection: 'row', alignItems: 'center', gap: 6 }, stepCardActions: { gap: 4 }, sortableSteps: { overflow: 'hidden' }, sortableStepsScroll: { flex: 1 }, sortableStepsContent: { paddingHorizontal: 0 }, sortableStepItem: { width: '100%' }, stepHandle: { alignSelf: 'stretch', justifyContent: 'center' }, stepHandlePressable: { width: 32, minHeight: 52, alignItems: 'center', justifyContent: 'center' }, stepHandleGlyph: { fontSize: 20, lineHeight: 24 }, mainActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, secondaryButton: { minHeight: 44, borderWidth: 1, borderRadius: 14, paddingHorizontal: 14, justifyContent: 'center', alignItems: 'center' }, secondaryLine: { minHeight: 36, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, controlPanel: { borderWidth: 1, borderRadius: 15, padding: 12, gap: 12 }, stepRailSection: { gap: 10, paddingVertical: 5 }, startDock: { borderTopWidth: 1, paddingTop: 10, paddingHorizontal: 18 }, settingsMenu: { gap: 6 }, settingIcon: { width: 32, height: 32, borderWidth: 1, borderRadius: 16, alignItems: 'center', justifyContent: 'center' }, settingsRow: { minHeight: 58, borderBottomWidth: 1, flexDirection: 'row', alignItems: 'center', paddingVertical: 8, gap: 12 }, sectionHeading: { flexDirection: 'row', alignItems: 'center', gap: 10 }, backButton: { width: 36, height: 36, borderWidth: 1, borderRadius: 18, alignItems: 'center', justifyContent: 'center' }, trackListRow: { minHeight: 62, borderWidth: 1, borderRadius: 13, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 10 }, trackListEdit: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 60 }, trackDot: { width: 9, height: 9, borderRadius: 5 }, trackDetail: { gap: 12 }, trackNameInput: { minHeight: 38, borderBottomWidth: 1.5, fontSize: 22, fontWeight: '500', paddingHorizontal: 1 }, trackModes: { gap: 6, paddingVertical: 3, paddingRight: 20 }, randomBox: { gap: 8 },
})

