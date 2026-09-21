import { useEffect, useState } from 'react'
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import Animated, { FadeInDown, FadeOut, LinearTransition, useReducedMotion } from 'react-native-reanimated'
import type { RunPolicy, TimerMode } from '../../types'
import { MAX_RUN_CYCLES, MAX_RUN_DURATION_SECONDS } from '../../lib/timerV2'
import { useTheme } from '../../theme/ThemeContext'
import { SegmentedControl } from './SegmentedControl'
import { tapHaptic } from '../../lib/haptics'
import { runLengthSummary } from '../../lib/run-length-summary'

interface Props {
  mode: TimerMode
  value: RunPolicy
  cycleDurationSeconds: number
  secondPrecision?: boolean
  onChange: (value: RunPolicy) => void
}

const choices = [
  { value: 'continuous', label: 'Continuous' },
  { value: 'cycles', label: 'Cycles' },
  { value: 'duration', label: 'Duration' },
] as const

export function RunLengthConfig({ mode, value, cycleDurationSeconds, secondPrecision = false, onChange }: Props) {
  const { tokens } = useTheme()
  const reducedMotion = useReducedMotion()
  const summary = runLengthSummary(mode, value, cycleDurationSeconds)

  return <View style={styles.section}>
    <Text accessibilityLiveRegion="polite" style={[styles.summary, { color: tokens.textMuted }]}>{summary}</Text>
    <SegmentedControl items={choices} value={value.kind} onChange={kind => onChange({ ...value, kind })} accessibilityLabel="Run length" />
    {value.kind !== 'continuous' ? <Animated.View entering={FadeInDown.duration(reducedMotion ? 80 : 170)} exiting={FadeOut.duration(reducedMotion ? 70 : 110)} layout={reducedMotion ? undefined : LinearTransition.duration(150)}>
      {value.kind === 'cycles'
        ? <View style={styles.cycleRow}><View style={styles.valueRow}><StepButton label={mode === 'sequence' ? 'Decrease rounds' : 'Decrease cycles'} glyph="−" disabled={value.cycleCount <= 1} onPress={() => onChange({ ...value, cycleCount: value.cycleCount - 1 })} /><NumberField label={mode === 'sequence' ? 'Rounds' : 'Cycles'} value={value.cycleCount} max={MAX_RUN_CYCLES} onCommit={cycleCount => onChange({ ...value, cycleCount })} hideLabel /><StepButton label={mode === 'sequence' ? 'Increase rounds' : 'Increase cycles'} glyph="+" disabled={value.cycleCount >= MAX_RUN_CYCLES} onPress={() => onChange({ ...value, cycleCount: value.cycleCount + 1 })} /></View></View>
        : <DurationFields seconds={value.durationSeconds} secondPrecision={secondPrecision} onChange={durationSeconds => onChange({ ...value, durationSeconds })} />}
    </Animated.View> : null}
  </View>
}

function DurationFields({ seconds, secondPrecision, onChange }: { seconds: number; secondPrecision: boolean; onChange: (seconds: number) => void }) {
  const normalized = Math.max(1, Math.round(seconds))
  const hours = Math.floor(normalized / 3_600)
  const minutes = Math.floor(normalized % 3_600 / 60)
  const remainder = normalized % 60
  const update = (nextHours: number, nextMinutes: number, nextSeconds = secondPrecision ? remainder : 0) => {
    const total = Math.max(secondPrecision ? 1 : 60, Math.min(MAX_RUN_DURATION_SECONDS, nextHours * 3_600 + nextMinutes * 60 + nextSeconds))
    onChange(total)
  }
  return <View style={styles.durationRow}>
    <NumberField label="Hours" value={hours} max={359} onCommit={value => update(value, minutes)} />
    <Text style={styles.colon}>:</Text>
    <NumberField label="Minutes" value={minutes} max={59} onCommit={value => update(hours, value)} />
    {secondPrecision ? <><Text style={styles.colon}>:</Text><NumberField label="Seconds" value={remainder} max={59} onCommit={value => update(hours, minutes, value)} /></> : null}
  </View>
}

function NumberField({ label, value, max, onCommit, hideLabel = false }: { label: string; value: number; max: number; onCommit: (value: number) => void; hideLabel?: boolean }) {
  const { tokens } = useTheme()
  const [draft, setDraft] = useState(String(value))
  useEffect(() => setDraft(String(value)), [value])
  const commit = () => {
    const parsed = Number.parseInt(draft, 10)
    const next = Number.isFinite(parsed) ? Math.max(label === 'Rounds' || label === 'Cycles' ? 1 : 0, Math.min(max, parsed)) : value
    onCommit(next)
    setDraft(String(next))
  }
  return <View style={styles.fieldWrap}><TextInput value={draft} onChangeText={text => setDraft(text.replace(/\D/g, '').slice(0, 3))} onBlur={commit} onSubmitEditing={commit} keyboardType="number-pad" selectTextOnFocus accessibilityLabel={label} style={[styles.field, { color: tokens.text, borderColor: tokens.border, backgroundColor: tokens.surface }]} />{hideLabel ? null : <Text style={[styles.fieldLabel, { color: tokens.textMuted }]}>{label}</Text>}</View>
}

function StepButton({ label, glyph, disabled, onPress }: { label: string; glyph: string; disabled: boolean; onPress: () => void }) {
  const { tokens } = useTheme()
  return <Pressable disabled={disabled} onPress={() => { tapHaptic(); onPress() }} accessibilityRole="button" accessibilityLabel={label} style={({ pressed }) => [styles.step, { borderColor: tokens.border, opacity: disabled ? 0.35 : pressed ? 0.65 : 1 }]}><Text style={[styles.stepGlyph, { color: tokens.accent }]}>{glyph}</Text></Pressable>
}

export function formatDuration(seconds: number): string {
  const normalized = Math.max(0, Math.round(seconds))
  const hours = Math.floor(normalized / 3_600)
  const minutes = Math.floor(normalized % 3_600 / 60)
  const rest = normalized % 60
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}` : `${minutes}:${String(rest).padStart(2, '0')}`
}

const styles = StyleSheet.create({
  section: { gap: 10 }, summary: { fontSize: 12, lineHeight: 17 },
  cycleRow: { alignItems: 'center' }, valueRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12 }, step: { width: 44, height: 44, borderWidth: 1.5, borderRadius: 22, alignItems: 'center', justifyContent: 'center' }, stepGlyph: { fontSize: 22, lineHeight: 24, textAlignVertical: 'center' },
  durationRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'center', gap: 8 }, colon: { fontFamily: 'JetBrainsMono-Regular', fontSize: 24, paddingTop: 8 }, fieldWrap: { alignItems: 'center', gap: 5 }, field: { width: 70, minHeight: 44, borderWidth: 1.5, borderRadius: 12, textAlign: 'center', fontFamily: 'JetBrainsMono-Regular', fontSize: 19, fontVariant: ['tabular-nums'], paddingHorizontal: 5 }, fieldLabel: { fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.6 },
})
