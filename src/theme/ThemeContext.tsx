import { createContext, useContext, useEffect, useMemo, useState, ReactNode } from 'react'
import { useColorScheme } from 'react-native'
import { ReduceMotion, ReducedMotionConfig, useReducedMotion } from 'react-native-reanimated'
import AsyncStorage from '@react-native-async-storage/async-storage'
import type { SubBellColorId } from '../types'
import { normalizeSubBellColor, subBellColorValue } from '../lib/subBellColors'
import { darkTheme, einkTheme, lightTheme, ThemeName, ThemeTokens, withAccent } from './tokens'

const THEME_KEY = 'chandas-theme'
const ACCENT_KEY = 'chandas-accent-color'

interface ThemeContextValue {
  theme: ThemeName
  tokens: ThemeTokens
  toggleTheme: () => void
  useEinkTheme: () => void
  accentColor: SubBellColorId
  setAccentColor: (value: SubBellColorId) => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

export function ThemeProvider({ children, themeOverride }: { children: ReactNode; themeOverride?: ThemeName | 'system' }) {
  const [theme, setTheme] = useState<ThemeName>('dark')
  const [accentColor, setAccentColorState] = useState<SubBellColorId>('violet')
  const systemScheme = useColorScheme()

  useEffect(() => {
    AsyncStorage.multiGet([THEME_KEY, ACCENT_KEY]).then(([[, savedTheme], [, savedAccent]]) => {
      if (savedTheme === 'dark' || savedTheme === 'light' || savedTheme === 'eink') setTheme(savedTheme)
      if (savedAccent) setAccentColorState(normalizeSubBellColor(savedAccent, 0))
    }).catch(() => undefined)
  }, [])

  const toggleTheme = () => {
    setTheme(t => {
      const next = t === 'dark' ? 'light' : 'dark'
      AsyncStorage.setItem(THEME_KEY, next).catch(() => {})
      return next
    })
  }

  const useEinkTheme = () => {
    setTheme('eink')
    AsyncStorage.setItem(THEME_KEY, 'eink').catch(() => {})
  }

  const setAccentColor = (value: SubBellColorId) => {
    setAccentColorState(value)
    AsyncStorage.setItem(ACCENT_KEY, value).catch(() => undefined)
  }

  // E-ink is an intentional global reading mode, including in the independent
  // service-owned widget React surface. It takes precedence over its local
  // light/dark preference until the normal toggle is tapped again.
  const effectiveTheme: ThemeName = theme === 'eink' ? 'eink' : themeOverride === 'system' ? (systemScheme === 'light' ? 'light' : 'dark') : themeOverride ?? theme
  const tokens = useMemo(() => effectiveTheme === 'eink'
    ? einkTheme
    : withAccent(effectiveTheme === 'dark' ? darkTheme : lightTheme, subBellColorValue(accentColor, 0)), [accentColor, effectiveTheme])

  return (
    <ThemeContext.Provider value={{ theme: effectiveTheme, tokens, toggleTheme, useEinkTheme, accentColor, setAccentColor }}>
      <ReducedMotionConfig mode={effectiveTheme === 'eink' ? ReduceMotion.Always : ReduceMotion.System} />
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider')
  return ctx
}

/** Combines the device accessibility preference with the e-ink display mode. */
export function useAppReducedMotion(): boolean {
  const systemReducedMotion = useReducedMotion()
  return systemReducedMotion || useTheme().theme === 'eink'
}
