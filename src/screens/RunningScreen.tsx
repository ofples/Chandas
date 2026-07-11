import { useEffect, useRef, useState } from 'react'
import { Animated, Dimensions, Modal, Pressable, StyleSheet, Text, View } from 'react-native'
import Svg, { Circle } from 'react-native-svg'
import Slider from '@react-native-community/slider'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTheme } from '../theme/ThemeContext'
import { AlarmIcon, BellIcon, ClockIcon, NoteIcon, RestartIcon, VolumeIcon } from '../components/Icons'

interface Props {
  mainCountdown: string
  subCountdown: string
  progress: number
  onStop: () => void
  volume: number
  onVolumeChange: (v: number) => void
  bgTrack: 1 | 2 | 3
  bgVolume: number
  onBgTrackChange: (t: 1 | 2 | 3) => void
  onBgVolumeChange: (v: number) => void
  snapEnabled: boolean
  onRestartUnsynced: () => void
  onSnapToClock: () => void
  alarmModeEnabled: boolean
  onToggleAlarmMode: () => void
}

const VIEW = 300
const CX = VIEW / 2
const CY = VIEW / 2
const R = 130
const CIRC = 2 * Math.PI * R

const BG_TRACKS: { id: 1 | 2 | 3; name: string }[] = [
  { id: 1, name: 'Ocean' },
  { id: 2, name: '432hz' },
  { id: 3, name: 'Lofi' },
]

const ringSize = Math.min(Dimensions.get('window').width * 0.78, 320)

function timeToSecs(s: string): number {
  const [m, sec] = s.split(':').map(Number)
  return (m || 0) * 60 + (sec || 0)
}

