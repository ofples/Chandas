import { useMemo, useState } from 'react'
import { Modal, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native'
import Slider from '@react-native-community/slider'
import Svg, { Circle } from 'react-native-svg'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type { AlarmBehavior, PatternProgram, TimerProgram } from '../types'
import { BellIcon, FocusIcon } from '../components/Icons'
import { Chip } from '../components/Chip'
import { CustomMinutePicker } from '../components/CustomMinutePicker'
import type { RuntimeMuteState } from '../lib/runtimeV2'
import { soundTitle } from '../lib/soundLibrary'
import { useTheme } from '../theme/ThemeContext'

interface Props {
  program: TimerProgram
  mainCountdown: string
  nextCueCountdown: string
  nextCueLabel: string
  progress: number
  activeHoursPaused: boolean
  activeHoursResumeAt: number
  mute: RuntimeMuteState
  alarmBehavior: AlarmBehavior
  onStop: () => void
  onPressAlarm: () => void
  onMuteForIterations: (count: number) => void
  onMuteForMinutes: (minutes: number) => void
  onClearMute: () => void
  masterVolume: number
  onMasterVolumeChange: (value: number) => void
  focusEnabled: boolean
  focusActive: boolean
  focusPolicyAccess: boolean
  onToggleFocus: () => void
}

export function TimerV2RunningScreen(props: Props) {
  const { tokens } = useTheme()
  const insets = useSafeAreaInsets()
  const { width } = useWindowDimensions()
  const [mixerOpen, setMixerOpen] = useState(false)
  const [customMute, setCustomMute] = useState(false)
  const size = Math.min(width * 0.78, 336)
  const muted = props.masterVolume <= 0 || props.mute.mutedUntil > Date.now() || Boolean(props.mute.iteration)
  const resumeDate = new Date(props.activeHoursResumeAt)
  const ringTracks = props.program.mode === 'pattern' ? props.program.tracks.filter(track => track.enabled && track.selectedOffsetsMinutes.length > 0).slice(0, 5) : []
  const mainLabel = props.activeHoursPaused ? `${String(resumeDate.getHours()).padStart(2, '0')}:${String(resumeDate.getMinutes()).padStart(2, '0')}` : props.mainCountdown

  return <View style={[styles.screen, { backgroundColor: tokens.bg, paddingTop: insets.top }]}>
    <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 128 }]}>
      <View style={styles.topline}><Text style={[styles.mode, { color: tokens.textMuted }]}>{props.program.mode === 'pattern' ? 'MAIN + SUB-BELLS' : 'SEQUENCE / SETS'}</Text><Text style={[styles.mode, { color: tokens.accent }]}>{props.focusActive ? 'FOCUS ON' : ''}</Text></View>
      <Pressable onPress={muted ? props.onClearMute : undefined} style={[styles.ringWrap, { width: size, height: size }]} accessibilityLabel={muted ? 'Clear timer mute' : undefined}>
        <TimerRings size={size} progress={props.progress} program={props.program} muted={muted} />
        <View pointerEvents="none" style={styles.center}><Text style={[styles.mainTime, { color: tokens.text }]}>{mainLabel}</Text><Text style={[styles.mainCaption, { color: tokens.textMuted }]}>{props.activeHoursPaused ? 'Resumes' : props.program.mode === 'pattern' ? 'until main gong' : 'until next step'}</Text>{!props.activeHoursPaused && <View style={styles.nextCue}><Text style={[styles.nextCueName, { color: tokens.accent }]}>{props.nextCueLabel}</Text><Text style={[styles.nextCueTime, { color: tokens.textMuted }]}>{props.nextCueCountdown}</Text></View>}</View>
        {muted && <View pointerEvents="none" style={[styles.slash, { width: size * 0.72, backgroundColor: tokens.accent }]} />}
      </Pressable>
      {props.program.mode === 'pattern' && ringTracks.length > 0 && <View style={styles.legend}>{ringTracks.map((track, index) => <View key={track.id} style={styles.legendItem}><View style={[styles.legendDot, { borderColor: index === 0 ? tokens.accent : tokens.textMuted }]} /><Text style={[styles.legendText, { color: tokens.textMuted }]}>{soundTitle(track.sound)} · {track.cadenceMinutes}m</Text></View>)}</View>}
    </ScrollView>
    <View style={[styles.bottom, { backgroundColor: tokens.bg, paddingBottom: insets.bottom + 18 }]}>
      <View style={styles.controls}><Pressable onPress={props.onPressAlarm} style={[styles.iconButton, { borderColor: props.alarmBehavior !== 'off' ? tokens.accent : tokens.border, backgroundColor: props.alarmBehavior !== 'off' ? tokens.accentGlow : 'transparent' }]} accessibilityLabel={props.alarmBehavior === 'locked' ? 'Alarm locked for every main gong' : props.alarmBehavior === 'once' ? 'Alarm armed for next main gong' : 'Arm alarm for next main gong'}><Text style={[styles.alarmText, { color: props.alarmBehavior !== 'off' ? tokens.accent : tokens.textMuted }]}>{props.alarmBehavior === 'locked' ? 'A∞' : props.alarmBehavior === 'once' ? 'A1' : 'A'}</Text></Pressable><Pressable onPress={props.onToggleFocus} style={[styles.iconButton, { borderColor: props.focusEnabled ? tokens.accent : tokens.border, backgroundColor: props.focusActive ? tokens.accentGlow : 'transparent' }]} accessibilityLabel="Toggle focus and Do Not Disturb"><FocusIcon color={props.focusEnabled ? tokens.accent : tokens.textMuted} /></Pressable><View style={styles.spacer} /><Pressable onPress={() => setMixerOpen(true)} style={[styles.iconButton, { borderColor: mixerOpen || muted ? tokens.accent : tokens.border }]} accessibilityLabel="Open mixer and mute controls"><BellIcon muted={muted} color={mixerOpen || muted ? tokens.accent : tokens.textMuted} /></Pressable></View>
      <Pressable onPress={props.onStop} style={[styles.stop, { borderColor: tokens.border, backgroundColor: tokens.surfaceHi }]}><Text style={[styles.stopText, { color: tokens.textMuted }]}>Stop</Text></Pressable>
    </View>
    <MixerSheet visible={mixerOpen} onClose={() => setMixerOpen(false)} masterVolume={props.masterVolume} onMasterVolumeChange={props.onMasterVolumeChange} mute={props.mute} onMuteIterations={props.onMuteForIterations} onClearMute={props.onClearMute} onCustom={() => { setMixerOpen(false); setCustomMute(true) }} />
    {customMute && <CustomMinutePicker title="Mute duration" initial={15} min={1} max={1440} onConfirm={minutes => { props.onMuteForMinutes(minutes); setCustomMute(false) }} onClose={() => setCustomMute(false)} />}
  </View>
}

