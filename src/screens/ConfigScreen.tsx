import * as Notifications from 'expo-notifications'
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native'
import Slider from '@react-native-community/slider'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { TimerConfig } from '../types'
import { useTheme } from '../theme/ThemeContext'
import { IntervalPicker } from '../components/IntervalPicker'
import { SnapConfig } from '../components/SnapConfig'
import { Toggle } from '../components/Toggle'
import { BellIcon, ThemeIcon, VolumeIcon } from '../components/Icons'

const APP_VERSION = '0.2.0'

const MAIN_PRESETS = [10, 15, 30]
const SUB_PRESETS = [5, 10, 15]

interface Props {
  config: TimerConfig
  onChange: (c: TimerConfig) => void
  onStart: () => void
}

export function ConfigScreen({ config, onChange, onStart }: Props) {
  const { tokens, theme, toggleTheme } = useTheme()
  const insets = useSafeAreaInsets()

  const set = <K extends keyof TimerConfig>(key: K, val: TimerConfig[K]) =>
    onChange({ ...config, [key]: val })

  const handleMainChange = (v: number) => {
    const newSub = config.subInterval >= v
      ? [...SUB_PRESETS].reverse().find(p => p < v) ?? Math.max(1, v - 1)
      : config.subInterval
    onChange({ ...config, mainInterval: v, subInterval: newSub })
  }

  const handleNotifToggle = async () => {
    const next = !config.notificationsEnabled
    if (next && Platform.OS === 'android') {
      const { status } = await Notifications.getPermissionsAsync()
      if (status !== 'granted') await Notifications.requestPermissionsAsync()
    }
    set('notificationsEnabled', next)
  }

  return (
    <View style={[styles.screen, { backgroundColor: tokens.bg, paddingTop: Math.max(insets.top, 24), paddingBottom: Math.max(insets.bottom, 24) }]}>
      <View style={styles.inner}>
        <IntervalPicker
          label="Main interval"
          value={config.mainInterval}
          presets={MAIN_PRESETS}
          onChange={handleMainChange}
          pickerTitle="Main interval (minutes)"
          pickerMin={1}
          pickerMax={240}
        />

        <IntervalPicker
          label="Sub interval"
          value={config.subInterval}
          presets={SUB_PRESETS}
          onChange={v => set('subInterval', v)}
          disabledAbove={config.mainInterval}
          pickerTitle="Sub interval (minutes)"
          pickerMin={1}
          pickerMax={config.mainInterval - 1}
          toggle={config.subEnabled}
          onToggle={v => set('subEnabled', v)}
        />

        <SnapConfig
          enabled={config.snapEnabled}
          offset={config.snapOffset}
          onToggle={v => set('snapEnabled', v)}
          onOffsetChange={v => set('snapOffset', v)}
        />

        <View style={styles.section}>
          <Text style={[styles.sectionLabel, { color: tokens.textMuted }]}>Volume</Text>
          <View style={styles.volumeRow}>
            <VolumeIcon level={config.volume} color={tokens.textMuted} />
            <Slider
              style={styles.slider}
              minimumValue={0}
              maximumValue={1}
              step={0.05}
              value={config.volume}
              onValueChange={v => set('volume', v)}
              minimumTrackTintColor={tokens.accent}
              maximumTrackTintColor={tokens.surfaceHi}
              thumbTintColor={tokens.accent}
            />
            <Pressable
              onPress={handleNotifToggle}
              style={[
                styles.notifBtn,
                {
                  borderColor: config.notificationsEnabled ? tokens.accent : tokens.border,
                  backgroundColor: config.notificationsEnabled ? 'rgba(124,111,247,0.1)' : 'transparent',
                },
              ]}
              accessibilityLabel={config.notificationsEnabled ? 'Disable notifications' : 'Enable notifications'}
            >
              <BellIcon on={config.notificationsEnabled} color={config.notificationsEnabled ? tokens.accent : tokens.textDisabled} />
            </Pressable>
          </View>
        </View>

        <View style={styles.section}>
          <View style={styles.toggleRow}>
            <Text style={[styles.sectionLabel, { color: tokens.textMuted }]}>Alarm mode</Text>
            <Toggle
              value={config.alarmModeEnabled}
              onChange={v => set('alarmModeEnabled', v)}
              accessibilityLabel="Alarm mode"
            />
          </View>
          <Text style={[styles.helperText, { color: tokens.textMuted }]}>
            The main gong rings continuously, full-screen, until dismissed
          </Text>
        </View>

        <Pressable
          onPress={onStart}
          style={({ pressed }) => [
            styles.startBtn,
            { backgroundColor: tokens.accent, transform: [{ scale: pressed ? 0.97 : 1 }] },
          ]}
        >
          <Text style={styles.startLabel}>Start</Text>
        </Pressable>
      </View>

      <Pressable
        onPress={toggleTheme}
        style={[styles.themeBtn, { top: Math.max(insets.top, 16), borderColor: tokens.border }]}
        accessibilityLabel={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
      >
        <ThemeIcon dark={theme === 'dark'} color={tokens.textMuted} />
      </Pressable>

      <Text style={[styles.version, { color: tokens.textMuted, bottom: Math.max(insets.bottom, 8) }]}>
        v{APP_VERSION}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  inner: {
    width: '100%',
    maxWidth: 420,
    gap: 28,
  },
  section: {
    gap: 12,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '500',
    letterSpacing: 1.3,
    textTransform: 'uppercase',
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  helperText: {
    fontSize: 12,
    opacity: 0.8,
  },
  volumeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  slider: {
    flex: 1,
  },
  notifBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  startBtn: {
    width: '100%',
    paddingVertical: 18,
    borderRadius: 9999,
    alignItems: 'center',
  },
  startLabel: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  themeBtn: {
    position: 'absolute',
    right: 16,
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  version: {
    position: 'absolute',
    left: 12,
    fontSize: 10,
    opacity: 0.4,
  },
})