export function RunningScreen({
  mainCountdown, subCountdown, progress, onStop,
  volume, onVolumeChange,
  bgTrack, bgVolume, onBgTrackChange, onBgVolumeChange,
  snapEnabled, onRestartUnsynced, onSnapToClock,
  alarmModeEnabled, onToggleAlarmMode,
}: Props) {
  const { tokens } = useTheme()
  const insets = useSafeAreaInsets()
  const [openPanel, setOpenPanel] = useState<'track' | 'volume' | 'bell' | null>(null)
  const prevCountdownRef = useRef(mainCountdown)
  const pulseAnim = useRef(new Animated.Value(0)).current

  useEffect(() => {
    const prev = prevCountdownRef.current
    prevCountdownRef.current = mainCountdown
    if (prev === '--:--' || mainCountdown === '--:--') return
    if (timeToSecs(mainCountdown) > timeToSecs(prev) + 5) {
      pulseAnim.setValue(1)
      Animated.timing(pulseAnim, { toValue: 0, duration: 700, useNativeDriver: true }).start()
    }
  }, [mainCountdown, pulseAnim])

  const dashOffset = CIRC * (1 - progress)

  // First tap on a volume button opens its slider; a second tap (while it's
  // already open) mutes that channel completely and closes the popup —
  // instead of just toggling the popup open/closed.
  const handleBellPress = () => {
    if (openPanel === 'bell') {
      onVolumeChange(0)
      setOpenPanel(null)
    } else {
      setOpenPanel('bell')
    }
  }

  const handleBgVolumePress = () => {
    if (openPanel === 'volume') {
      onBgVolumeChange(0)
      setOpenPanel(null)
    } else {
      setOpenPanel('volume')
    }
  }

  const ringScale = pulseAnim.interpolate({ inputRange: [0, 1], outputRange: [1, 1.04] })

  return (
    <View style={[
      styles.screen,
      {
        backgroundColor: tokens.bg,
        paddingTop: insets.top,
        paddingBottom: Math.max(insets.bottom, 40),
      },
    ]}>
      <View style={styles.inner}>
        <View style={styles.ringWrap}>
          <Animated.View style={{ transform: [{ scale: ringScale }] }}>
            <Svg width={ringSize} height={ringSize} viewBox={`0 0 ${VIEW} ${VIEW}`} style={styles.ringSvg}>
              <Circle cx={CX} cy={CY} r={R} stroke={tokens.surfaceHi} strokeWidth={3} fill="none" />
              <Circle
                cx={CX}
                cy={CY}
                r={R}
                stroke={tokens.accent}
                strokeWidth={3}
                fill="none"
                strokeLinecap="round"
                strokeDasharray={`${CIRC}, ${CIRC}`}
                strokeDashoffset={dashOffset}
              />
            </Svg>
          </Animated.View>

          <View style={styles.countdownWrap} pointerEvents="none">
            <Text style={[styles.countdownMain, { color: tokens.text }]}>{mainCountdown}</Text>
            <View style={styles.countdownSub}>
              <Text style={[styles.bellGlyph, { color: tokens.textMuted }]}>♪</Text>
              <Text style={[styles.subTime, { color: tokens.textMuted }]}>{subCountdown}</Text>
            </View>
          </View>
        </View>
      </View>

      <View style={styles.bottom}>
        <View style={styles.mediaRow}>
          <View style={styles.mediaRowLeft}>
            <Pressable
              onPress={snapEnabled ? onRestartUnsynced : onSnapToClock}
              style={[styles.mediaBtn, { borderColor: tokens.accent }]}
              accessibilityLabel={snapEnabled ? 'Unsync and restart the timer' : 'Snap the timer to the clock'}
            >
              {snapEnabled ? <RestartIcon color={tokens.accent} /> : <ClockIcon color={tokens.accent} />}
            </Pressable>

            <Pressable
              onPress={handleBellPress}
              style={[styles.mediaBtn, { borderColor: openPanel === 'bell' ? tokens.accent : tokens.border }]}
              accessibilityLabel="Gong & bell volume"
            >
              <BellIcon muted={volume === 0} color={openPanel === 'bell' ? tokens.accent : tokens.textMuted} />
            </Pressable>
          </View>

          <View style={styles.mediaRowRight}>
            <Pressable
              onPress={onToggleAlarmMode}
              style={[
                styles.mediaBtn,
                {
                  borderColor: alarmModeEnabled ? tokens.accent : tokens.border,
                  backgroundColor: alarmModeEnabled ? 'rgba(124,111,247,0.14)' : 'transparent',
                },
              ]}
              accessibilityLabel={alarmModeEnabled ? 'Disable alarm mode' : 'Enable alarm mode'}
            >
              <AlarmIcon color={alarmModeEnabled ? tokens.accent : tokens.textMuted} />
            </Pressable>

            <Pressable
              onPress={() => setOpenPanel(p => (p === 'track' ? null : 'track'))}
              style={[styles.mediaBtn, { borderColor: openPanel === 'track' ? tokens.accent : tokens.border }]}
              accessibilityLabel="Select background track"
            >
              <NoteIcon color={openPanel === 'track' ? tokens.accent : tokens.textMuted} />
            </Pressable>

            <Pressable
              onPress={handleBgVolumePress}
              style={[styles.mediaBtn, { borderColor: openPanel === 'volume' ? tokens.accent : tokens.border }]}
              accessibilityLabel="Background volume"
            >
              <VolumeIcon muted={bgVolume === 0} color={openPanel === 'volume' ? tokens.accent : tokens.textMuted} />
            </Pressable>
          </View>
        </View>

        <Pressable
          onPress={onStop}
          style={({ pressed }) => [
            styles.stopBtn,
            { backgroundColor: tokens.surfaceHi, borderColor: tokens.border, transform: [{ scale: pressed ? 0.97 : 1 }] },
          ]}
        >
          <Text style={[styles.stopLabel, { color: tokens.textMuted }]}>Stop</Text>
        </Pressable>
      </View>

      {/* Popovers render as Modals (their own native overlay layer) rather than
          absolutely-positioned Views — a position:absolute + manual zIndex popup
          nested several levels deep turned out to be unreliable for touch
          delivery on at least one real device (taps didn't reach the Slider at
          all, even though the same Slider component works fine in normal
          document flow on ConfigScreen). Modal sidesteps that whole class of
          bug, and CustomMinutePicker already uses the same pattern reliably. */}

      <Modal transparent animationType="fade" visible={openPanel === 'bell'} onRequestClose={() => setOpenPanel(null)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setOpenPanel(null)}>
          <Pressable
            style={[
              styles.modalSheet,
              { backgroundColor: tokens.surface, borderColor: tokens.border, paddingBottom: Math.max(insets.bottom, 32) },
            ]}
            onPress={e => e.stopPropagation()}
          >
            <Text style={[styles.modalTitle, { color: tokens.textMuted }]}>Gong & bell volume</Text>
            <Slider
              style={styles.modalSlider}
              minimumValue={0}
              maximumValue={1}
              step={0.01}
              value={volume}
              onValueChange={onVolumeChange}
              minimumTrackTintColor={tokens.accent}
              maximumTrackTintColor={tokens.surfaceHi}
              thumbTintColor={tokens.accent}
            />
          </Pressable>
        </Pressable>
      </Modal>

      <Modal transparent animationType="fade" visible={openPanel === 'track'} onRequestClose={() => setOpenPanel(null)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setOpenPanel(null)}>
          <Pressable
            style={[
              styles.modalSheet,
              { backgroundColor: tokens.surface, borderColor: tokens.border, paddingBottom: Math.max(insets.bottom, 32) },
            ]}
            onPress={e => e.stopPropagation()}
          >
            <Text style={[styles.modalTitle, { color: tokens.textMuted }]}>Background track</Text>
            <View style={styles.trackChips}>
              {BG_TRACKS.map(t => (
                <Pressable
                  key={t.id}
                  onPress={() => { onBgTrackChange(t.id); setOpenPanel(null) }}
                  style={[styles.mediaChip, bgTrack === t.id && { backgroundColor: 'rgba(124,111,247,0.18)' }]}
                >
                  <Text style={[styles.mediaChipLabel, { color: bgTrack === t.id ? tokens.accent : tokens.textMuted }]}>
                    {t.name}
                  </Text>
                </Pressable>
              ))}
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal transparent animationType="fade" visible={openPanel === 'volume'} onRequestClose={() => setOpenPanel(null)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setOpenPanel(null)}>
          <Pressable
            style={[
              styles.modalSheet,
              { backgroundColor: tokens.surface, borderColor: tokens.border, paddingBottom: Math.max(insets.bottom, 32) },
            ]}
            onPress={e => e.stopPropagation()}
          >
            <Text style={[styles.modalTitle, { color: tokens.textMuted }]}>Background volume</Text>
            <Slider
              style={styles.modalSlider}
              minimumValue={0}
              maximumValue={1}
              step={0.01}
              value={bgVolume}
              onValueChange={onBgVolumeChange}
              minimumTrackTintColor={tokens.accent}
              maximumTrackTintColor={tokens.surfaceHi}
              thumbTintColor={tokens.accent}
            />
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
  },
  inner: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
  },
  ringWrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  ringSvg: {
    transform: [{ rotate: '-90deg' }],
  },
  countdownWrap: {
    position: 'absolute',
    alignItems: 'center',
    gap: 10,
  },
  countdownMain: {
    fontFamily: 'JetBrainsMono-Light',
    fontSize: 64,
    fontWeight: '300',
    letterSpacing: -1,
  },
  countdownSub: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  bellGlyph: {
    fontSize: 12,
    opacity: 0.6,
  },
  subTime: {
    fontFamily: 'JetBrainsMono-Regular',
    fontSize: 13,
  },
  bottom: {
    width: '100%',
    maxWidth: 420,
  },
  mediaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  mediaRowLeft: {
    flexDirection: 'row',
    gap: 8,
  },
  mediaRowRight: {
    flexDirection: 'row',
    gap: 8,
  },
  mediaBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderWidth: 1.5,
    borderBottomWidth: 0,
    padding: 24,
    gap: 16,
  },
  modalTitle: {
    fontSize: 13,
    fontWeight: '500',
    letterSpacing: 1.3,
    textTransform: 'uppercase',
  },
  modalSlider: {
    width: '100%',
    height: 40,
  },
  trackChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  mediaChip: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 9999,
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  mediaChipLabel: {
    fontSize: 14,
    fontWeight: '500',
  },
  stopBtn: {
    width: '100%',
    paddingVertical: 18,
    borderRadius: 9999,
    borderWidth: 1.5,
    alignItems: 'center',
  },
  stopLabel: {
    fontSize: 15,
    fontWeight: '600',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
})
