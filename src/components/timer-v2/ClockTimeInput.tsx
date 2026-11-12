import { useState } from 'react'
import { Pressable, StyleSheet, Text } from 'react-native'
import { TimeOfDayPicker } from '../TimeOfDayPicker'
import { useTheme } from '../../theme/ThemeContext'
import { formatClockTime } from '../../lib/time-inputs'

export { formatClockDraft, formatClockTime, parseClockDraft } from '../../lib/time-inputs'

interface Props {
  value: number
  onChange: (value: number) => void
  accessibilityLabel: string
}

export function ClockTimeInput({ value, onChange, accessibilityLabel }: Props) {
  const { tokens } = useTheme()
  const [open, setOpen] = useState(false)
  const time = formatClockTime(value)
  return <>
    <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel} accessibilityValue={{ text: time }} onPress={() => setOpen(true)} style={[styles.input, { borderColor: tokens.border }]}>
      <Text style={[styles.time, { color: tokens.text }]}>{time}</Text>
    </Pressable>
    {open ? <TimeOfDayPicker title={accessibilityLabel} initial={value} onClose={() => setOpen(false)} onConfirm={minutes => { onChange(minutes); setOpen(false) }} /> : null}
  </>
}

const styles = StyleSheet.create({
  input: { width: '100%', minHeight: 44, borderWidth: 1.5, borderRadius: 12, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12, paddingVertical: 10 },
  time: { fontFamily: 'JetBrainsMono-Regular', fontSize: 14, fontVariant: ['tabular-nums'] },
})
