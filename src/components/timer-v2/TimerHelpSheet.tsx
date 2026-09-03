import type { ReactNode } from 'react'
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native'
import { AlarmIcon, BellIcon, ClockIcon, FocusIcon, RestartIcon, VolumeIcon } from '../Icons'
import { useTheme } from '../../theme/ThemeContext'
import { BottomSheet } from './BottomSheet'

export function TimerHelpSheet({ visible, onClose, onOpenFocusSettings }: { visible: boolean; onClose: () => void; onOpenFocusSettings?: () => void }) {
  const { tokens } = useTheme()
  const item = (icon: ReactNode, title: string, body: string) => <View style={styles.item}><View style={[styles.icon, { borderColor: tokens.border }]}>{icon}</View><View style={styles.copy}><Text style={[styles.title, { color: tokens.text }]}>{title}</Text><Text style={[styles.body, { color: tokens.textMuted }]}>{body}</Text></View></View>
  return <BottomSheet visible={visible} eyebrow="HOW IT WORKS" title="Timer help" onClose={onClose}>
    {item(<BellIcon on color={tokens.accent} />, 'Cycle', 'One main interval repeats. Add up to five sub-bells at selected points, each with its own sound and level.')}
    {item(<RestartIcon color={tokens.accent} />, 'Sequence', 'Steps run in order and repeat. Each step has its own duration, label, sound and level.')}
    {item(<ClockIcon color={tokens.accent} />, 'Run length', 'Keep going until you stop, or finish after a chosen number of cycles or an exact duration.')}
    {item(<ClockIcon color={tokens.accent} />, 'Schedule', 'Add weekly active times. Overnight ranges belong to the day on which they start; missed bells are not replayed.')}
    {item(<ClockIcon color={tokens.accent} />, 'Snap to clock', 'Keep Cycle mode on a local wall-clock rhythm, including after timezone and daylight-saving changes.')}
    {item(<RestartIcon color={tokens.accent} />, 'Reset', 'Start a fresh full interval or sequence. In a snapped Cycle, reset also unsnaps it from the clock.')}
    {item(<AlarmIcon color={tokens.accent} />, 'Alarm', 'Tap once to enable the alarm at the end of the current main interval. Tap twice to enable it for every main interval.')}
    {item(<VolumeIcon muted color={tokens.accent} />, 'Mute', 'Mute one or more cycles, or choose a number of minutes. Your volume levels stay unchanged.')}
    {Platform.OS === 'android' ? item(<FocusIcon color={tokens.accent} />, 'Calls and Focus', 'Bells can stay quiet during calls. Optional Chandas Focus manages its own Android Do Not Disturb rule while allowing alarms.') : null}
    {Platform.OS === 'android' && onOpenFocusSettings ? <Pressable accessibilityRole="link" onPress={onOpenFocusSettings} style={[styles.action, { borderColor: tokens.accent }]}><Text style={[styles.actionText, { color: tokens.accent }]}>Open Android DND access</Text></Pressable> : null}
    {item(<BellIcon on color={tokens.accent} />, 'Shortcuts', 'Use the quick choices for common values. Drag across cue positions to select several, and drag the dotted handles to reorder.')}
  </BottomSheet>
}

const styles = StyleSheet.create({
  item: { flexDirection: 'row', alignItems: 'flex-start', gap: 11 },
  icon: { width: 32, height: 32, borderWidth: 1.5, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  copy: { flex: 1, gap: 3 },
  title: { fontSize: 14, fontWeight: '700' },
  body: { fontSize: 12, lineHeight: 18 },
  action: { alignSelf: 'flex-start', borderWidth: 1.5, borderRadius: 99, paddingHorizontal: 13, paddingVertical: 9 },
  actionText: { fontSize: 12, fontWeight: '700' },
})
