import { useEffect, useState } from 'react'
import { AppState } from 'react-native'
import type { SoundRef } from '../types'
import { ChandasTimerService } from '../native/ChandasTimerService'

/** Runtime URI availability is derived, not persisted into immutable presets. */
export function useSoundAvailability(sound: SoundRef): boolean {
  const key = sound.kind === 'builtin' ? sound.id : sound.uri
  const [available, setAvailable] = useState(() => ChandasTimerService.isSoundAvailable(sound))
  useEffect(() => {
    const refresh = () => setAvailable(ChandasTimerService.isSoundAvailable(sound))
    refresh()
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') refresh() })
    return () => subscription.remove()
  // Sound metadata can change without URI identity; availability cannot.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return available
}
