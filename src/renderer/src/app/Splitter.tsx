import { useCallback, useRef } from 'react'

/*
 * A draggable edge between two panes.
 *
 * Pointer events rather than mouse events, and `setPointerCapture` rather than
 * listeners on the window: capture means the drag keeps following the pointer
 * once it leaves the handle - which it does immediately, because the handle is
 * six pixels wide and the hand is not that precise - and it ends by itself if the
 * button is released outside the window.
 *
 * The handle is also a real separator for the keyboard: arrows nudge it, Home
 * puts it back. A control that can only be dragged is a control that cannot be
 * used by someone who is not holding a mouse.
 */

interface SplitterProps {
  /** Current width of the pane to the left, in pixels. */
  value: number
  min: number
  max: number
  /** The width to return to on double-click or Home. */
  reset: number
  onChange: (width: number) => void
  label: string
}

const STEP = 16

export function Splitter({
  value,
  min,
  max,
  reset,
  onChange,
  label
}: SplitterProps): React.JSX.Element {
  /*
   * Where the drag started, so the width is computed from the pointer's total
   * travel rather than accumulated per event. Adding up deltas drifts: each one
   * is rounded and clamped, and a drag against the maximum then needs the same
   * distance back before anything moves.
   */
  const origin = useRef<{ x: number; width: number } | null>(null)

  const clamp = useCallback(
    (width: number) => Math.min(max, Math.max(min, Math.round(width))),
    [max, min]
  )

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      // Left button only: a middle-click drag on a separator means nothing, and
      // a right-click one belongs to the context menu.
      if (event.button !== 0) {
        return
      }
      event.currentTarget.setPointerCapture(event.pointerId)
      origin.current = { x: event.clientX, width: value }
      document.body.classList.add('is-resizing')
    },
    [value]
  )

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const start = origin.current
      if (start === null) {
        return
      }
      onChange(clamp(start.width + (event.clientX - start.x)))
    },
    [clamp, onChange]
  )

  const end = useCallback(() => {
    origin.current = null
    document.body.classList.remove('is-resizing')
  }, [])

  return (
    <div
      className="splitter"
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerCancel={end}
      onDoubleClick={() => onChange(reset)}
      onKeyDown={(event) => {
        if (event.key === 'ArrowLeft') {
          event.preventDefault()
          onChange(clamp(value - STEP))
        } else if (event.key === 'ArrowRight') {
          event.preventDefault()
          onChange(clamp(value + STEP))
        } else if (event.key === 'Home') {
          event.preventDefault()
          onChange(reset)
        }
      }}
    >
      <span className="splitter-grip" />
    </div>
  )
}
