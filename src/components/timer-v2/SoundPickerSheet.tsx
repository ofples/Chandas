import { useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from 'react-native'
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

type SoundTab = 'built-in' | 'android' | 'device'
const SOUND_TABS = [{ value: 'built-in', label: 'Built-in' }, { value: 'android', label: 'Android' }, { value: 'device', label: 'Device' }] as const

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
  const [message, setMessage] = useState<{ title: string; detail: string } | null>(null)
  const previewRequest = useRef(0)
  const selectedAvailable = useSoundAvailability(cue.sound)
  const selectedKey = cue.sound.kind === 'builtin' ? cue.sound.id : cue.sound.uri
  const choices = useMemo(() => cueSounds(cue), [cue])

  useEffect(() => () => { previewRequest.current += 1; ChandasTimerService.stopSoundPreview() }, [])
  useEffect(() => {
    if (visible) setTab(cue.sound.kind === 'builtin' ? 'built-in' : cue.sound.kind === 'android' ? 'android' : 'device')
    else { previewRequest.current += 1; ChandasTimerService.stopSoundPreview(); setPreviewing(null); setMessage(null) }
  }, [cue.sound.kind, visible])

  const close = () => { stopPreview(); onClose() }
  const stopPreview = () => { previewRequest.current += 1; ChandasTimerService.stopSoundPreview(); setPreviewing(null) }
  const chooseSound = (sound: SoundRef) => {
    stopPreview()
    setMessage(null)
    onChange({ sound, sounds: [sound], soundMode: 'single' })
    selectionHaptic()
    void preview(sound)
  }
  const addChoice = (sound: SoundRef) => {
    const next = [...choices.filter(item => soundRefKey(item) !== soundRefKey(sound)), sound]
    onChange({ sounds: next, soundMode: next.length > 1 ? (cue.soundMode === 'random' ? 'random' : 'sequence') : 'single' })
    selectionHaptic()
    void preview(sound)
  }
  const removeChoice = (sound: SoundRef) => {
    const next = choices.filter(item => soundRefKey(item) !== soundRefKey(sound))
    if (next.length === 0) return
    onChange({ sound: soundRefKey(cue.sound) === soundRefKey(sound) ? next[0] : cue.sound, sounds: next, soundMode: next.length > 1 ? cue.soundMode ?? 'sequence' : 'single' })
  }
  const moveChoice = (from: number, to: number) => {
    if (to < 0 || to >= choices.length) return
    const next = [...choices]
    const [moved] = next.splice(from, 1)
    next.splice(to, 0, moved)
    onChange({ sound: next[0], sounds: next })
  }
  const preview = async (sound: SoundRef) => {
    stopPreview()
    const key = sound.kind === 'builtin' ? sound.id : sound.uri
    if (previewing === key) { setPreviewing(null); return }
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
    setPicking(true)
    setMessage(null)
    try {
      const result = await ChandasTimerService.pickDeviceSound(ringtoneType)
      if (result) {
        chooseSound({ kind: 'android', ringtoneType, ...result })
        onFeedback({ title: 'Sound selected', message: result.title, tone: 'success' })
      }
    } catch {
      setMessage({ title: 'Android sounds did not open', detail: 'Nothing changed. Try again, or choose one of the built-in sounds.' })
    } finally { setPicking(false) }
  }
  const pickDocument = async () => {
    setPicking(true)
    setMessage(null)
    try {
      const result = await ChandasTimerService.pickAudioDocument()
      if (result) {
        chooseSound({ kind: 'document', ...result })
        onFeedback({ title: 'Audio file selected', message: result.title, tone: 'success' })
      }
    } catch {
      setMessage({ title: 'Device audio did not open', detail: 'Nothing changed. Try again, or choose one of the built-in sounds.' })
    } finally { setPicking(false) }
  }

  const volumeFooter = <View style={[styles.footer, { backgroundColor: tokens.surface }]}>
    <View style={styles.selected}>
      <Text numberOfLines={1} style={[styles.optionTitle, styles.selectedTitle, { color: selectedAvailable ? tokens.text : tokens.accent }]}>{soundTitle(cue.sound)}{selectedAvailable ? '' : ' · unavailable'}</Text>
    </View>
    <View style={styles.volumeHeader}><SheetSectionTitle>Cue volume</SheetSectionTitle><Text style={[styles.value, { color: tokens.text }]}>{Math.round(cue.volume * 100)}%</Text></View>
    <View style={styles.volumeRow}><Slider style={styles.slider} minimumValue={0} maximumValue={1} step={0.05} value={cue.volume} onSlidingStart={stopPreview} onValueChange={volume => onChange({ volume })} minimumTrackTintColor={tokens.accent} maximumTrackTintColor={tokens.surfaceHi} thumbTintColor={tokens.accent} accessibilityLabel={`${title} volume`} accessibilityValue={{ min: 0, max: 100, now: Math.round(cue.volume * 100), text: `${Math.round(cue.volume * 100)} percent` }} /><Pressable onPress={() => void preview(cue.sound)} style={[styles.preview, { borderColor: tokens.border }]} accessibilityRole="button" accessibilityLabel={`${previewing === selectedKey ? 'Stop' : 'Preview'} selected sound`}><Text style={[styles.previewText, { color: tokens.accent }]}>{previewing === selectedKey ? '■' : '▶'}</Text></Pressable></View>
  </View>

  return (
    <BottomSheet visible={visible} title={title} help={advanced ? 'Tap a sound to use it and hear it immediately. Add several choices for each future cue to use in order or at random.' : 'Tap a sound to use it and hear it immediately, then set this cue’s own volume below. Built-in sounds travel with saved configurations.'} onClose={close} onBack={onBack ? () => { stopPreview(); onBack() } : undefined} pinnedContent={<SegmentedControl items={SOUND_TABS} value={tab} onChange={value => { stopPreview(); setTab(value) }} accessibilityLabel="Sound source" />} footer={volumeFooter}>
      {message ? <GentleNotice title={message.title} message={message.detail} tone="attention" /> : null}
      {advanced ? <View style={[styles.choices, { borderColor: tokens.border }]}>
        <View style={styles.choicesHeader}><Text style={[styles.optionTitle, { color: tokens.text }]}>Sound choices</Text><Text style={[styles.helper, { color: tokens.textMuted }]}>{choices.length === 1 ? 'One sound per cue' : `${choices.length} sounds per cue`}</Text></View>
        {choices.map((choice, index) => <View key={soundRefKey(choice)} style={styles.choiceRow}><Text numberOfLines={1} style={[styles.helper, styles.choiceTitle, { color: tokens.text }]}>{index + 1}. {soundTitle(choice)}</Text><Pressable onPress={() => void preview(choice)} accessibilityRole="button" accessibilityLabel={`Preview ${soundTitle(choice)}`}><Text style={[styles.choiceAction, { color: tokens.accent }]}>Play</Text></Pressable>{choices.length > 1 ? <><Pressable disabled={index === 0} onPress={() => moveChoice(index, index - 1)} accessibilityRole="button" accessibilityState={{ disabled: index === 0 }} accessibilityLabel={`Move ${soundTitle(choice)} earlier`}><Text style={[styles.choiceAction, { color: index === 0 ? tokens.textMuted : tokens.accent }]}>↑</Text></Pressable><Pressable disabled={index === choices.length - 1} onPress={() => moveChoice(index, index + 1)} accessibilityRole="button" accessibilityState={{ disabled: index === choices.length - 1 }} accessibilityLabel={`Move ${soundTitle(choice)} later`}><Text style={[styles.choiceAction, { color: index === choices.length - 1 ? tokens.textMuted : tokens.accent }]}>↓</Text></Pressable><Pressable onPress={() => removeChoice(choice)} accessibilityRole="button" accessibilityLabel={`Remove ${soundTitle(choice)} from sound choices`}><Text style={[styles.choiceAction, { color: tokens.warm }]}>Remove</Text></Pressable></> : null}</View>)}
        {choices.length > 1 ? <SegmentedControl items={[{ value: 'sequence', label: 'In order' }, { value: 'random', label: 'Random' }]} value={cue.soundMode === 'random' ? 'random' : 'sequence'} onChange={soundMode => onChange({ soundMode })} accessibilityLabel="Sound choice order" /> : null}
        <View style={styles.outputRow}><View style={styles.optionCopy}><Text style={[styles.optionTitle, { color: tokens.text }]}>Sound output</Text><Text style={[styles.helper, { color: tokens.textMuted }]}>{cue.soundEnabled === false ? 'Vibration only' : 'Sound and vibration'}</Text></View><Toggle value={cue.soundEnabled !== false} onChange={soundEnabled => onChange({ soundEnabled })} accessibilityLabel="Play sound for this cue" /></View>
      </View> : null}

      <Animated.View key={tab} entering={FadeIn.duration(reducedMotion ? 80 : 180)} exiting={FadeOut.duration(reducedMotion ? 70 : 120)}>
      {tab === 'built-in' ? <View style={styles.list}>{BUILT_IN_SOUNDS.map(sound => {
        const ref: SoundRef = { kind: 'builtin', id: sound.id }
        const selected = cue.sound.kind === 'builtin' && cue.sound.id === sound.id
        const playing = previewing === sound.id
        return <View key={sound.id} style={[styles.option, { borderColor: selected ? tokens.accent : tokens.border, backgroundColor: selected ? tokens.accentGlow : 'transparent' }]}>
          <Pressable style={styles.optionCopy} onPress={() => chooseSound(ref)} accessibilityRole="radio" accessibilityState={{ checked: selected }}>
            <Text style={[styles.optionTitle, { color: tokens.text }]}>{sound.name}</Text>
            <Text style={[styles.helper, { color: tokens.textMuted }]}>{sound.description}</Text>
          </Pressable>
          <Pressable onPress={() => void preview(ref)} style={[styles.preview, { borderColor: tokens.border }]} accessibilityRole="button" accessibilityLabel={`${playing ? 'Stop' : 'Preview'} ${sound.name}`}>
            <Text style={[styles.previewText, { color: tokens.accent }]}>{playing ? '■' : '▶'}</Text>
          </Pressable>
          {advanced ? <Pressable onPress={() => addChoice(ref)} style={styles.addChoice} accessibilityRole="button" accessibilityLabel={`Add ${sound.name} to sound choices`}><Text style={[styles.choose, { color: tokens.accent }]}>Add</Text></Pressable> : null}
        </View>
      })}</View> : null}

      {tab === 'android' ? <View style={styles.sourcePanel}>
        {!isNativeServiceAvailable ? <GentleNotice title="Available in the Android app" message="Built-in sounds can still be explored here. Device sound pickers open in an installed Chandas build." /> : null}
        <Pressable disabled={!isNativeServiceAvailable || picking} onPress={() => void pickAndroid('alarm')} style={[styles.sourceButton, { borderColor: tokens.border, opacity: !isNativeServiceAvailable || picking ? 0.45 : 1 }]} accessibilityRole="button" accessibilityState={{ disabled: !isNativeServiceAvailable || picking, busy: picking }}>
          <View style={styles.optionCopy}><Text style={[styles.optionTitle, { color: tokens.text }]}>Alarm sounds</Text><Text style={[styles.helper, { color: tokens.textMuted }]}>Uses Android’s Alarm stream and your DND alarm setting</Text></View>{picking ? <ActivityIndicator color={tokens.accent} size="small" /> : <Text style={[styles.choose, { color: tokens.accent }]}>Choose</Text>}
        </Pressable>
        <Pressable disabled={!isNativeServiceAvailable || picking} onPress={() => void pickAndroid('notification')} style={[styles.sourceButton, { borderColor: tokens.border, opacity: !isNativeServiceAvailable || picking ? 0.45 : 1 }]} accessibilityRole="button">
          <View style={styles.optionCopy}><Text style={[styles.optionTitle, { color: tokens.text }]}>Notification sounds</Text><Text style={[styles.helper, { color: tokens.textMuted }]}>Also played on the Alarm audio stream</Text></View>{picking ? <ActivityIndicator color={tokens.accent} size="small" /> : <Text style={[styles.choose, { color: tokens.accent }]}>Choose</Text>}
        </Pressable>
      </View> : null}

      {tab === 'device' ? <View style={styles.sourcePanel}>
        {!isNativeServiceAvailable ? <GentleNotice title="Available in the Android app" message="File browsing opens in an installed Chandas build. Your current sound remains selected here." /> : null}
        <Pressable disabled={!isNativeServiceAvailable || picking} onPress={() => void pickDocument()} style={[styles.sourceButton, { borderColor: tokens.border, opacity: !isNativeServiceAvailable || picking ? 0.45 : 1 }]} accessibilityRole="button">
          <View style={styles.optionCopy}><Text style={[styles.optionTitle, { color: tokens.text }]}>Choose audio file</Text><Text style={[styles.helper, { color: tokens.textMuted }]}>MP3, M4A, OGG, WAV and other supported audio</Text></View>{picking ? <ActivityIndicator color={tokens.accent} size="small" /> : <Text style={[styles.choose, { color: tokens.accent }]}>Browse</Text>}
        </Pressable>
      </View> : null}
      </Animated.View>
    </BottomSheet>
  )
}

