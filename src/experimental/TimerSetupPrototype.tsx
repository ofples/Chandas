import AsyncStorage from '@react-native-async-storage/async-storage'
import * as Clipboard from 'expo-clipboard'
import Slider from '@react-native-community/slider'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { useFonts, JetBrainsMono_300Light, JetBrainsMono_400Regular } from '@expo-google-fonts/jetbrains-mono'
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context'
import type { CueSettings, HapticPattern, HapticStrength, PatternTrack } from '../types'
import { Toggle } from '../components/Toggle'
import { Chip } from '../components/Chip'
import { DurationSelector } from '../components/timer-v2/DurationSelector'
import { ClockSnapSelector } from '../components/timer-v2/ClockSnapSelector'
import { SoundPickerSheet } from '../components/timer-v2/SoundPickerSheet'
import { SoundName } from '../components/timer-v2/SoundName'
import { ScheduleConfig } from '../components/timer-v2/schedule-config'
import { HapticsSheet } from '../components/timer-v2/haptics-sheet'
import { SegmentedControl } from '../components/timer-v2/SegmentedControl'
import { ColorSelector } from '../components/timer-v2/ColorSelector'
import { OffsetGrid } from '../components/timer-v2/OffsetGrid'
import { SheetSectionTitle } from '../components/timer-v2/SheetSectionTitle'
import { PrototypeSheet } from './PrototypeSheet'
import { ThemeProvider, useTheme } from '../theme/ThemeContext'
import { ConfirmationProvider, useConfirmation } from '../components/timer-v2/ConfirmationDialog'
import { AppErrorBoundary } from '../components/timer-v2/app-error-boundary'
import { FeedbackLayerProvider, RootFeedbackOverlay } from '../components/timer-v2/feedback-layer'
import { SetupHelpProvider } from '../components/timer-v2/inline-help'
import { formatCompactDurationSeconds, trackCadenceSeconds, trackSelectedOffsetsSeconds, validOffsetsForCadenceSeconds } from '../lib/timerV2'
import {
  addPrototypeLibrarySound, addStep, createPrototypeStore, defaultPrototypeDraft, deleteConfig, draftIsDirty, duplicateConfig, duplicateStep, importPrototypeConfig,
  moveStep, newPrototypeTrack, normalizePrototypeStore, renameConfig, saveAsConfig, saveCurrentConfig,
  SETUP_PROTOTYPE_STORAGE_KEY, switchConfig,
  type PrototypeDraft, type PrototypeStep, type PrototypeStore, type PrototypeSavedConfig,
} from './setup-prototype-model'

const CAPABILITIES = ['Volume', 'Schedule', 'Run length', 'Haptics', 'Alarm', 'End gong', 'Display', 'Notifications', 'Calls', 'Focus'] as const
type Capability = typeof CAPABILITIES[number]
type CueTarget = { kind: 'step'; stepId: string } | { kind: 'track'; stepId: string; trackId: string } | { kind: 'completion' } | { kind: 'alarm' }
const STEP_PRESETS = [1, 2, 3, 5, 10, 15, 20, 25, 30, 45, 60]

/** Isolated interactive setup concept. It never starts or configures the real timer. */
export default function TimerSetupPrototype() {
  const [themeOverride, setThemeOverride] = useState<'dark' | 'light'>('dark')
  const [fontsLoaded] = useFonts({ 'JetBrainsMono-Light': JetBrainsMono_300Light, 'JetBrainsMono-Regular': JetBrainsMono_400Regular })
  const [notice, setNotice] = useState<null | { id: string; title: string; message: string; tone: 'success' | 'attention' }>(null)
  const dismiss = useCallback(() => setNotice(null), [])
  if (!fontsLoaded) return <View style={[styles.fill, { backgroundColor: '#0b0c10' }]} />
  return <GestureHandlerRootView style={styles.fill}>
    <SafeAreaProvider>
      <ThemeProvider themeOverride={themeOverride}>
        <ConfirmationProvider>
          <FeedbackLayerProvider notice={notice} onDismiss={dismiss}>
            <SetupHelpProvider visible={false} onChange={() => undefined}>
              <AppErrorBoundary><PrototypeApp onNotice={setNotice} onToggleTheme={() => setThemeOverride(current => current === 'dark' ? 'light' : 'dark')} /></AppErrorBoundary>
              <RootFeedbackOverlay />
            </SetupHelpProvider>
          </FeedbackLayerProvider>
        </ConfirmationProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  </GestureHandlerRootView>
}

