import { useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { useTheme } from '../theme/ThemeContext'
import { Chip } from './Chip'
import { Toggle } from './Toggle'
import { CustomMinutePicker } from './CustomMinutePicker'

interface Props {
  label: string
  value: number
  presets: number[]
  onChange: (v: number) => void
  disabledAbove?: number
  pickerTitle?: string
  pickerMin?: number
  pickerMax?: number
  toggle?: boolean
  onToggle?: (v: boolean) => void
}

export function IntervalPicker({
  label,
  value,
  presets,
  onChange,
  disabledAbove,
  pickerTitle = 'Custom interval',
  pickerMin = 1,
  pickerMax = 240,
  toggle,
  onToggle,
}: Props) {
  const { tokens } = useTheme()
  const [showPicker, setShowPicker] = useState(false)
  const isCustom = !presets.includes(value)
  const hasToggle = toggle !== undefined

  const chips = (
    <View style={styles.chips}>
      {presets.map(p => (
        <Chip
          key={p}
          label={String(p)}
          active={value === p && !isCustom}
          disabled={disabledAbove !== undefined && p >= disabledAbove}
          onPress={() => onChange(p)}
        />
      ))}
      <Chip label={isCustom ? String(value) : '…'} active={isCustom} onPress={() => setShowPicker(true)} />
    </View>
  )

  return (
    <View style={styles.section}>
      {hasToggle ? (
        <>
          <View style={styles.toggleRow}>
            <Text style={[styles.label, { color: tokens.textMuted }]}>{label}</Text>
            <Toggle value={!!toggle} onChange={v => onToggle?.(v)} accessibilityLabel={label} />
          </View>
          {toggle && <View style={styles.offsetInner}>{chips}</View>}
        </>
      ) : (
        <>
          <Text style={[styles.label, { color: tokens.textMuted }]}>{label}</Text>
          {chips}
        </>
      )}

      {showPicker && (
        <CustomMinutePicker
          title={pickerTitle}
          initial={isCustom ? value : presets[0]}
          min={pickerMin}
          max={pickerMax}
          onConfirm={v => { onChange(v); setShowPicker(false) }}
          onClose={() => setShowPicker(false)}
        />
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  section: {
    gap: 12,
  },
  label: {
    fontSize: 11,
    fontWeight: '500',
    letterSpacing: 1.3,
    textTransform: 'uppercase',
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  offsetInner: {
    paddingTop: 12,
  },
})
