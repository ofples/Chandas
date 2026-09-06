import { useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import Animated, { FadeInDown, FadeOut, LinearTransition, useReducedMotion } from 'react-native-reanimated'
import type { HapticProfile, TimerHapticsSettings } from '../../types'
import { HAPTIC_PATTERNS, HAPTIC_STRENGTHS, hapticProfileSummary } from '../../lib/haptic-profiles'
import { previewHapticProfile, tapHaptic } from '../../lib/haptics'
import { useTheme } from '../../theme/ThemeContext'
import { BottomSheet } from './BottomSheet'
import { SegmentedControl } from './SegmentedControl'
import { GentleNotice } from './experience-feedback'

type ProfileKey = 'main' | 'subBell' | 'alarm'

interface Props {
  visible: boolean
  value: TimerHapticsSettings
  onChange: (value: TimerHapticsSettings) => void
  onClose: () => void
}

const ROWS: readonly { key: ProfileKey; title: string; detail: string }[] = [
  { key: 'main', title: 'Main timer', detail: 'Main gongs and Sequence boundaries' },
  { key: 'subBell', title: 'Sub-bells', detail: 'Quieter interval cues' },
  { key: 'alarm', title: 'Alarm', detail: 'Repeats until dismissed' },
]

export function HapticsSheet({ visible, value, onChange, onClose }: Props) {
  const { tokens } = useTheme()
  const [expanded, setExpanded] = useState<ProfileKey | null>(null)
  const [previewFailed, setPreviewFailed] = useState(false)

  const patchProfile = (key: ProfileKey, patch: Partial<HapticProfile>) => {
    onChange({ ...value, [key]: { ...value[key], ...patch } })
  }

  const preview = async (profile: HapticProfile) => {
    setPreviewFailed(false)
    if (!await previewHapticProfile(profile)) setPreviewFailed(true)
  }

  return <BottomSheet visible={visible} title="Haptics" onClose={onClose}>
    <Text style={[styles.intro, { color: tokens.textMuted }]}>Choose how timer cues feel. Turning Haptics off also silences taps and feedback.</Text>
    <View style={styles.list}>
      {ROWS.map((row, index) => {
        const profile = value[row.key]
        const open = expanded === row.key
        return <Animated.View key={row.key} layout={LinearTransition.duration(170)}>
          {index > 0 ? <View style={[styles.divider, { backgroundColor: tokens.border }]} /> : null}
          <View style={styles.row}>
            <Pressable
              style={styles.rowCopy}
              onPress={() => { tapHaptic(); setExpanded(current => current === row.key ? null : row.key) }}
              accessibilityRole="button"
              accessibilityState={{ expanded: open }}
              accessibilityLabel={`${row.title}, ${hapticProfileSummary(profile)}`}
            >
              <Text style={[styles.title, { color: tokens.text }]}>{row.title}</Text>
              <Text style={[styles.summary, { color: tokens.textMuted }]}>{hapticProfileSummary(profile)} · {row.detail}</Text>
            </Pressable>
            <PreviewButton onPress={() => void preview(profile)} label={`Preview ${row.title} haptic`} />
          </View>
          {open ? <Animated.View entering={FadeInDown.duration(160)} exiting={FadeOut.duration(100)} style={styles.editor}>
            <Text style={[styles.controlLabel, { color: tokens.text }]}>Pattern</Text>
            <SegmentedControl items={HAPTIC_PATTERNS} value={profile.pattern} onChange={pattern => patchProfile(row.key, { pattern })} accessibilityLabel={`${row.title} haptic pattern`} />
            <Text style={[styles.controlLabel, { color: tokens.text }]}>Strength</Text>
            <SegmentedControl items={HAPTIC_STRENGTHS} value={profile.strength} onChange={strength => patchProfile(row.key, { strength })} accessibilityLabel={`${row.title} haptic strength`} />
            {row.key === 'alarm' ? <Text style={[styles.note, { color: tokens.textMuted }]}>The selected group repeats with a calm pause until the alarm is dismissed. Preview plays it once.</Text> : null}
          </Animated.View> : null}
        </Animated.View>
      })}
    </View>
    {previewFailed ? <GentleNotice title="Preview was not available" message="Nothing changed. This device may not support vibration previews." tone="attention" /> : null}
  </BottomSheet>
}

function PreviewButton({ onPress, label }: { onPress: () => void; label: string }) {
  const { tokens } = useTheme()
  const reducedMotion = useReducedMotion()
  return <Pressable
    hitSlop={7}
    onPress={onPress}
    accessibilityRole="button"
    accessibilityLabel={label}
    style={({ pressed }) => [styles.preview, { borderColor: tokens.border, backgroundColor: pressed ? tokens.accentGlow : 'transparent', transform: [{ scale: pressed && !reducedMotion ? 0.92 : 1 }] }]}
  ><Text style={[styles.previewGlyph, { color: tokens.accent }]}>≋</Text></Pressable>
}

const styles = StyleSheet.create({
  intro: { fontSize: 12, lineHeight: 18, marginBottom: 2 },
  list: { gap: 0 },
  divider: { height: 1 },
  row: { minHeight: 66, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 },
  rowCopy: { flex: 1, minWidth: 0, minHeight: 50, justifyContent: 'center', gap: 3 },
  title: { fontSize: 14, fontWeight: '700' },
  summary: { fontSize: 12, lineHeight: 17 },
  preview: { width: 38, height: 38, borderWidth: 1.5, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  previewGlyph: { fontSize: 22, lineHeight: 24, fontWeight: '700' },
  editor: { gap: 9, paddingBottom: 16 },
  controlLabel: { fontSize: 13, fontWeight: '700', marginTop: 2 },
  note: { fontSize: 11, lineHeight: 16, marginTop: 1 },
})
