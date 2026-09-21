import { useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, Alert, Platform, Pressable, StyleSheet, Text, View } from 'react-native'
import Slider from '@react-native-community/slider'
import Animated, { FadeIn, FadeOut, useReducedMotion } from 'react-native-reanimated'
import { selectionHaptic } from '../../lib/haptics'
import type { CueSettings, SoundRef } from '../../types'
import { BUILT_IN_SOUNDS, soundTitle } from '../../lib/soundLibrary'
import { cueSounds, soundRefKey } from '../../lib/timerV2'
import { ChandasTimerService, isNativeServiceAvailable } from '../../native/ChandasTimerService'
import { useTheme } from '../../theme/ThemeContext'
import { BottomSheet } from './BottomSheet'
import { useSoundAvailability } from '../../hooks/use-sound-availability'
import { GentleNotice, type AppNotice } from './experience-feedback'
import { SegmentedControl } from './SegmentedControl'
import { SheetSectionTitle } from './SheetSectionTitle'
import { Toggle } from '../Toggle'
import { Sortable, SortableItem, type SortableRenderItemProps } from 'react-native-reanimated-dnd'
import { SwipeToDeleteRow } from './swipe-to-delete-row'

type SoundTab = 'built-in' | 'android' | 'device'
const SOUND_TABS = [{ value: 'built-in', label: 'Included' }, { value: 'android', label: 'Android' }, { value: 'device', label: 'Device' }] as const

interface Props {
  visible: boolean
  title: string
  cue: CueSettings
  masterVolume: number
  advanced?: boolean
  onChange: (patch: Partial<CueSettings>) => void
  onClose: () => void
  onBack?: () => void
  onFeedback: (notice: Omit<AppNotice, 'id'>) => void
}