function TimerRings({ size, progress, program, muted }: { size: number; progress: number; program: TimerProgram; muted: boolean }) {
  const { tokens } = useTheme()
  const rings = useMemo(() => program.mode === 'pattern' ? Math.max(1, program.tracks.filter(track => track.enabled && track.selectedOffsetsMinutes.length > 0).length + 1) : 2, [program])
  const center = 100; const radius = 82; const circumference = Math.PI * 2 * radius
  return <Svg width={size} height={size} viewBox="0 0 200 200" style={styles.svg}>
    {Array.from({ length: rings }).map((_, index) => { const r = radius - index * 10; const c = Math.PI * 2 * r; const isMain = index === 0; return <Circle key={index} cx={center} cy={center} r={r} fill="none" stroke={isMain ? tokens.surfaceHi : tokens.border} strokeWidth={isMain ? 3 : 1.5} /> })}
    <Circle cx={center} cy={center} r={radius} fill="none" stroke={tokens.accent} strokeWidth={3} strokeLinecap="round" strokeDasharray={`${circumference}, ${circumference}`} strokeDashoffset={circumference * (1 - progress)} transform="rotate(-90 100 100)" opacity={muted ? 0.35 : 1} />
  </Svg>
}

function MixerSheet({ visible, onClose, masterVolume, onMasterVolumeChange, mute, onMuteIterations, onClearMute, onCustom }: { visible: boolean; onClose: () => void; masterVolume: number; onMasterVolumeChange: (value: number) => void; mute: RuntimeMuteState; onMuteIterations: (count: number) => void; onClearMute: () => void; onCustom: () => void }) {
  const { tokens } = useTheme()
  const iterationActive = Boolean(mute.iteration)
  const timeActive = mute.mutedUntil > Date.now()
  return <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}><Pressable style={styles.backdrop} onPress={onClose}><Pressable onPress={event => event.stopPropagation()} style={[styles.sheet, { backgroundColor: tokens.surface, borderColor: tokens.border }]}><View style={styles.sheetHeader}><Text style={[styles.sheetTitle, { color: tokens.text }]}>Mixer & mute</Text><Pressable onPress={onClose}><Text style={[styles.done, { color: tokens.accent }]}>Done</Text></Pressable></View><Text style={[styles.mode, { color: tokens.textMuted }]}>MASTER VOLUME</Text><View style={styles.volumeRow}><Text style={[styles.volumeValue, { color: tokens.text }]}>{Math.round(masterVolume * 100)}%</Text><Slider style={styles.slider} minimumValue={0} maximumValue={1} step={0.05} value={masterVolume} onValueChange={onMasterVolumeChange} minimumTrackTintColor={tokens.accent} maximumTrackTintColor={tokens.surfaceHi} thumbTintColor={tokens.accent} /></View><Text style={[styles.mode, { color: tokens.textMuted }]}>MUTE FOR</Text><Text style={[styles.help, { color: tokens.textMuted }]}>Cycle mute keeps the final selected main boundary audible.</Text><View style={styles.muteRow}>{[1, 2, 3].map(count => <Chip key={count} label={`${count} cycle${count === 1 ? '' : 's'}`} active={iterationActive} onPress={() => onMuteIterations(count)} />)}<Chip label="Time…" active={timeActive} onPress={onCustom} /></View>{(iterationActive || timeActive) && <Pressable onPress={onClearMute}><Text style={[styles.clear, { color: tokens.accent }]}>Clear mute</Text></Pressable>}</Pressable></Pressable></Modal>
}

