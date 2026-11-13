import { useAppReducedMotion } from '../../theme/ThemeContext'
import { useEffect, useState } from 'react'
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import Animated, { FadeInDown, FadeOut, LinearTransition } from 'react-native-reanimated'
import type { RunPolicy, TimerMode } from '../../types'
import { MAX_RUN_CYCLES, MAX_RUN_DURATION_SECONDS } from '../../lib/timerV2'
import { useTheme } from '../../theme/ThemeContext'
import { SegmentedControl } from './SegmentedControl'
import { tapHaptic } from '../../lib/haptics'
import { runLengthSummary } from '../../lib/run-length-summary'
import { ClockTimeInput } from './ClockTimeInput'
import { CustomMinutePicker } from '../CustomMinutePicker'

interface Props {
  mode: TimerMode
  value: RunPolicy
  cycleDurationSeconds: number
  rounds?: boolean
  secondPrecision?: boolean
  allowUntil?: boolean
  allowCycles?: boolean
  onChange: (value: RunPolicy) => void
}

const choices = [
  { value: 'continuous', label: 'Continuous', weight: 1.45 },
  { value: 'cycles', label: 'Cycles' },
  { value: 'duration', label: 'Duration' },
  { value: 'until', label: 'Until' },
] as const

export function RunLengthConfig({ mode, rounds = mode === 'sequence', value, cycleDurationSeconds, secondPrecision = false, allowUntil = false, allowCycles = true, onChange }: Props) {
  const { tokens } = useTheme()
  const reducedMotion = useAppReducedMotion()
  const summary = runLengthSummary(mode, value, cycleDurationSeconds, rounds)

  return <View style={styles.section}>
    <Text accessibilityLiveRegion="polite" style={[styles.summary, { color: tokens.textMuted }]}>{summary}</Text>
    <SegmentedControl items={choices.filter(choice => (allowUntil || choice.value !== 'until' || value.kind === 'until') && (allowCycles || choice.value !== 'cycles')).map(choice => choice.value === 'cycles' && rounds ? { ...choice, label: 'Rounds' } : choice)} value={value.kind} onChange={kind => {
      const now = new Date()
      onChange({ ...value, kind, ...(kind === 'until' ? { untilMinutes: value.untilMinutes ?? (now.getHours() * 60 + now.getMinutes() + 60) % 1440 } : {}) })
    }} accessibilityLabel="Run length" />
    {value.kind !== 'continuous' ? <Animated.View entering={reducedMotion ? undefined : FadeInDown.duration(170)} exiting={reducedMotion ? undefined : FadeOut.duration(110)} layout={reducedMotion ? undefined : LinearTransition.duration(150)}>
      {value.kind === 'cycles'
        ? <View style={styles.cycleRow}><View style={styles.valueRow}><StepButton label={rounds ? 'Decrease rounds' : 'Decrease cycles'} glyph="−" disabled={value.cycleCount <= 1} onPress={() => onChange({ ...value, cycleCount: value.cycleCount - 1 })} /><NumberField label={rounds ? 'Rounds' : 'Cycles'} value={value.cycleCount} max={MAX_RUN_CYCLES} onCommit={cycleCount => onChange({ ...value, cycleCount })} hideLabel /><StepButton label={rounds ? 'Increase rounds' : 'Increase cycles'} glyph="+" disabled={value.cycleCount >= MAX_RUN_CYCLES} onPress={() => onChange({ ...value, cycleCount: value.cycleCount + 1 })} /></View></View>
        : value.kind === 'until'
          ? <ClockTimeInput value={value.untilMinutes ?? 0} onChange={untilMinutes => onChange({ ...value, untilMinutes })} accessibilityLabel="Stop at local time" />
          : <DurationFields seconds={value.durationSeconds} secondPrecision={secondPrecision} onChange={durationSeconds => onChange({ ...value, durationSeconds })} />}
    </Animated.View> : null}
  </View>
}

function DurationFields({ seconds, secondPrecision, onChange }: { seconds: number; secondPrecision: boolean; onChange: (seconds: number) => void }) {
  const { tokens } = useTheme()
  const [open, setOpen] = useState(false)
  const precise = secondPrecision
  const minutes = Math.floor(seconds / 60)
  const display = precise ? formatDuration(seconds) : `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`
  const commit = (value: number) => { onChange(value); setOpen(false) }
  return <>
    <Pressable accessibilityRole="button" accessibilityLabel={`Run duration, ${display}`} onPress={() => setOpen(true)} style={[styles.durationButton, { borderColor: tokens.border }]}><Text style={[styles.durationValue, { color: tokens.text }]}>{display}</Text></Pressable>
    {open ? <CustomMinutePicker title="Run duration" initial={minutes} initialSeconds={seconds} secondPrecision={precise} max={Math.floor(MAX_RUN_DURATION_SECONDS / 60)} minSeconds={precise ? 1 : 60} maxSeconds={MAX_RUN_DURATION_SECONDS} onConfirm={value => commit(value * 60)} onConfirmSeconds={precise ? commit : undefined} onClose={() => setOpen(false)} /> : null}
  </>
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
  const { tokens, theme } = useTheme()
  return <Pressable disabled={disabled} onPress={() => { tapHaptic(); onPress() }} accessibilityRole="button" accessibilityLabel={label} style={({ pressed }) => [styles.step, { borderColor: tokens.border, backgroundColor: theme === 'eink' && disabled ? tokens.surfaceHi : 'transparent', opacity: theme === 'eink' ? 1 : disabled ? 0.35 : pressed ? 0.65 : 1 }]}><Text style={[styles.stepGlyph, { color: theme === 'eink' && disabled ? tokens.textDisabled : tokens.accent }]}>{glyph}</Text></Pressable>
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
  durationButton: { minHeight: 44, alignSelf: 'center', justifyContent: 'center', borderWidth: 1.5, borderRadius: 12, paddingHorizontal: 16 }, durationValue: { fontFamily: 'JetBrainsMono-Regular', fontSize: 19 }, fieldWrap: { alignItems: 'center', gap: 5 }, field: { width: 70, minHeight: 44, borderWidth: 1.5, borderRadius: 12, textAlign: 'center', fontFamily: 'JetBrainsMono-Regular', fontSize: 19, fontVariant: ['tabular-nums'], paddingHorizontal: 5 }, fieldLabel: { fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.6 },
})
