import { TourTarget } from './guided-tour'
import { useState, type ReactNode } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import type { SubBellColorId, UnifiedTimerStep } from '../../types'
import { MAX_CUE_DURATION_SECONDS } from '../../lib/timerV2'
import { useTheme } from '../../theme/ThemeContext'
import { Toggle } from '../Toggle'
import { DurationSelector } from './DurationSelector'
import { SoundName } from './SoundName'
import { PatternTimelinePreview } from './PatternTimelinePreview'
import { subBellColorValue } from '../../lib/subBellColors'
import { ColorSelector } from './ColorSelector'
import { DraggableSheet } from './DraggableSheet'
import { SheetTextButton } from './SheetTextButton'

/** The same interval controls, whether edited on the page or inside a step sheet. */
export function UnifiedIntervalEditor({ step, automaticColor, secondPrecision, onDuration, onColor, onSound, onSubBells, onSubBellsEnabled, controls, noMainInterval = false, onInfinity, isStep = false }: {
  step: UnifiedTimerStep; secondPrecision: boolean; onDuration: (seconds: number) => void;
  automaticColor: SubBellColorId; onColor: (color: SubBellColorId | undefined) => void;
  onSound: () => void; onSubBells: () => void; onSubBellsEnabled: (enabled: boolean) => void; controls: ReactNode
  noMainInterval?: boolean; onInfinity?: () => void; isStep?: boolean
}) {
  const { tokens, theme } = useTheme()
  const [colorOpen, setColorOpen] = useState(false)
  const color = step.color ?? automaticColor
  const stroke = theme === 'eink' ? tokens.accent : subBellColorValue(color, 0)
  const intervalLabel = isStep ? 'Step interval' : 'Main interval'
  const tracks = (step.subBellsEnabled ? step.subBellTracks : []).map(track => ({ ...track, cadenceMinutes: Math.max(1, Math.ceil(track.cadenceSeconds / 60)), selectedOffsetsMinutes: track.selectedOffsetsSeconds.map(offset => Math.ceil(offset / 60)) }))
  return <View style={styles.editor}>
    <View style={styles.header}>
      <Text style={[styles.label, styles.flex, { color: tokens.text }]}>{intervalLabel}</Text>
      {!noMainInterval ? <Pressable accessibilityRole="button" accessibilityLabel={`${intervalLabel} color`} onPress={() => setColorOpen(true)} style={[styles.colorButton, { borderColor: tokens.border }]}><View style={[styles.swatch, { backgroundColor: stroke }]} /></Pressable> : null}
    </View>
    <TourTarget id="tour-duration"><View testID="unified-main-duration"><DurationSelector value={Math.ceil(step.durationSeconds / 60)} valueSeconds={step.durationSeconds} secondPrecision={secondPrecision} presets={[5, 10, 15, 30, 45, 60]} minSeconds={1} maxSeconds={MAX_CUE_DURATION_SECONDS} onChange={minutes => onDuration(Math.min(MAX_CUE_DURATION_SECONDS, minutes * 60))} onChangeSeconds={onDuration} infinite={noMainInterval} onInfinity={onInfinity} /></View></TourTarget>
    {noMainInterval ? <View style={styles.sound} accessibilityLabel="At the end, no main interval">
      <View><Text style={[styles.label, { color: tokens.textMuted }]}>At the end</Text><Text style={[styles.detail, { color: tokens.textMuted }]}>No main interval</Text></View>
    </View> : <Pressable testID="unified-main-sound" accessibilityRole="button" accessibilityLabel={`Choose ${isStep ? 'step' : 'main'} interval sound`} onPress={onSound} style={styles.sound}>
      <View style={styles.flex}><Text style={[styles.label, { color: tokens.text }]}>At the end</Text>{step.endCue.soundMuted || step.endCue.volume === 0 ? <Text style={[styles.detail, { color: tokens.textMuted }]}>Silent</Text> : <SoundName cue={step.endCue} style={styles.detail} />}</View><Text style={{ color: tokens.textMuted }}>›</Text>
    </Pressable>}
    {controls}
    <TourTarget id="tour-bells"><View style={[styles.card, { backgroundColor: tokens.surface, borderColor: tokens.border }]}>
      <Pressable testID="unified-open-subbells" accessibilityRole="button" accessibilityLabel="Configure sub-bells" onPress={onSubBells} style={StyleSheet.absoluteFill} />
      <View pointerEvents="box-none" style={styles.header}>
        <View pointerEvents="none" style={styles.flex}><Text style={[styles.label, { color: tokens.text }]}>Sub-bells</Text><Text style={[styles.detail, { color: tokens.textMuted }]}>{noMainInterval ? `${step.subBellTracks.filter(track => track.enabled && (track.repeatEnabled || track.randomRepeat)).length} active · Independent timing` : step.subBellsEnabled ? `${step.subBellTracks.filter(track => track.enabled).length} active · ${step.subBellTracks.length} configured` : step.subBellTracks.length ? 'Off · settings retained' : 'No sub-bells'}</Text></View>
        {noMainInterval ? <Text style={{ color: tokens.textMuted }}>›</Text> : <Toggle value={step.subBellsEnabled} onChange={onSubBellsEnabled} accessibilityLabel="Sub-bells during this interval" />}
      </View>
      {!noMainInterval ? <View pointerEvents="none"><PatternTimelinePreview tracks={tracks} mainDurationSeconds={step.durationSeconds} boundaryColor={stroke} /></View> : null}
    </View></TourTarget>
    <DraggableSheet visible={colorOpen && !noMainInterval} title={`${intervalLabel} color`} presentation="center" fitContent onClose={() => setColorOpen(false)}>
      <ColorSelector paletteOnly accessibilityLabel={`${intervalLabel} color`} value={color} onChange={value => { onColor(value); setColorOpen(false) }} />
      {step.color ? <SheetTextButton label="Use automatic color" onPress={() => { onColor(undefined); setColorOpen(false) }} /> : null}
    </DraggableSheet>
  </View>
}

const styles = StyleSheet.create({
  editor: { gap: 14 }, label: { fontSize: 14, fontWeight: '600' }, detail: { fontSize: 12, lineHeight: 17 }, flex: { flex: 1, minWidth: 0 },
  sound: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 12 },
  colorButton: { width: 44, height: 44, borderWidth: 1, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  swatch: { width: 17, height: 17, borderRadius: 9 },
  card: { borderWidth: 1, borderRadius: 16, padding: 12, gap: 10 }, header: { minHeight: 42, flexDirection: 'row', alignItems: 'center', gap: 10 },
})