export function SoundPickerSheet({ visible, title, cue, masterVolume, advanced = false, onChange, onClose, onBack, onFeedback }: Props) {
  const { tokens } = useTheme()
  const reducedMotion = useReducedMotion()
  const [tab, setTab] = useState<SoundTab>('built-in')
  const [previewing, setPreviewing] = useState<string | null>(null)
  const [picking, setPicking] = useState(false)
  const [choicesOpen, setChoicesOpen] = useState(false)
  const [message, setMessage] = useState<{ title: string; detail: string } | null>(null)
  const previewRequest = useRef(0)
  const selectedAvailable = useSoundAvailability(cue.sound)
  const selectedKey = cue.sound.kind === 'builtin' ? cue.sound.id : cue.sound.uri
  const choices = useMemo(() => cueSounds(cue), [cue])
  const atChoiceLimit = advanced && choices.length >= 8

  useEffect(() => () => { previewRequest.current += 1; ChandasTimerService.stopSoundPreview() }, [])
  useEffect(() => {
    if (visible) setTab(cue.sound.kind === 'builtin' ? 'built-in' : cue.sound.kind === 'android' ? 'android' : 'device')
    else { previewRequest.current += 1; ChandasTimerService.stopSoundPreview(); setPreviewing(null); setMessage(null); setChoicesOpen(false) }
  }, [cue.sound.kind, visible])

  const close = () => { stopPreview(); onClose() }
  const stopPreview = () => { previewRequest.current += 1; ChandasTimerService.stopSoundPreview(); setPreviewing(null) }
  const chooseSound = (sound: SoundRef) => {
    stopPreview()
    setMessage(null)
    onChange({ sound, sounds: [sound], soundMode: 'single' })
    selectionHaptic()
    void preview(sound, false)
  }
  const setOnlySound = (sound: SoundRef) => {
    setMessage(null)
    onChange({ sound, sounds: [sound], soundMode: 'single' })
    selectionHaptic()
  }
  const auditionAndChooseOnly = (sound: SoundRef) => {
    void preview(sound, false)
    if (!advanced || choices.length <= 1) {
      setOnlySound(sound)
      return
    }
    const replace = () => setOnlySound(sound)
    const message = `Keep only ${soundTitle(sound)}? Your other ${choices.length - 1} sound choice${choices.length === 2 ? '' : 's'} will be removed.`
    if (Platform.OS === 'web') {
      if (globalThis.confirm?.(message)) replace()
      return
    }
    Alert.alert('Replace sound choices?', message, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Keep this sound', style: 'destructive', onPress: replace },
    ])
  }
  const addChoice = (sound: SoundRef) => {
    if (choices.length >= 8 && !choices.some(item => soundRefKey(item) === soundRefKey(sound))) return
    const alreadyAdded = choices.some(item => soundRefKey(item) === soundRefKey(sound))
    const next = alreadyAdded ? choices : [...choices, sound]
    onChange({ sound: next[0], sounds: next, soundMode: next.length > 1 ? (cue.soundMode === 'random' ? 'random' : 'sequence') : 'single' })
    selectionHaptic()
    void preview(sound, false)
  }
  const removeChoice = (sound: SoundRef) => {
    const next = choices.filter(item => soundRefKey(item) !== soundRefKey(sound))
    if (next.length === 0) return
    onChange({ sound: next[0], sounds: next, soundMode: next.length > 1 ? cue.soundMode ?? 'sequence' : 'single' })
    selectionHaptic()
  }
  const toggleChoice = (sound: SoundRef) => {
    if (choices.some(item => soundRefKey(item) === soundRefKey(sound))) removeChoice(sound)
    else addChoice(sound)
  }
  const moveChoice = (from: number, to: number) => {
    if (to < 0 || to >= choices.length) return
    const next = [...choices]
    const [moved] = next.splice(from, 1)
    next.splice(to, 0, moved)
    onChange({ sound: next[0], sounds: next })
  }
  const preview = async (sound: SoundRef, toggle = true) => {
    const key = sound.kind === 'builtin' ? sound.id : sound.uri
    const wasPlaying = previewing === key
    stopPreview()
    if (toggle && wasPlaying) return
    const request = ++previewRequest.current
    try {
      const didStart = await ChandasTimerService.previewSound(sound, masterVolume * cue.volume)
      if (request !== previewRequest.current) return
      if (!didStart && Platform.OS === 'android') setMessage({ title: 'That sound could not be previewed', detail: 'Choose another sound, or reselect the file if it moved.' })
      setPreviewing(didStart ? key : null)
    } catch {
      if (request !== previewRequest.current) return
      setPreviewing(null)
      setMessage({ title: 'Preview stayed quiet', detail: 'Nothing changed. Try another sound or check the phone’s Alarm volume.' })
    }
  }

  const pickAndroid = async (ringtoneType: 'alarm' | 'notification') => {
    if (atChoiceLimit) return
    setPicking(true)
    setMessage(null)
    try {
      const result = await ChandasTimerService.pickDeviceSound(ringtoneType)
      if (result) {
        const sound: SoundRef = { kind: 'android', ringtoneType, ...result }
        if (advanced) addChoice(sound); else chooseSound(sound)
        onFeedback({ title: advanced ? 'Sound added' : 'Sound selected', message: result.title, tone: 'success' })
      }
    } catch {
      setMessage({ title: 'Android sounds did not open', detail: 'Nothing changed. Try again, or choose one of the built-in sounds.' })
    } finally { setPicking(false) }
  }
  const pickDocument = async () => {
    if (atChoiceLimit) return
    setPicking(true)
    setMessage(null)
    try {
      const result = await ChandasTimerService.pickAudioDocument()
      if (result) {
        const sound: SoundRef = { kind: 'document', ...result }
        if (advanced) addChoice(sound); else chooseSound(sound)
        onFeedback({ title: advanced ? 'Audio file added' : 'Audio file selected', message: result.title, tone: 'success' })
      }
    } catch {
      setMessage({ title: 'Device audio did not open', detail: 'Nothing changed. Try again, or choose one of the built-in sounds.' })
    } finally { setPicking(false) }
  }

  const androidChoices = choices.filter(sound => sound.kind === 'android')
  const deviceChoices = choices.filter(sound => sound.kind === 'document')
  const volumeFooter = <View style={[styles.footer, { backgroundColor: tokens.surface }]}>
    {advanced ? <Pressable onPress={() => { stopPreview(); setChoicesOpen(true) }} style={styles.settingsRow} accessibilityRole="button" accessibilityLabel="Edit sound choices">
      <View style={styles.optionCopy}><Text style={[styles.optionTitle, { color: tokens.text }]}>Sound choices</Text><Text numberOfLines={2} style={[styles.helper, { color: tokens.textMuted }]}>{soundChoicesSummary(choices)}</Text></View>
      <Text style={[styles.disclosure, { color: tokens.accent }]}>›</Text>
    </Pressable> : <View style={styles.selected}>
      <Text numberOfLines={1} style={[styles.optionTitle, styles.selectedTitle, { color: selectedAvailable ? tokens.text : tokens.accent }]}>{soundTitle(cue.sound)}{selectedAvailable ? '' : ' · unavailable'}</Text>
    </View>}
    {advanced ? <View style={styles.outputRow}><View style={styles.optionCopy}><Text style={[styles.optionTitle, { color: tokens.text }]}>Sound output</Text><Text style={[styles.helper, { color: tokens.textMuted }]}>{cue.soundEnabled === false ? 'Vibration only' : 'Sound and vibration'}</Text></View><Toggle value={cue.soundEnabled !== false} onChange={soundEnabled => onChange({ soundEnabled })} accessibilityLabel="Play sound for this cue" /></View> : null}
    <View style={styles.volumeHeader}><SheetSectionTitle>Cue volume</SheetSectionTitle><Text style={[styles.value, { color: tokens.text }]}>{Math.round(cue.volume * 100)}%</Text></View>
    <View style={styles.volumeRow}><Slider style={styles.slider} minimumValue={0} maximumValue={1} step={0.05} value={cue.volume} onSlidingStart={stopPreview} onValueChange={volume => onChange({ volume })} minimumTrackTintColor={tokens.accent} maximumTrackTintColor={tokens.surfaceHi} thumbTintColor={tokens.accent} accessibilityLabel={`${title} volume`} accessibilityValue={{ min: 0, max: 100, now: Math.round(cue.volume * 100), text: `${Math.round(cue.volume * 100)} percent` }} /><Pressable onPress={() => void preview(cue.sound)} style={[styles.preview, { borderColor: tokens.border }]} accessibilityRole="button" accessibilityLabel={`${previewing === selectedKey ? 'Stop' : 'Preview'} selected sound`}><Text style={[styles.previewText, { color: tokens.accent }]}>{previewing === selectedKey ? '■' : '▶'}</Text></Pressable></View>
  </View>

  if (choicesOpen) return <BottomSheet visible={visible} title="Sound choices" help="Drag the dotted handle to set the order. Swipe left to remove a sound. The first sound is used when only one choice remains." onClose={close} onBack={() => { stopPreview(); setChoicesOpen(false) }}>
    <SoundChoicesEditor choices={choices} mode={cue.soundMode === 'random' ? 'random' : 'sequence'} previewing={previewing} onModeChange={soundMode => onChange({ soundMode })} onMove={moveChoice} onRemove={removeChoice} onPreview={sound => preview(sound, false)} />
  </BottomSheet>

  return (
    <BottomSheet visible={visible} title={title} help={advanced ? 'Tap a sound name to hear it and keep only that sound. Use the round selectors to combine included, Android and device sounds.' : 'Tap a sound to use it and hear it immediately, then set this cue’s own volume below. Included sounds travel with saved configurations.'} onClose={close} onBack={onBack ? () => { stopPreview(); onBack() } : undefined} pinnedContent={<SegmentedControl items={SOUND_TABS} value={tab} onChange={value => { stopPreview(); setTab(value) }} accessibilityLabel="Sound source" />} footer={volumeFooter}>
      {message ? <GentleNotice title={message.title} message={message.detail} tone="attention" /> : null}
      <Animated.View key={tab} entering={FadeIn.duration(reducedMotion ? 80 : 180)} exiting={FadeOut.duration(reducedMotion ? 70 : 120)}>
      {tab === 'built-in' ? <View style={styles.list}>{BUILT_IN_SOUNDS.map(sound => {
        const ref: SoundRef = { kind: 'builtin', id: sound.id }
        const selected = advanced ? choices.some(choice => soundRefKey(choice) === soundRefKey(ref)) : cue.sound.kind === 'builtin' && cue.sound.id === sound.id
        const selectionDisabled = advanced && (selected ? choices.length === 1 : choices.length >= 8)
        return <SoundLibraryRow key={sound.id} title={sound.name} detail={sound.description} advanced={advanced} selected={selected} selectionDisabled={selectionDisabled} onPress={() => advanced ? auditionAndChooseOnly(ref) : chooseSound(ref)} onToggle={() => toggleChoice(ref)} />
      })}</View> : null}

      {tab === 'android' ? <View style={styles.sourcePanel}>
        {!isNativeServiceAvailable ? <GentleNotice title="Available in the Android app" message="Built-in sounds can still be explored here. Device sound pickers open in an installed Chandas build." /> : null}
        <Pressable disabled={!isNativeServiceAvailable || picking || atChoiceLimit} onPress={() => void pickAndroid('alarm')} style={[styles.sourceButton, { opacity: !isNativeServiceAvailable || picking || atChoiceLimit ? 0.45 : 1 }]} accessibilityRole="button" accessibilityState={{ disabled: !isNativeServiceAvailable || picking || atChoiceLimit, busy: picking }}>
          <View style={styles.optionCopy}><Text style={[styles.optionTitle, { color: tokens.text }]}>{advanced ? 'Add alarm sound' : 'Choose alarm sound'}</Text><Text style={[styles.helper, { color: tokens.textMuted }]}>Uses Android’s Alarm stream and your DND alarm setting</Text></View>{picking ? <ActivityIndicator color={tokens.accent} size="small" /> : <Text style={[styles.disclosure, { color: tokens.accent }]}>›</Text>}
        </Pressable>
        <Pressable disabled={!isNativeServiceAvailable || picking || atChoiceLimit} onPress={() => void pickAndroid('notification')} style={[styles.sourceButton, { opacity: !isNativeServiceAvailable || picking || atChoiceLimit ? 0.45 : 1 }]} accessibilityRole="button" accessibilityState={{ disabled: !isNativeServiceAvailable || picking || atChoiceLimit, busy: picking }}>
          <View style={styles.optionCopy}><Text style={[styles.optionTitle, { color: tokens.text }]}>{advanced ? 'Add notification sound' : 'Choose notification sound'}</Text><Text style={[styles.helper, { color: tokens.textMuted }]}>Also played on the Alarm audio stream</Text></View>{picking ? <ActivityIndicator color={tokens.accent} size="small" /> : <Text style={[styles.disclosure, { color: tokens.accent }]}>›</Text>}
        </Pressable>
        {androidChoices.length ? <View style={styles.addedList}><SheetSectionTitle>Added Android sounds</SheetSectionTitle>{androidChoices.map(sound => <SoundLibraryRow key={soundRefKey(sound)} title={soundTitle(sound)} detail={sound.ringtoneType === 'alarm' ? 'Android alarm sound' : 'Android notification sound'} advanced={advanced} selected selectionDisabled={advanced && choices.length === 1} onPress={() => advanced ? auditionAndChooseOnly(sound) : chooseSound(sound)} onToggle={() => toggleChoice(sound)} />)}</View> : null}
      </View> : null}

      {tab === 'device' ? <View style={styles.sourcePanel}>
        {!isNativeServiceAvailable ? <GentleNotice title="Available in the Android app" message="File browsing opens in an installed Chandas build. Your current sound remains selected here." /> : null}
        <Pressable disabled={!isNativeServiceAvailable || picking || atChoiceLimit} onPress={() => void pickDocument()} style={[styles.sourceButton, { opacity: !isNativeServiceAvailable || picking || atChoiceLimit ? 0.45 : 1 }]} accessibilityRole="button" accessibilityState={{ disabled: !isNativeServiceAvailable || picking || atChoiceLimit, busy: picking }}>
          <View style={styles.optionCopy}><Text style={[styles.optionTitle, { color: tokens.text }]}>{advanced ? 'Add audio file' : 'Choose audio file'}</Text><Text style={[styles.helper, { color: tokens.textMuted }]}>MP3, M4A, OGG, WAV and other supported audio</Text></View>{picking ? <ActivityIndicator color={tokens.accent} size="small" /> : <Text style={[styles.disclosure, { color: tokens.accent }]}>›</Text>}
        </Pressable>
        {deviceChoices.length ? <View style={styles.addedList}><SheetSectionTitle>Added audio files</SheetSectionTitle>{deviceChoices.map(sound => <SoundLibraryRow key={soundRefKey(sound)} title={soundTitle(sound)} detail="Audio file from this device" advanced={advanced} selected selectionDisabled={advanced && choices.length === 1} onPress={() => advanced ? auditionAndChooseOnly(sound) : chooseSound(sound)} onToggle={() => toggleChoice(sound)} />)}</View> : null}
      </View> : null}
      </Animated.View>
    </BottomSheet>
  )
}

