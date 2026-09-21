import { useEffect, useRef, useState } from 'react'
import { SheetTextButton } from './SheetTextButton'

interface Props {
  label: string
  accessibilityLabel: string
  disabled?: boolean
  onDelete: () => void
}

/** Shared destructive action that requires a second tap within a short window. */
export function DoubleTapDeleteButton({ label, accessibilityLabel, disabled = false, onDelete }: Props) {
  const [armed, setArmed] = useState(false)
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => {
    if (resetTimer.current) clearTimeout(resetTimer.current)
  }, [])

  const press = () => {
    if (armed) {
      if (resetTimer.current) clearTimeout(resetTimer.current)
      onDelete()
      return
    }
    setArmed(true)
    resetTimer.current = setTimeout(() => setArmed(false), 2_500)
  }

  return <SheetTextButton disabled={disabled} label={armed ? 'Tap again to delete' : label} tone="danger" onPress={press} accessibilityLabel={armed ? `Confirm ${accessibilityLabel.toLowerCase()}` : accessibilityLabel} />
}
