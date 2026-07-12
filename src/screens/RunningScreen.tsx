import { useEffect, useRef, useState } from 'react'
import { Animated, Modal, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native'
import Svg, { Circle } from 'react-native-svg'
import Slider from '@react-native-community/slider'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTheme } from '../theme/ThemeContext'
import { AlarmIcon, BellIcon, ClockIcon, RestartIcon } from '../components/Icons'

interface Props {
  mainCountdown: string
  subCountdown: string
  progress: number
  onStop: () => void
  volume: number
  onVolumeChange: (v: number) => void
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

function timeToSecs(s: string): number {
  const [m, sec] = s.split(':').map(Number)
  return (m || 0) * 60 + (sec || 0)
}

export function RunningScreen({
  mainCountdown, subCountdown, progress, onStop,
  volume, onVolumeChange,
  snapEnabled, onRestartUnsynced, onSnapToClock,
  alarmModeEnabled, onToggleAlarmMode,
}: Props) {
  const { tokens } = useTheme()
  const insets = useSafeAreaInsets()
  const [openPanel, setOpenPanel] = useState<'bell' | null>(null)
  const { width } = useWindowDimensions()
  const prevCountdownRef = useRef(mainCountdown)
  const pulseAnim = useRef(new Animated.Value(0)).current

  // Remembers the last non-zero level for each channel so the mute button in
  // its modal can restore it, instead of unmuting to an arbitrary default.
  const lastVolumeRef = useRef(volume > 0 ? volume : 0.8)
  useEffect(() => { if (volume > 0) lastVolumeRef.current = volume }, [volume])

  const toggleMuteVolume = () => onVolumeChange(volume > 0 ? 0 : lastVolumeRef.current)

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

  const ringScale = pulseAnim.interpolate({ inputRange: [0, 1], outputRange: [1, 1.04] })
  const ringSize = Math.min(width * 0.78, 320)

  return (
    <View style={[
      styles.screen,
      {
        backgroundColor: tokens.bg,
        paddingTop: insets.top,
      },
    ]}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 132 }]}
        showsVerticalScrollIndicator={false}
      >
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
      </ScrollView>

      <View style={[styles.bottom, { backgroundColor: tokens.bg, paddingBottom: insets.bottom + 20 }]}>
        <View style={styles.bottomInner}>
          <View style={styles.mediaRow}>
            <View style={styles.mediaRowLeft}>
              <Pressable
                onPress={snapEnabled ? onRestartUnsynced : onSnapToClock}
                style={[
                  styles.mediaBtn,
                  {
                    borderColor: snapEnabled ? tokens.accent : tokens.border,
                    backgroundColor: snapEnabled ? 'rgba(124,111,247,0.14)' : 'transparent',
                  },
                ]}
                accessibilityLabel={snapEnabled ? 'Unsync and restart the timer' : 'Snap the timer to the clock'}
                accessibilityState={{ selected: snapEnabled }}
              >
                {snapEnabled ? <RestartIcon color={tokens.accent} /> : <ClockIcon color={tokens.accent} />}
              </Pressable>

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
            </View>

          <View style={styles.mediaRowRight}>
            <Pressable
              onPress={handleBellPress}
              style={[styles.mediaBtn, { borderColor: openPanel === 'bell' ? tokens.accent : tokens.border }]}
              accessibilityLabel="Gong & bell volume"
            >
              <BellIcon muted={volume === 0} color={openPanel === 'bell' ? tokens.accent : tokens.textMuted} />
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
              { backgroundColor: tokens.surface, borderColor: tokens.border, paddingBottom: insets.bottom + 32 },
            ]}
            onPress={e => e.stopPropagation()}
          >
            <Text style={[styles.modalTitle, { color: tokens.textMuted }]}>Gong & bell volume</Text>
            <View style={styles.modalVolumeRow}>
              <Pressable
                onPress={toggleMuteVolume}
                style={[styles.modalMuteBtn, { borderColor: volume === 0 ? tokens.accent : tokens.border }]}
                accessibilityLabel={volume === 0 ? 'Unmute' : 'Mute'}
              >
                <BellIcon muted={volume === 0} color={volume === 0 ? tokens.accent : tokens.textMuted} />
              </Pressable>
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
            </View>
          </Pressable>
        </Pressable>
      </Modal>

    </View>
  )
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  scroll: {
    flex: 1,
    width: '100%',
  },
  scrollContent: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
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
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  bottomInner: {
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
  modalVolumeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  modalMuteBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  modalSlider: {
    flex: 1,
    height: 40,
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
