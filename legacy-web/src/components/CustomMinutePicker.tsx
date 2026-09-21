import { useEffect, useRef, useState } from 'react'

interface Props {
  title: string
  initial: number
  min?: number
  max?: number
  onConfirm: (value: number) => void
  onClose: () => void
}

export function CustomMinutePicker({ title, initial, min = 1, max = 59, onConfirm, onClose }: Props) {
  const [value, setValue] = useState(initial)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose()
  }

  const handleConfirm = () => {
    const clamped = Math.max(min, Math.min(max, value))
    onConfirm(clamped)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleConfirm()
    if (e.key === 'Escape') onClose()
  }

  return (
    <div className="modal-overlay" onClick={handleOverlayClick}>
      <div className="modal-sheet">
        <div className="modal-title">{title}</div>
        <div className="modal-input-row">
          <input
            ref={inputRef}
            className="modal-input"
            type="number"
            min={min}
            max={max}
            value={value}
            onChange={e => setValue(Number(e.target.value))}
            onKeyDown={handleKeyDown}
          />
          <span className="modal-unit">min</span>
        </div>
        <button className="modal-confirm" onClick={handleConfirm}>
          Set
        </button>
      </div>
    </div>
  )
}
