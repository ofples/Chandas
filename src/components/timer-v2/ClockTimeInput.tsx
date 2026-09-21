import { useEffect, useRef, useState } from 'react'
import { StyleSheet, Text, TextInput, View } from 'react-native'
import { useTheme } from '../../theme/ThemeContext'

export function formatClockTime(minutes: number): string {
  const value = ((Math.round(minutes) % 1_440) + 1_440) % 1_440
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`
}

/** Right-filled clock entry: 2, 22, 2:20, 22:00. */
export function formatClockDraft(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 4)
  if (digits.length <= 2) return digits
  return digits.length === 3 ? `${digits[0]}:${digits.slice(1)}` : `${digits.slice(0, 2)}:${digits.slice(2)}`
}

export function parseClockDraft(value: string): number | null {
  const digits = value.replace(/\D/g, '')
  if (digits.length === 0 || digits.length > 4) return null
  // One/two digits are a right-filled minute draft, matching the live entry
  // sequence while avoiding surprising conversion to an hour.
  if (digits.length <= 2) return Number(digits) <= 59 ? Number(digits) : null
  const hours = Number(digits.slice(0, -2))
  const minutes = Number(digits.slice(-2))
  return hours <= 23 && minutes <= 59 ? hours * 60 + minutes : null
}

interface Props {
  value: number
  onChange: (value: number) => void
  accessibilityLabel: string
  autoFocus?: boolean
  style?: object
}

export function ClockTimeInput({ value, onChange, accessibilityLabel, autoFocus, style }: Props) {
  const { tokens } = useTheme()
  const [draft, setDraft] = useState(formatClockTime(value))
  const [focused, setFocused] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const lastValid = useRef(value)
  useEffect(() => { if (!focused) { lastValid.current = value; setDraft(formatClockTime(value)) } }, [focused, value])
  const commit = () => {
    const parsed = parseClockDraft(draft)
    setFocused(false)
    if (parsed === null) { setDraft(formatClockTime(lastValid.current)); setError('Enter a valid 24-hour time.') }
    else { setError(null); lastValid.current = parsed; onChange(parsed); setDraft(formatClockTime(parsed)) }
  }
  return <View style={styles.wrap}><TextInput
    value={focused ? draft : formatClockTime(value)}
    onFocus={() => { setError(null); setFocused(true); setDraft(formatClockDraft(formatClockTime(value))) }}
    onChangeText={text => { setError(null); setDraft(formatClockDraft(text)) }}
    onBlur={commit}
    onSubmitEditing={commit}
    selectTextOnFocus
    autoFocus={autoFocus}
    keyboardType="number-pad"
    returnKeyType="done"
    maxLength={5}
    accessibilityLabel={accessibilityLabel}
    style={[styles.input, { color: tokens.text, borderColor: error ? tokens.warm : focused ? tokens.accent : tokens.border }, style]}
  />{error ? <Text accessibilityRole="alert" style={[styles.error, { color: tokens.warm }]}>{error}</Text> : null}</View>
}

const styles = StyleSheet.create({
  wrap: { width: '100%', gap: 4 },
  input: { width: '100%', minHeight: 44, borderWidth: 1.5, borderRadius: 12, textAlign: 'center', paddingHorizontal: 12, paddingVertical: 10, fontFamily: 'JetBrainsMono-Regular', fontSize: 14, fontVariant: ['tabular-nums'] },
  error: { fontSize: 11, lineHeight: 15 },
})
