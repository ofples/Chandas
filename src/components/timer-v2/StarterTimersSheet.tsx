import { useMemo, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import Svg, { Path } from 'react-native-svg'
import { useTheme } from '../../theme/ThemeContext'
import { createStarterTimers, STARTER_TIMER_DETAILS } from '../../lib/starter-timers'
import type { UnifiedTimerConfig } from '../../lib/unified-config-state'
import { ConfigurationIcon } from '../Icons'
import { DraggableSheet } from './DraggableSheet'

export function StarterTimersSheet({ configs, onAdd, onClose }: { configs: UnifiedTimerConfig[]; onAdd: (config: UnifiedTimerConfig) => Promise<boolean>; onClose: () => void }) {
  const { tokens } = useTheme()
  const starters = useMemo(() => createStarterTimers(), [])
  const [adding, setAdding] = useState<string | null>(null)
  const [error, setError] = useState(false)
  return <DraggableSheet visible title="Starter timers" testID="starter-timers-sheet" fitContent onClose={onClose}>
    <Text style={[styles.copy, { color: tokens.textMuted }]}>Add a timer, then change anything you like. Remove it from its ⋮ menu.</Text>
    {starters.map(config => {
      const added = configs.some(saved => saved.id === config.id)
      return <View key={config.id} style={[styles.row, { borderColor: tokens.border }]}>
        <ConfigurationIcon color={tokens.textMuted} />
        <View style={styles.details}><Text style={[styles.title, { color: tokens.text }]}>{config.name}</Text><Text style={[styles.copy, { color: tokens.textMuted }]}>{STARTER_TIMER_DETAILS[config.id]}</Text></View>
        {added ? <Text accessibilityLabel={`${config.name} already added`} style={{ color: tokens.accent }}>Added</Text> : <Pressable disabled={adding !== null} accessibilityRole="button" accessibilityLabel={`Add ${config.name}`} onPress={async () => {
          if (adding) return
          setAdding(config.id); setError(false)
          try { if (!await onAdd(config)) setError(true) } catch { setError(true) }
          finally { setAdding(null) }
        }} style={[styles.add, { borderColor: tokens.border, opacity: adding ? 0.5 : 1 }]}><Svg width={18} height={18} viewBox="0 0 24 24"><Path d="M12 5v14M5 12h14" stroke={tokens.accent} strokeWidth={2} strokeLinecap="round" /></Svg></Pressable>}
      </View>
    })}
    {error ? <Text accessibilityRole="alert" style={[styles.copy, { color: tokens.warm }]}>That timer could not be added. Try again.</Text> : null}
  </DraggableSheet>
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 12, alignItems: 'center', minHeight: 84, borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: 10 },
  details: { flex: 1, minWidth: 0, gap: 4 }, title: { fontSize: 16, fontWeight: '500' }, copy: { fontSize: 14, lineHeight: 20 },
  add: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
})
