import { useEffect, useRef, useState } from 'react'
import type { AccentName, Prefs } from '../lib/prefs'
import { ACCENTS, MEASURE_MAX, MEASURE_MIN, MEASURE_STEP } from '../lib/prefs'

/**
 * The settings popover: accent, serif body and the measure.
 *
 * A popover rather than three controls in the header - they are set once and then
 * left alone, and the header's job is the wordmark and the search field.
 */
export function Settings({
  prefs,
  onChange
}: {
  prefs: Prefs
  onChange: (prefs: Prefs) => void
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const holder = useRef<HTMLDivElement | null>(null)

  // Click away to close, which is what every popover is expected to do.
  useEffect(() => {
    if (!open) {
      return
    }
    const onPointerDown = (event: PointerEvent): void => {
      if (holder.current !== null && !holder.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setOpen(false)
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <div className="settings" ref={holder}>
      <button
        type="button"
        className={`settings-toggle${open ? ' is-active' : ''}`}
        title="Settings"
        onClick={() => setOpen(!open)}
      >
        ⚙
      </button>

      {open && (
        <div className="settings-panel">
          <label className="settings-row">
            <span>Accent</span>
            <span className="accent-swatches">
              {(Object.keys(ACCENTS) as AccentName[]).map((name) => (
                <button
                  key={name}
                  type="button"
                  className={`accent-swatch${prefs.accent === name ? ' is-selected' : ''}`}
                  style={{ background: ACCENTS[name] }}
                  title={name}
                  onClick={() => onChange({ ...prefs, accent: name })}
                />
              ))}
            </span>
          </label>

          <label className="settings-row">
            <span>Serif body</span>
            <input
              type="checkbox"
              checked={prefs.serif}
              onChange={(event) => onChange({ ...prefs, serif: event.target.checked })}
            />
          </label>

          <label className="settings-row">
            <span>Measure</span>
            <input
              type="range"
              min={MEASURE_MIN}
              max={MEASURE_MAX}
              step={MEASURE_STEP}
              value={prefs.measure}
              onChange={(event) => onChange({ ...prefs, measure: Number(event.target.value) })}
            />
            <span className="settings-value">{prefs.measure}</span>
          </label>
        </div>
      )}
    </div>
  )
}
