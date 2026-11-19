import { useEffect, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { Chip } from '../../Chip'
import { CustomMinutePicker } from '../../CustomMinutePicker'
import { TimeOfDayPicker } from '../../TimeOfDayPicker'
import { SheetSectionTitle } from '../SheetSectionTitle'
import { nextLocalClockTime } from '../../../lib/time-inputs'
import { useTheme } from '../../../theme/ThemeContext'
import { BellIcon } from '../../Icons'
import { formatEventLocalTime, type CueMuteSuggestion } from '../../../lib/upcoming-events'

interface Props {
  muted: boolean
  timedUntil?: number
  muteSummary?: string
  iterationCount?: number
  secondPrecision?: boolean
  onMuteForSeconds: (seconds: number) => void
  onMuteUntil: (deadline: number) => void
  onMuteIterations?: (count: number) => void
  onClearMute: () => void
  getSuggestions?: (now: number, limit?: number) => CueMuteSuggestion[]
}

export function TimerMuteControls({ muted, timedUntil = 0, muteSummary, iterationCount, secondPrecision, onMuteForSeconds, onMuteUntil, onMuteIterations, onClearMute, getSuggestions }: Props) {
  const { tokens } = useTheme()
  const [picker, setPicker] = useState<'duration' | 'until' | null>(null)
  const [suggestionTime, setSuggestionTime] = useState(Date.now)
  const [suggestionLimit, setSuggestionLimit] = useState(12)
  const showsSuggestions = !!getSuggestions
  const suggestions = getSuggestions?.(suggestionTime, suggestionLimit) ?? []
  useEffect(() => {
    if (!showsSuggestions) return
    const clock = setInterval(() => setSuggestionTime(Date.now()), 1_000)
    return () => clearInterval(clock)
  }, [showsSuggestions])
  const close = () => setPicker(null)
  const muteFor = (seconds: number) => { onMuteForSeconds(seconds); close() }
  const initialTime = new Date(timedUntil > Date.now() ? timedUntil : Date.now() + 15 * 60_000)

  return <>
    {muted ? <Text accessibilityLiveRegion="polite" style={[styles.muteStatus, { color: tokens.text }]}>{muteSummary ?? (timedUntil > suggestionTime ? `Muted until ${formatEventLocalTime(timedUntil)}` : iterationCount ? `Muted for ${iterationCount} ${iterationCount === 1 ? 'round' : 'rounds'}` : 'Muted')}</Text> : null}
    <SheetSectionTitle>Mute for</SheetSectionTitle>
    <View style={styles.options}>
      {onMuteIterations
        ? [1, 2, 3].map(count => <Chip key={count} label={`${count}×`} active={iterationCount === count} onPress={() => onMuteIterations(count)} />)
        : [5, 15, 30].map(minutes => <Chip key={minutes} label={`${minutes}m`} active={false} onPress={() => muteFor(minutes * 60)} />)}
      <Chip label={onMuteIterations ? 'Minutes…' : 'Custom…'} active={picker === 'duration'} onPress={() => setPicker('duration')} />
      <Chip label="Until…" active={picker === 'until'} onPress={() => setPicker('until')} />
    </View>
    {muted ? <Pressable accessibilityRole="button" onPress={onClearMute} style={({ pressed }) => [styles.clear, { borderColor: tokens.accent, backgroundColor: pressed ? tokens.accentGlow : tokens.surface }]}><Text style={[styles.clearText, { color: tokens.accent }]}>Clear mute</Text></Pressable> : null}
    {suggestions.length > 0 ? <View style={styles.suggestions}>
      <SheetSectionTitle>Resume at a bell</SheetSectionTitle>
      <ScrollView testID="mute-bell-times" accessibilityLabel="Upcoming bell times" nestedScrollEnabled showsVerticalScrollIndicator={false} style={styles.suggestionList} contentContainerStyle={styles.suggestions} onScroll={event => {
        const { contentOffset, layoutMeasurement, contentSize } = event.nativeEvent
        if (contentOffset.y > 0 && contentOffset.y + layoutMeasurement.height >= contentSize.height - 44 && suggestions.length >= suggestionLimit) {
          setSuggestionLimit(current => current + 12)
        }
      }} scrollEventThrottle={100}>
      {suggestions.map(({ at, label, timerName }) => {
        const time = formatEventLocalTime(at)
        const title = timerName && timerName !== label ? `${timerName} · ${label}` : label
        const selected = timedUntil === at
        return <Pressable key={at} accessibilityRole="button" accessibilityState={{ selected }} accessibilityLabel={`Mute until ${title}, ${time}`} onPress={() => {
          if (at > Date.now()) onMuteUntil(at)
          setSuggestionTime(Date.now())
        }} style={({ pressed }) => [styles.suggestion, { borderColor: selected ? tokens.accent : tokens.border, backgroundColor: pressed || selected ? tokens.accentGlow : 'transparent' }]}>
          <BellIcon on color={selected ? tokens.accent : tokens.textMuted} />
          <Text numberOfLines={1} style={[styles.suggestionLabel, { color: tokens.text }]}>{title}</Text>
          <Text style={[styles.suggestionTime, { color: tokens.textMuted }]}>{time}</Text>
        </Pressable>
      })}
      </ScrollView>
    </View> : null}
    {picker === 'duration' ? <CustomMinutePicker title="Mute duration" initial={15} secondPrecision={secondPrecision} max={1440} minSeconds={1} onConfirm={minutes => muteFor(minutes * 60)} onConfirmSeconds={muteFor} onClose={close} /> : null}
    {picker === 'until' ? <TimeOfDayPicker title="Mute until" initial={initialTime.getHours() * 60 + initialTime.getMinutes()} onConfirm={minutes => {
      onMuteUntil(nextLocalClockTime(minutes, Date.now()))
      close()
    }} onClose={close} /> : null}
  </>
}

const styles = StyleSheet.create({
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  suggestions: { gap: 6 },
  suggestionList: { maxHeight: 210 },
  muteStatus: { fontSize: 14, lineHeight: 20 },
  suggestion: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 9, borderWidth: 1, borderRadius: 12, paddingHorizontal: 10 },
  suggestionLabel: { flex: 1, minWidth: 0, fontSize: 13 },
  suggestionTime: { fontSize: 12, fontVariant: ['tabular-nums'] },
  clear: { minHeight: 50, borderWidth: 1.5, borderRadius: 14, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 18 },
  clearText: { fontSize: 15, lineHeight: 20, fontWeight: '700' },
})
