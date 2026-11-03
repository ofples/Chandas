import { StyleSheet, Text, View } from 'react-native'
import { Toggle } from '../Toggle'
import { AlarmIcon, ClockIcon, FocusIcon, RestartIcon, VolumeIcon } from '../Icons'
import { enabledRunningControls, RUNNING_CONTROL_DEFINITIONS, type RunningControlId } from '../../lib/running-controls'
import type { AppTimerSettings } from '../../types'
import { useTheme } from '../../theme/ThemeContext'

export function RunningControlSettingsList({ settings, onChange }: {
  settings: Pick<AppTimerSettings, 'advancedModeEnabled' | 'runningControlIds'>
  onChange: (ids: RunningControlId[]) => void
}) {
  const { tokens } = useTheme()
  const selected = enabledRunningControls(settings)
  return <View style={styles.list}>{RUNNING_CONTROL_DEFINITIONS.map(control => {
    const enabled = selected.has(control.id)
    const color = tokens.textMuted
    const icon = control.icon === 'restart' ? <RestartIcon color={color} />
      : control.icon === 'clock' ? <ClockIcon color={color} />
        : control.icon === 'alarm' ? <AlarmIcon color={color} />
          : control.icon === 'focus' ? <FocusIcon color={color} />
            : <VolumeIcon muted={false} color={color} />
    return <View key={control.id} style={styles.row}>
      <View style={[styles.icon, { borderColor: tokens.border }]}>{icon}</View>
      <View style={styles.copy}><Text style={[styles.title, { color: tokens.text }]}>{control.title}</Text><Text style={[styles.description, { color: tokens.textMuted }]}>{control.description}</Text></View>
      <Toggle value={enabled} onChange={value => {
        const current = settings.runningControlIds ?? [...selected]
        onChange(value ? [...new Set([...current, control.id])] : current.filter(id => id !== control.id))
      }} accessibilityLabel={`Show ${control.title}`} />
    </View>
  })}</View>
}

const styles = StyleSheet.create({
  list: { gap: 13 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  icon: { width: 30, height: 30, borderWidth: 1, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  copy: { flex: 1, minWidth: 0, gap: 2 },
  title: { fontSize: 13, lineHeight: 18, fontWeight: '700' },
  description: { fontSize: 11, lineHeight: 15 },
})
