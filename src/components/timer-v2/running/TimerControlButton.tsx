import { useAppReducedMotion } from '../../../theme/ThemeContext'
import type { ReactNode } from 'react'
import { useRef } from 'react'
import { Pressable, StyleSheet, Text } from 'react-native'
import Animated, { FadeIn } from 'react-native-reanimated'
import { tapHaptic } from '../../../lib/haptics'
import { useTheme } from '../../../theme/ThemeContext'

interface Props {
  children: ReactNode
  label: string
  tooltip: string
  active?: boolean
  disabled?: boolean
  badge?: string
  size?: number
  filled?: boolean
  onPress: () => void
  onLongPress?: () => void
  onTooltip?: (message: string) => void
}

export function TimerControlButton({ children, label, tooltip, active = false, disabled = false, badge, size = 40, filled = false, onPress, onLongPress, onTooltip }: Props) {
  const { tokens, theme } = useTheme()
  const reducedMotion = useAppReducedMotion()
  const longPressed = useRef(false)
  const showLongPress = () => {
    longPressed.current = true
    if (onLongPress) onLongPress()
    else onTooltip?.(tooltip)
  }
  return <Pressable
    disabled={disabled}
    hitSlop={Math.max(2, (48 - size) / 2)}
    onPressIn={() => { longPressed.current = false }}
    onLongPress={showLongPress}
    delayLongPress={450}
    onPressOut={() => setTimeout(() => { longPressed.current = false }, 0)}
    onPress={() => { if (!longPressed.current) { tapHaptic(); onPress() } }}
    accessibilityRole="button"
    accessibilityLabel={label}
    accessibilityHint={tooltip}
    accessibilityState={{ selected: active, disabled }}
    style={({ pressed }) => [styles.button, filled && theme !== 'eink' && styles.filled, { width: size, height: size, borderRadius: size / 2, borderColor: tokens.border, backgroundColor: active ? tokens.accentGlow : filled ? tokens.surface : 'transparent', opacity: disabled && theme !== 'eink' ? 0.38 : pressed && theme !== 'eink' ? 0.72 : 1, transform: [{ scale: pressed && !disabled && !reducedMotion ? 0.92 : 1 }] }]}
  >
    {children}
    {badge ? <Animated.View entering={reducedMotion ? undefined : FadeIn.duration(120)} style={[styles.badge, { backgroundColor: tokens.accent }]}><Text style={styles.badgeText}>{badge}</Text></Animated.View> : null}
  </Pressable>
}

const styles = StyleSheet.create({
  button: { borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  filled: { elevation: 10, shadowColor: '#000', shadowOpacity: 0.22, shadowRadius: 7, shadowOffset: { width: 0, height: 3 } },
  badge: { position: 'absolute', right: -2, top: -3, minWidth: 14, height: 14, borderRadius: 7, paddingHorizontal: 3, alignItems: 'center', justifyContent: 'center' },
  badgeText: { color: '#fff', fontSize: 8, fontWeight: '900' },
})
