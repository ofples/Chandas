import { useEffect, useRef, useState } from 'react'
import { Modal, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native'
import Svg, { Circle } from 'react-native-svg'
import Slider from '@react-native-community/slider'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTheme } from '../theme/ThemeContext'
import { AlarmIcon, BellIcon, ClockIcon, FocusIcon, RestartIcon } from '../components/Icons'
import { Chip } from '../components/Chip'
import { CustomMinutePicker } from '../components/CustomMinutePicker'
import {
  FlashingTimerCircle,
  TIMER_CIRCLE_CENTER,
  TIMER_CIRCLE_RADIUS,
  TIMER_CIRCLE_VIEW,
} from '../components/FlashingTimerCircle'

interface Props {
  mainCountdown: string
  subCountdown: string
  progress: number
  activeHoursPaused: boolean
  activeHoursResumeAt: number
  onStop: () => void
  volume: number
  onVolumeChange: (v: number) => void
  snapEnabled: boolean
  onRestartUnsynced: () => void
  onSnapToClock: () => void
  alarmModeEnabled: boolean
  onToggleAlarmMode: () => void
  alarmOnceArmed: boolean
  onToggleAlarmOnce: () => void
  mutedUntil: number
  mutedIterationsRemaining: number
  onMuteForIterations: (count: number) => void
  onMuteForMinutes: (minutes: number) => void
  onClearTimedMute: () => void
  focusModeEnabled: boolean
  focusModeActive: boolean
  focusPolicyAccess: boolean
  onToggleFocusMode: () => void
}

const CIRC = 2 * Math.PI * TIMER_CIRCLE_RADIUS

function timeToSecs(s: string): number {
  const [m, sec] = s.split(':').map(Number)
  return (m || 0) * 60 + (sec || 0)
}

