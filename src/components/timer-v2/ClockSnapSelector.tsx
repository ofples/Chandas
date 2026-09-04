import { useState } from 'react'
import { ScrollView, StyleSheet, View } from 'react-native'
import { Chip } from '../Chip'
import { CustomMinutePicker } from '../CustomMinutePicker'

export function clockSnapPresets(mainMinutes: number): number[] {
  const upper = Math.min(55, Math.max(5, Math.round(mainMinutes)))
  const inclusive = upper <= 10
  const result: number[] = []
  for (let offset = 0; inclusive ? offset <= upper : offset < upper; offset += 5) result.push(offset)
  return result
}

export function ClockSnapSelector({ mainMinutes, value, onChange, compact = false }: { mainMinutes: number; value: number; onChange: (offset: number) => void; compact?: boolean }) {
  const [customOpen, setCustomOpen] = useState(false)
  const presets = clockSnapPresets(mainMinutes)
  const isPreset = presets.includes(value)
  return <View style={styles.row}>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.presets} style={styles.scroller}>
      {presets.map(offset => <Chip key={offset} label={`:${String(offset).padStart(2, '0')}`} compact={compact} active={value === offset} onPress={() => onChange(offset)} />)}
    </ScrollView>
    <Chip label={isPreset ? 'Custom' : `:${String(value).padStart(2, '0')}`} compact={compact} active={!isPreset} onPress={() => setCustomOpen(true)} accessibilityLabel={isPreset ? 'Choose a custom clock offset' : `Edit custom clock offset, ${value} minutes`} />
    {customOpen ? <CustomMinutePicker title="Clock offset" initial={value} min={0} max={59} onConfirm={offset => { onChange(offset); setCustomOpen(false) }} onClose={() => setCustomOpen(false)} /> : null}
  </View>
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  scroller: { flex: 1, minWidth: 0 },
  presets: { gap: 8, paddingRight: 2 },
})
