import { useEffect, useState } from 'react'
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from 'react-native'
import Slider from '@react-native-community/slider'
import Animated, { FadeIn, FadeOut, useReducedMotion } from 'react-native-reanimated'
import * as Haptics from 'expo-haptics'
import type { CueSettings, SoundRef } from '../../types'
import { BUILT_IN_SOUNDS, soundTitle } from '../../lib/soundLibrary'
import { ChandasTimerService, isNativeServiceAvailable } from '../../native/ChandasTimerService'
import { useTheme } from '../../theme/ThemeContext'
import { BottomSheet } from './BottomSheet'
import { useSoundAvailability } from '../../hooks/use-sound-availability'
import { GentleNotice, type AppNotice } from './experience-feedback'

type SoundTab = 'built-in' | 'android' | 'device'

interface Props {
  visible: boolean
  title: string
  cue: CueSettings
  masterVolume: number
  onChange: (patch: Partial<CueSettings>) => void
  onClose: () => void
  onFeedback: (notice: Omit<AppNotice, 'id'>) => void
}

export function SoundPickerSheet({ visible, title, cue, masterVolume, onChange, onClose, onFeedback }: Props) {
  const { tokens } = useTheme()
  const reducedMotion = useReducedMotion()
  const [tab, setTab] = useState<SoundTab>('built-in')
  const [previewing, setPreviewing] = useState<string | null>(null)
  const [picking, setPicking] = useState(false)
  const [message, setMessage] = useState<{ title: string; detail: string } | null>(null)
  const selectedAvailable = useSoundAvailability(cue.sound)

  useEffect(() => () => ChandasTimerService.stopSoundPreview(), [])
  useEffect(() => {
    if (visible) setTab(cue.sound.kind === 'builtin' ? 'built-in' : cue.sound.kind === 'android' ? 'android' : 'device')
    else { ChandasTimerService.stopSoundPreview(); setPreviewing(null); setMessage(null) }
  }, [cue.sound.kind, visible])

  const close = () => { ChandasTimerService.stopSoundPreview(); setPreviewing(null); onClose() }
  const stopPreview = () => { ChandasTimerService.stopSoundPreview(); setPreviewing(null) }
  const chooseSound = (sound: SoundRef) => { stopPreview(); setMessage(null); onChange({ sound }); void Haptics.selectionAsync().catch(() => undefined) }
  const preview = async (sound: SoundRef) => {
    ChandasTimerService.stopSoundPreview()
    const key = sound.kind === 'builtin' ? sound.id : sound.uri
    if (previewing === key) { setPreviewing(null); return }
    try {
      const didStart = await ChandasTimerService.previewSound(sound, masterVolume * cue.volume)
      if (!didStart && Platform.OS === 'android') setMessage({ title: 'That sound could not be previewed', detail: 'Choose another sound, or reselect the file if it moved.' })
      setPreviewing(didStart || (Platform.OS === 'android' && isNativeServiceAvailable) ? key : null)
    } catch {
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

  const volumeFooter = <View style={[styles.footer, { backgroundColor: tokens.surface, borderTopColor: tokens.border }]}>
    <View style={[styles.selected, { backgroundColor: tokens.surfaceHi }]}>
      <View style={styles.optionCopy}><Text style={[styles.label, { color: selectedAvailable ? tokens.textMuted : tokens.accent }]}>{selectedAvailable ? 'SELECTED' : 'UNAVAILABLE · CHOOSE A REPLACEMENT'}</Text><Text numberOfLines={1} style={[styles.optionTitle, { color: tokens.text }]}>{soundTitle(cue.sound)}</Text></View>
      <Pressable onPress={() => void preview(cue.sound)} accessibilityRole="button" accessibilityLabel="Preview selected sound"><Text style={[styles.choose, { color: tokens.accent }]}>Preview</Text></Pressable>
    </View>
    <View style={styles.volumeHeader}><Text style={[styles.label, { color: tokens.textMuted }]}>CUE VOLUME</Text><Text style={[styles.value, { color: tokens.text }]}>{Math.round(cue.volume * 100)}%</Text></View>
    <Slider minimumValue={0} maximumValue={1} step={0.05} value={cue.volume} onSlidingStart={stopPreview} onValueChange={volume => onChange({ volume })} minimumTrackTintColor={tokens.accent} maximumTrackTintColor={tokens.surfaceHi} thumbTintColor={tokens.accent} accessibilityLabel={`${title} volume`} accessibilityValue={{ min: 0, max: 100, now: Math.round(cue.volume * 100), text: `${Math.round(cue.volume * 100)} percent` }} />
  </View>

  return (
    <BottomSheet visible={visible} eyebrow="SOUND & LEVEL" title={title} onClose={close} footer={volumeFooter}>
      <View style={[styles.tabs, { borderColor: tokens.border }]}> 
        {([['built-in', 'Built-in'], ['android', 'Android'], ['device', 'Device']] as const).map(([value, label]) => (
          <Pressable key={value} onPress={() => { stopPreview(); setTab(value) }} accessibilityRole="tab" accessibilityState={{ selected: tab === value }} style={[styles.tab, tab === value && { backgroundColor: tokens.accent }]}>
            <Text style={[styles.tabText, { color: tab === value ? '#fff' : tokens.textMuted }]}>{label}</Text>
          </Pressable>
        ))}
      </View>

      {message ? <GentleNotice title={message.title} message={message.detail} tone="attention" /> : null}

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
  tabs: { flexDirection: 'row', borderWidth: 1.5, borderRadius: 12, padding: 3, gap: 3 },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 9 },
  tabText: { fontSize: 12, fontWeight: '700' },
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
  selected: { padding: 13, borderRadius: 12, flexDirection: 'row', alignItems: 'center', gap: 12 },
  footer: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 12, gap: 9 },
  label: { fontSize: 10, letterSpacing: 1.2, fontWeight: '700' },
  volumeHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  value: { fontFamily: 'JetBrainsMono-Regular', fontSize: 13 },
})
