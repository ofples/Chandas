// Design tokens ported 1:1 from legacy-web/src/App.css (:root / [data-theme="light"]).

export interface ThemeTokens {
  bg: string
  surface: string
  surfaceHi: string
  accent: string
  accentDim: string
  accentGlow: string
  positive: string
  positiveGlow: string
  warm: string
  warmGlow: string
  text: string
  textMuted: string
  textDisabled: string
  border: string
}

export const darkTheme: ThemeTokens = {
  bg: '#0b0c10',
  surface: '#16171e',
  surfaceHi: '#1e1f28',
  accent: '#7c6ff7',
  accentDim: '#3d3880',
  accentGlow: 'rgba(124, 111, 247, 0.25)',
  positive: '#72b6a1',
  positiveGlow: 'rgba(114, 182, 161, 0.15)',
  warm: '#d5aa70',
  warmGlow: 'rgba(213, 170, 112, 0.14)',
  text: '#e8e8f0',
  textMuted: '#5a5a72',
  textDisabled: '#2e2e3e',
  border: 'rgba(255,255,255,0.07)',
}

export const lightTheme: ThemeTokens = {
  bg: '#f5f5f7',
  surface: '#ffffff',
  surfaceHi: '#ebebef',
  accent: '#6255e0',
  accentDim: '#c4bffa',
  accentGlow: 'rgba(98, 85, 224, 0.2)',
  positive: '#397c69',
  positiveGlow: 'rgba(57, 124, 105, 0.11)',
  warm: '#93682f',
  warmGlow: 'rgba(147, 104, 47, 0.10)',
  text: '#1a1a2e',
  textMuted: '#7a7a96',
  textDisabled: '#c8c8d8',
  border: 'rgba(0,0,0,0.09)',
}

export const radius = {
  pill: 9999,
  lg: 16,
}

export type ThemeName = 'dark' | 'light'
