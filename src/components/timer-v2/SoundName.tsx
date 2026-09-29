import { Text, type StyleProp, type TextStyle } from 'react-native'
import type { CueSettings } from '../../types'
import { soundChoicesSummary } from '../../lib/soundLibrary'
import { cueSounds } from '../../lib/timerV2'
import { useSoundAvailability } from '../../hooks/use-sound-availability'
import { useTheme } from '../../theme/ThemeContext'

export function SoundName({ cue, style }: { cue: CueSettings; style?: StyleProp<TextStyle> }) {
  const { tokens } = useTheme()
  const available = useSoundAvailability(cue.sound)
  return <Text numberOfLines={1} style={[style, { color: available ? tokens.textMuted : tokens.accent }]}>{soundChoicesSummary(cueSounds(cue))}{available ? '' : ' · Unavailable'}</Text>
}
