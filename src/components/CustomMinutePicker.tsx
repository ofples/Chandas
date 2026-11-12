import { useRef, useState } from 'react'
import { Pressable, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native'
import { useTheme } from '../theme/ThemeContext'
import { BottomSheet } from './timer-v2/BottomSheet'
import { formatClockTime, formatDurationDraft, parseClockDraft, parseDurationDigits } from '../lib/time-inputs'

interface Props {
  title: string
  initial: number
  initialSeconds?: number
  secondPrecision?: boolean
  clockTime?: boolean
  min?: number
  max?: number
  minSeconds?: number
  maxSeconds?: number
  onConfirm: (value: number) => void
  onConfirmSeconds?: (value: number) => void
  onClose: () => void
}

/** Shared keypad for elapsed durations and 24-hour clock times. */
export function CustomMinutePicker({ title, initial, initialSeconds, secondPrecision = false, clockTime = false, min = 1, max = 59, minSeconds = min * 60, maxSeconds = max * 60, onConfirm, onConfirmSeconds, onClose }: Props) {
  const { tokens } = useTheme()
  const { height: windowHeight } = useWindowDimensions()
  const exact = initialSeconds ?? initial * 60
  const [digits, setDigits] = useState(clockTime ? formatClockTime(initial).replace(':', '') : durationDigits(exact, secondPrecision))
  const [error, setError] = useState<string | null>(null)
  const firstKeyRef = useRef(true)
  const confirmingRef = useRef(false)

  const pressDigit = (key: string) => {
    setError(null)
    const replace = firstKeyRef.current
    firstKeyRef.current = false
    setDigits(current => {
      const next = `${replace ? '' : current}${key}`
      return clockTime ? next.slice(0, 4) : next.replace(/^0+(?=\d)/, '').slice(0, 7)
    })
  }
  const backspace = () => {
    setError(null)
    firstKeyRef.current = false
    setDigits(current => current.slice(0, -1))
  }
  const handleHardwareKey = (event: { nativeEvent: { key: string } }) => {
    const key = event.nativeEvent.key
    if (/^\d$/.test(key)) pressDigit(key)
    else if (key === 'Backspace' || key === 'Delete') backspace()
    else if (key === 'Enter') handleConfirm()
  }

  const handleConfirm = () => {
    if (confirmingRef.current) return
    if (clockTime) {
      const minutes = parseClockDraft(digits)
      if (minutes === null) { setError('Enter a time from 00:00 to 23:59.'); return }
      confirmingRef.current = true
      onConfirm(minutes)
      return
    }
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

  const display = clockTime ? digits.padStart(4, '0').replace(/^(..)/, '$1:') : formatDurationDraft(digits, secondPrecision)
  return <BottomSheet visible title={title} help={clockTime ? 'Enter a 24-hour time.' : `Enter digits from right to left${secondPrecision ? ': seconds, then minutes, then hours' : ': minutes, then hours'}.`} onClose={onClose} initialSnap="full">
    <View style={styles.fieldWrap}>
      <TextInput testID={clockTime ? 'clock-keypad-value' : 'duration-keypad-value'} value={display} onChangeText={() => undefined} showSoftInputOnFocus={false} inputMode="none" autoFocus blurOnSubmit={false} onKeyPress={handleHardwareKey} caretHidden style={[styles.input, { backgroundColor: tokens.surfaceHi, borderColor: error ? tokens.warm : tokens.border, color: tokens.text }]} accessibilityLabel={clockTime ? '24-hour time' : secondPrecision ? 'Duration in hours minutes and seconds' : 'Duration in hours and minutes'} />
      <Text style={[styles.label, { color: tokens.textMuted }]}>{secondPrecision ? 'HOURS : MINUTES : SECONDS' : 'HOURS : MINUTES'}</Text>
    </View>
    {error ? <Text accessibilityRole="alert" style={[styles.error, { color: tokens.warm }]}>{error}</Text> : null}
    <View testID="duration-keypad" style={styles.keypad} accessibilityRole="none">{[['1','2','3'],['4','5','6'],['7','8','9'],['00','0','⌫']].map((row, rowIndex) => <View key={rowIndex} style={styles.keyRow}>{row.map(key => <Pressable key={key} testID={`duration-key-${key === '⌫' ? 'backspace' : key}`} onPress={() => key === '⌫' ? backspace() : pressDigit(key)} accessibilityRole="button" accessibilityLabel={key === '⌫' ? 'Backspace' : key === '00' ? 'Double zero' : key} style={({ pressed }) => [styles.key, { height: Math.max(44, Math.min(58, (windowHeight - 392) / 4)), backgroundColor: tokens.surfaceHi, borderColor: tokens.border, opacity: pressed ? 0.7 : 1 }]}><Text style={[styles.keyLabel, { color: tokens.text }]}>{key}</Text></Pressable>)}</View>)}</View>
    <Pressable onPressIn={handleConfirm} onPress={handleConfirm} accessibilityRole="button" accessibilityLabel={`Set ${title.replace(/^set\s+/i, '')}`} style={({ pressed }) => [styles.confirm, { backgroundColor: tokens.accent, opacity: pressed ? 0.76 : 1 }]}><Text style={styles.confirmLabel}>{clockTime ? 'Set time' : 'Set duration'}</Text></Pressable>
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
  keypad: { gap: 9, width: '100%', maxWidth: 390, alignSelf: 'center' },
  keyRow: { flexDirection: 'row', gap: 9 },
  key: { flex: 1, height: 58, borderWidth: 1, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  keyLabel: { fontSize: 22, fontWeight: '600', fontVariant: ['tabular-nums'] },
  label: { fontSize: 9, fontWeight: '700', letterSpacing: 1 },
  error: { fontSize: 12, lineHeight: 17, textAlign: 'center' },
  confirm: { minHeight: 48, borderRadius: 99, alignItems: 'center', justifyContent: 'center' },
  confirmLabel: { color: '#fff', fontSize: 14, fontWeight: '700' },
})
