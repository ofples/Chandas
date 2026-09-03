import { StyleSheet, Text, View } from 'react-native'
import { useTheme } from '../../theme/ThemeContext'
import { BottomSheet } from './BottomSheet'

export function TimerHelpSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { tokens } = useTheme()
  const item = (title: string, body: string) => <View style={styles.item}><Text style={[styles.title, { color: tokens.text }]}>{title}</Text><Text style={[styles.body, { color: tokens.textMuted }]}>{body}</Text></View>
  return <BottomSheet visible={visible} eyebrow="HOW IT WORKS" title="Timer help" onClose={onClose}>
    {item('Main + sub-bells', 'One main interval repeats. Each sub-bell track can ring at selected minute offsets, with its own sound and level. If tracks overlap, the higher track in the priority order plays.')}
    {item('Sequence / sets', 'Steps run in order and repeat as a cycle. Each step has its own duration, label, sound and level. Continuous alarm mode is intentionally unavailable in sequences.')}
    {item('Clock alignment', 'Aligning to the clock anchors the repeating main interval to local wall-clock time. After a timezone or daylight-saving change, Chandas realigns to the same local schedule and never replays missed bells.')}
    {item('Alarm control', 'In Main + sub-bells, one tap arms the next main gong as a continuous alarm. A second quick tap locks every main gong. Tap again to turn it off.')}
    {item('Mute', 'Mute for one or more cycles suppresses bells inside that period but still plays its final main or cycle boundary. Time-based mute resumes only at the next future cue. Your volume levels are never erased.')}
    {item('Calls and Do Not Disturb', 'Normal bells automatically stay quiet during active calls when phone-state access is available. Bells use the Alarm stream. Optional Focus automation manages a dedicated Android DND rule and mirrors changes made in Android settings.')}
    {item('Shortcuts', 'Quick duration and clock chips select common values. Drag over a cue grid to paint several positions. Drag the dotted handles to reorder priority or sequence steps. Long-press running controls for a short explanation.')}
    <Text style={[styles.note, { color: tokens.textDisabled }]}>Android ultimately controls exact-alarm, Alarm volume, notification, full-screen alarm, phone-state and DND permissions. Chandas shows the relevant setting when action is needed.</Text>
  </BottomSheet>
}

const styles = StyleSheet.create({
  item: { gap: 3 },
  title: { fontSize: 14, fontWeight: '700' },
  body: { fontSize: 12, lineHeight: 18 },
  note: { fontSize: 11, lineHeight: 16, marginTop: 4 },
})
