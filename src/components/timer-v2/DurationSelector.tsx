import { useEffect, useState } from 'react'
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { Chip } from '../Chip'
import { useTheme } from '../../theme/ThemeContext'
import { FadedHorizontalScrollView } from './FadedHorizontalScrollView'
import { SheetSectionTitle } from './SheetSectionTitle'
import { formatCompactDurationSeconds } from '../../lib/timerV2'

interface Props {
  value: number
  valueSeconds?: number
  secondPrecision?: boolean
  presets: readonly number[]
  onChange: (minutes: number) => void
  onChangeSeconds?: (seconds: number) => void
  label?: string
  min?: number
  max?: number
  compact?: boolean
  fadeColor?: string
}

export function DurationSelector({ value, valueSeconds, secondPrecision = false, presets, onChange, onChangeSeconds, label, min = 1, max = 240, compact = false, fadeColor }: Props) {
  const { tokens } = useTheme()
  const [customOpen, setCustomOpen] = useState(false)
  const exactSeconds = valueSeconds ?? value * 60
  const isPreset = presets.some(minutes => minutes * 60 === exactSeconds)
  const chooseSeconds = (seconds: number) => onChangeSeconds ? onChangeSeconds(seconds) : onChange(Math.ceil(seconds / 60))
  const choices = isPreset
    ? presets.map(minutes => ({ seconds: minutes * 60, label: `${minutes}m` }))
    : [{ seconds: exactSeconds, label: formatCompactDurationSeconds(exactSeconds) }, ...presets.map(minutes => ({ seconds: minutes * 60, label: `${minutes}m` }))]
  return (
    <View style={styles.wrap}>
      {label ? <SheetSectionTitle>{label}</SheetSectionTitle> : null}
      <View style={styles.choiceRow}>
        <View style={styles.scrollSlot}>
          <FadedHorizontalScrollView fadeColor={fadeColor ?? tokens.surface} style={styles.scroller} contentContainerStyle={styles.presets}>
            {choices.map(choice => <Chip key={choice.seconds} label={choice.label} active={exactSeconds === choice.seconds} onPress={() => chooseSeconds(choice.seconds)} compact={compact} />)}
          </FadedHorizontalScrollView>
        </View>
        <Chip
          label="Custom"
          active={customOpen}
          onPress={() => setCustomOpen(open => !open)}
          compact={compact}
          accessibilityLabel="Edit custom duration"
        />
      </View>
      {customOpen ? <InlineDurationFields valueSeconds={exactSeconds} secondPrecision={secondPrecision} minSeconds={min === 1 ? 1 : min * 60} maxSeconds={max * 60} onConfirm={seconds => { chooseSeconds(seconds); setCustomOpen(false) }} /> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { gap: 9 },
  choiceRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  scrollSlot: { flex: 1, minWidth: 0, position: 'relative' },
  scroller: { flex: 1, minWidth: 0 },
  presets: { gap: 8, paddingRight: 30 },
  inlineDuration: { gap: 10, borderWidth: 1, borderRadius: 14, padding: 12 }, durationFields: { flexDirection: 'row', justifyContent: 'center', alignItems: 'flex-start', gap: 8 }, durationField: { alignItems: 'center', gap: 4 }, durationInput: { width: 74, minHeight: 44, borderWidth: 1.5, borderRadius: 10, textAlign: 'center', fontFamily: 'JetBrainsMono-Regular', fontSize: 17, fontVariant: ['tabular-nums'] }, durationLabel: { fontSize: 9, fontWeight: '700', letterSpacing: 0.8 }, colon: { fontFamily: 'JetBrainsMono-Regular', fontSize: 21, paddingTop: 10 }, save: { minHeight: 42, borderRadius: 21, justifyContent: 'center', alignItems: 'center' }, saveLabel: { color: '#fff', fontSize: 13, fontWeight: '700' }, error: { fontSize: 12, lineHeight: 16 },
})

function InlineDurationFields({ valueSeconds, secondPrecision, minSeconds, maxSeconds, onConfirm }: { valueSeconds: number; secondPrecision: boolean; minSeconds: number; maxSeconds: number; onConfirm: (seconds: number) => void }) {
  const { tokens } = useTheme()
  const [hours, setHours] = useState(String(Math.floor(valueSeconds / 3_600)))
  const [minutes, setMinutes] = useState(String(Math.floor(valueSeconds % 3_600 / 60)))
  const [seconds, setSeconds] = useState(String(valueSeconds % 60))
  const [error, setError] = useState<string | null>(null)
  useEffect(() => { setHours(String(Math.floor(valueSeconds / 3_600))); setMinutes(String(Math.floor(valueSeconds % 3_600 / 60))); setSeconds(String(valueSeconds % 60)) }, [valueSeconds])
  const digits = (set: (value: string) => void, maxLength: number) => (text: string) => set(text.replace(/\D/g, '').slice(0, maxLength))
  const save = () => {
    const hour = Number(hours || 0), minute = Number(minutes || 0), second = Number(seconds || 0)
    if (minute > 59 || second > 59) { setError('Minutes and seconds must be between 0 and 59.'); return }
    const total = hour * 3_600 + minute * 60 + (secondPrecision ? second : 0)
    if (total < minSeconds || total > maxSeconds) { setError(`Choose a duration between ${formatCompactDurationSeconds(minSeconds)} and ${formatCompactDurationSeconds(maxSeconds)}.`); return }
    onConfirm(total)
  }
  const field = (label: string, fieldValue: string, onChange: (text: string) => void, autoFocus = false) => <View style={styles.durationField}><TextInput value={fieldValue} onChangeText={onChange} autoFocus={autoFocus} keyboardType="number-pad" selectTextOnFocus maxLength={label === 'Hours' ? 3 : 2} accessibilityLabel={label} style={[styles.durationInput, { color: tokens.text, borderColor: tokens.border, backgroundColor: tokens.surface }]} /><Text style={[styles.durationLabel, { color: tokens.textMuted }]}>{label}</Text></View>
  return <View style={[styles.inlineDuration, { borderColor: tokens.border, backgroundColor: tokens.surfaceHi }]}><View style={styles.durationFields}>{field('Hours', hours, digits(setHours, 3), true)}<Text style={[styles.colon, { color: tokens.textMuted }]}>:</Text>{field('Minutes', minutes, digits(setMinutes, 2))}{secondPrecision ? <><Text style={[styles.colon, { color: tokens.textMuted }]}>:</Text>{field('Seconds', seconds, digits(setSeconds, 2))}</> : null}</View>{error ? <Text accessibilityRole="alert" style={[styles.error, { color: tokens.warm }]}>{error}</Text> : null}<Pressable onPress={save} accessibilityRole="button" accessibilityLabel="Set custom duration" style={({ pressed }) => [styles.save, { backgroundColor: tokens.accent, opacity: pressed ? 0.76 : 1 }]}><Text style={styles.saveLabel}>Set duration</Text></Pressable></View>
}