function PrototypeApp({ onNotice, onToggleTheme }: { onNotice: (notice: { id: string; title: string; message: string; tone: 'success' | 'attention' }) => void; onToggleTheme: () => void }) {
  const { tokens, theme } = useTheme()
  const confirm = useConfirmation()
  const insets = useSafeAreaInsets()
  const [store, setStore] = useState<PrototypeStore>(createPrototypeStore)
  const [hydrated, setHydrated] = useState(false)
  const [sheetOpen, setSheetOpen] = useState(true)
  const [visibleCapabilities, setVisibleCapabilities] = useState<Capability[]>([])
  const [stepEditorId, setStepEditorId] = useState<string | null>(null)
  const [configPicker, setConfigPicker] = useState(false)
  const [cueTarget, setCueTarget] = useState<CueTarget | null>(null)
  const [hapticsOpen, setHapticsOpen] = useState(false)
  const [notice, setNotice] = useState<{ title: string; message: string; tone: 'success' | 'attention' } | null>(null)
  const [nameEdit, setNameEdit] = useState<{ kind: 'rename' | 'save-as'; id?: string; value: string } | null>(null)
  const [switchTarget, setSwitchTarget] = useState<string | null>(null)
  const [startPreview, setStartPreview] = useState(false)
  const persistenceQueue = useRef(Promise.resolve())

  useEffect(() => {
    let alive = true
    AsyncStorage.getItem(SETUP_PROTOTYPE_STORAGE_KEY).then(raw => {
      if (!alive) return
      if (raw) {
        try { setStore(normalizePrototypeStore(JSON.parse(raw))) }
        catch { setStore(createPrototypeStore()) }
      }
    }).catch(() => { if (alive) setStore(createPrototypeStore()) }).finally(() => { if (alive) setHydrated(true) })
    return () => { alive = false }
  }, [])
  useEffect(() => {
    if (!hydrated) return
    const snapshot = JSON.stringify(store)
    persistenceQueue.current = persistenceQueue.current.catch(() => undefined).then(() => AsyncStorage.setItem(SETUP_PROTOTYPE_STORAGE_KEY, snapshot)).catch(() => setNotice({ title: 'Prototype setup was not saved', message: 'Storage is unavailable. This draft remains open until you leave.', tone: 'attention' }))
  }, [hydrated, store])

  const updateDraft = (transform: (draft: PrototypeDraft) => PrototypeDraft) => setStore(current => ({ ...current, draft: transform(current.draft) }))
  const patchStep = (stepId: string, patch: Partial<PrototypeStep>) => updateDraft(draft => ({ ...draft, steps: draft.steps.map(step => step.id === stepId ? { ...step, ...patch } : step) }))
  const currentCue = cueTarget ? resolveCue(store.draft, cueTarget) : null
  const updateCue = (patch: Partial<CueSettings>) => {
    if (!cueTarget) return
    if (patch.sound) setStore(current => addPrototypeLibrarySound(current, patch.sound!))
    for (const sound of patch.sounds ?? []) setStore(current => addPrototypeLibrarySound(current, sound))
    updateDraft(draft => {
      if (cueTarget.kind === 'completion') return { ...draft, completionCue: { ...(draft.completionCue ?? defaultCue()), ...patch } }
      if (cueTarget.kind === 'alarm') return { ...draft, settings: { ...draft.settings, alarmSound: patch.sound ?? draft.settings.alarmSound, alarmVolume: patch.volume ?? draft.settings.alarmVolume } }
      return { ...draft, steps: draft.steps.map(step => {
        if (step.id !== cueTarget.stepId) return step
        if (cueTarget.kind === 'step') return { ...step, endCue: { ...step.endCue, ...patch } }
        return { ...step, tracks: step.tracks.map(track => track.id === cueTarget.trackId ? { ...track, ...patch } : track) }
      }) }
    })
  }
  const closeSetup = () => { setSheetOpen(false); setStepEditorId(null); setConfigPicker(false) }
  const persist = (next: PrototypeStore) => setStore(next)
  const addSaveAs = () => setNameEdit({ kind: 'save-as', value: `${store.draft.name} copy` })
  const saveCurrent = () => { persist(saveCurrentConfig(store)); setNotice({ title: 'Configuration saved', message: store.draft.name, tone: 'success' }) }
  const beginSwitch = (id: string) => {
    if (id === store.activeConfigId || (id === '__unsaved__' && store.activeConfigId === null)) { setConfigPicker(false); return }
    if (draftIsDirty(store)) setSwitchTarget(id)
    else { persist(switchConfig(store, id, 'discard')); setConfigPicker(false) }
  }
  const switchWith = (choice: 'save' | 'keep' | 'discard' | 'dismiss') => {
    if (!switchTarget) return
    if (choice === 'save') {
      const next = saveCurrentConfig(store)
      const switched = switchConfig(next, switchTarget, 'discard')
      persist(switched)
    } else if (choice !== 'dismiss') persist(switchConfig(store, switchTarget, choice))
    setSwitchTarget(null)
    if (choice !== 'dismiss') setConfigPicker(false)
  }
  const createStep = () => {
    const source = store.draft.steps[store.draft.steps.length - 1] ?? fallbackStep()
    updateDraft(draft => ({ ...draft, steps: [...draft.steps, addStep(source)] }))
  }
  const updateTrack = (stepId: string, trackId: string, patch: Partial<PatternTrack>) => updateDraft(draft => ({ ...draft, steps: draft.steps.map(step => step.id !== stepId ? step : { ...step, tracks: step.tracks.map(track => track.id === trackId ? { ...track, ...patch } : track) }) }))
  const cueTitle = cueTarget?.kind === 'completion' ? 'Final gong' : cueTarget?.kind === 'alarm' ? 'Alarm sound' : cueTarget?.kind === 'step' ? 'Step end cue' : 'Sub-bell cue'
  const activeStep = stepEditorId ? store.draft.steps.find(step => step.id === stepEditorId) : undefined
  const shownCapabilities = [...new Set([...visibleCapabilities, ...capabilitiesEnabledBy(store.draft)])]

  const configHeader = <>
          <View style={styles.sheetHeader}>
            <Pressable style={styles.configTitle} onPress={() => setConfigPicker(true)} accessibilityRole="button" accessibilityLabel={`Configuration ${store.draft.name}. Choose configuration`}>
              <Text style={[styles.eyebrow, { color: tokens.textMuted }]}>CONFIGURATION{draftIsDirty(store) ? ' · DRAFT' : ''}</Text>
              <Text numberOfLines={1} style={[styles.sheetTitle, { color: tokens.text }]}>{store.draft.name} <Text style={{ color: tokens.accent }}>⌄</Text></Text>
            </Pressable>
          </View>
          <View style={styles.saveRow}>
            <Text style={[styles.helperText, { color: tokens.textMuted }]}>{store.draft.steps.length} {store.draft.steps.length === 1 ? 'step' : 'steps'} · {runSummary(store.draft)}</Text>
            <Pressable onPress={saveCurrent} style={styles.saveButton} accessibilityRole="button"><Text style={[styles.saveLabel, { color: tokens.accent }]}>Save</Text></Pressable>
            <Pressable onPress={addSaveAs} style={[styles.saveButton, { borderColor: tokens.border }]} accessibilityRole="button"><Text style={[styles.saveLabel, { color: tokens.text }]}>Save as</Text></Pressable>
          </View>
  </>

  return <View style={[styles.screen, { backgroundColor: tokens.bg, paddingTop: insets.top }]}>
    <View style={styles.hostHeader}><Pressable onPress={onToggleTheme} accessibilityRole="button" style={[styles.iconButton, { borderColor: tokens.border }]}><Text style={{ color: tokens.text }}>{theme === 'dark' ? '☼' : '◐'}</Text></Pressable><Text style={[styles.brand, { color: tokens.text }]}>CHANDAS <Text style={{ color: tokens.accent }}>·</Text></Text><View style={{ width: 42 }} /></View>
    <View style={styles.previewArea}>
      <Text style={[styles.sheetTitle, { color: tokens.text }]}>{store.draft.name}</Text>
      <Pressable disabled={!hydrated} onPress={() => { setSheetOpen(true); setStepEditorId(null) }} style={[styles.openSetup, { backgroundColor: tokens.accent, opacity: hydrated ? 1 : 0.5 }]} accessibilityRole="button"><Text style={styles.openSetupText}>{hydrated ? 'Open setup' : 'Loading setup…'}</Text></Pressable>
      <Text style={[styles.prototypeLabel, { color: tokens.textMuted }]}>Experimental setup · saved separately</Text>
    </View>
    {sheetOpen ? <PrototypeSheet visible={sheetOpen && hydrated && !configPicker && !nameEdit && !switchTarget && !cueTarget && !hapticsOpen && !startPreview} title="Timer setup" presentationKey={activeStep?.id ?? 'overview'} showTitle={false} pinnedContent={configHeader} onClose={closeSetup} onBack={activeStep ? () => setStepEditorId(null) : undefined} initialSnap="full" footer={<View style={styles.footer}><Text style={[styles.footerSummary, { color: tokens.textMuted }]}>{runSummary(store.draft)} · {formatCompactDurationSeconds(cycleSeconds(store.draft))} per round</Text><Pressable onPress={() => setStartPreview(true)} style={[styles.startButton, { backgroundColor: tokens.accent }]} accessibilityRole="button"><Text style={styles.startLabel}>Review setup</Text></Pressable></View>}>
          <View style={styles.sheetContent}>
            {activeStep ? <StepEditor step={activeStep} canRemove={store.draft.steps.length > 1} onChange={patch => patchStep(activeStep.id, patch)} onUpdateTrack={(trackId, patch) => updateTrack(activeStep.id, trackId, patch)} onEditCue={target => setCueTarget(target)} onRemove={() => { updateDraft(draft => ({ ...draft, steps: draft.steps.filter(step => step.id !== activeStep.id) })); setStepEditorId(null) }} onDuplicate={() => updateDraft(draft => ({ ...draft, steps: [...draft.steps.slice(0, draft.steps.findIndex(step => step.id === activeStep.id) + 1), duplicateStep(activeStep), ...draft.steps.slice(draft.steps.findIndex(step => step.id === activeStep.id) + 1)] }))} onMove={(direction) => updateDraft(draft => ({ ...draft, steps: moveStep(draft.steps, draft.steps.findIndex(step => step.id === activeStep.id), draft.steps.findIndex(step => step.id === activeStep.id) + direction) }))} /> : <>
              {store.draft.steps.length > 1 ? <SheetSectionTitle>Steps</SheetSectionTitle> : null}
              {store.draft.steps.length === 1 && !stepEditorId ? <SingleStepEditor step={store.draft.steps[0]} onChange={patch => patchStep(store.draft.steps[0].id, patch)} onEditCue={() => setCueTarget({ kind: 'step', stepId: store.draft.steps[0].id })} onOpenDetails={() => setStepEditorId(store.draft.steps[0].id)} /> : store.draft.steps.map((step, index) => <StepRow key={step.id} step={step} index={index} count={store.draft.steps.length} onPress={() => setStepEditorId(step.id)} onMove={direction => updateDraft(draft => ({ ...draft, steps: moveStep(draft.steps, index, index + direction) }))} onDuplicate={() => updateDraft(draft => ({ ...draft, steps: [...draft.steps.slice(0, index + 1), duplicateStep(step), ...draft.steps.slice(index + 1)] }))} onRemove={() => updateDraft(draft => ({ ...draft, steps: draft.steps.filter(item => item.id !== step.id) }))} />)}
              <View style={styles.stepActions}><ActionButton label="＋ Add step" onPress={createStep} /><ActionButton label="Duplicate" onPress={() => { const step = store.draft.steps.at(-1); if (step) updateDraft(draft => ({ ...draft, steps: [...draft.steps, duplicateStep(step)] })) }} disabled={!store.draft.steps.length} /></View>
              <SectionCard title="Clock alignment">
                <View style={styles.fieldRow}><Text style={[styles.fieldTitle, { color: tokens.text }]}>Align complete round</Text><Toggle value={store.draft.alignment.kind === 'local-clock'} onChange={enabled => updateDraft(draft => ({ ...draft, alignment: enabled ? { kind: 'local-clock', offsetMinutes: 0 } : { kind: 'elapsed' } }))} accessibilityLabel="Align the complete round to the clock" /></View>
                {store.draft.alignment.kind === 'local-clock' ? <ClockSnapSelector cycleDurationSeconds={cycleSeconds(store.draft)} value={store.draft.alignment.offsetMinutes} onChange={offsetMinutes => updateDraft(draft => ({ ...draft, alignment: { kind: 'local-clock', offsetMinutes } }))} fadeColor={tokens.surface} /> : <Text style={[styles.helperText, { color: tokens.textMuted }]}>Start immediately and measure each round from its start.</Text>}
              </SectionCard>
              <View style={styles.capabilityBlock}><SheetSectionTitle>Optional controls</SheetSectionTitle><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.capabilityRail}>{CAPABILITIES.map(item => <Chip key={item} label={item} active={shownCapabilities.includes(item)} onPress={() => setVisibleCapabilities(current => current.includes(item) ? current.filter(value => value !== item) : [...current, item])} compact />)}</ScrollView>{shownCapabilities.length ? shownCapabilities.map(item => <CapabilityFields key={item} capability={item} draft={store.draft} onDraft={updateDraft} onEditCue={setCueTarget} onEditHaptics={() => setHapticsOpen(true)} />) : <Text style={[styles.helperText, { color: tokens.textMuted }]}>Choose a labelled control to reveal its settings here.</Text>}</View>
              <Text style={[styles.helperText, { color: tokens.textMuted }]}>Setup concept · edits are saved separately.</Text>
            </>}
            {notice ? <View style={[styles.inlineNotice, { borderColor: notice.tone === 'success' ? tokens.positive : tokens.warm }]}><Text style={[styles.fieldTitle, { color: notice.tone === 'success' ? tokens.positive : tokens.warm }]}>{notice.title}</Text><Text style={[styles.helperText, { color: tokens.textMuted }]}>{notice.message}</Text></View> : null}
          </View>
    </PrototypeSheet> : null}

    {currentCue ? <SoundPickerSheet visible={!configPicker && !switchTarget && !nameEdit && !hapticsOpen && !startPreview} title={cueTitle} cue={currentCue} soundLibrary={store.soundLibrary} masterVolume={store.draft.settings.masterVolume} advanced onChange={updateCue} onClose={() => setCueTarget(null)} onFeedback={result => { const message = result.message ?? ''; const tone = result.tone === 'success' ? 'success' : 'attention'; setNotice({ title: result.title, message, tone }); onNotice({ id: String(Date.now()), title: result.title, message, tone }) }} /> : null}
    <HapticsSheet visible={hapticsOpen && !configPicker && !switchTarget && !nameEdit && !startPreview} value={store.draft.settings.haptics} onChange={haptics => updateDraft(draft => ({ ...draft, settings: { ...draft.settings, haptics } }))} onClose={() => setHapticsOpen(false)} />
    <ConfigPicker onToggleRunning={id => setStore(current => ({ ...current, configs: current.configs.map(config => config.id === id ? { ...config, showInRunningSelector: config.showInRunningSelector === false } : config) }))} visible={configPicker && !switchTarget && !nameEdit} store={store} onClose={() => { setConfigPicker(false); setSwitchTarget(null) }} onSelect={beginSwitch} onRename={(id, value) => { setConfigPicker(false); setNameEdit({ kind: 'rename', id, value }) }} onDuplicate={id => persist(duplicateConfig(store, id))} onDelete={id => { void confirm({ title: 'Delete configuration?', message: 'This removes the saved configuration and its kept draft.', confirmLabel: 'Delete', destructive: true }).then(accepted => { if (accepted) setStore(current => deleteConfig(current, id)) }) }} onImport={candidate => { const next = importPrototypeConfig(store, candidate); if (next === store) return false; persist(next); setNotice({ title: 'Setup imported', message: 'The imported setup is saved as a configuration.', tone: 'success' }); return true }} onExport={() => { void exportPrototype(store).then(() => setNotice({ title: 'Setup copied', message: 'The current prototype setup JSON is on your clipboard.', tone: 'success' })).catch(() => setNotice({ title: 'Could not copy setup', message: 'Clipboard access was unavailable.', tone: 'attention' })) }} />
    <DirtySwitchDialog target={switchTarget === '__unsaved__' ? { name: 'Kept draft' } : switchTarget ? store.configs.find(config => config.id === switchTarget) : undefined} onChoice={switchWith} />
    <NameDialog value={nameEdit} onChange={value => setNameEdit(current => current ? { ...current, value } : null)} onCancel={() => setNameEdit(null)} onSave={() => { if (!nameEdit) return; persist(nameEdit.kind === 'rename' && nameEdit.id ? renameConfig(store, nameEdit.id, nameEdit.value) : saveAsConfig(store, nameEdit.value)); setNameEdit(null) }} />
    <Modal visible={startPreview} transparent animationType="fade" onRequestClose={() => setStartPreview(false)}><View style={styles.dialogBackdrop}><View style={[styles.dialog, { backgroundColor: tokens.surface, borderColor: tokens.border }]}><Text style={[styles.sheetTitle, { color: tokens.text }]}>Setup preview only</Text><Text style={[styles.helperText, { color: tokens.textMuted }]}>This prototype does not start a timer. Your setup is saved in its own experimental storage.</Text><Pressable onPress={() => setStartPreview(false)} style={[styles.startButton, { backgroundColor: tokens.accent }]}><Text style={styles.startLabel}>Back to setup</Text></Pressable></View></View></Modal>
  </View>
}