function SoundLibraryRow({ title, detail, advanced, selected, selectionDisabled, onPress, onToggle }: {
  title: string
  detail: string
  advanced: boolean
  selected: boolean
  selectionDisabled: boolean
  onPress: () => void
  onToggle: () => void
}) {
  const { tokens } = useTheme()
  return <View style={[styles.libraryRow, { borderBottomColor: tokens.border }]}>
    {advanced ? <Pressable hitSlop={8} disabled={selectionDisabled} onPress={onToggle} style={[styles.checkboxPressable, { opacity: selectionDisabled ? 0.48 : 1 }]} accessibilityRole="checkbox" accessibilityLabel={`${selected ? 'Remove' : 'Add'} ${title} ${selected ? 'from' : 'to'} sound choices`} accessibilityState={{ checked: selected, disabled: selectionDisabled }}>
      <View style={[styles.checkbox, { borderColor: selected ? tokens.accent : tokens.border, backgroundColor: selected ? tokens.accent : 'transparent' }]}>{selected ? <Text style={styles.checkboxMark}>✓</Text> : null}</View>
    </Pressable> : null}
    <Pressable onPress={onPress} style={styles.libraryRowMain} accessibilityRole="button" accessibilityLabel={`${title}. Preview and use only this sound`}>
      <View style={styles.optionCopy}><Text style={[styles.optionTitle, { color: tokens.text }]}>{title}</Text><Text style={[styles.helper, { color: tokens.textMuted }]}>{detail}</Text></View>
    </Pressable>
  </View>
}

