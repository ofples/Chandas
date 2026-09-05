import type { ReactNode } from 'react'
import { StyleSheet, Text } from 'react-native'
import { useTheme } from '../../theme/ThemeContext'

/** Shared section/field heading for Timer v2 sheets. */
export function SheetSectionTitle({ children }: { children: ReactNode }) {
  const { tokens } = useTheme()
  return <Text style={[styles.title, { color: tokens.text }]}>{children}</Text>
}

const styles = StyleSheet.create({
  title: { fontSize: 14, lineHeight: 20, fontWeight: '700' },
})
