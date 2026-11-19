import type { ReactNode } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { BellIcon, ConfigurationIcon, TimerTransportIcon } from '../Icons'
import { useTheme } from '../../theme/ThemeContext'
import { BottomSheet } from './BottomSheet'
import { RunningControlSettingsList } from './RunningControlSettingsList'
import type { AppTimerSettings } from '../../types'

interface Props {
  visible: boolean
  mode: 'pattern' | 'sequence' | 'bells'
  controlSettings: Pick<AppTimerSettings, 'advancedModeEnabled' | 'runningControlIds'> & { scrubbingEnabled?: boolean }
  onRunningControlIdsChange: (id: NonNullable<AppTimerSettings['runningControlIds']>[number], enabled: boolean) => void
  onClose: () => void
}

/** Help for the controls on the running screen only. Setup guidance stays beside setup. */
export function TimerHelpSheet({ visible, mode, controlSettings, onRunningControlIdsChange, onClose }: Props) {
  const { tokens } = useTheme()
  const item = (icon: ReactNode, title: string, body: string) => <View style={styles.item}><View style={[styles.icon, { borderColor: tokens.border }]}>{icon}</View><View style={styles.copy}><Text style={[styles.title, { color: tokens.text }]}>{title}</Text><Text style={[styles.body, { color: tokens.textMuted }]}>{body}</Text></View></View>
  return <BottomSheet visible={visible} title="Running timer help" onClose={onClose}>
    {mode === 'bells'
      ? item(<BellIcon on color={tokens.accent} />, 'Your bells', 'The timer counts down to the next bell. Each bell follows its own timing.')
      : mode === 'pattern'
        ? item(<BellIcon on color={tokens.accent} />, 'Your timer', 'The timer counts down the current interval. Colored inner rings mark upcoming sub-bells.')
        : item(<BellIcon on color={tokens.accent} />, 'Your steps', 'The timer counts down the current step. Its name appears below the timer.')}
    {item(<TimerTransportIcon kind="pause" color={tokens.accent} />, 'Pause and resume', 'Use the button below the watchface to freeze the countdown, then continue from the same position. Pausing a clock-aligned timer turns off clock alignment.')}
    {mode === 'sequence' ? item(<TimerTransportIcon kind="next" color={tokens.accent} />, 'Move between steps', 'Tap a neighboring step or use the buttons beside Pause. Hold the step strip for half a second before dragging farther.') : null}
    {item(<ConfigurationIcon color={tokens.accent} />, 'Your configurations', 'Swipe down or tap Configurations to see your timers. When several timers are running, swipe sideways through the center of the timer to switch between them.')}
    <View style={styles.controlSettings}><Text style={[styles.controlTitle, { color: tokens.text }]}>Show running controls</Text><Text style={[styles.body, { color: tokens.textMuted }]}>Applies to all timers. Each control appears where it can be used. Hold a control to see what it does.</Text><RunningControlSettingsList settings={controlSettings} onChange={onRunningControlIdsChange} /></View>
  </BottomSheet>
}

const styles = StyleSheet.create({
  item: { flexDirection: 'row', alignItems: 'flex-start', gap: 11 },
  icon: { width: 28, height: 28, marginTop: -4, borderWidth: 1.5, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  copy: { flex: 1, minWidth: 0, gap: 3 },
  title: { fontSize: 15, lineHeight: 21, fontWeight: '600' },
  body: { fontSize: 14, lineHeight: 20 },
  controlSettings: { gap: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#8885', paddingTop: 14 },
  controlTitle: { fontSize: 16, lineHeight: 22, fontWeight: '600' },
})