function SoundChoicesEditor({ choices, mode, previewing, onModeChange, onMove, onRemove, onPreview }: {
  choices: SoundRef[]
  mode: 'sequence' | 'random'
  previewing: string | null
  onModeChange: (mode: 'sequence' | 'random') => void
  onMove: (from: number, to: number) => void
  onRemove: (sound: SoundRef) => void
  onPreview: (sound: SoundRef) => void | Promise<void>
}) {
  const { tokens } = useTheme()
  const rows = choices.map(sound => ({ id: soundRefKey(sound) }))
  return <View style={styles.choiceEditor}>
    {choices.length > 1 ? <SegmentedControl items={[{ value: 'sequence', label: 'In order' }, { value: 'random', label: 'Random' }]} value={mode} onChange={onModeChange} accessibilityLabel="Sound choice order" /> : null}
      <View style={[styles.choiceList, { height: Math.min(430, Math.max(60, choices.length * 60)) }]}>
        <Sortable data={rows} estimatedItemHeight={54} useFlatList={false} style={styles.choiceScroller} contentContainerStyle={styles.choiceListContent} renderItem={props => {
          const sound = choices.find(choice => soundRefKey(choice) === props.item.id)
          if (!sound) return null
          return <SortableSoundChoiceRow {...props} sound={sound} itemCount={choices.length} canDelete={choices.length > 1} playing={previewing === soundPreviewKey(sound)} onMove={onMove} onRemove={onRemove} onPreview={onPreview} />
        }} />
      </View>
      <Text style={[styles.choiceHint, { color: tokens.textMuted }]}>Hold the dotted handle to reorder. Swipe left to delete.</Text>
  </View>
}

