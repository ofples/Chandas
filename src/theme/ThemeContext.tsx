import { createContext, useContext, useEffect, useMemo, useState, ReactNode } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'
import type { SubBellColorId } from '../types'
import { normalizeSubBellColor, subBellColorValue } from '../lib/subBellColors'
import { darkTheme, lightTheme, ThemeName, ThemeTokens, withAccent } from './tokens'

const THEME_KEY = 'chandas-theme'
const ACCENT_KEY = 'chandas-accent-color'

interface ThemeContextValue {
  theme: ThemeName
  tokens: ThemeTokens
  toggleTheme: () => void
  accentColor: SubBellColorId
  setAccentColor: (value: SubBellColorId) => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<ThemeName>('dark')
  const [accentColor, setAccentColorState] = useState<SubBellColorId>('violet')

  useEffect(() => {
    AsyncStorage.multiGet([THEME_KEY, ACCENT_KEY]).then(([[, savedTheme], [, savedAccent]]) => {
      if (savedTheme === 'dark' || savedTheme === 'light') setTheme(savedTheme)
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

  const setAccentColor = (value: SubBellColorId) => {
    setAccentColorState(value)
    AsyncStorage.setItem(ACCENT_KEY, value).catch(() => undefined)
  }

  const tokens = useMemo(() => withAccent(theme === 'dark' ? darkTheme : lightTheme, subBellColorValue(accentColor, 0)), [accentColor, theme])

  return (
    <ThemeContext.Provider value={{ theme, tokens, toggleTheme, accentColor, setAccentColor }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider')
  return ctx
}
