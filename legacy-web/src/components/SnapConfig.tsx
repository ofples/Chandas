import { useState } from 'react'
import { CustomMinutePicker } from './CustomMinutePicker'

const SNAP_PRESETS = [0, 10, 15]

interface Props {
  enabled: boolean
  offset: number           // minutes
  onToggle: (v: boolean) => void
  onOffsetChange: (v: number) => void
}

export function SnapConfig({ enabled, offset, onToggle, onOffsetChange }: Props) {
  const [showPicker, setShowPicker] = useState(false)
  const isCustomOffset = !SNAP_PRESETS.includes(offset)

  return (
    <div className="config-section">
      <div className="toggle-row">
        <span className="section-label">Snap to clock</span>
        <label className="toggle">
          <input
            type="checkbox"
            checked={enabled}
            onChange={e => onToggle(e.target.checked)}
          />
          <span className="toggle-track" />
          <span className="toggle-thumb" />
        </label>
      </div>

      <div className={`snap-offset${enabled ? ' open' : ''}`}>
        <div className="snap-offset-inner">
          <div className="chips">
            {SNAP_PRESETS.map(p => (
              <button
                key={p}
                className={`chip${offset === p && !isCustomOffset ? ' active' : ''}`}
                onClick={() => onOffsetChange(p)}
              >
                {p === 0 ? ':00' : `:${String(p).padStart(2, '0')}`}
              </button>
            ))}
            <button
              className={`chip${isCustomOffset ? ' active' : ''}`}
              onClick={() => setShowPicker(true)}
            >
              {isCustomOffset ? `:${String(offset).padStart(2, '0')}` : '…'}
            </button>
          </div>
        </div>
      </div>

      {showPicker && (
        <CustomMinutePicker
          title="Snap offset (minutes)"
          initial={isCustomOffset ? offset : 0}
          min={0}
          max={59}
          onConfirm={v => { onOffsetChange(v); setShowPicker(false) }}
          onClose={() => setShowPicker(false)}
        />
      )}
    </div>
  )
}
