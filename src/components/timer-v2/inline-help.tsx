import { createContext, type ReactNode, use } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import Animated, { FadeInDown, FadeOut, useReducedMotion } from 'react-native-reanimated'
import { useTheme } from '../../theme/ThemeContext'
import { tapHaptic } from '../../lib/haptics'

interface SetupHelpState {
  visible: boolean
  onChange?: (visible: boolean) => void
}

const SetupHelpContext = createContext<SetupHelpState>({ visible: false })

export function SetupHelpProvider({ visible, onChange, children }: { visible: boolean; onChange: (visible: boolean) => void; children: ReactNode }) {
  return <SetupHelpContext value={{ visible, onChange }}>{children}</SetupHelpContext>
}

export function useSetupHelp() {
  return use(SetupHelpContext)
}

export function ContextualHelp({ children }: { children?: ReactNode }) {
  return <InlineHelp visible={useSetupHelp().visible}>{children}</InlineHelp>
}

export function HelpToggleButton({ active, onPress }: { active: boolean; onPress: () => void }) {
  const { tokens } = useTheme()
  return (
    <Pressable
      hitSlop={5}
      onPress={() => { tapHaptic(); onPress() }}
      style={[styles.toggle, { borderColor: active ? tokens.accent : tokens.border, backgroundColor: active ? tokens.accentGlow : 'transparent' }]}
      accessibilityRole="button"
      accessibilityState={{ expanded: active }}
      accessibilityLabel={active ? 'Hide setup explanations' : 'Show setup explanations'}
    >
      <Text style={[styles.toggleText, { color: tokens.accent }]}>?</Text>
    </Pressable>
  )
}

export function InlineHelp({ visible, children }: { visible: boolean; children?: ReactNode }) {
  const { tokens } = useTheme()
  const reducedMotion = useReducedMotion()
  if (!visible || !children) return null
  return (
    <Animated.View
      entering={FadeInDown.duration(reducedMotion ? 70 : 150)}
      exiting={FadeOut.duration(reducedMotion ? 60 : 100)}
      style={styles.help}
    >
      <View style={[styles.icon, { borderColor: tokens.accent }]} accessibilityElementsHidden>
        <Text style={[styles.iconText, { color: tokens.accent }]}>i</Text>
      </View>
      <Text selectable style={[styles.text, { color: tokens.textMuted }]}>{children}</Text>
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  help: { flexDirection: 'row', alignItems: 'flex-start', gap: 9, paddingRight: 18 },
  icon: { width: 18, height: 18, borderWidth: 1, borderRadius: 9, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  iconText: { fontSize: 10, lineHeight: 12, fontWeight: '800' },
  text: { flex: 1, minWidth: 0, fontSize: 12, lineHeight: 18 },
  toggle: { width: 36, height: 36, borderWidth: 1.5, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  toggleText: { fontSize: 17, fontWeight: '800' },
})
