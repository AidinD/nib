import { useEffect, useRef, useState } from 'react'

/*
 * The right-click menu on a card.
 *
 * It exists for one job: handing over a reference to the note that can be pasted
 * into a conversation. Describing a note by what it is about is ambiguous the
 * moment two of them are about the same thing; `nib:note-<id>` is not.
 *
 * Built in the app rather than as Electron's native context menu, per the suite's
 * rule about native dialogs - and for a practical reason too: a native menu
 * cannot show the id, and reading it is half of what it is for.
 */

interface CardMenuProps {
  /** Where the pointer was, in viewport coordinates. */
  at: { left: number; top: number }
  /** The note's own id, shown as well as copied. */
  noteId: string
  reference: string
  onClose: () => void
}

export function CardMenu({ at, noteId, reference, onClose }: CardMenuProps): React.JSX.Element {
  const [copied, setCopied] = useState(false)
  const box = useRef<HTMLDivElement | null>(null)
  const [place, setPlace] = useState(at)

  /*
   * Pulled back inside the window when it would hang off the edge.
   *
   * Measured after the first paint rather than guessed from a fixed width: the
   * menu is as wide as the longest thing in it, and the id is a different length
   * in every notebook. Right-clicking a card near the right edge of a narrow
   * list column is the normal case here, not the awkward one.
   */
  useEffect(() => {
    const element = box.current
    if (element === null) {
      return
    }
    const rect = element.getBoundingClientRect()
    const left = Math.max(6, Math.min(at.left, window.innerWidth - rect.width - 6))
    const top = Math.max(6, Math.min(at.top, window.innerHeight - rect.height - 6))
    if (left !== place.left || top !== place.top) {
      setPlace({ left, top })
    }
  }, [at, place.left, place.top])

  // Escape closes it, and so does a click anywhere else - both on capture, so a
  // click on the thing underneath does not also do whatever that thing does.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        onClose()
      }
    }
    const onPointerDown = (event: PointerEvent): void => {
      if (box.current !== null && !box.current.contains(event.target as Node)) {
        onClose()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('pointerdown', onPointerDown, true)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('pointerdown', onPointerDown, true)
    }
  }, [onClose])

  const copy = (): void => {
    void window.nib.copyText(reference)
    setCopied(true)
    // Long enough to read, short enough not to be in the way. The menu closes
    // itself so there is no second click to dismiss what you already did.
    window.setTimeout(onClose, 700)
  }

  return (
    <div className="card-menu" ref={box} style={{ left: place.left, top: place.top }}>
      <button type="button" className="card-menu-row" onClick={copy}>
        {copied ? 'Copied' : 'Copy reference'}
      </button>
      {/* The id itself, because sometimes the answer is to read it out rather
          than to paste it. Selectable on purpose. */}
      <span className="card-menu-id">{noteId}</span>
    </div>
  )
}
