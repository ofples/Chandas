import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import Slider from '@react-native-community/slider'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { TimerConfig } from '../types'
import { useTheme } from '../theme/ThemeContext'
import { IntervalPicker } from '../components/IntervalPicker'
import { SnapConfig } from '../components/SnapConfig'
import { Toggle } from '../components/Toggle'
import { ChevronIcon, ThemeIcon, VolumeIcon } from '../components/Icons'
import { isNativeServiceAvailable, SlotTimerService } from '../native/SlotTimerService'
import { ActiveHoursConfig } from '../components/ActiveHoursConfig'

const APP_VERSION = '0.2.0'

const MAIN_PRESETS = [10, 15, 30]
const SUB_PRESETS = [5, 10, 15]

interface Props {
  config: TimerConfig
  onChange: (c: TimerConfig) => void
  onStart: () => void
  focusPolicyAccess: boolean
  onFocusModeChange: (enabled: boolean) => void
  onOpenFocusSettings: () => void
  advancedSettingsExpanded: boolean
  onAdvancedSettingsChange: (expanded: boolean) => void
}

export function ConfigScreen({
  config,
  onChange,
  onStart,
  focusPolicyAccess,
  onFocusModeChange,
  onOpenFocusSettings,
  advancedSettingsExpanded,
  onAdvancedSettingsChange,
}: Props) {
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

  const handleAlarmToggle = (enabled: boolean) => {
    if (
      enabled &&
      Platform.OS === 'android' &&
      isNativeServiceAvailable &&
      !SlotTimerService.canUseFullScreenIntent()
    ) {
      SlotTimerService.openFullScreenIntentSettings()
    }
    set('alarmModeEnabled', enabled)
  }

  return (
    <View style={[styles.screen, { backgroundColor: tokens.bg }]}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingTop: insets.top + 52, paddingBottom: insets.bottom + 124 },
        ]}
        showsVerticalScrollIndicator={false}
      >
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
            <Pressable
              onPress={() => set('volume', 0)}
              style={({ pressed }) => [
                styles.volumeBtn,
                {
                  borderColor: config.volume === 0 ? tokens.accent : tokens.border,
                  backgroundColor: config.volume === 0 ? 'rgba(124,111,247,0.1)' : 'transparent',
                  opacity: pressed ? 0.7 : 1,
                },
              ]}
              accessibilityRole="button"
              accessibilityLabel={config.volume === 0 ? 'Timer sounds muted' : 'Mute timer sounds'}
              accessibilityState={{ disabled: config.volume === 0 }}
              disabled={config.volume === 0}
            >
              <VolumeIcon muted={config.volume === 0} color={config.volume === 0 ? tokens.accent : tokens.textMuted} />
            </Pressable>
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
          </View>
        </View>

        {!advancedSettingsExpanded && (
          <Pressable
            onPress={() => onAdvancedSettingsChange(true)}
            style={({ pressed }) => [styles.modeBtn, { opacity: pressed ? 0.65 : 1 }]}
            accessibilityRole="button"
            accessibilityState={{ expanded: false }}
          >
            <Text style={[styles.modeBtnLabel, { color: tokens.textMuted }]}>Advanced</Text>
            <ChevronIcon up={false} color={tokens.textMuted} />
          </Pressable>
        )}

        {advancedSettingsExpanded && (
          <View style={styles.advancedSettings}>
            <ActiveHoursConfig
              enabled={config.activeHoursEnabled}
              startMinutes={config.activeHoursStart}
              endMinutes={config.activeHoursEnd}
              onToggle={value => set('activeHoursEnabled', value)}
              onStartChange={value => set('activeHoursStart', value)}
              onEndChange={value => set('activeHoursEnd', value)}
            />

            {Platform.OS === 'android' && isNativeServiceAvailable && (
              <View style={styles.section}>
                <View style={styles.toggleRow}>
                  <Text style={[styles.sectionLabel, { color: tokens.textMuted }]}>Focus session</Text>
                  <Toggle
                    value={config.focusModeEnabled}
                    onChange={onFocusModeChange}
                    accessibilityLabel="Focus session"
                  />
                </View>
                {config.focusModeEnabled && !focusPolicyAccess && (
                  <Pressable
                    onPress={onOpenFocusSettings}
                    style={({ pressed }) => [
                      styles.focusAccess,
                      { borderColor: tokens.accent, opacity: pressed ? 0.75 : 1 },
                    ]}
                    accessibilityRole="button"
                  >
                    <Text style={[styles.focusAccessLabel, { color: tokens.accent }]}>Grant DND access</Text>
                  </Pressable>
                )}
              </View>
            )}

            <View style={styles.section}>
              <View style={styles.toggleRow}>
                <Text style={[styles.sectionLabel, { color: tokens.textMuted }]}>Alarm mode</Text>
                <Toggle
                  value={config.alarmModeEnabled}
                  onChange={handleAlarmToggle}
                  accessibilityLabel="Alarm mode"
                />
              </View>
            </View>

            <Pressable
              onPress={() => onAdvancedSettingsChange(false)}
              style={({ pressed }) => [styles.modeBtn, { opacity: pressed ? 0.65 : 1 }]}
              accessibilityRole="button"
              accessibilityLabel="Show simplified settings"
            >
              <Text style={[styles.modeBtnLabel, { color: tokens.textMuted }]}>Simplified</Text>
              <ChevronIcon up color={tokens.textMuted} />
            </Pressable>
          </View>
        )}

        </View>
      </ScrollView>

      <View style={[styles.bottom, { backgroundColor: tokens.bg, paddingBottom: insets.bottom + 20 }]}>
        <View style={styles.bottomInner}>
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
      </View>

      <Pressable
        onPress={toggleTheme}
        style={[styles.themeBtn, { top: Math.max(insets.top, 16), borderColor: tokens.border }]}
        accessibilityLabel={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
      >
        <ThemeIcon dark={theme === 'dark'} color={tokens.textMuted} />
      </Pressable>

      <Text style={[styles.version, { color: tokens.textMuted, bottom: insets.bottom + 90 }]}>
        v{APP_VERSION}
      </Text>
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
  focusAccess: {
    alignSelf: 'flex-start',
    borderWidth: 1.5,
    borderRadius: 9999,
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  focusAccessLabel: {
    fontSize: 12,
    fontWeight: '600',
  },
  volumeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  slider: {
    flex: 1,
  },
  volumeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modeBtn: {
    alignSelf: 'center',
    minHeight: 36,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    paddingHorizontal: 12,
  },
  modeBtnLabel: {
    fontSize: 12,
    fontWeight: '600',
  },
  advancedSettings: {
    gap: 28,
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