const styles = StyleSheet.create({
  list: { gap: 8 },
  option: { minHeight: 66, borderWidth: 1.5, borderRadius: 13, flexDirection: 'row', alignItems: 'center', padding: 12, gap: 12 },
  optionCopy: { flex: 1, gap: 3 },
  optionTitle: { fontSize: 14, fontWeight: '600' },
  helper: { fontSize: 12, lineHeight: 17 },
  preview: { width: 38, height: 38, borderWidth: 1.5, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  previewText: { fontSize: 12 },
  sourcePanel: { gap: 12 },
  sourceButton: { minHeight: 70, padding: 14, borderWidth: 1.5, borderRadius: 13, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  choose: { fontSize: 12, fontWeight: '700' },
  selected: { minHeight: 32, flexDirection: 'row', alignItems: 'center', gap: 12 },
  selectedTitle: { flex: 1 },
  footer: { paddingTop: 6, gap: 9 },
  volumeHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  volumeRow: { flexDirection: 'row', alignItems: 'center', gap: 8 }, slider: { flex: 1, height: 38 },
  value: { fontFamily: 'JetBrainsMono-Regular', fontSize: 13 },
  choices: { borderWidth: 1, borderRadius: 13, padding: 10, gap: 8 },
  choicesHeader: { gap: 2 },
  outputRow: { minHeight: 42, flexDirection: 'row', alignItems: 'center', gap: 10 },
  choiceRow: { minHeight: 28, flexDirection: 'row', alignItems: 'center', gap: 10 },
  choiceTitle: { flex: 1 },
  choiceAction: { fontSize: 12, fontWeight: '700' },
  addChoice: { minHeight: 38, justifyContent: 'center', paddingHorizontal: 2 },
})
