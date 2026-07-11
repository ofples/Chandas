import { useState } from 'react'
import { CustomMinutePicker } from './CustomMinutePicker'

interface Props {
  label: string
  value: number          // current value in minutes
  presets: number[]
  onChange: (v: number) => void
  disabledAbove?: number // chips with value >= this are disabled
  pickerTitle?: string
  pickerMin?: number
  pickerMax?: number
  toggle?: boolean       // if provided, shows a toggle switch next to the label
  onToggle?: (v: boolean) => void
}

export function IntervalPicker({
  label,
  value,
  presets,
  onChange,
  disabledAbove,
  pickerTitle = 'Custom interval',
  pickerMin = 1,
  pickerMax = 240,
  toggle,
  onToggle,
}: Props) {
  const [showPicker, setShowPicker] = useState(false)
  const isCustom = !presets.includes(value)
  const hasToggle = toggle !== undefined

  const chips = (
    <div className="chips">
      {presets.map(p => {
        const disabled = disabledAbove !== undefined && p >= disabledAbove
        return (
          <button
            key={p}
            className={`chip${value === p && !isCustom ? ' active' : ''}`}
            disabled={disabled}
            onClick={() => onChange(p)}
          >
            {p}
          </button>
        )
      })}
      <button
        className={`chip${isCustom ? ' active' : ''}`}
        onClick={() => setShowPicker(true)}
      >
        {isCustom ? `${value}` : '…'}
      </button>
    </div>
  )

  return (
    <div className="config-section">
      {hasToggle ? (
        <>
          <div className="toggle-row">
            <span className="section-label">{label}</span>
            <label className="toggle">
              <input type="checkbox" checked={toggle} onChange={e => onToggle?.(e.target.checked)} />
              <span className="toggle-track" />
              <span className="toggle-thumb" />
            </label>
          </div>
          <div className={`snap-offset${toggle ? ' open' : ''}`}>
            <div className="snap-offset-inner">{chips}</div>
          </div>
        </>
      ) : (
        <>
          <span className="section-label">{label}</span>
          {chips}
        </>
      )}

      {showPicker && (
        <CustomMinutePicker
          title={pickerTitle}
          initial={isCustom ? value : presets[0]}
          min={pickerMin}
          max={pickerMax}
          onConfirm={v => { onChange(v); setShowPicker(false) }}
          onClose={() => setShowPicker(false)}
        />
      )}
    </div>
  )
}
