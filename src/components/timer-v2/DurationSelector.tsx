import { useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { Chip } from '../Chip'
import { CustomMinutePicker } from '../CustomMinutePicker'
import { useTheme } from '../../theme/ThemeContext'
import { FadedHorizontalScrollView } from './FadedHorizontalScrollView'
import { SheetSectionTitle } from './SheetSectionTitle'

interface Props {
  value: number
  presets: readonly number[]
  onChange: (minutes: number) => void
  label?: string
  min?: number
  max?: number
  compact?: boolean
  fadeColor?: string
}

export function DurationSelector({ value, presets, onChange, label, min = 1, max = 240, compact = false, fadeColor }: Props) {
  const { tokens } = useTheme()
  const [customOpen, setCustomOpen] = useState(false)
  const isPreset = presets.includes(value)
  return (
    <View style={styles.wrap}>
      {label ? <SheetSectionTitle>{label}</SheetSectionTitle> : null}
      <View style={styles.choiceRow}>
        <View style={styles.scrollSlot}>
          <FadedHorizontalScrollView fadeColor={fadeColor ?? tokens.surface} style={styles.scroller} contentContainerStyle={styles.presets}>
            {presets.map(minutes => <Chip key={minutes} label={`${minutes}m`} active={value === minutes} onPress={() => onChange(minutes)} compact={compact} />)}
          </FadedHorizontalScrollView>
        </View>
        <Chip
          label={isPreset ? 'Custom' : `${value}m`}
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
  choiceRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  scrollSlot: { flex: 1, minWidth: 0, position: 'relative' },
  scroller: { flex: 1, minWidth: 0 },
  presets: { gap: 8, paddingRight: 30 },
})
