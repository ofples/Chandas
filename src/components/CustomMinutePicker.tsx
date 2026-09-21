import { useRef, useState } from 'react'
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { useTheme } from '../theme/ThemeContext'
import { BottomSheet } from './timer-v2/BottomSheet'
import { formatDurationDraft, parseDurationDigits } from '../lib/time-inputs'

interface Props {
  title: string
  initial: number
  initialSeconds?: number
  secondPrecision?: boolean
  min?: number
  max?: number
  minSeconds?: number
  maxSeconds?: number
  onConfirm: (value: number) => void
  onConfirmSeconds?: (value: number) => void
  onClose: () => void
}

/** Elapsed-duration editor. Deliberately not a clock picker: durations may exceed 24 hours. */
export function CustomMinutePicker({ title, initial, initialSeconds, secondPrecision = false, min = 1, max = 59, minSeconds = min * 60, maxSeconds = max * 60, onConfirm, onConfirmSeconds, onClose }: Props) {
  const { tokens } = useTheme()
  const exact = initialSeconds ?? initial * 60
  const [digits, setDigits] = useState(durationDigits(exact, secondPrecision))
  const [error, setError] = useState<string | null>(null)
  const confirmingRef = useRef(false)

  const handleConfirm = () => {
    if (confirmingRef.current) return
    const parsedSeconds = parseDurationDigits(digits, secondPrecision)
    const totalSeconds = parsedSeconds === null ? null : parsedSeconds + (!secondPrecision && onConfirmSeconds ? exact % 60 : 0)
    if (totalSeconds === null || totalSeconds < minSeconds || totalSeconds > maxSeconds) {
      setError(`Choose a duration between ${formatDuration(minSeconds)} and ${formatDuration(maxSeconds)}.`)
      return
    }
    confirmingRef.current = true
    if (secondPrecision && onConfirmSeconds) {
      onConfirmSeconds(totalSeconds)
      return
    }
    const totalMinutes = Math.floor(totalSeconds / 60)
    onConfirm(Math.max(min, Math.min(max, totalMinutes)))
  }

  return <BottomSheet visible title={title} help={`Type the duration from right to left${secondPrecision ? ': seconds, then minutes, then hours' : ': minutes, then hours'}.`} onClose={onClose} scroll={false}>
    <View style={styles.fieldWrap}>
      <TextInput autoFocus value={formatDurationDraft(digits, secondPrecision)} onChangeText={text => { setError(null); setDigits(text.replace(/\D/g, '').replace(/^0+(?=\d)/, '').slice(0, 7)) }} keyboardType="number-pad" selectTextOnFocus maxLength={9} returnKeyType="done" onSubmitEditing={handleConfirm} style={[styles.input, { backgroundColor: tokens.surfaceHi, borderColor: error ? tokens.warm : tokens.border, color: tokens.text }]} accessibilityLabel={secondPrecision ? 'Duration in hours minutes and seconds' : 'Duration in hours and minutes'} />
      <Text style={[styles.label, { color: tokens.textMuted }]}>{secondPrecision ? 'HOURS : MINUTES : SECONDS' : 'HOURS : MINUTES'}</Text>
    </View>
    {error ? <Text accessibilityRole="alert" style={[styles.error, { color: tokens.warm }]}>{error}</Text> : null}
    <Pressable onPressIn={handleConfirm} onPress={handleConfirm} accessibilityRole="button" accessibilityLabel={`Set ${title}`} style={({ pressed }) => [styles.confirm, { backgroundColor: tokens.accent, opacity: pressed ? 0.76 : 1 }]}><Text style={styles.confirmLabel}>Set duration</Text></Pressable>
  </BottomSheet>
}

function durationDigits(seconds: number, secondPrecision: boolean): string {
  const hours = Math.floor(seconds / 3_600)
  const minutes = Math.floor(seconds % 3_600 / 60)
  const remainder = Math.floor(seconds % 60)
  if (secondPrecision) return `${hours || ''}${hours ? String(minutes).padStart(2, '0') : minutes || ''}${hours || minutes ? String(remainder).padStart(2, '0') : remainder || 0}`
  return `${hours || ''}${hours ? String(minutes).padStart(2, '0') : minutes || 0}`
}

function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3_600)
  const minutes = Math.floor(seconds % 3_600 / 60)
  const remainder = seconds % 60
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}` : `${minutes}:${String(remainder).padStart(2, '0')}`
}

const styles = StyleSheet.create({
  fieldWrap: { alignItems: 'center', gap: 7, paddingVertical: 4 },
  input: { width: '100%', minHeight: 66, borderWidth: 1.5, borderRadius: 14, fontFamily: 'JetBrainsMono-Regular', fontSize: 30, paddingHorizontal: 14, textAlign: 'center', fontVariant: ['tabular-nums'] },
  label: { fontSize: 9, fontWeight: '700', letterSpacing: 1 },
  error: { fontSize: 12, lineHeight: 17, textAlign: 'center' },
  confirm: { minHeight: 48, borderRadius: 99, alignItems: 'center', justifyContent: 'center' },
  confirmLabel: { color: '#fff', fontSize: 14, fontWeight: '700' },
})