function SingleStepEditor({ step, onChange, onEditCue, onOpenDetails }: { step: PrototypeStep; onChange: (patch: Partial<PrototypeStep>) => void; onEditCue: () => void; onOpenDetails: () => void }) {
  const { tokens } = useTheme()
  return <SectionCard title="Interval">
    <TextInput value={step.label} onChangeText={label => onChange({ label })} accessibilityLabel="Interval name" placeholder="Interval name (optional)" placeholderTextColor={tokens.textMuted} style={[styles.nameInput, { color: tokens.text, borderBottomColor: tokens.border }]} />
    <DurationSelector label="Duration" value={Math.ceil(step.durationSeconds / 60)} valueSeconds={step.durationSeconds} secondPrecision presets={STEP_PRESETS} minSeconds={1} maxSeconds={14_400} onChange={minutes => onChange({ durationSeconds: minutes * 60 })} onChangeSeconds={durationSeconds => onChange({ durationSeconds })} fadeColor={tokens.surface} />
    <Pressable onPress={onEditCue} style={[styles.cueRow, { borderColor: tokens.border }]} accessibilityRole="button"><View><Text style={[styles.fieldTitle, { color: tokens.text }]}>End cue</Text><SoundName cue={step.endCue} /></View><Text style={{ color: tokens.accent }}>›</Text></Pressable>
    <View style={styles.fieldRow}><View style={styles.fieldCopy}><Text style={[styles.fieldTitle, { color: tokens.text }]}>Sub-bells</Text><Text style={[styles.helperText, { color: tokens.textMuted }]}>{trackSummary(step)}</Text></View><Toggle value={step.subBellsEnabled} onChange={subBellsEnabled => onChange({ subBellsEnabled })} accessibilityLabel="Enable sub-bells" /></View>
    <Pressable onPress={onOpenDetails} style={[styles.detailButton, { borderColor: tokens.border }]}><Text style={[styles.actionLabel, { color: tokens.accent }]}>Edit sub-bells ›</Text></Pressable>
  </SectionCard>
}

function StepRow({ step, index, count, onPress, onMove, onDuplicate, onRemove }: { step: PrototypeStep; index: number; count: number; onPress: () => void; onMove: (direction: number) => void; onDuplicate: () => void; onRemove: () => void }) {
  const { tokens } = useTheme()
  return <View style={[styles.stepRow, { borderColor: tokens.border }]}>
    <Pressable onPress={onPress} style={styles.stepMain} accessibilityRole="button" accessibilityLabel={`Edit step ${index + 1}, ${step.label}, ${formatCompactDurationSeconds(step.durationSeconds)}`}>
      <Text style={[styles.stepIndex, { color: tokens.accent }]}>{String(index + 1).padStart(2, '0')}</Text>
      <View style={styles.stepCopy}><Text style={[styles.stepTitle, { color: tokens.text }]}>{step.label || `Step ${index + 1}`}</Text><Text style={[styles.helperText, { color: tokens.textMuted }]}>{formatCompactDurationSeconds(step.durationSeconds)} · {trackSummary(step)}</Text></View><Text style={{ color: tokens.accent }}>›</Text>
    </Pressable>
    <View style={styles.stepControls}><ActionButton label="↑" onPress={() => onMove(-1)} disabled={index === 0} accessibilityLabel="Move step earlier" /><ActionButton label="↓" onPress={() => onMove(1)} disabled={index === count - 1} accessibilityLabel="Move step later" /><ActionButton label="Duplicate" onPress={onDuplicate} /><ActionButton label="Remove" onPress={onRemove} disabled={count <= 1} danger /></View>
  </View>
}

