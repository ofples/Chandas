import { useEffect, useState } from 'react'
import { Keyboard } from 'react-native'

/** Keeps keyboard-dependent spacing consistent across screens and sheets. */
export function useKeyboardVisible(enabled = true): boolean {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (!enabled) {
      setVisible(false)
      return
    }
    const show = Keyboard.addListener('keyboardDidShow', () => setVisible(true))
    const hide = Keyboard.addListener('keyboardDidHide', () => setVisible(false))
    return () => {
      show.remove()
      hide.remove()
    }
  }, [enabled])

  return visible
}
