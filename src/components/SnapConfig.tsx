import { useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { useTheme } from '../theme/ThemeContext'
import { Chip } from './Chip'
import { Toggle } from './Toggle'
import { CustomMinutePicker } from './CustomMinutePicker'

const SNAP_PRESETS = [0, 10, 15]

interface Props {
  enabled: boolean
  offset: number
  onToggle: (v: boolean) => void
  onOffsetChange: (v: number) => void
}

export function SnapConfig({ enabled, offset, onToggle, onOffsetChange }: Props) {
  const { tokens } = useTheme()
  const [showPicker, setShowPicker] = useState(false)
  const isCustomOffset = !SNAP_PRESETS.includes(offset)

  return (
    <View style={styles.section}>
      <View style={styles.toggleRow}>
        <Text style={[styles.label, { color: tokens.textMuted }]}>Snap to clock</Text>
        <Toggle value={enabled} onChange={onToggle} accessibilityLabel="Snap to clock" />
      </View>

      {enabled && (
        <View style={styles.offsetInner}>
          <View style={styles.chips}>
            {SNAP_PRESETS.map(p => (
              <Chip
                key={p}
                label={p === 0 ? ':00' : `:${String(p).padStart(2, '0')}`}
                active={offset === p && !isCustomOffset}
                onPress={() => onOffsetChange(p)}
              />
            ))}
            <Chip
              label={isCustomOffset ? `:${String(offset).padStart(2, '0')}` : '…'}
              active={isCustomOffset}
              onPress={() => setShowPicker(true)}
            />
          </View>
        </View>
      )}

      {showPicker && (
        <CustomMinutePicker
          title="Snap offset (minutes)"
          initial={isCustomOffset ? offset : 0}
          min={0}
          max={59}
          onConfirm={v => { onOffsetChange(v); setShowPicker(false) }}
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
