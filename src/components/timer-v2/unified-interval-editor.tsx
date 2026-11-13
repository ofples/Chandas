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
export function UnifiedIntervalEditor({ step, secondPrecision, onDuration, onSound, onToggleSound, onSubBells, onSubBellsEnabled, controls, noMainInterval = false, onInfinity }: {
  step: UnifiedTimerStep; secondPrecision: boolean; onDuration: (seconds: number) => void;
  onSound: () => void; onToggleSound: () => void; onSubBells: () => void; onSubBellsEnabled: (enabled: boolean) => void; controls: ReactNode
  noMainInterval?: boolean; onInfinity?: () => void
}) {
  const { tokens } = useTheme()
  const tracks = (step.subBellsEnabled ? step.subBellTracks : []).map(track => ({ ...track, cadenceMinutes: Math.max(1, Math.ceil(track.cadenceSeconds / 60)), selectedOffsetsMinutes: track.selectedOffsetsSeconds.map(offset => Math.ceil(offset / 60)) }))
  return <View style={styles.editor}>
    <Text style={[styles.label, { color: tokens.text }]}>Main interval</Text>
    <View testID="unified-main-duration"><DurationSelector value={Math.ceil(step.durationSeconds / 60)} valueSeconds={step.durationSeconds} secondPrecision={secondPrecision} presets={[5, 10, 15, 30, 45, 60]} minSeconds={1} maxSeconds={MAX_CUE_DURATION_SECONDS} onChange={minutes => onDuration(Math.min(MAX_CUE_DURATION_SECONDS, minutes * 60))} onChangeSeconds={onDuration} infinite={noMainInterval} onInfinity={onInfinity} /></View>
    {noMainInterval ? <View style={styles.sound} accessibilityLabel="At the end, no main interval">
      <BellIcon muted color={tokens.textMuted} /><View><Text style={[styles.label, { color: tokens.textMuted }]}>At the end</Text><Text style={[styles.detail, { color: tokens.textMuted }]}>No main interval</Text></View>
    </View> : <View style={styles.sound}>
      <Pressable testID="unified-main-sound" accessibilityRole="button" accessibilityLabel="Choose main interval sound" onPress={onSound} style={[styles.sound, styles.flex]}>
        <BellIcon on color={tokens.accent} /><View style={styles.flex}><Text style={[styles.label, { color: tokens.text }]}>At the end</Text><SoundName cue={step.endCue} style={styles.detail} /></View><Text style={{ color: tokens.textMuted }}>›</Text>
      </Pressable>
      <Pressable accessibilityRole="switch" accessibilityLabel="Mute main interval sound" accessibilityState={{ checked: !!step.endCue.soundMuted }} onPress={onToggleSound} style={styles.muteSound}>
        <VolumeIcon muted={step.endCue.soundMuted} level={step.endCue.volume} color={step.endCue.soundMuted ? tokens.accent : tokens.textMuted} />
      </Pressable>
    </View>}
    {controls}
    <View style={[styles.card, { backgroundColor: tokens.surface, borderColor: tokens.border }]}>
      <Pressable testID="unified-open-subbells" accessibilityRole="button" accessibilityLabel="Configure sub-bells" onPress={onSubBells} style={StyleSheet.absoluteFill} />
      <View pointerEvents="box-none" style={styles.header}>
        <View pointerEvents="none" style={styles.flex}><Text style={[styles.label, { color: tokens.text }]}>Sub-bells</Text><Text style={[styles.detail, { color: tokens.textMuted }]}>{noMainInterval ? `${step.subBellTracks.filter(track => track.enabled && (track.repeatEnabled || track.randomRepeat)).length} active · Independent timing` : step.subBellsEnabled ? `${step.subBellTracks.filter(track => track.enabled).length} active · ${step.subBellTracks.length} configured` : step.subBellTracks.length ? 'Off · settings retained' : 'No sub-bells'}</Text></View>
        {noMainInterval ? <Text style={{ color: tokens.textMuted }}>›</Text> : <Toggle value={step.subBellsEnabled} onChange={onSubBellsEnabled} accessibilityLabel="Sub-bells during this interval" />}
      </View>
      {!noMainInterval ? <View pointerEvents="none"><PatternTimelinePreview tracks={tracks} mainDurationSeconds={step.durationSeconds} /></View> : null}
    </View>
  </View>
}

const styles = StyleSheet.create({
  editor: { gap: 14 }, label: { fontSize: 14, fontWeight: '600' }, detail: { fontSize: 12, lineHeight: 17 }, flex: { flex: 1, minWidth: 0 },
  sound: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 12 },
  muteSound: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  card: { borderWidth: 1, borderRadius: 16, padding: 12, gap: 10 }, header: { minHeight: 42, flexDirection: 'row', alignItems: 'center', gap: 10 },
})