function StepEditor({ step, canRemove, onChange, onUpdateTrack, onEditCue, onRemove, onDuplicate, onMove }: { step: PrototypeStep; canRemove: boolean; onChange: (patch: Partial<PrototypeStep>) => void; onUpdateTrack: (id: string, patch: Partial<PatternTrack>) => void; onEditCue: (target: CueTarget) => void; onRemove: () => void; onDuplicate: () => void; onMove: (direction: number) => void }) {
  const { tokens } = useTheme()
  const [expandedTrackId, setExpandedTrackId] = useState<string | null>(null)
  const [stepOptions, setStepOptions] = useState<string[]>([])
  return <View style={styles.editorPage}>
    <View style={styles.editorHeader}><Text style={[styles.eyebrow, { color: tokens.textMuted }]}>STEP EDITOR</Text></View>
    <TextInput value={step.label} onChangeText={label => onChange({ label })} placeholder="Step name" placeholderTextColor={tokens.textMuted} style={[styles.nameInput, { color: tokens.text, borderBottomColor: tokens.border }]} accessibilityLabel="Step name" />
    <DurationSelector label="Duration" value={Math.ceil(step.durationSeconds / 60)} valueSeconds={step.durationSeconds} secondPrecision presets={STEP_PRESETS} minSeconds={1} maxSeconds={14_400} onChange={minutes => onChange({ durationSeconds: minutes * 60 })} onChangeSeconds={durationSeconds => onChange({ durationSeconds })} fadeColor={tokens.surface} />
    <View style={[styles.fieldRow, { borderBottomColor: tokens.border }]}><View><Text style={[styles.fieldTitle, { color: tokens.text }]}>End cue</Text><SoundName cue={step.endCue} /></View><Pressable onPress={() => onEditCue({ kind: 'step', stepId: step.id })} style={[styles.detailButton, { borderColor: tokens.border }]}><Text style={[styles.actionLabel, { color: tokens.accent }]}>Edit sound</Text></Pressable></View>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.capabilityRail}>{['Alarm', 'Vibration'].map(option => <Chip key={option} label={option} active={stepOptions.includes(option) || (option === 'Alarm' ? step.alarmEnabled : !!step.endCue.hapticOverride)} onPress={() => setStepOptions(current => current.includes(option) ? current.filter(item => item !== option) : [...current, option])} />)}</ScrollView>
    {stepOptions.includes('Vibration') || step.endCue.hapticOverride ? <CueHapticControl title="Step end cue haptics" cue={step.endCue} onChange={endCue => onChange({ endCue })} /> : null}
    {stepOptions.includes('Alarm') || step.alarmEnabled ? <View style={styles.fieldRow}><View style={styles.fieldCopy}><Text style={[styles.fieldTitle, { color: tokens.text }]}>Alarm at end</Text></View><Toggle value={step.alarmEnabled} onChange={alarmEnabled => onChange({ alarmEnabled })} accessibilityLabel="Alarm at step end" /></View> : null}
    <View style={styles.subHeader}><SheetSectionTitle>Sub-bells</SheetSectionTitle><Toggle value={step.subBellsEnabled} onChange={subBellsEnabled => onChange({ subBellsEnabled })} accessibilityLabel="Enable sub-bells for this step" /></View>
    {step.tracks.map((track, index) => <View key={track.id}>
      <Pressable accessibilityRole="button" accessibilityLabel={`Edit ${track.label}`} onPress={() => setExpandedTrackId(current => current === track.id ? null : track.id)} style={[styles.cueRow, { borderColor: tokens.border }]}><View style={styles.fieldCopy}><Text style={[styles.fieldTitle, { color: tokens.text }]}>{track.label}</Text><Text style={[styles.helperText, { color: tokens.textMuted }]}>{track.enabled ? trackSummary({ ...step, tracks: [track] }) : 'Disabled · settings retained'}</Text></View><Text style={{ color: tokens.accent }}>{expandedTrackId === track.id ? '⌃' : '›'}</Text></Pressable>
      {expandedTrackId === track.id ? <><TrackEditor track={track} index={index} durationSeconds={step.durationSeconds} onChange={patch => onUpdateTrack(track.id, patch)} onCue={() => onEditCue({ kind: 'track', stepId: step.id, trackId: track.id })} onRemove={() => onChange({ tracks: step.tracks.filter(item => item.id !== track.id) })} /><ActionButton label="Duplicate sub-bell" onPress={() => { const copy = duplicateStep({ ...step, tracks: [track] }).tracks[0]; onChange({ tracks: [...step.tracks, { ...copy, label: `${track.label} copy` }] }) }} /></> : null}
    </View>)}
    <ActionButton label="＋ Add sub-bell" onPress={() => { const track = newPrototypeTrack(step.tracks.length, step.durationSeconds); onChange({ tracks: [...step.tracks, track] }); setExpandedTrackId(track.id) }} />
    <View style={styles.editorActions}><ActionButton label="Move earlier" onPress={() => onMove(-1)} /><ActionButton label="Move later" onPress={() => onMove(1)} /><ActionButton label="Duplicate step" onPress={onDuplicate} /><ActionButton label="Remove step" onPress={onRemove} disabled={!canRemove} danger /></View>
  </View>
}

