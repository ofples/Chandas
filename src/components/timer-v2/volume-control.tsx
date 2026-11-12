import { useEffect, useRef, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import Slider from '@react-native-community/slider'
import type { CueSettings } from '../../types'
import { cueSounds } from '../../lib/timerV2'
import { ChandasTimerService } from '../../native/ChandasTimerService'
import { useTheme } from '../../theme/ThemeContext'
import { TimerTransportIcon } from '../Icons'

/** A channel level and an audition at its effective volume, independent of timer playback. */
export function VolumeControl({ label, value, onChange, cue, masterVolume, masterControl = false, alarmPreview = false, accessibilityLabel = label }: {
  label: string; value: number; onChange: (value: number) => void; cue: CueSettings;
  masterVolume: number; masterControl?: boolean; alarmPreview?: boolean; accessibilityLabel?: string
}) {
  const { tokens } = useTheme()
  const choiceIndex = useRef(0)
  const mounted = useRef(true)
  const previewRequest = useRef(0)
  const [unavailable, setUnavailable] = useState(false)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; previewRequest.current += 1; ChandasTimerService.stopSoundPreview() } }, [])
  const preview = async () => {
    setUnavailable(false)
    const request = ++previewRequest.current
    const choices = cueSounds(cue)
    const sound = choices[choiceIndex.current++ % choices.length]
    const volume = masterControl ? value * cue.volume : masterVolume * value
    try {
      const started = await ChandasTimerService.previewSound(sound, volume, { alarm: alarmPreview })
      if (mounted.current && request === previewRequest.current) setUnavailable(!started)
    } catch { if (mounted.current && request === previewRequest.current) setUnavailable(true) }
  }
  return <View style={styles.block}>
    <View style={styles.heading}><Text numberOfLines={1} style={[styles.label, { color: tokens.text }]}>{label}</Text><Text style={[styles.value, { color: tokens.textMuted }]}>{Math.round(value * 100)}%</Text></View>
    <View style={styles.controls}>
      <Slider style={styles.slider} minimumValue={0} maximumValue={1} step={0.05} value={value} onSlidingStart={() => { previewRequest.current += 1; ChandasTimerService.stopSoundPreview() }} onValueChange={onChange} minimumTrackTintColor={tokens.accent} maximumTrackTintColor={tokens.surfaceHi} thumbTintColor={tokens.accent} accessibilityLabel={accessibilityLabel} />
      <Pressable accessibilityRole="button" accessibilityLabel={`Preview ${accessibilityLabel}`} onPress={() => void preview()} hitSlop={4} style={({ pressed }) => [styles.preview, { borderColor: tokens.border, opacity: pressed ? 0.6 : 1 }]}><TimerTransportIcon kind="play" color={tokens.accent} /></Pressable>
    </View>
    {unavailable ? <Text style={[styles.hint, { color: tokens.textMuted }]}>Preview unavailable</Text> : null}
  </View>
}

const styles = StyleSheet.create({
  block: { gap: 2 }, heading: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  label: { flex: 1, fontSize: 14, fontWeight: '400' }, value: { fontSize: 12, fontVariant: ['tabular-nums'] },
  controls: { flexDirection: 'row', alignItems: 'center', gap: 12 }, slider: { flex: 1, height: 36 },
  preview: { width: 36, height: 36, borderWidth: 1, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  hint: { fontSize: 12 },
})