export function RunningScreen({
  mainCountdown,
  subCountdown,
  progress,
  activeHoursPaused,
  activeHoursResumeAt,
  onStop,
  volume,
  onVolumeChange,
  snapEnabled,
  onRestartUnsynced,
  onSnapToClock,
  alarmModeEnabled,
  onToggleAlarmMode,
  alarmOnceArmed,
  onToggleAlarmOnce,
  mutedUntil,
  mutedIterationsRemaining,
  onMuteForIterations,
  onMuteForMinutes,
  onClearTimedMute,
  focusModeEnabled,
  focusModeActive,
  focusPolicyAccess,
  onToggleFocusMode,
}: Props) {
  const { tokens } = useTheme()
  const insets = useSafeAreaInsets()
  const { width } = useWindowDimensions()
  const [openPanel, setOpenPanel] = useState<'bell' | null>(null)
  const [showCustomMute, setShowCustomMute] = useState(false)
  const previousCountdownsRef = useRef({ main: mainCountdown, sub: subCountdown })
  const [flashBurst, setFlashBurst] = useState({ trigger: 0, flashes: 1, duration: 650 })
  const alarmLongPressRef = useRef(false)
  const lastVolumeRef = useRef(volume > 0 ? volume : 0.8)

  useEffect(() => {
    if (volume > 0) lastVolumeRef.current = volume
  }, [volume])

  useEffect(() => {
    const previous = previousCountdownsRef.current
    previousCountdownsRef.current = { main: mainCountdown, sub: subCountdown }

    const mainReset = previous.main !== '--:--' && mainCountdown !== '--:--' &&
      timeToSecs(mainCountdown) > timeToSecs(previous.main) + 5
    const subReset = previous.sub !== '--:--' && subCountdown !== '--:--' &&
      timeToSecs(subCountdown) > timeToSecs(previous.sub) + 1

    if (mainReset) {
      setFlashBurst(current => ({ trigger: current.trigger + 1, flashes: 3, duration: 260 }))
    } else if (subReset) {
      setFlashBurst(current => ({ trigger: current.trigger + 1, flashes: 1, duration: 650 }))
    }
  }, [mainCountdown, subCountdown])

  const ringSize = Math.min(width * 0.78, 320)
  const dashOffset = CIRC * (1 - progress)
  const timedMuteActive = mutedIterationsRemaining > 0 || mutedUntil > Date.now()
  const soundMuted = volume === 0 || timedMuteActive
  const resumeDate = new Date(activeHoursResumeAt)
  const resumeTime = activeHoursPaused
    ? `${String(resumeDate.getHours()).padStart(2, '0')}:${String(resumeDate.getMinutes()).padStart(2, '0')}`
    : ''

  const unmute = () => {
    onClearTimedMute()
    if (volume === 0) onVolumeChange(lastVolumeRef.current)
  }

  const toggleMuteVolume = () => {
    if (soundMuted) unmute()
    else onVolumeChange(0)
  }

  const handleBellPress = () => {
    if (soundMuted) {
      unmute()
      setOpenPanel(null)
      return
    }
    if (openPanel === 'bell') {
      toggleMuteVolume()
      setOpenPanel(null)
    } else {
      setOpenPanel('bell')
    }
  }

  const handleAlarmPress = () => {
    if (alarmLongPressRef.current) return
    if (alarmOnceArmed) onToggleAlarmOnce()
    onToggleAlarmMode()
  }

  const handleAlarmLongPress = () => {
    alarmLongPressRef.current = true
    if (alarmModeEnabled) onToggleAlarmMode()
    if (!alarmOnceArmed) onToggleAlarmOnce()
  }

  const chooseIterationMute = (count: number) => {
    if (mutedIterationsRemaining === count && mutedUntil === 0) onClearTimedMute()
    else onMuteForIterations(count)
  }

  const openCustomMute = () => {
    setOpenPanel(null)
    setShowCustomMute(true)
  }

  return (
    <View style={[styles.screen, { backgroundColor: tokens.bg, paddingTop: insets.top }]}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 132 }]}
        showsVerticalScrollIndicator={false}
      >
        <Pressable
          onPress={soundMuted ? unmute : undefined}
          style={[styles.ringWrap, { width: ringSize, height: ringSize }]}
          accessibilityRole={soundMuted ? 'button' : undefined}
          accessibilityLabel={soundMuted ? 'Unmute timer sounds' : undefined}
        >
          <View
            style={[
              styles.timerVisual,
              {
                width: ringSize,
                height: ringSize,
                opacity: activeHoursPaused ? 0.35 : soundMuted ? 0.28 : 1,
              },
            ]}
          >
            <FlashingTimerCircle
              size={ringSize}
              color={tokens.accent}
              trigger={flashBurst.trigger}
              flashes={flashBurst.flashes}
              duration={flashBurst.duration}
            />
            <Svg
              width={ringSize}
              height={ringSize}
              viewBox={`0 0 ${TIMER_CIRCLE_VIEW} ${TIMER_CIRCLE_VIEW}`}
              style={styles.ringSvg}
            >
              <Circle
                cx={TIMER_CIRCLE_CENTER}
                cy={TIMER_CIRCLE_CENTER}
                r={TIMER_CIRCLE_RADIUS}
                stroke={tokens.surfaceHi}
                strokeWidth={3}
                fill="none"
              />
              <Circle
                cx={TIMER_CIRCLE_CENTER}
                cy={TIMER_CIRCLE_CENTER}
                r={TIMER_CIRCLE_RADIUS}
                stroke={tokens.accent}
                strokeWidth={3}
                fill="none"
                strokeLinecap="round"
                strokeDasharray={`${CIRC}, ${CIRC}`}
                strokeDashoffset={dashOffset}
              />
            </Svg>

            <View style={styles.countdownWrap} pointerEvents="none">
              <Text style={[styles.countdownMain, { color: tokens.text }]}>
                {activeHoursPaused ? resumeTime : mainCountdown}
              </Text>
              {activeHoursPaused ? (
                <Text style={[styles.pausedLabel, { color: tokens.textMuted }]}>Resumes</Text>
              ) : (
                <View style={styles.countdownSub}>
                <Text style={[styles.bellGlyph, { color: tokens.textMuted }]}>♪</Text>
                <Text style={[styles.subTime, { color: tokens.textMuted }]}>{subCountdown}</Text>
                </View>
              )}
            </View>
          </View>

          {soundMuted && (
            <View
              pointerEvents="none"
              style={[
                styles.muteSlash,
                { width: ringSize * 0.72, backgroundColor: tokens.accent },
              ]}
            />
          )}
        </Pressable>
      </ScrollView>

      <View style={[styles.bottom, { backgroundColor: tokens.bg, paddingBottom: insets.bottom + 20 }]}>
        <View style={styles.bottomInner}>
          <View style={styles.mediaRow}>
            <View style={styles.mediaRowLeft}>
              <Pressable
                onPress={onRestartUnsynced}
                style={[
                  styles.mediaBtn,
                  {
                    borderColor: tokens.border,
                    backgroundColor: 'transparent',
                  },
                ]}
                accessibilityLabel="Reset the timer"
              >
                <RestartIcon color={tokens.accent} />
              </Pressable>

              {!snapEnabled && (
                <Pressable
                  onPress={onSnapToClock}
                  style={[
                    styles.mediaBtn,
                    {
                      borderColor: tokens.border,
                      backgroundColor: 'transparent',
                    },
                  ]}
                  accessibilityLabel="Snap the timer to the clock"
                >
                  <ClockIcon color={tokens.accent} />
                </Pressable>
              )}

              <Pressable
                onPressIn={() => { alarmLongPressRef.current = false }}
                onPress={handleAlarmPress}
                onLongPress={handleAlarmLongPress}
                onPressOut={() => setTimeout(() => { alarmLongPressRef.current = false }, 0)}
                delayLongPress={500}
                style={[
                  styles.mediaBtn,
                  {
                    borderColor: alarmModeEnabled || alarmOnceArmed ? tokens.accent : tokens.border,
                    backgroundColor: alarmModeEnabled || alarmOnceArmed ? tokens.accentGlow : 'transparent',
                  },
                ]}
                accessibilityLabel={alarmOnceArmed
                  ? 'Alarm armed for one iteration'
                  : alarmModeEnabled
                    ? 'Disable alarm mode'
                    : 'Enable alarm mode'}
                accessibilityHint="Long press to arm the next main iteration only"
              >
                <AlarmIcon color={alarmModeEnabled || alarmOnceArmed ? tokens.accent : tokens.textMuted} />
                {alarmOnceArmed && (
                  <View style={[styles.onceBadge, { backgroundColor: '#4d8fff' }]}>
                    <Text style={styles.onceBadgeLabel}>1</Text>
                  </View>
                )}
              </Pressable>

              <Pressable
                onPress={onToggleFocusMode}
                style={[
                  styles.mediaBtn,
                  {
                    borderColor: focusModeEnabled ? tokens.accent : tokens.border,
                    backgroundColor: focusModeActive ? tokens.accentGlow : 'transparent',
                  },
                ]}
                accessibilityLabel={focusModeEnabled ? 'Disable focus session' : 'Enable focus session'}
                accessibilityHint={!focusPolicyAccess ? 'Requires Do Not Disturb access' : undefined}
              >
                <FocusIcon color={focusModeEnabled ? tokens.accent : tokens.textMuted} />
                {focusModeEnabled && !focusPolicyAccess && (
                  <View style={[styles.onceBadge, { backgroundColor: tokens.accent }]}>
                    <Text style={styles.onceBadgeLabel}>!</Text>
                  </View>
                )}
              </Pressable>
            </View>

            <View style={styles.mediaRowRight}>
              <Pressable
                onPress={handleBellPress}
                style={[
                  styles.mediaBtn,
                  { borderColor: openPanel === 'bell' || soundMuted ? tokens.accent : tokens.border },
                ]}
                accessibilityLabel="Gong and bell volume"
              >
                <BellIcon
                  muted={soundMuted}
                  color={openPanel === 'bell' || soundMuted ? tokens.accent : tokens.textMuted}
                />
              </Pressable>
            </View>
          </View>

          <Pressable
            onPress={onStop}
            style={({ pressed }) => [
              styles.stopBtn,
              {
                backgroundColor: tokens.surfaceHi,
                borderColor: tokens.border,
                transform: [{ scale: pressed ? 0.97 : 1 }],
              },
            ]}
          >
            <Text style={[styles.stopLabel, { color: tokens.textMuted }]}>Stop</Text>
          </Pressable>
        </View>
      </View>

      <Modal transparent animationType="fade" visible={openPanel === 'bell'} onRequestClose={() => setOpenPanel(null)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setOpenPanel(null)}>
          <Pressable
            style={[
              styles.modalSheet,
              { backgroundColor: tokens.surface, borderColor: tokens.border, paddingBottom: insets.bottom + 32 },
            ]}
            onPress={event => event.stopPropagation()}
          >
            <Text style={[styles.modalTitle, { color: tokens.textMuted }]}>Gong and bell volume</Text>
            <View style={styles.modalVolumeRow}>
              <Pressable
                onPress={toggleMuteVolume}
                style={[styles.modalMuteBtn, { borderColor: soundMuted ? tokens.accent : tokens.border }]}
                accessibilityLabel={soundMuted ? 'Unmute' : 'Mute'}
              >
                <BellIcon muted={soundMuted} color={soundMuted ? tokens.accent : tokens.textMuted} />
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

            <View style={styles.mutePresets}>
              <Text style={[styles.mutePresetsLabel, { color: tokens.textMuted }]}>Mute for</Text>
              <View style={styles.mutePresetRow}>
                {[1, 2, 3].map(count => (
                  <Chip
                    key={count}
                    label={`${count}x`}
                    active={mutedIterationsRemaining === count && mutedUntil === 0}
                    onPress={() => chooseIterationMute(count)}
                  />
                ))}
                <Chip label="…" active={mutedUntil > Date.now()} onPress={openCustomMute} />
              </View>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {showCustomMute && (
        <CustomMinutePicker
          title="Mute duration"
          initial={mutedUntil > Date.now() ? Math.ceil((mutedUntil - Date.now()) / 60_000) : 15}
          min={1}
          max={1_440}
          onConfirm={minutes => {
            onMuteForMinutes(minutes)
            setShowCustomMute(false)
          }}
          onClose={() => setShowCustomMute(false)}
        />
      )}

      {focusModeActive && <View pointerEvents="none" style={styles.focusBorder} />}
    </View>
  )
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  focusBorder: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    borderWidth: 3,
    borderColor: '#4d8fff',
    zIndex: 100,
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
  timerVisual: {
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
    fontVariant: ['tabular-nums'],
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
    fontVariant: ['tabular-nums'],
  },
  pausedLabel: {
    fontSize: 11,
    fontWeight: '500',
    letterSpacing: 1.3,
    textTransform: 'uppercase',
  },
  muteSlash: {
    position: 'absolute',
    height: 4,
    borderRadius: 2,
    transform: [{ rotate: '-45deg' }],
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
  onceBadge: {
    position: 'absolute',
    top: -4,
    right: -4,
    width: 15,
    height: 15,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  onceBadgeLabel: {
    color: '#fff',
    fontSize: 9,
    fontWeight: '700',
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
    gap: 20,
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
  mutePresets: {
    gap: 10,
  },
  mutePresetsLabel: {
    fontSize: 11,
    fontWeight: '500',
    letterSpacing: 1.3,
    textTransform: 'uppercase',
  },
  mutePresetRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
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
