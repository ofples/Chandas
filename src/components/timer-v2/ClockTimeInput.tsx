import { useEffect, useRef, useState } from 'react'
import { StyleSheet, Text, TextInput, View } from 'react-native'
import { useTheme } from '../../theme/ThemeContext'
import { formatClockDraft, formatClockTime, parseClockDraft } from '../../lib/time-inputs'

export { formatClockDraft, formatClockTime, parseClockDraft } from '../../lib/time-inputs'

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
  const changeDraft = (text: string) => {
    const next = formatClockDraft(text)
    const parsed = parseClockDraft(next)
    if (next.replace(/\D/g, '').length >= 3 && parsed === null) {
      setError('Enter a valid 24-hour time.')
      return
    }
    setError(null)
    setDraft(next)
    if (parsed !== null) {
      lastValid.current = parsed
      onChange(parsed)
    }
  }
  return <View style={styles.wrap}><TextInput
    value={focused ? draft : formatClockTime(value)}
    onFocus={() => { setError(null); setFocused(true); setDraft(formatClockDraft(formatClockTime(value))) }}
    onChangeText={changeDraft}
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
