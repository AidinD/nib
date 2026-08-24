import { useCallback, useEffect, useRef } from 'react'

/*
 * The trail of notes that have been opened, and how to walk it.
 *
 * Kept in a ref rather than in state: nothing on screen renders from the trail
 * itself, and a re-render per note opened - which state would cause - would be a
 * re-render for nothing. What the trail does is answer "where was I", which is
 * only ever asked in a callback.
 */

const LIMIT = 100

export interface NoteHistory {
  /** Record a note as visited, unless it is where we already are. */
  visit: (noteId: string) => void
  /** The note one step back, or null when there is none. */
  back: () => string | null
  /** The note one step forward, or null. */
  forward: () => string | null
}

/**
 * `open` is called with the note to go to. It must NOT call `visit` - walking the
 * trail does not add to it, or going back would be impossible: every step back
 * would append a new entry and there would always be somewhere further back.
 */
export function useNoteHistory(open: (noteId: string) => void): NoteHistory {
  const trail = useRef<string[]>([])
  const cursor = useRef(-1)
  /*
   * `open` is held in a ref, not in a dependency array.
   *
   * The caller's version of it closes over the index and the current selection, so
   * it is a new function on every render - and a dependency on it would tear down
   * and re-attach the mouse and keyboard listeners every time anything on screen
   * changed.
   */
  const openRef = useRef(open)
  openRef.current = open

  const visit = useCallback((noteId: string) => {
    /*
     * Already here: nothing to record.
     *
     * This is also what makes walking the trail safe. `visit` is called from an
     * effect that watches which note is open, so a step back opens a note and the
     * effect immediately offers it back to be recorded - and this line drops it,
     * because the cursor already points at it. Without it, going back would append
     * and there would always be somewhere further back to go.
     */
    if (trail.current[cursor.current] === noteId) {
      return
    }
    /*
     * Opening a note after going back drops what was ahead.
     *
     * The same rule a browser follows, and for the same reason: the forward
     * entries were a path from a place we have now left, and offering them would
     * be offering to jump sideways into a story that no longer connects.
     */
    trail.current = [...trail.current.slice(0, cursor.current + 1), noteId].slice(-LIMIT)
    cursor.current = trail.current.length - 1
  }, [])

  const step = useCallback((direction: -1 | 1): string | null => {
    const next = cursor.current + direction
    const noteId = trail.current[next]
    if (noteId === undefined) {
      return null
    }
    cursor.current = next
    openRef.current(noteId)
    return noteId
  }, [])

  const back = useCallback(() => step(-1), [step])
  const forward = useCallback(() => step(1), [step])

  // The mouse's two side buttons, which arrive from the main process because
  // Windows sends them as an app-command rather than as a mouse event.
  useEffect(() => {
    return window.nib.onHistoryStep((direction) => {
      if (direction === 'back') {
        back()
      } else {
        forward()
      }
    })
  }, [back, forward])

  /*
   * Alt+Left and Alt+Right, for the same journey without letting go of the
   * keyboard.
   *
   * Allowed while the caret is in a note - that is where it will nearly always be,
   * and a shortcut that only works when nothing is focused is a shortcut nobody
   * can use. Ignored in the title and search fields, where a stray Alt+Arrow
   * jumping to another note mid-sentence would be startling.
   */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!event.altKey || event.ctrlKey || event.shiftKey) {
        return
      }
      const target = event.target as HTMLElement | null
      if (target !== null && target.closest('input, textarea') !== null) {
        return
      }
      if (event.key === 'ArrowLeft') {
        event.preventDefault()
        back()
      } else if (event.key === 'ArrowRight') {
        event.preventDefault()
        forward()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [back, forward])

  return { visit, back, forward }
}