function TrackEditor({ track, index, durationSeconds, onChange, onCue, onRemove }: { track: PatternTrack; index: number; durationSeconds: number; onChange: (patch: Partial<PatternTrack>) => void; onCue: () => void; onRemove: () => void }) {
  const { tokens } = useTheme()
  const [details, setDetails] = useState<string[]>([])
  const duration = Math.max(2, durationSeconds - 1)
  const offsets = useMemo(() => validOffsetsForCadenceSeconds(durationSeconds, trackCadenceSeconds(track)), [durationSeconds, track.cadenceMinutes, track.cadenceSeconds])
  const selected = trackSelectedOffsetsSeconds(track)
  const cadenceEnabled = track.repeatEnabled !== false
  const randomEnabled = Boolean(track.randomRepeat)
  const afterEnabled = typeof track.afterStartSeconds === 'number'
  const beforeEnabled = typeof track.beforeEndSeconds === 'number'
  const patchCadence = (seconds: number) => onChange({ cadenceSeconds: seconds, cadenceMinutes: Math.max(1, Math.ceil(seconds / 60)), selectedOffsetsMinutes: [], selectedOffsetsSeconds: validOffsetsForCadenceSeconds(durationSeconds, seconds), repeatEnabled: true })
  return <SectionCard title={`Sub-bell ${index + 1}`}>
    <TextInput value={track.label} onChangeText={label => onChange({ label })} accessibilityLabel="Sub-bell name" style={[styles.nameInput, { color: tokens.text, borderBottomColor: tokens.border }]} />
    <View style={styles.fieldRow}><View style={styles.fieldCopy}><Text style={[styles.fieldTitle, { color: tokens.text }]}>Play this cue</Text><Text style={[styles.helperText, { color: tokens.textMuted }]}>{track.enabled ? 'Enabled' : 'Paused · settings retained'}</Text></View><Toggle value={track.enabled} onChange={enabled => onChange({ enabled })} accessibilityLabel={`Enable sub-bell ${index + 1}`} /></View>
    {details.includes('Appearance') || track.showOnWatchFace === false ? <View style={[styles.fieldRow, { borderTopColor: tokens.border, borderTopWidth: StyleSheet.hairlineWidth }]}><View style={styles.fieldCopy}><Text style={[styles.fieldTitle, { color: tokens.text }]}>Show rings on watchface</Text><Text style={[styles.helperText, { color: tokens.textMuted }]}>Display only · cue remains audible</Text></View><Toggle value={track.showOnWatchFace !== false} onChange={showOnWatchFace => onChange({ showOnWatchFace })} accessibilityLabel={`Show sub-bell ${index + 1} rings`} /></View> : null}
    <Pressable onPress={onCue} style={[styles.cueRow, { borderColor: tokens.border }]}><View><Text style={[styles.fieldTitle, { color: tokens.text }]}>Sound and volume</Text><SoundName cue={track} /><Text style={[styles.helperText, { color: tokens.textMuted }]}>{Math.round(track.volume * 100)}% volume</Text></View><Text style={{ color: tokens.accent }}>›</Text></Pressable>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.capabilityRail}>{['Occurrences', 'Random', 'After start', 'Before end', 'Appearance', 'Vibration'].map(option => <Chip key={option} label={option} active={details.includes(option)} onPress={() => setDetails(current => current.includes(option) ? current.filter(item => item !== option) : [...current, option])} />)}</ScrollView>
    {details.includes('Vibration') || track.hapticOverride ? <CueHapticControl title="Sub-bell cue haptics" cue={track} onChange={value => onChange({ hapticOverride: value.hapticOverride })} /> : null}
    {details.includes('Appearance') || track.showOnWatchFace === false ? <ColorSelector value={track.color ?? 'violet'} onChange={color => onChange({ color })} label="Sub-bell color" /> : null}
    <View style={styles.fieldRow}><Text style={[styles.fieldTitle, { color: tokens.text }]}>Repeating cadence</Text><Toggle value={cadenceEnabled} onChange={repeatEnabled => onChange({ repeatEnabled })} accessibilityLabel={`Enable cadence for sub-bell ${index + 1}`} /></View>
    {cadenceEnabled ? <><DurationSelector label="Every" value={Math.ceil(trackCadenceSeconds(track) / 60)} valueSeconds={trackCadenceSeconds(track)} secondPrecision presets={[1, 2, 3, 5, 10, 15, 20, 30]} minSeconds={1} maxSeconds={duration} onChange={minutes => patchCadence(minutes * 60)} onChangeSeconds={patchCadence} compact fadeColor={tokens.surface} />{details.includes('Occurrences') || selected.length !== offsets.length ? <SelectionEditor title="Cadence occurrences" offsets={offsets} selected={selected} onChange={selectedOffsetsSeconds => onChange({ selectedOffsetsMinutes: [], selectedOffsetsSeconds })} /> : null}</> : null}
    {details.includes('Random') || randomEnabled ? <View style={styles.fieldRow}><View style={styles.fieldCopy}><Text style={[styles.fieldTitle, { color: tokens.text }]}>Random gaps</Text><Text style={[styles.helperText, { color: tokens.textMuted }]}>Extra randomized cadence events</Text></View><Toggle value={randomEnabled} onChange={enabled => onChange({ randomRepeat: enabled ? { minSeconds: 60, maxSeconds: 300 } : undefined })} accessibilityLabel="Enable randomized gaps" /></View> : null}
    {randomEnabled ? <View style={styles.inlinePair}><NumberField label="Min gap (sec)" value={track.randomRepeat!.minSeconds} onChange={value => onChange({ randomRepeat: { ...track.randomRepeat!, minSeconds: Math.min(value, track.randomRepeat!.maxSeconds) } })} /><NumberField label="Max gap (sec)" value={track.randomRepeat!.maxSeconds} onChange={value => onChange({ randomRepeat: { ...track.randomRepeat!, maxSeconds: Math.max(value, track.randomRepeat!.minSeconds) } })} /></View> : null}
    {details.includes('After start') || afterEnabled ? <PointCue title="After start" enabled={afterEnabled} value={track.afterStartSeconds ?? 60} max={duration} onToggle={enabled => onChange({ afterStartSeconds: enabled ? Math.min(60, duration) : undefined })} onChange={afterStartSeconds => onChange({ afterStartSeconds })} /> : null}
    {details.includes('Before end') || beforeEnabled ? <PointCue title="Before end" enabled={beforeEnabled} value={track.beforeEndSeconds ?? 60} max={duration} onToggle={enabled => onChange({ beforeEndSeconds: enabled ? Math.min(60, duration) : undefined })} onChange={beforeEndSeconds => onChange({ beforeEndSeconds })} /> : null}
    <ActionButton label="Remove sub-bell" onPress={onRemove} danger />
  </SectionCard>
}


function CapabilityFields({ capability, draft, onDraft, onEditCue, onEditHaptics }: { capability: Capability; draft: PrototypeDraft; onDraft: (update: (draft: PrototypeDraft) => PrototypeDraft) => void; onEditCue: (target: CueTarget) => void; onEditHaptics: () => void }) {
  const { tokens } = useTheme()
  if (capability === 'Volume') return <SectionCard title="Overall volume"><VolumeField label="Master volume" value={draft.settings.masterVolume} onChange={masterVolume => onDraft(value => ({ ...value, settings: { ...value.settings, masterVolume } }))} /><Text style={[styles.helperText, { color: tokens.textMuted }]}>Multiplies each cue’s own volume.</Text></SectionCard>
  if (capability === 'Haptics') return <SectionCard title="Haptic profiles"><View style={styles.fieldRow}><View style={styles.fieldCopy}><Text style={[styles.fieldTitle, { color: tokens.text }]}>Haptics</Text><Text style={[styles.helperText, { color: tokens.textMuted }]}>{draft.settings.haptics.enabled ? 'On · main, sub-bell, and alarm profiles' : 'Off'}</Text></View><ActionButton label="Edit haptics" onPress={onEditHaptics} /></View></SectionCard>
  if (capability === 'Schedule') return <SectionCard title="Active and quiet hours"><ScheduleConfig value={draft.settings.availability} onChange={availability => onDraft(value => ({ ...value, settings: { ...value.settings, availability } }))} /></SectionCard>
  if (capability === 'Run length') return <RunLengthFields draft={draft} onDraft={onDraft} />
  if (capability === 'Alarm') return <SectionCard title="Alarm cue"><View style={styles.fieldRow}><Text style={[styles.fieldTitle, { color: tokens.text }]}>Global alarm sound</Text><Pressable onPress={() => onEditCue({ kind: 'alarm' })}><SoundName cue={{ sound: draft.settings.alarmSound, volume: draft.settings.alarmVolume }} /></Pressable></View><VolumeField label="Alarm volume" value={draft.settings.alarmVolume} onChange={alarmVolume => onDraft(value => ({ ...value, settings: { ...value.settings, alarmVolume } }))} /><NumberField label="Alarm duration (sec)" value={draft.settings.alarmDurationSeconds} onChange={alarmDurationSeconds => onDraft(value => ({ ...value, settings: { ...value.settings, alarmDurationSeconds: Math.max(1, alarmDurationSeconds) } }))} /><Text style={[styles.helperText, { color: tokens.textMuted }]}>Step-end alarms and the global alarm sound keep their own settings.</Text></SectionCard>
  if (capability === 'End gong') return <SectionCard title="Final gong"><View style={styles.fieldRow}><View><Text style={[styles.fieldTitle, { color: tokens.text }]}>Play at bounded finish</Text>{draft.completionCue ? <SoundName cue={draft.completionCue} /> : <Text style={[styles.helperText, { color: tokens.textMuted }]}>Uses the main cue if not customized</Text>}</View><Toggle value={Boolean(draft.completionCue)} onChange={enabled => onDraft(value => ({ ...value, completionCue: enabled ? value.completionCue ?? { ...value.steps[0]?.endCue ?? defaultCue() } : null }))} accessibilityLabel="Enable final gong" /></View><Pressable onPress={() => onEditCue({ kind: 'completion' })} style={[styles.detailButton, { borderColor: tokens.border }]}><Text style={[styles.actionLabel, { color: tokens.accent }]}>Choose final gong sound</Text></Pressable></SectionCard>
  if (capability === 'Display') return <SectionCard title="Floating display"><View style={styles.fieldRow}><View><Text style={[styles.fieldTitle, { color: tokens.text }]}>Floating overlay</Text><Text style={[styles.helperText, { color: tokens.textMuted }]}>Prototype preference · no device setting opened</Text></View><Toggle value={draft.preferences.overlayEnabled} onChange={overlayEnabled => onDraft(value => ({ ...value, preferences: { ...value.preferences, overlayEnabled } }))} accessibilityLabel="Floating overlay preference" /></View><SheetSectionTitle>Widget appearance</SheetSectionTitle><SegmentedControl items={[{ value: 'system', label: 'System' }, { value: 'dark', label: 'Dark' }, { value: 'light', label: 'Light' }]} value={draft.preferences.widgetAppearance ?? 'system'} onChange={widgetAppearance => onDraft(value => ({ ...value, preferences: { ...value.preferences, widgetAppearance } }))} accessibilityLabel="Widget appearance" /><View style={styles.fieldRow}><View><Text style={[styles.fieldTitle, { color: tokens.text }]}>Exact timing</Text><Text style={[styles.helperText, { color: tokens.textMuted }]}>Prototype preference · no permissions requested</Text></View><Toggle value={draft.preferences.exactTiming} onChange={exactTiming => onDraft(value => ({ ...value, preferences: { ...value.preferences, exactTiming } }))} accessibilityLabel="Exact timing preference" /></View><View style={styles.fieldRow}><View><Text style={[styles.fieldTitle, { color: tokens.text }]}>Second precision</Text><Text style={[styles.helperText, { color: tokens.textMuted }]}>Use exact duration seconds</Text></View><Toggle value={draft.settings.secondPrecisionEnabled} onChange={secondPrecisionEnabled => onDraft(value => ({ ...value, settings: { ...value.settings, secondPrecisionEnabled } }))} accessibilityLabel="Second precision" /></View></SectionCard>
  if (capability === 'Notifications') return <SectionCard title="Notification preferences"><PreferenceRow title="Timer notifications" prototype value={draft.settings.notificationsEnabled} onChange={notificationsEnabled => onDraft(value => ({ ...value, settings: { ...value.settings, notificationsEnabled } }))} /><PreferenceRow title="Live countdown" value={draft.settings.liveCountdownEnabled} onChange={liveCountdownEnabled => onDraft(value => ({ ...value, settings: { ...value.settings, liveCountdownEnabled } }))} /></SectionCard>
  if (capability === 'Calls') return <SectionCard title="Call behavior"><PreferenceRow title="Mute during calls" prototype value={draft.settings.muteDuringCallsEnabled} onChange={muteDuringCallsEnabled => onDraft(value => ({ ...value, settings: { ...value.settings, muteDuringCallsEnabled } }))} /></SectionCard>
  return <SectionCard title="Focus automation"><PreferenceRow title="Focus mode automation" prototype value={draft.settings.focusAutomationEnabled} onChange={focusAutomationEnabled => onDraft(value => ({ ...value, settings: { ...value.settings, focusAutomationEnabled } }))} /><Text style={[styles.helperText, { color: tokens.textMuted }]}>Shown as a setup preference only. This prototype does not open focus settings.</Text></SectionCard>
}

