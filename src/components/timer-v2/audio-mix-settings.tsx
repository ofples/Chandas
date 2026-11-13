import { useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { CheckIcon } from '../Icons'
import { ChandasTimerService, type TimerAudioMixMode } from '../../native/ChandasTimerService'
import { useTheme } from '../../theme/ThemeContext'

const choices: ReadonlyArray<{ id: TimerAudioMixMode; label: string; detail: string }> = [
  { id: 'default', label: 'Automatic', detail: 'Bells play alongside other audio. Alarms ask other apps to pause.' },
  { id: 'mix', label: 'Mix with other audio', detail: 'Play bells and alarms alongside music, podcasts, and other audio.' },
  { id: 'duck', label: 'Lower other audio', detail: 'Ask Android to turn down other audio while Chandas plays. Some apps may pause instead.' },
  { id: 'pause', label: 'Pause other audio', detail: 'Ask other apps to pause while Chandas plays. Android lets them resume afterward.' },
]

export function audioMixLabel(mode: TimerAudioMixMode | null) {
  return choices.find(choice => choice.id === mode)?.label ?? choices[0].label
}

export function AudioMixSettings({ mode, onChange }: { mode: TimerAudioMixMode; onChange: (mode: TimerAudioMixMode) => boolean }) {
  const { tokens } = useTheme()
  const [error, setError] = useState(false)
  return <View>
    {choices.map(({ id, label, detail }) => <Pressable
      key={id}
      accessibilityRole="radio"
      accessibilityState={{ checked: mode === id }}
      accessibilityLabel={label}
      accessibilityHint={detail}
      onPress={() => setError(!onChange(id))}
      style={[styles.row, { borderBottomColor: tokens.border }]}
    >
      <View style={styles.copy}>
        <Text style={[styles.label, { color: tokens.text }]}>{label}</Text>
        <Text style={[styles.detail, { color: tokens.textMuted }]}>{detail}</Text>
      </View>
      <View style={styles.check}>{mode === id ? <CheckIcon color={tokens.accent} /> : null}</View>
    </Pressable>)}
    {error ? <Text accessibilityRole="alert" style={[styles.detail, { color: tokens.warm }]}>Could not change sound mixing.</Text> : null}
  </View>
}

const styles = StyleSheet.create({
  row: { minHeight: 56, borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 12 },
  copy: { flex: 1, gap: 3 },
  label: { fontSize: 15, fontWeight: '600' },
  detail: { fontSize: 13, lineHeight: 18 },
  check: { width: 20, alignItems: 'center' },
})
