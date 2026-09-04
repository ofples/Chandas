import { useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { Chip } from '../Chip'
import { CustomMinutePicker } from '../CustomMinutePicker'
import { useTheme } from '../../theme/ThemeContext'

interface Props {
  value: number
  presets: readonly number[]
  onChange: (minutes: number) => void
  label?: string
  min?: number
  max?: number
  compact?: boolean
}

export function DurationSelector({ value, presets, onChange, label, min = 1, max = 240, compact = false }: Props) {
  const { tokens } = useTheme()
  const [customOpen, setCustomOpen] = useState(false)
  const isPreset = presets.includes(value)
  return (
    <View style={styles.wrap}>
      {label ? <Text style={[styles.label, { color: tokens.textMuted }]}>{label}</Text> : null}
      <View style={styles.chips}>
        {presets.map(minutes => <Chip key={minutes} label={`${minutes}m`} active={value === minutes} onPress={() => onChange(minutes)} compact={compact} />)}
        <Chip
          label={isPreset ? 'Custom' : `${value}m  ✎`}
          active={!isPreset}
          onPress={() => setCustomOpen(true)}
          compact={compact}
          accessibilityLabel={isPreset ? 'Choose a custom duration' : `Edit custom duration, ${value} minutes`}
        />
      </View>
      {customOpen ? <CustomMinutePicker title={label ?? 'Custom duration'} initial={value} min={min} max={max} onConfirm={minutes => { onChange(minutes); setCustomOpen(false) }} onClose={() => setCustomOpen(false)} /> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { gap: 9 },
  label: { fontSize: 11, fontWeight: '700', letterSpacing: 1.25 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
})