function RunLengthFields({ draft, onDraft }: { draft: PrototypeDraft; onDraft: (update: (draft: PrototypeDraft) => PrototypeDraft) => void }) {
  const { tokens } = useTheme()
  return <SectionCard title="How long to run"><SegmentedControl items={[{ value: 'continuous', label: 'Continuous' }, { value: 'cycles', label: 'Rounds' }, { value: 'duration', label: 'Exact time' }]} value={draft.runPolicy.kind} onChange={kind => onDraft(value => ({ ...value, runPolicy: { ...value.runPolicy, kind } as PrototypeDraft['runPolicy'] }))} accessibilityLabel="Run duration type" />{draft.runPolicy.kind === 'cycles' ? <NumberField label="Complete rounds" value={draft.runPolicy.cycleCount} onChange={cycleCount => onDraft(value => ({ ...value, runPolicy: { ...value.runPolicy, cycleCount: Math.max(1, cycleCount) } }))} /> : null}{draft.runPolicy.kind === 'duration' ? <DurationSelector label="Stop after" value={Math.ceil(draft.runPolicy.durationSeconds / 60)} valueSeconds={draft.runPolicy.durationSeconds} secondPrecision presets={[5, 10, 15, 30, 45, 60, 90, 120]} minSeconds={1} maxSeconds={359 * 3600 + 3599} onChange={minutes => onDraft(value => ({ ...value, runPolicy: { ...value.runPolicy, durationSeconds: minutes * 60 } }))} onChangeSeconds={durationSeconds => onDraft(value => ({ ...value, runPolicy: { ...value.runPolicy, durationSeconds } }))} fadeColor={tokens.surface} /> : null}<Text style={[styles.helperText, { color: tokens.textMuted }]}>Final gong can sound when a bounded run ends.</Text></SectionCard>
}

function SelectionEditor({ title, offsets, selected, onChange }: { title: string; offsets: number[]; selected: number[]; onChange: (selection: number[]) => void }) {
  const { tokens } = useTheme()
  if (offsets.length > 480) return <Text style={[styles.helperText, { color: tokens.textMuted }]}>This cadence has {offsets.length} occurrences. Choose a longer cadence to edit individual times.</Text>
  return <View style={styles.selectionBlock}><Text style={[styles.fieldTitle, { color: tokens.text }]}>{title}</Text><View style={styles.selectionActions}><Pressable onPress={() => onChange(offsets)}><Text style={[styles.actionLabel, { color: tokens.accent }]}>All</Text></Pressable><Pressable onPress={() => onChange([])}><Text style={[styles.actionLabel, { color: tokens.textMuted }]}>Clear</Text></Pressable></View><OffsetGrid offsets={offsets} selected={selected} unit="seconds" onChange={onChange} /></View>
}

function PointCue({ title, enabled, value, max, onToggle, onChange }: { title: string; enabled: boolean; value: number; max: number; onToggle: (value: boolean) => void; onChange: (value: number) => void }) {
  const { tokens } = useTheme()
  return <View style={styles.pointCue}><View style={styles.fieldRow}><Text style={[styles.fieldTitle, { color: tokens.text }]}>{title}</Text><Toggle value={enabled} onChange={onToggle} accessibilityLabel={`Enable ${title.toLowerCase()}`} /></View>{enabled ? <NumberField label="Offset (seconds)" value={value} onChange={next => onChange(Math.max(1, Math.min(max, next)))} /> : null}</View>
}

function CueHapticControl({ title, cue, onChange }: { title: string; cue: CueSettings; onChange: (cue: CueSettings) => void }) {
  const { tokens } = useTheme()
  const override = cue.hapticOverride
  const mode = override === 'off' ? 'off' : override ? 'custom' : 'default'
  const profile = typeof override === 'object' ? override : { pattern: 'single' as HapticPattern, strength: 'balanced' as HapticStrength }
  return <View style={styles.hapticOverride}>
    <Text style={[styles.fieldTitle, { color: tokens.text }]}>{title}</Text>
    <SegmentedControl items={[{ value: 'default', label: 'Default' }, { value: 'off', label: 'Off' }, { value: 'custom', label: 'Custom' }]} value={mode} onChange={value => onChange({ ...cue, hapticOverride: value === 'default' ? undefined : value === 'off' ? 'off' : profile })} accessibilityLabel={title} />
    {mode === 'custom' ? <><SegmentedControl items={[{ value: 'single', label: 'Single' }, { value: 'double', label: 'Double' }, { value: 'triple', label: 'Triple' }]} value={profile.pattern} onChange={pattern => onChange({ ...cue, hapticOverride: { ...profile, pattern: pattern as HapticPattern } })} accessibilityLabel={`${title} pattern`} /><SegmentedControl items={[{ value: 'gentle', label: 'Gentle' }, { value: 'balanced', label: 'Balanced' }, { value: 'strong', label: 'Strong' }]} value={profile.strength} onChange={strength => onChange({ ...cue, hapticOverride: { ...profile, strength: strength as HapticStrength } })} accessibilityLabel={`${title} strength`} /></> : null}
  </View>
}

function PreferenceRow({ title, prototype, value, onChange }: { title: string; prototype?: boolean; value: boolean; onChange: (value: boolean) => void }) {
  const { tokens } = useTheme()
  return <View style={styles.fieldRow}><View style={styles.fieldCopy}><Text style={[styles.fieldTitle, { color: tokens.text }]}>{title}</Text><Text style={[styles.helperText, { color: tokens.textMuted }]}>{prototype ? 'Prototype preference · no permission granted' : 'Preference only'}</Text></View><Toggle value={value} onChange={onChange} accessibilityLabel={title} /></View>
}

