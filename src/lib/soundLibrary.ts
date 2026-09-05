import type { BuiltInSoundId, SoundRef } from '../types'

export interface BuiltInSoundDefinition {
  id: BuiltInSoundId
  name: string
  description: string
  source: number
}

const GONG_SOURCE = require('../../assets/sounds/gong.mp3')
const BELL_SOURCE = require('../../assets/sounds/bell.mp3')
const BLOOM_SOURCE = require('../../assets/sounds/bloom.mp3')
const BOXING_BELL_SOURCE = require('../../assets/sounds/boxing_bell.wav')
const BUBBLE_SOURCE = require('../../assets/sounds/bubble.wav')
const CHAMPAGNE_SOURCE = require('../../assets/sounds/champagne.wav')
const CYMBAL_SOURCE = require('../../assets/sounds/cymbal.mp3')
const HANDPAN_SOURCE = require('../../assets/sounds/handpan.mp3')
const HEARTBEAT_SOURCE = require('../../assets/sounds/heartbeat.wav')
const ICE_SOURCE = require('../../assets/sounds/ice.wav')
const INSTAMATIC_SOURCE = require('../../assets/sounds/instamatic.wav')
const MOUSE_CLICK_SOURCE = require('../../assets/sounds/mouse_click.wav')
const PAGE_SOURCE = require('../../assets/sounds/page.wav')
const SINE_BASS_SOURCE = require('../../assets/sounds/sine_bass.mp3')
const SINE_HIGH_SOURCE = require('../../assets/sounds/sine_high.wav')
const SINE_LOW_SOURCE = require('../../assets/sounds/sine_low.wav')
const WATER_DROP_SOURCE = require('../../assets/sounds/water_drop.mp3')
const WIND_SOURCE = require('../../assets/sounds/wind.mp3')

export const BUILT_IN_SOUNDS: BuiltInSoundDefinition[] = [
  { id: 'temple-gong', name: 'Temple gong', description: 'Deep and spacious', source: GONG_SOURCE },
  { id: 'clear-bell', name: 'Clear bell', description: 'Light and direct', source: BELL_SOURCE },
  { id: 'bloom', name: 'Bloom', description: 'Soft and unfolding', source: BLOOM_SOURCE },
  { id: 'boxing-bell', name: 'Boxing bell', description: 'Sharp metallic strike', source: BOXING_BELL_SOURCE },
  { id: 'bubble', name: 'Bubble', description: 'Round liquid pop', source: BUBBLE_SOURCE },
  { id: 'champagne', name: 'Champagne', description: 'Bright sparkling pop', source: CHAMPAGNE_SOURCE },
  { id: 'cymbal', name: 'Cymbal', description: 'Short metallic shimmer', source: CYMBAL_SOURCE },
  { id: 'handpan', name: 'Handpan', description: 'Warm and resonant', source: HANDPAN_SOURCE },
  { id: 'heartbeat', name: 'Heartbeat', description: 'Soft double pulse', source: HEARTBEAT_SOURCE },
  { id: 'ice', name: 'Ice', description: 'Crisp glassy tap', source: ICE_SOURCE },
  { id: 'instamatic', name: 'Instamatic', description: 'Mechanical camera click', source: INSTAMATIC_SOURCE },
  { id: 'mouse-click', name: 'Mouse click', description: 'Small dry click', source: MOUSE_CLICK_SOURCE },
  { id: 'page', name: 'Page', description: 'Light paper flick', source: PAGE_SOURCE },
  { id: 'sine-bass', name: 'Sine bass', description: 'Low pure tone', source: SINE_BASS_SOURCE },
  { id: 'sine-high', name: 'Sine high', description: 'High sustained tone', source: SINE_HIGH_SOURCE },
  { id: 'sine-low', name: 'Sine low', description: 'Low sustained tone', source: SINE_LOW_SOURCE },
  { id: 'water-drop', name: 'Water drop', description: 'Clear water plink', source: WATER_DROP_SOURCE },
  { id: 'wind', name: 'Wind', description: 'Soft airy sweep', source: WIND_SOURCE },
]

export function soundTitle(sound: SoundRef): string {
  if (sound.kind !== 'builtin') return sound.title
  return BUILT_IN_SOUNDS.find(item => item.id === sound.id)?.name ?? 'Built-in sound'
}

export function sourceForSound(sound: SoundRef): number | null {
  if (sound.kind !== 'builtin') return sound.uri ? null : null
  return BUILT_IN_SOUNDS.find(item => item.id === sound.id)?.source ?? BELL_SOURCE
}
