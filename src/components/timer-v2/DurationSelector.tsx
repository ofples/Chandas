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
  minSeconds?: number
  maxSeconds?: number
  compact?: boolean
  fadeColor?: string
  infinite?: boolean
  onInfinity?: () => void
}

export function DurationSelector({ value, valueSeconds, secondPrecision = false, presets, onChange, onChangeSeconds, label, min = 1, max = 240, minSeconds = secondPrecision ? 1 : min * 60, maxSeconds = max * 60, compact = false, fadeColor, infinite = false, onInfinity }: Props) {
  const { tokens } = useTheme()
  const [customOpen, setCustomOpen] = useState(false)
  const exactSeconds = valueSeconds ?? value * 60
  const validPresets = presets.filter(minutes => minutes * 60 >= minSeconds && minutes * 60 <= maxSeconds)
  const isPreset = validPresets.some(minutes => minutes * 60 === exactSeconds)
  const chooseSeconds = (seconds: number) => onChangeSeconds ? onChangeSeconds(seconds) : onChange(Math.ceil(seconds / 60))
  const choices = isPreset
    ? validPresets.map(minutes => ({ seconds: minutes * 60, label: `${minutes}m` }))
    : [{ seconds: exactSeconds, label: formatCompactDurationSeconds(exactSeconds) }, ...validPresets.map(minutes => ({ seconds: minutes * 60, label: `${minutes}m` }))]
  const selectedIndex = infinite && onInfinity ? choices.length : choices.findIndex(choice => choice.seconds === exactSeconds)
  return (
    <View style={styles.wrap}>
      {label ? <SheetSectionTitle>{label}</SheetSectionTitle> : null}
      <View style={styles.choiceRow}>
        <View style={styles.scrollSlot}>
          <FadedHorizontalScrollView fadeColor={fadeColor ?? tokens.surface} selectedIndex={selectedIndex} itemCount={choices.length + Number(!!onInfinity)} selectionKey={infinite ? 'infinite' : exactSeconds} style={styles.scroller} contentContainerStyle={styles.presets}>
            {choices.map(choice => <Chip key={choice.seconds} label={choice.label} active={!infinite && exactSeconds === choice.seconds} onPress={() => chooseSeconds(choice.seconds)} compact={compact} />)}
            {onInfinity ? <Chip label="∞" accessibilityLabel="No main interval" active={infinite} onPress={onInfinity} compact={compact} /> : null}
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
      {customOpen ? <CustomMinutePicker
        title={label ? `Set ${label.toLowerCase()}` : 'Set duration'}
        initial={value}
        initialSeconds={exactSeconds}
        secondPrecision={secondPrecision}
        min={min}
        max={max}
        minSeconds={minSeconds}
        maxSeconds={maxSeconds}
        onConfirm={minutes => { onChange(minutes); setCustomOpen(false) }}
        onConfirmSeconds={seconds => { chooseSeconds(seconds); setCustomOpen(false) }}
        onClose={() => setCustomOpen(false)}
      /> : null}
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