function VolumeField({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  const { tokens } = useTheme()
  return <View style={styles.volumeField}><View style={styles.fieldRow}><Text style={[styles.fieldTitle, { color: tokens.text }]}>{label}</Text><Text style={[styles.helperText, { color: tokens.textMuted }]}>{Math.round(value * 100)}%</Text></View><Slider minimumValue={0} maximumValue={1} step={0.05} value={value} onValueChange={onChange} minimumTrackTintColor={tokens.accent} maximumTrackTintColor={tokens.surfaceHi} thumbTintColor={tokens.accent} accessibilityLabel={label} /></View>
}

function NumberField({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  const { tokens } = useTheme()
  const [text, setText] = useState(String(value))
  useEffect(() => setText(String(value)), [value])
  return <View style={[styles.numberField, { borderColor: tokens.border }]}><Text style={[styles.helperText, { color: tokens.textMuted }]}>{label}</Text><TextInput value={text} onChangeText={raw => { setText(raw.replace(/[^0-9]/g, '')); const parsed = Number(raw.replace(/[^0-9]/g, '')); if (Number.isFinite(parsed) && parsed > 0) onChange(parsed) }} onBlur={() => { if (!text || Number(text) < 1) setText('1') }} keyboardType="number-pad" style={[styles.numberInput, { color: tokens.text }]} accessibilityLabel={label} /></View>
}

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  const { tokens } = useTheme()
  return <View style={[styles.sectionCard, { backgroundColor: 'transparent', borderColor: tokens.border }]}><SheetSectionTitle>{title}</SheetSectionTitle>{children}</View>
}

function ActionButton({ label, onPress, disabled = false, danger = false, accessibilityLabel }: { label: string; onPress: () => void; disabled?: boolean; danger?: boolean; accessibilityLabel?: string }) {
  const { tokens } = useTheme()
  return <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? label} style={({ pressed }) => [styles.smallAction, { borderColor: danger ? tokens.warm : tokens.border, opacity: disabled ? 0.4 : pressed ? 0.72 : 1 }]}><Text style={[styles.actionLabel, { color: danger ? tokens.warm : tokens.text }]}>{label}</Text></Pressable>
}

function ConfigCard({ config, current, dirty, onSelect, onRename, onDuplicate, onDelete, onToggleRunning }: { config: PrototypeSavedConfig; current: boolean; dirty: boolean; onSelect: () => void; onRename: () => void; onDuplicate: () => void; onDelete: () => void; onToggleRunning: () => void }) {
  const { tokens } = useTheme()
  const [actions, setActions] = useState(false)
  return <View style={[styles.configCard, { borderColor: current ? tokens.accent : tokens.border }]}>
    <View style={styles.fieldRow}>
      <Pressable accessibilityRole="button" accessibilityLabel={`Open configuration ${config.name}`} onPress={onSelect} style={[styles.configMain, { flex: 1 }]}>
        <Text style={[styles.fieldTitle, { color: tokens.text }]}>{config.name}{current ? ' · current' : ''}{dirty ? ' · Draft' : ''}</Text>
        <Text style={[styles.helperText, { color: tokens.textMuted }]}>{config.snapshot.steps.length} {config.snapshot.steps.length === 1 ? 'step' : 'steps'} · {runSummary(config.snapshot)}</Text>
      </Pressable>
      <ActionButton label="⋯" accessibilityLabel={`Configuration actions for ${config.name}`} onPress={() => setActions(value => !value)} />
    </View>
    {actions ? <><View style={styles.configActions}><ActionButton label="Rename" onPress={onRename} /><ActionButton label="Duplicate" onPress={onDuplicate} /><ActionButton label="Delete" onPress={onDelete} danger /></View><PreferenceRow title="Show while running" value={config.showInRunningSelector !== false} onChange={onToggleRunning} /></> : null}
  </View>
}

function ConfigPicker({ onToggleRunning, visible, store, onClose, onSelect, onRename, onDuplicate, onDelete, onImport, onExport }: { onToggleRunning: (id: string) => void; visible: boolean; store: PrototypeStore; onClose: () => void; onSelect: (id: string) => void; onRename: (id: string, value: string) => void; onDuplicate: (id: string) => void; onDelete: (id: string) => void; onImport: (candidate: unknown) => boolean; onExport: () => void }) {
  const { tokens } = useTheme()
  const [importText, setImportText] = useState('')
  const [importError, setImportError] = useState('')
  const importConfig = () => {
    try {
      const parsed = JSON.parse(importText)
      if (!onImport(parsed)) throw new Error('invalid')
      setImportText('')
      setImportError('Imported as a saved configuration.')
    } catch { setImportError('Could not import. Paste a valid setup export JSON.') }
  }
  return <PrototypeSheet visible={visible} title="Configurations" onClose={onClose} initialSnap="partial"><View style={{ gap: 12 }}>
    {store.keptDrafts.__unsaved__ ? <View style={[styles.configCard, { borderColor: tokens.border }]}><Pressable onPress={() => onSelect('__unsaved__')} style={styles.configMain}><Text style={[styles.fieldTitle, { color: tokens.text }]}>Kept draft</Text><Text style={[styles.helperText, { color: tokens.textMuted }]}>{store.keptDrafts.__unsaved__.steps.length} steps · {runSummary(store.keptDrafts.__unsaved__)}</Text></Pressable></View> : null}
    {store.configs.map(config => <ConfigCard key={config.id} config={config} current={config.id === store.activeConfigId} dirty={!!store.keptDrafts[config.id] || (config.id === store.activeConfigId && draftIsDirty(store))} onSelect={() => onSelect(config.id)} onRename={() => onRename(config.id, config.name)} onDuplicate={() => onDuplicate(config.id)} onDelete={() => onDelete(config.id)} onToggleRunning={() => onToggleRunning(config.id)} />)}
    {!store.configs.length && !store.keptDrafts.__unsaved__ ? <Text style={[styles.helperText, { color: tokens.textMuted }]}>Save this setup to start your configuration library.</Text> : null}
    <Pressable onPress={onExport} style={[styles.detailButton, { borderColor: tokens.border }]}><Text style={[styles.actionLabel, { color: tokens.accent }]}>Copy export JSON</Text></Pressable><Text style={[styles.helperText, { color: tokens.textMuted }]}>Import a previous prototype export</Text><TextInput value={importText} onChangeText={setImportText} multiline placeholder="Paste setup JSON" placeholderTextColor={tokens.textMuted} style={[styles.importInput, { borderColor: tokens.border, color: tokens.text }]} />{importError ? <Text style={[styles.helperText, { color: tokens.accent }]}>{importError}</Text> : null}<Pressable onPress={importConfig} style={[styles.detailButton, { borderColor: tokens.border }]}><Text style={[styles.actionLabel, { color: tokens.accent }]}>Import setup</Text></Pressable></View></PrototypeSheet>
}

function DirtySwitchDialog({ target, onChoice }: { target?: { name: string } ; onChoice: (choice: 'save' | 'keep' | 'discard' | 'dismiss') => void }) {
  const { tokens } = useTheme()
  return <Modal visible={Boolean(target)} transparent animationType="fade" onRequestClose={() => onChoice('dismiss')}><View style={styles.dialogBackdrop}><View style={[styles.dialog, { backgroundColor: tokens.surface, borderColor: tokens.border }]}><Text style={[styles.sheetTitle, { color: tokens.text }]}>Unsaved draft</Text><Text style={[styles.helperText, { color: tokens.textMuted }]}>Switch to {target?.name}? Your edits can be saved, kept as a draft, or discarded.</Text><View style={styles.dialogChoices}><ActionButton label="Save & switch" onPress={() => onChoice('save')} /><ActionButton label="Keep draft & switch" onPress={() => onChoice('keep')} /><ActionButton label="Discard & switch" onPress={() => onChoice('discard')} danger /><ActionButton label="Stay here" onPress={() => onChoice('dismiss')} /></View></View></View></Modal>
}

function NameDialog({ value, onChange, onCancel, onSave }: { value: { kind: 'rename' | 'save-as'; id?: string; value: string } | null; onChange: (value: string) => void; onCancel: () => void; onSave: () => void }) {
  const { tokens } = useTheme()
  return <Modal visible={Boolean(value)} transparent animationType="fade" onRequestClose={onCancel}><View style={styles.dialogBackdrop}><View style={[styles.dialog, { backgroundColor: tokens.surface, borderColor: tokens.border }]}><Text style={[styles.sheetTitle, { color: tokens.text }]}>{value?.kind === 'rename' ? 'Rename configuration' : 'Save as new configuration'}</Text><TextInput value={value?.value ?? ''} onChangeText={onChange} autoFocus placeholder="Configuration name" placeholderTextColor={tokens.textMuted} style={[styles.nameInput, { color: tokens.text, borderBottomColor: tokens.border }]} accessibilityLabel="Configuration name" /><View style={styles.configActions}><ActionButton label="Cancel" onPress={onCancel} /><ActionButton label="Save" onPress={onSave} /></View></View></View></Modal>
}

