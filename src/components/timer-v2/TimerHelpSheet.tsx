import type { ReactNode } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { BellIcon, TimerTransportIcon } from '../Icons'
import { useTheme } from '../../theme/ThemeContext'
import { BottomSheet } from './BottomSheet'
import { RunningControlSettingsList } from './RunningControlSettingsList'
import type { AppTimerSettings } from '../../types'

interface Props {
  visible: boolean
  mode: 'pattern' | 'sequence'
  controlSettings: Pick<AppTimerSettings, 'advancedModeEnabled' | 'runningControlIds'>
  onRunningControlIdsChange: (ids: NonNullable<AppTimerSettings['runningControlIds']>) => void
  onClose: () => void
}

/** Help for the controls on the running screen only. Setup guidance stays beside setup. */
export function TimerHelpSheet({ visible, mode, controlSettings, onRunningControlIdsChange, onClose }: Props) {
  const { tokens } = useTheme()
  const item = (icon: ReactNode, title: string, body: string) => <View style={styles.item}><View style={[styles.icon, { borderColor: tokens.border }]}>{icon}</View><View style={styles.copy}><Text style={[styles.title, { color: tokens.text }]}>{title}</Text><Text style={[styles.body, { color: tokens.textMuted }]}>{body}</Text></View></View>
  return <BottomSheet visible={visible} title="Running timer help" onClose={onClose}>
    {mode === 'pattern'
      ? item(<BellIcon on color={tokens.accent} />, 'Your timer', 'The timer counts down the current interval. Colored inner rings mark upcoming sub-bells.')
      : item(<BellIcon on color={tokens.accent} />, 'Your steps', 'The timer counts down the current step. Its name and place in the round appear around the timer.')}
    {item(<TimerTransportIcon kind="pause" color={tokens.accent} />, 'Pause and resume', 'Use the button below the watchface to freeze the countdown, then continue from the same position. Pausing a clock-aligned timer turns off clock alignment.')}
    {mode === 'sequence' ? item(<TimerTransportIcon kind="next" color={tokens.accent} />, 'Move between steps', 'Use the buttons beside Pause to skip to the previous or next step without sounding the skipped cue.') : null}
    <View style={styles.controlSettings}><Text style={[styles.controlTitle, { color: tokens.text }]}>Show running controls</Text><RunningControlSettingsList settings={controlSettings} onChange={onRunningControlIdsChange} /></View>
  </BottomSheet>
}

const styles = StyleSheet.create({
  item: { flexDirection: 'row', alignItems: 'flex-start', gap: 11 },
  icon: { width: 28, height: 28, marginTop: -4, borderWidth: 1.5, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  copy: { flex: 1, minWidth: 0, gap: 3 },
  title: { fontSize: 14, lineHeight: 20, fontWeight: '700' },
  body: { fontSize: 12, lineHeight: 18 },
  controlSettings: { gap: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#8885', paddingTop: 14 },
  controlTitle: { fontSize: 14, lineHeight: 20, fontWeight: '700' },
})
