import { useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { Chip } from '../Chip'
import { CustomMinutePicker } from '../CustomMinutePicker'
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
  const chooseMinutes = (minutes: number) => onChangeSeconds ? onChangeSeconds(minutes * 60) : onChange(minutes)
  return (
    <View style={styles.wrap}>
      {label ? <SheetSectionTitle>{label}</SheetSectionTitle> : null}
      <View style={styles.choiceRow}>
        <View style={styles.scrollSlot}>
          <FadedHorizontalScrollView fadeColor={fadeColor ?? tokens.surface} style={styles.scroller} contentContainerStyle={styles.presets}>
            {presets.map(minutes => <Chip key={minutes} label={`${minutes}m`} active={exactSeconds === minutes * 60} onPress={() => chooseMinutes(minutes)} compact={compact} />)}
          </FadedHorizontalScrollView>
        </View>
        <Chip
          label={isPreset ? 'Custom' : formatCompactDurationSeconds(exactSeconds)}
          active={!isPreset}
          onPress={() => setCustomOpen(true)}
          compact={compact}
          accessibilityLabel={isPreset ? 'Choose a custom duration' : `Edit custom duration, ${formatCompactDurationSeconds(exactSeconds)}`}
        />
      </View>
      {customOpen ? <CustomMinutePicker title={label ?? 'Custom duration'} initial={value} initialSeconds={exactSeconds} secondPrecision={secondPrecision} min={min} max={max} minSeconds={min === 1 ? 1 : min * 60} maxSeconds={max * 60} onConfirm={minutes => { onChange(minutes); setCustomOpen(false) }} onConfirmSeconds={seconds => { (onChangeSeconds ?? (value => onChange(Math.ceil(value / 60))))(seconds); setCustomOpen(false) }} onClose={() => setCustomOpen(false)} /> : null}
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