async function exportPrototype(store: PrototypeStore) {
  await Clipboard.setStringAsync(JSON.stringify({ schemaVersion: 1, draft: store.draft }, null, 2))
}

function resolveCue(draft: PrototypeDraft, target: CueTarget): CueSettings | null {
  if (target.kind === 'completion') return draft.completionCue
  if (target.kind === 'alarm') return { sound: draft.settings.alarmSound, volume: draft.settings.alarmVolume }
  const step = draft.steps.find(item => item.id === target.stepId)
  if (!step) return null
  if (target.kind === 'step') return step.endCue
  return step.tracks.find(track => track.id === target.trackId) ?? null
}

function capabilitiesEnabledBy(draft: PrototypeDraft): Capability[] {
  const enabled: Capability[] = ['Volume']
  if (draft.settings.availability.enabled) enabled.push('Schedule')
  if (draft.runPolicy.kind !== 'continuous') enabled.push('Run length')
  if (draft.settings.haptics.enabled) enabled.push('Haptics')
  if (draft.steps.some(step => step.alarmEnabled)) enabled.push('Alarm')
  if (draft.completionCue) enabled.push('End gong')
  if (draft.preferences.overlayEnabled || draft.preferences.exactTiming || draft.settings.secondPrecisionEnabled) enabled.push('Display')
  if (draft.settings.notificationsEnabled || draft.settings.liveCountdownEnabled) enabled.push('Notifications')
  if (draft.settings.muteDuringCallsEnabled) enabled.push('Calls')
  if (draft.settings.focusAutomationEnabled) enabled.push('Focus')
  return enabled
}

function defaultCue(): CueSettings { return { sound: { kind: 'builtin', id: 'temple-gong' }, volume: 1 } }
function fallbackStep(): PrototypeStep { const draft = defaultPrototypeDraft(); return draft.steps[0] }
function runSummary(draft: PrototypeDraft): string { return draft.runPolicy.kind === 'continuous' ? 'Continuous' : draft.runPolicy.kind === 'cycles' ? `${draft.runPolicy.cycleCount} rounds` : formatCompactDurationSeconds(draft.runPolicy.durationSeconds) }
function cycleSeconds(draft: PrototypeDraft): number { return draft.steps.reduce((sum, step) => sum + step.durationSeconds, 0) }
function trackSummary(step: PrototypeStep): string { const active = step.tracks.filter(track => track.enabled); if (!step.subBellsEnabled || !active.length) return 'Sub-bells off'; return active.map(track => { const bits = [track.repeatEnabled !== false ? `${formatCompactDurationSeconds(trackCadenceSeconds(track))} cadence` : '', track.randomRepeat ? 'random' : '', track.afterStartSeconds ? 'after start' : '', track.beforeEndSeconds ? 'before end' : ''].filter(Boolean); return bits.join(' + ') || 'sub-bell' }).join(' · ') }

const styles = StyleSheet.create({
  fill: { flex: 1 }, screen: { flex: 1 }, hostHeader: { height: 56, paddingHorizontal: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, brand: { fontSize: 13, letterSpacing: 2.4, fontWeight: '500' }, iconButton: { minWidth: 40, height: 40, borderWidth: 1.5, borderRadius: 20, alignItems: 'center', justifyContent: 'center' }, actionGlyph: { fontSize: 23, lineHeight: 26 }, previewArea: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 22 }, orbit: { width: 260, aspectRatio: 1, borderWidth: 1, borderRadius: 130, alignItems: 'center', justifyContent: 'center' }, orbitInner: { width: 208, aspectRatio: 1, borderWidth: 1, borderRadius: 104, alignItems: 'center', justifyContent: 'center', gap: 8 }, eyebrow: { fontSize: 11, fontWeight: '500', letterSpacing: 1.2 }, orbitTime: { fontSize: 42, fontVariant: ['tabular-nums'], fontWeight: '300' }, orbitCaption: { fontSize: 12 }, openSetup: { minHeight: 48, minWidth: 160, paddingHorizontal: 24, borderRadius: 26, alignItems: 'center', justifyContent: 'center' }, openSetupText: { color: '#fff', fontWeight: '500' }, prototypeLabel: { fontSize: 11 }, sheetHeader: { minHeight: 48, paddingHorizontal: 0, flexDirection: 'row', alignItems: 'center', gap: 9 }, configTitle: { flex: 1, minWidth: 0, gap: 3 }, sheetTitle: { fontSize: 19, fontWeight: '500' }, saveRow: { minHeight: 38, paddingHorizontal: 0, flexDirection: 'row', alignItems: 'center', gap: 8 }, helperText: { fontSize: 12, lineHeight: 17 }, saveButton: { borderWidth: 1, borderColor: 'transparent', borderRadius: 18, paddingHorizontal: 11, paddingVertical: 7 }, saveLabel: { fontSize: 12, fontWeight: '500' }, sheetContent: { gap: 16 }, stepHeader: { gap: 4 }, sectionCard: { paddingVertical: 14, borderBottomWidth: 1, gap: 12 }, fieldRow: { minHeight: 46, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, paddingVertical: 4 }, fieldCopy: { flex: 1, minWidth: 0, gap: 2 }, fieldTitle: { fontSize: 13, fontWeight: '500' }, cueRow: { minHeight: 54, borderWidth: 1, borderRadius: 13, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, detailButton: { minHeight: 42, borderWidth: 1, borderRadius: 13, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 12 }, actionLabel: { fontSize: 12, fontWeight: '500' }, stepActions: { flexDirection: 'row', gap: 8 }, smallAction: { minHeight: 44, borderWidth: 1, borderRadius: 17, paddingHorizontal: 10, justifyContent: 'center', alignItems: 'center' }, stepRow: { borderWidth: 1, borderRadius: 15, padding: 10, gap: 8 }, stepMain: { minHeight: 50, flexDirection: 'row', alignItems: 'center', gap: 10 }, stepIndex: { fontVariant: ['tabular-nums'], fontSize: 12, fontWeight: '500' }, stepCopy: { flex: 1, gap: 3 }, stepTitle: { fontSize: 14, fontWeight: '500' }, stepControls: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 }, capabilityBlock: { gap: 10 }, capabilityRail: { gap: 8, paddingRight: 20 }, prototypeNotice: { padding: 13, borderRadius: 14, gap: 4 }, prototypeNoticeTitle: { fontSize: 12, fontWeight: '500' }, inlineNotice: { borderWidth: 1, borderRadius: 12, padding: 10, gap: 4 }, footer: { minHeight: 52, paddingHorizontal: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }, footerSummary: { flex: 1, fontSize: 11 }, startButton: { minHeight: 44, minWidth: 140, paddingHorizontal: 16, borderRadius: 22, justifyContent: 'center', alignItems: 'center' }, startLabel: { color: '#fff', fontSize: 13, fontWeight: '500' }, editorPage: { gap: 15 }, editorHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 }, nameInput: { borderBottomWidth: 1, paddingVertical: 10, fontSize: 18, fontWeight: '500' }, subHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, editorActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 }, selectionBlock: { gap: 9 }, selectionActions: { flexDirection: 'row', gap: 18 }, inlinePair: { flexDirection: 'row', gap: 8 }, numberField: { flex: 1, minHeight: 55, borderWidth: 1, borderRadius: 11, paddingHorizontal: 10, paddingVertical: 6 }, numberInput: { minHeight: 24, padding: 0, fontSize: 14, fontWeight: '500' }, pointCue: { gap: 5 }, volumeField: { gap: 2 }, hapticOverride: { gap: 8 }, dialogBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', padding: 22 }, dialog: { width: '100%', maxWidth: 520, maxHeight: '88%', borderWidth: 1.5, borderRadius: 20, padding: 18, gap: 12 }, dialogHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, dialogChoices: { gap: 8 }, configCard: { borderWidth: 1, borderRadius: 13, padding: 10, gap: 8 }, configMain: { minHeight: 38, justifyContent: 'center', gap: 3 }, configActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 }, importInput: { minHeight: 80, maxHeight: 120, borderWidth: 1, borderRadius: 10, padding: 10, textAlignVertical: 'top' },
})
