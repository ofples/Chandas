import type { ReactNode } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import type { UnifiedTimerStep } from '../../types'
import { MAX_CUE_DURATION_SECONDS } from '../../lib/timerV2'
import { useTheme } from '../../theme/ThemeContext'
import { BellIcon, VolumeIcon } from '../Icons'
import { Toggle } from '../Toggle'
import { DurationSelector } from './DurationSelector'
import { SoundName } from './SoundName'
import { PatternTimelinePreview } from './PatternTimelinePreview'

/** The same interval controls, whether edited on the page or inside a step sheet. */
export function UnifiedIntervalEditor({ step, secondPrecision, onDuration, onSound, onSubBells, onSubBellsEnabled, controls }: {
  step: UnifiedTimerStep; secondPrecision: boolean; onDuration: (seconds: number) => void;
  onSound: () => void; onSubBells: () => void; onSubBellsEnabled: (enabled: boolean) => void; controls: ReactNode
}) {
  const { tokens } = useTheme()
  const tracks = (step.subBellsEnabled ? step.subBellTracks : []).map(track => ({ ...track, cadenceMinutes: Math.max(1, Math.ceil(track.cadenceSeconds / 60)), selectedOffsetsMinutes: track.selectedOffsetsSeconds.map(offset => Math.ceil(offset / 60)) }))
  return <View style={styles.editor}>
    <Text style={[styles.label, { color: tokens.text }]}>Main interval</Text>
    <View testID="unified-main-duration"><DurationSelector value={Math.ceil(step.durationSeconds / 60)} valueSeconds={step.durationSeconds} secondPrecision={secondPrecision || step.durationSeconds % 60 !== 0} presets={[5, 10, 15, 30, 45, 60]} minSeconds={1} maxSeconds={MAX_CUE_DURATION_SECONDS} onChange={minutes => onDuration(Math.min(MAX_CUE_DURATION_SECONDS, minutes * 60))} onChangeSeconds={onDuration} /></View>
    <Pressable testID="unified-main-sound" accessibilityRole="button" accessibilityLabel="Choose main interval sound" onPress={onSound} style={styles.sound}>
      <BellIcon on color={tokens.accent} /><View style={styles.flex}><Text style={[styles.label, { color: tokens.text }]}>At the end</Text><SoundName cue={step.endCue} style={styles.detail} /></View><VolumeIcon level={step.endCue.volume} color={tokens.textMuted} /><Text style={{ color: tokens.textMuted }}>›</Text>
    </Pressable>
    {controls}
    <View style={[styles.card, { backgroundColor: tokens.surface, borderColor: tokens.border }]}>
      <Pressable testID="unified-open-subbells" accessibilityRole="button" accessibilityLabel="Configure sub-bells" onPress={onSubBells} style={StyleSheet.absoluteFill} />
      <View pointerEvents="box-none" style={styles.header}>
        <View pointerEvents="none" style={styles.flex}><Text style={[styles.label, { color: tokens.text }]}>Sub-bells</Text><Text style={[styles.detail, { color: tokens.textMuted }]}>{step.subBellsEnabled ? `${step.subBellTracks.filter(track => track.enabled).length} active · ${step.subBellTracks.length} configured` : step.subBellTracks.length ? 'Off · settings retained' : 'No sub-bells'}</Text></View>
        <Toggle value={step.subBellsEnabled} onChange={onSubBellsEnabled} accessibilityLabel="Sub-bells during this interval" />
      </View>
      <View pointerEvents="none"><PatternTimelinePreview tracks={tracks} mainDurationSeconds={step.durationSeconds} /></View>
    </View>
  </View>
}

const styles = StyleSheet.create({
  editor: { gap: 14 }, label: { fontSize: 14, fontWeight: '600' }, detail: { fontSize: 12, lineHeight: 17 }, flex: { flex: 1, minWidth: 0 },
  sound: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 12 },
  card: { borderWidth: 1, borderRadius: 16, padding: 12, gap: 10 }, header: { minHeight: 42, flexDirection: 'row', alignItems: 'center', gap: 10 },
})