function SortableSoundChoiceRow({ sound, itemCount, canDelete, playing, onMove, onRemove, onPreview, ...props }: SortableRenderItemProps<{ id: string }> & {
  sound: SoundRef
  itemCount: number
  canDelete: boolean
  playing: boolean
  onMove: (from: number, to: number) => void
  onRemove: (sound: SoundRef) => void
  onPreview: (sound: SoundRef) => void | Promise<void>
}) {
  const { tokens } = useTheme()
  const { id, index, item, positions, lowerBound, autoScrollDirection, itemsCount, isDynamicHeight, estimatedItemHeight, itemHeights, scheduleHeightUpdate } = props
  const available = useSoundAvailability(sound)
  const finishMove = (_id: string, to: number) => { if (to !== index) onMove(index, to) }
  const adjust = (direction: 'increment' | 'decrement') => {
    const target = Math.max(0, Math.min(itemCount - 1, index + (direction === 'increment' ? 1 : -1)))
    if (target !== index) { selectionHaptic(); onMove(index, target) }
  }
  return <SortableItem id={id} data={item} positions={positions} lowerBound={lowerBound} autoScrollDirection={autoScrollDirection} itemsCount={itemsCount} isDynamicHeight={isDynamicHeight} estimatedItemHeight={estimatedItemHeight} itemHeights={itemHeights} scheduleHeightUpdate={scheduleHeightUpdate} onDrop={finishMove} style={styles.choiceSortableItem}>
    <SwipeToDeleteRow disabled={!canDelete} onDelete={() => onRemove(sound)} accessibilityLabel={`Delete ${soundTitle(sound)} from sound choices`}>
      <View style={[styles.choiceRow, { borderBottomColor: tokens.border }]}>
        <SortableItem.Handle style={styles.choiceHandle}><Pressable hitSlop={8} style={styles.choiceHandlePressable} accessibilityRole="adjustable" accessibilityLabel={`Reorder ${soundTitle(sound)}`} accessibilityHint="Touch and hold to drag, or use accessibility actions to move it" accessibilityValue={{ text: `${index + 1} of ${itemCount}` }} accessibilityActions={[{ name: 'increment', label: 'Move later' }, { name: 'decrement', label: 'Move earlier' }]} onAccessibilityAction={event => adjust(event.nativeEvent.actionName as 'increment' | 'decrement')}><Text style={[styles.choiceHandleGlyph, { color: tokens.textMuted }]}>⠿</Text></Pressable></SortableItem.Handle>
        <View style={styles.choicePosition}><Text style={[styles.choicePositionText, { color: tokens.accent }]}>{index + 1}</Text></View>
        <View style={styles.optionCopy}><Text numberOfLines={1} style={[styles.optionTitle, { color: available ? tokens.text : tokens.accent }]}>{soundTitle(sound)}</Text>{!available ? <Text style={[styles.helper, { color: tokens.accent }]}>Unavailable · fallback will play</Text> : null}</View>
        <Pressable onPress={() => void onPreview(sound)} style={[styles.choicePreview, { borderColor: tokens.border }]} accessibilityRole="button" accessibilityLabel={`${playing ? 'Stop' : 'Preview'} ${soundTitle(sound)}`}><Text style={[styles.previewText, { color: tokens.accent }]}>{playing ? '■' : '▶'}</Text></Pressable>
      </View>
    </SwipeToDeleteRow>
  </SortableItem>
}

