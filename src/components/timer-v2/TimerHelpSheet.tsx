import type { ReactNode } from 'react'
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native'
import { AlarmIcon, BellIcon, ClockIcon, FocusIcon, RestartIcon, VolumeIcon } from '../Icons'
import { useTheme } from '../../theme/ThemeContext'
import { BottomSheet } from './BottomSheet'
import { SheetTextButton } from './SheetTextButton'

interface Props {
  visible: boolean
  mode: 'pattern' | 'sequence'
  clockAlignmentVisible: boolean
  advancedModeEnabled: boolean
  onClose: () => void
  onShowAdvanced: () => void
  onOpenFocusSettings?: () => void
}

/** Help for the controls on the running screen only. Setup guidance stays beside setup. */
export function TimerHelpSheet({ visible, mode, clockAlignmentVisible, advancedModeEnabled, onClose, onShowAdvanced, onOpenFocusSettings }: Props) {
  const { tokens } = useTheme()
  const item = (icon: ReactNode, title: string, body: string) => <View style={styles.item}><View style={[styles.icon, { borderColor: tokens.border }]}>{icon}</View><View style={styles.copy}><Text style={[styles.title, { color: tokens.text }]}>{title}</Text><Text style={[styles.body, { color: tokens.textMuted }]}>{body}</Text></View></View>
  return <BottomSheet visible={visible} title="Running timer help" onClose={onClose}>
    {mode === 'pattern'
      ? item(<BellIcon on color={tokens.accent} />, 'Your cycle', 'The large timer counts down the main interval. Colored inner rings show the next sub-bells you have set.')
      : item(<BellIcon on color={tokens.accent} />, 'Your sequence', 'The large timer counts down the current step. Its name and place in the sequence appear around the timer.')}
    {item(<RestartIcon color={tokens.accent} />, mode === 'pattern' ? 'Restart cycle' : 'Restart sequence', mode === 'pattern' ? 'Begin a fresh main interval from now.' : 'Go back to the first step and begin again from now.')}
    {clockAlignmentVisible ? item(<ClockIcon color={tokens.accent} />, 'Align to clock', mode === 'pattern' ? 'Choose a clock mark for the repeating interval, such as every hour on :00.' : 'Choose a clock mark for the full sequence to begin on.') : null}
    {advancedModeEnabled && mode === 'pattern' ? item(<AlarmIcon color={tokens.accent} />, 'Alarm', 'Tap once to alarm at the next main gong. Double-tap to keep it on for every main gong. Tap anywhere when it rings to dismiss it.') : null}
    {advancedModeEnabled && Platform.OS === 'android' ? item(<FocusIcon color={tokens.accent} />, 'Chandas Focus', 'Let Chandas turn on its own Do Not Disturb rule while the timer is running.') : null}
    {advancedModeEnabled && Platform.OS === 'android' && onOpenFocusSettings ? <Pressable accessibilityRole="link" onPress={onOpenFocusSettings} style={[styles.action, { borderColor: tokens.accent }]}><Text style={[styles.actionText, { color: tokens.accent }]}>Open Android DND access</Text></Pressable> : null}
    {item(<VolumeIcon color={tokens.accent} />, 'Sound and mute', 'Change the overall volume, preview individual sounds, or mute the timer for a while without losing your levels.')}
    {!advancedModeEnabled ? <View style={styles.showAdvanced}><Text style={[styles.advancedHint, { color: tokens.textMuted }]}>Need alarms, Focus, or other optional controls?</Text><SheetTextButton label="Show advanced" onPress={onShowAdvanced} /></View> : null}
  </BottomSheet>
}

const styles = StyleSheet.create({
  item: { flexDirection: 'row', alignItems: 'flex-start', gap: 11 },
  icon: { width: 28, height: 28, marginTop: -4, borderWidth: 1.5, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  copy: { flex: 1, minWidth: 0, gap: 3 },
  title: { fontSize: 14, lineHeight: 20, fontWeight: '700' },
  body: { fontSize: 12, lineHeight: 18 },
  action: { alignSelf: 'flex-end', borderWidth: 1.5, borderRadius: 99, paddingHorizontal: 13, paddingVertical: 9 },
  actionText: { fontSize: 12, fontWeight: '700' },
  showAdvanced: { minHeight: 46, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingTop: 2 },
  advancedHint: { flex: 1, fontSize: 12, lineHeight: 18 },
})
