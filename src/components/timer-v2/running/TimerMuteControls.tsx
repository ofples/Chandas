import { useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { Chip } from '../../Chip'
import { CustomMinutePicker } from '../../CustomMinutePicker'
import { TimeOfDayPicker } from '../../TimeOfDayPicker'
import { SheetSectionTitle } from '../SheetSectionTitle'
import { nextLocalClockTime } from '../../../lib/time-inputs'
import { useTheme } from '../../../theme/ThemeContext'

interface Props {
  muted: boolean
  timedUntil?: number
  iterationCount?: number
  secondPrecision?: boolean
  onMuteForSeconds: (seconds: number) => void
  onMuteUntil: (deadline: number) => void
  onMuteIterations?: (count: number) => void
  onClearMute: () => void
}

export function TimerMuteControls({ muted, timedUntil = 0, iterationCount, secondPrecision, onMuteForSeconds, onMuteUntil, onMuteIterations, onClearMute }: Props) {
  const { tokens } = useTheme()
  const [picker, setPicker] = useState<'duration' | 'until' | null>(null)
  const close = () => setPicker(null)
  const muteFor = (seconds: number) => { onMuteForSeconds(seconds); close() }
  const initialTime = new Date(timedUntil > Date.now() ? timedUntil : Date.now() + 15 * 60_000)

  return <>
    <SheetSectionTitle>Mute for</SheetSectionTitle>
    <View style={styles.options}>
      {onMuteIterations
        ? [1, 2, 3].map(count => <Chip key={count} label={`${count}×`} active={iterationCount === count} onPress={() => onMuteIterations(count)} />)
        : [5, 15, 30].map(minutes => <Chip key={minutes} label={`${minutes}m`} active={false} onPress={() => muteFor(minutes * 60)} />)}
      <Chip label={onMuteIterations ? 'Minutes…' : 'Custom…'} active={picker === 'duration'} onPress={() => setPicker('duration')} />
      <Chip label="Until…" active={picker === 'until'} onPress={() => setPicker('until')} />
    </View>
    {muted ? <Pressable accessibilityRole="button" onPress={onClearMute} style={({ pressed }) => [styles.clear, { borderColor: tokens.accent, backgroundColor: pressed ? tokens.accentGlow : tokens.surface }]}><Text style={[styles.clearText, { color: tokens.accent }]}>Clear mute</Text></Pressable> : null}
    {picker === 'duration' ? <CustomMinutePicker title="Mute duration" initial={15} secondPrecision={secondPrecision} max={1440} minSeconds={1} onConfirm={minutes => muteFor(minutes * 60)} onConfirmSeconds={muteFor} onClose={close} /> : null}
    {picker === 'until' ? <TimeOfDayPicker title="Mute until" initial={initialTime.getHours() * 60 + initialTime.getMinutes()} onConfirm={minutes => {
      onMuteUntil(nextLocalClockTime(minutes, Date.now()))
      close()
    }} onClose={close} /> : null}
  </>
}

const styles = StyleSheet.create({
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  clear: { minHeight: 50, borderWidth: 1.5, borderRadius: 14, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 18 },
  clearText: { fontSize: 15, lineHeight: 20, fontWeight: '700' },
})