function soundChoicesSummary(choices: SoundRef[]): string {
  const visible = choices.slice(0, 3).map(soundTitle)
  const remaining = choices.length - visible.length
  return `${visible.join(', ')}${remaining > 0 ? ` and ${remaining} ${remaining === 1 ? 'other' : 'others'}` : ''}`
}

function soundPreviewKey(sound: SoundRef): string {
  return sound.kind === 'builtin' ? sound.id : sound.uri
}

const styles = StyleSheet.create({
  list: { gap: 0 },
  libraryRow: { minHeight: 62, flexDirection: 'row', alignItems: 'stretch', borderBottomWidth: StyleSheet.hairlineWidth },
  libraryRowMain: { flex: 1, minWidth: 0, justifyContent: 'center', paddingVertical: 10, paddingRight: 8 },
  checkboxPressable: { width: 44, alignItems: 'flex-start', justifyContent: 'center' },
  optionCopy: { flex: 1, minWidth: 0, gap: 3 },
  optionTitle: { fontSize: 14, fontWeight: '600' },
  helper: { fontSize: 12, lineHeight: 17 },
  preview: { width: 38, height: 38, borderWidth: 1.5, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  previewText: { fontSize: 12 },
  sourcePanel: { gap: 4 },
  sourceButton: { minHeight: 66, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  addedList: { paddingTop: 12 },
  selected: { minHeight: 32, flexDirection: 'row', alignItems: 'center', gap: 12 },
  selectedTitle: { flex: 1 },
  footer: { paddingTop: 6, gap: 9 },
  volumeHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  volumeRow: { flexDirection: 'row', alignItems: 'center', gap: 8 }, slider: { flex: 1, height: 38 },
  value: { fontFamily: 'JetBrainsMono-Regular', fontSize: 13 },
  checkbox: { width: 22, height: 22, borderWidth: 1.5, borderRadius: 11, alignItems: 'center', justifyContent: 'center' }, checkboxMark: { color: '#fff', fontSize: 13, lineHeight: 16, fontWeight: '900' },
  settingsRow: { minHeight: 58, paddingVertical: 7, flexDirection: 'row', alignItems: 'center', gap: 10 }, disclosure: { width: 24, textAlign: 'center', fontSize: 22, lineHeight: 25, fontWeight: '500' },
  choiceEditor: { gap: 12 }, choiceList: { overflow: 'hidden' }, choiceScroller: { flex: 1 }, choiceListContent: { paddingHorizontal: 0 }, choiceSortableItem: { width: '100%' },
  outputRow: { minHeight: 42, flexDirection: 'row', alignItems: 'center', gap: 10 },
  choiceRow: { minHeight: 54, flexDirection: 'row', alignItems: 'center', gap: 8, borderBottomWidth: StyleSheet.hairlineWidth, backgroundColor: 'transparent' }, choiceHandle: { alignSelf: 'stretch', justifyContent: 'center' }, choiceHandlePressable: { width: 30, minHeight: 52, alignItems: 'center', justifyContent: 'center' }, choiceHandleGlyph: { fontSize: 19, lineHeight: 22, letterSpacing: -3 }, choicePosition: { width: 19, alignItems: 'center' }, choicePositionText: { fontFamily: 'JetBrainsMono-Regular', fontSize: 11 }, choicePreview: { width: 34, height: 34, borderWidth: 1, borderRadius: 17, alignItems: 'center', justifyContent: 'center' }, choiceHint: { fontSize: 10, lineHeight: 14 },
})
