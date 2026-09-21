import { useEffect, useState } from 'react'
import { AppState } from 'react-native'
import type { SoundRef } from '../types'
import { ChandasTimerService } from '../native/ChandasTimerService'

function safelyCheckSound(sound: SoundRef): boolean {
  try {
    return ChandasTimerService.isSoundAvailable(sound)
  } catch {
    return false
  }
}

/** Runtime URI availability is derived, not persisted into immutable presets. */
export function useSoundAvailability(sound: SoundRef): boolean {
  const key = sound.kind === 'builtin' ? sound.id : sound.uri
  const [available, setAvailable] = useState(() => safelyCheckSound(sound))
  useEffect(() => {
    const refresh = () => setAvailable(safelyCheckSound(sound))
    refresh()
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') refresh() })
    return () => subscription.remove()
  // Sound metadata can change without URI identity; availability cannot.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return available
}
