import { useEffect, useRef } from 'react'
import type { RefObject } from 'react'

/*
 * Putting a popover away: Escape, or a press anywhere outside it.
 *
 * Both listened for on the document, in the capture phase, rather than on the
 * popover's own field or on the note. That is the whole point. The note picker
 * once listened for Escape only in its search field and for nothing outside it,
 * so when the caret went back into the note - which is where a click on the
 * text puts it - neither Escape nor a click could close it, and the only way
 * out was to pick a note you did not want. The slash menu and the calendar had
 * the same gap from the other side: Escape only reached them from the note
 * body. TagPicker, CardMenu and Settings already did it this way.
 *
 * Escape is stopped once it has closed something, so it closes the popover and
 * nothing else - not the search, not a panel behind it. A press inside the
 * popover is left alone, so its own rows and field still work.
 *
 * `onClose` is read through a ref, so a parent passing a fresh arrow every
 * render does not re-attach the listeners each time.
 */
export function useDismiss(panel: RefObject<HTMLElement | null>, onClose: () => void): void {
  const latest = useRef(onClose)
  latest.current = onClose

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        latest.current()
      }
    }
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target
      if (!(target instanceof Node) || panel.current?.contains(target) !== true) {
        latest.current()
      }
    }
    document.addEventListener('keydown', onKeyDown, true)
    document.addEventListener('pointerdown', onPointerDown, true)
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      document.removeEventListener('pointerdown', onPointerDown, true)
    }
  }, [panel])
}
