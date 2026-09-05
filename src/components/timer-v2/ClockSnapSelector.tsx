import { useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { Chip } from '../Chip'
import { CustomMinutePicker } from '../CustomMinutePicker'
import { useTheme } from '../../theme/ThemeContext'
import { FadedHorizontalScrollView } from './FadedHorizontalScrollView'
import { clockOffsetLabel, clockSnapPresets } from '../../lib/clockAlignment'

export function ClockSnapSelector({ mainMinutes, value, onChange, compact = false, fadeColor, disabled = false }: { mainMinutes: number; value: number; onChange: (offset: number) => void; compact?: boolean; fadeColor?: string; disabled?: boolean }) {
  const { tokens } = useTheme()
  const [customOpen, setCustomOpen] = useState(false)
  const presets = clockSnapPresets(mainMinutes)
  const isPreset = presets.includes(value)
  const maxOffset = Math.max(0, Math.min(59, Math.round(mainMinutes) - 1))
  return <View style={styles.row}>
    <View style={styles.scrollSlot}>
      <FadedHorizontalScrollView fadeColor={fadeColor ?? tokens.surface} contentContainerStyle={styles.presets} style={styles.scroller}>
        {presets.map(offset => <Chip key={offset} label={clockOffsetLabel(offset)} compact={compact} active={value === offset} disabled={disabled} onPress={() => onChange(offset)} />)}
      </FadedHorizontalScrollView>
    </View>
    {maxOffset > 0 ? <Chip label={isPreset ? 'Custom' : clockOffsetLabel(value)} compact={compact} active={!isPreset} disabled={disabled} onPress={() => setCustomOpen(true)} accessibilityLabel={isPreset ? 'Choose a custom clock offset' : `Edit custom clock offset, ${value} minutes`} /> : null}
    {customOpen && maxOffset > 0 ? <CustomMinutePicker title="Clock offset" initial={value} min={0} max={maxOffset} onConfirm={offset => { onChange(offset); setCustomOpen(false) }} onClose={() => setCustomOpen(false)} /> : null}
  </View>
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  scrollSlot: { flex: 1, minWidth: 0, position: 'relative' },
  scroller: { flex: 1, minWidth: 0 },
  presets: { gap: 8, paddingRight: 30 },
})
