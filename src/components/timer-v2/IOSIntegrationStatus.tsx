import { useEffect, useState } from 'react'
import { AppState, Platform, Pressable, StyleSheet, Text, View } from 'react-native'
import { ChandasTimerService } from '../../native/ChandasTimerService'
import { useTheme } from '../../theme/ThemeContext'

export function IOSIntegrationStatus({ compact = false }: { compact?: boolean }) {
  const { tokens } = useTheme()
  const [status, setStatus] = useState(ChandasTimerService.getIOSSystemStatus)
  useEffect(() => {
    if (Platform.OS !== 'ios') return
    const native = ChandasTimerService.addIOSSystemStatusListener(setStatus)
    const resumed = AppState.addEventListener('change', value => { if (value === 'active') setStatus(ChandasTimerService.getIOSSystemStatus()) })
    return () => { native?.remove(); resumed.remove() }
  }, [])
  if (Platform.OS !== 'ios') return null
  if (compact && !status?.error && (!status?.activeCount || !status.backgroundScheduledThrough)) return null
  const coverage = status?.backgroundScheduledThrough
  const deadline = coverage && coverage > 0 ? new Date(coverage) : null
  const deadlineLabel = deadline?.toLocaleString([], { ...(deadline.toDateString() !== new Date().toDateString() ? { month: 'short', day: 'numeric' } as const : {}), hour: '2-digit', minute: '2-digit' })
  const summary = status?.error ?? (coverage === -1 ? 'Background bells repeat automatically' : coverage ? `Background bells scheduled until ${deadlineLabel}` : status?.activeCount ? 'No background bells are scheduled yet.' : status?.notifications ? 'Notifications are allowed. Start a timer to schedule bells.' : status ? 'Allow notifications to hear bells while Chandas is closed.' : 'Background bells require an installed iPhone build.')
  return <View style={styles.section} accessibilityLiveRegion="polite">
    <Text numberOfLines={compact ? 1 : undefined} style={[compact ? styles.compact : styles.body, { color: status?.error ? tokens.warm : tokens.textMuted }]}>{summary}</Text>
    {!compact ? <>
      <Text style={[styles.body, { color: tokens.textMuted }]}>Regular bell patterns can repeat automatically. Other timers have a limited background schedule; reopening Chandas extends it. Background bells appear as notifications and follow your iPhone’s alert volume, silent mode and Focus. iPhone controls background vibration. Sound excerpts are limited to 29 seconds; previews play the full source.</Text>
      <Text style={[styles.body, { color: tokens.textMuted }]}>{status?.alarmKit ? `System alarms ${status.alarmsAuthorized ? 'are allowed' : 'need separate permission'}. They can sound through silent mode and Focus and ring until dismissed. Automatic ring duration is controlled by iOS.` : 'Prominent interval alarms require iOS 26 or later. Ordinary bells remain available.'}</Text>
      <Text style={[styles.body, { color: tokens.textMuted }]}>Live Activities show the last timer you opened, with elapsed or total remaining time. iOS controls visibility and ends them after eight hours. Focus and audio output are managed by iPhone.</Text>
      <Pressable accessibilityRole="button" onPress={ChandasTimerService.openNotificationSettings} style={styles.button}><Text style={{ color: tokens.accent }}>iPhone settings ›</Text></Pressable>
    </> : null}
  </View>
}
const styles = StyleSheet.create({ section: { gap: 12 }, body: { fontSize: 14, lineHeight: 21 }, compact: { fontSize: 12, lineHeight: 17, textAlign: 'center' }, button: { minHeight: 44, justifyContent: 'center' } })