const styles = StyleSheet.create({
  screen: { flex: 1 }, content: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20, gap: 20 }, topline: { width: '100%', maxWidth: 460, flexDirection: 'row', justifyContent: 'space-between' }, mode: { fontSize: 11, letterSpacing: 1.25, fontWeight: '700' }, ringWrap: { alignItems: 'center', justifyContent: 'center' }, svg: { position: 'absolute', transform: [{ rotate: '0deg' }] }, center: { alignItems: 'center', gap: 5, maxWidth: '76%' }, mainTime: { fontFamily: 'JetBrainsMono-Light', fontSize: 58, fontVariant: ['tabular-nums'] }, mainCaption: { fontSize: 11, letterSpacing: 1.1, textTransform: 'uppercase' }, nextCue: { marginTop: 12, alignItems: 'center', gap: 2 }, nextCueName: { fontSize: 14, fontWeight: '700' }, nextCueTime: { fontFamily: 'JetBrainsMono-Regular', fontSize: 12 }, slash: { position: 'absolute', height: 4, borderRadius: 3, transform: [{ rotate: '-45deg' }] }, legend: { width: '100%', maxWidth: 360, gap: 7 }, legendItem: { flexDirection: 'row', alignItems: 'center', gap: 7 }, legendDot: { width: 9, height: 9, borderRadius: 5, borderWidth: 1.5 }, legendText: { fontSize: 11 }, bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 20, alignItems: 'center' }, controls: { width: '100%', maxWidth: 460, flexDirection: 'row', gap: 8, marginBottom: 10 }, spacer: { flex: 1 }, iconButton: { width: 38, height: 38, borderWidth: 1.5, borderRadius: 19, alignItems: 'center', justifyContent: 'center' }, alarmText: { fontSize: 12, fontWeight: '800' }, stop: { width: '100%', maxWidth: 460, borderWidth: 1.5, paddingVertical: 16, borderRadius: 99, alignItems: 'center' }, stopText: { fontSize: 14, textTransform: 'uppercase', letterSpacing: 1.1, fontWeight: '700' }, backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' }, sheet: { borderTopLeftRadius: 18, borderTopRightRadius: 18, borderWidth: 1.5, borderBottomWidth: 0, padding: 22, gap: 15 }, sheetHeader: { flexDirection: 'row', justifyContent: 'space-between' }, sheetTitle: { fontSize: 18, fontWeight: '700' }, done: { fontSize: 13, fontWeight: '700' }, volumeRow: { flexDirection: 'row', alignItems: 'center', gap: 10 }, volumeValue: { fontFamily: 'JetBrainsMono-Regular', width: 38 }, slider: { flex: 1, height: 35 }, help: { fontSize: 12, lineHeight: 17 }, muteRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, clear: { fontSize: 13, fontWeight: '700' },
})
