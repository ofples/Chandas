import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useTheme } from '../../theme/ThemeContext'
import { BottomSheet } from './BottomSheet'

export function TimerHelpSheet({ visible, onClose, onOpenFocusSettings }: { visible: boolean; onClose: () => void; onOpenFocusSettings?: () => void }) {
  const { tokens } = useTheme()
  const item = (title: string, body: string) => <View style={styles.item}><Text style={[styles.title, { color: tokens.text }]}>{title}</Text><Text style={[styles.body, { color: tokens.textMuted }]}>{body}</Text></View>
  return <BottomSheet visible={visible} eyebrow="HOW IT WORKS" title="Timer help" onClose={onClose}>
    {item('Main + sub-bells', 'One main interval repeats. Each sub-bell track can ring at selected minute offsets, with its own sound and level. If tracks overlap, the higher track in the priority order plays.')}
    {item('Sequence / sets', 'Steps run in order and repeat as a cycle. Each step has its own duration, label, sound and level. Continuous alarm mode is intentionally unavailable in sequences.')}
    {item('Run length', 'Continuous keeps going until you stop. Cycles counts complete main intervals or sequence rounds. Duration ends after the exact hours, minutes and seconds you choose. A bounded session finishes with one cue; calls, mute and schedule windows never extend its length.')}
    {item('Schedule', 'Turn Schedule on to add several weekly active time ranges. Overlapping ranges simply join together, and overnight ranges belong to the day on which they start. Outside them, program phase continues quietly and missed bells are never replayed.')}
    {item('Clock alignment', 'Aligning to the clock anchors the repeating main interval to local wall-clock time. After a timezone or daylight-saving change, Chandas realigns to the same local schedule and never replays missed bells. A bounded session keeps its promised end time.')}
    {item('Restart', 'Restart from now begins a fresh full interval or sequence cycle using elapsed time. It clears cycle mute because the old ending boundary no longer exists; a minute-based mute keeps its timestamp.')}
    {item('Alarm control', 'In Main + sub-bells, one tap arms the next main gong as a continuous alarm. A second quick tap locks every main gong. Tap again to turn it off.')}
    {item('Mute', 'Mute for one or more cycles suppresses bells inside that period but still plays its final main or cycle boundary. Time-based mute resumes only at the next future cue. Your volume levels are never erased.')}
    {item('Calls and Do Not Disturb', 'Normal bells automatically stay quiet during active calls when phone-state access is available. Bells use the phone’s Alarm stream and obey the active DND mode’s alarm setting. Optional Chandas Focus manages only its own Android rule, explicitly allows alarms, and mirrors changes made in Android settings.')}
    {onOpenFocusSettings ? <Pressable accessibilityRole="link" onPress={onOpenFocusSettings} style={[styles.action, { borderColor: tokens.accent }]}><Text style={[styles.actionText, { color: tokens.accent }]}>Open Android DND access</Text></Pressable> : null}
    {item('Shortcuts', 'Quick duration and clock chips select common values. Drag over a cue grid to paint several positions. Drag the dotted handles to reorder priority or sequence steps. Long-press running controls for a short explanation.')}
    <Text style={[styles.note, { color: tokens.textDisabled }]}>Android ultimately controls exact-alarm, Alarm volume, notification, full-screen alarm, phone-state and DND permissions. Chandas shows the relevant setting when action is needed.</Text>
  </BottomSheet>
}

const styles = StyleSheet.create({
  item: { gap: 3 },
  title: { fontSize: 14, fontWeight: '700' },
  body: { fontSize: 12, lineHeight: 18 },
  note: { fontSize: 11, lineHeight: 16, marginTop: 4 },
  action: { alignSelf: 'flex-start', borderWidth: 1.5, borderRadius: 99, paddingHorizontal: 13, paddingVertical: 9 },
  actionText: { fontSize: 12, fontWeight: '700' },
})
