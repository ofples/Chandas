import type { BuiltInSoundId, SoundRef } from '../types'

export interface BuiltInSoundDefinition {
  id: BuiltInSoundId
  name: string
  description: string
  /** Temporary bundled source: the distinct library files can replace these without changing saved references. */
  source: number
}

const GONG_SOURCE = require('../../assets/sounds/gong.mp3')
const BELL_SOURCE = require('../../assets/sounds/bell.mp3')

export const BUILT_IN_SOUNDS: BuiltInSoundDefinition[] = [
  { id: 'temple-gong', name: 'Temple gong', description: 'Deep and spacious', source: GONG_SOURCE },
  { id: 'clear-bell', name: 'Clear bell', description: 'Light and direct', source: BELL_SOURCE },
  { id: 'soft-bowl', name: 'Soft bowl', description: 'Warm and rounded', source: BELL_SOURCE },
  { id: 'wood-block', name: 'Wood block', description: 'Dry and precise', source: BELL_SOURCE },
  { id: 'bright-chime', name: 'Bright chime', description: 'Gentle and lifting', source: BELL_SOURCE },
]

export function soundTitle(sound: SoundRef): string {
  if (sound.kind !== 'builtin') return sound.title
  return BUILT_IN_SOUNDS.find(item => item.id === sound.id)?.name ?? 'Built-in sound'
}

export function sourceForSound(sound: SoundRef): number | null {
  if (sound.kind !== 'builtin') return sound.uri ? null : null
  return BUILT_IN_SOUNDS.find(item => item.id === sound.id)?.source ?? BELL_SOURCE
}
