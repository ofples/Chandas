import { Text, type StyleProp, type TextStyle } from 'react-native'
import type { SoundRef } from '../../types'
import { soundTitle } from '../../lib/soundLibrary'
import { useSoundAvailability } from '../../hooks/use-sound-availability'
import { useTheme } from '../../theme/ThemeContext'

export function SoundName({ sound, style }: { sound: SoundRef; style?: StyleProp<TextStyle> }) {
  const { tokens } = useTheme()
  const available = useSoundAvailability(sound)
  return <Text numberOfLines={1} style={[style, { color: available ? tokens.textMuted : tokens.accent }]}>{soundTitle(sound)}{available ? '' : ' · Unavailable'}</Text>
}
