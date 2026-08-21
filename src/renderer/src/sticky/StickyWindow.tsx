import { useCallback, useEffect, useRef, useState } from 'react'
import { STICKY_TINTS } from '@shared/types'
import { useNib } from '../lib/useNib'
import { bodyHasDrawing, bodyHasImage, buildPreview, noteTrail, sanitizeHtml } from '../lib/notes'

const SAVE_DELAY = 600

/**
 * One sticky window, bound to a pinned note.
 *
 * It edits the same note file the main window does, so the note is the single
 * source of truth and there is no separate "sticky" copy to reconcile. The
 * formatting rules are the editor's; the chrome is not - a sticky has a drag
 * strip, a tint row and a trail, and no toolbar.
 */
export function StickyWindow({ noteId }: { noteId: string }): React.JSX.Element {
  const { index, ops } = useNib()
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const [title, setTitle] = useState('')
  const [alwaysOnTop, setAlwaysOnTop] = useState(true)
  const [loadedBody, setLoadedBody] = useState(false)
  const saveTimer = useRef<number | null>(null)

  const note =
    index.categories.flatMap((category) => category.notes).find((n) => n.id === noteId) ?? null
  const tint = note?.tint !== undefined && note.tint.length > 0 ? note.tint : STICKY_TINTS[0]

  // Loaded once: the body is a contenteditable, so re-writing innerHTML on every
  // index change would fight the caret.
  //
  // `note?.id` has to be in the deps, not just the noteId from the hash: the
  // index arrives asynchronously, so the first render has no note yet and the
  // body element it lives in is not mounted. Without re-running when the note
  // appears, the read resolves against a null ref and the sticky stays blank.
  useEffect(() => {
    if (loadedBody || note === null) {
      return
    }
    let cancelled = false
    void window.nib.readNote(noteId).then((doc) => {
      if (cancelled || bodyRef.current === null) {
        return
      }
      bodyRef.current.innerHTML = sanitizeHtml(doc?.html ?? '')
      setTitle(doc?.title ?? '')
      setLoadedBody(true)
    })
    return () => {
      cancelled = true
    }
  }, [loadedBody, noteId, note?.id])

  const save = useCallback(async () => {
    const element = bodyRef.current
    if (note === null || element === null) {
      return
    }
    if (saveTimer.current !== null) {
      window.clearTimeout(saveTimer.current)
      saveTimer.current = null
    }
    const html = sanitizeHtml(element.innerHTML)
    const edited = await window.nib.writeNote({
      id: note.id,
      categoryId: note.categoryId,
      subId: note.subId,
      title,
      html,
      created: note.created,
      edited: Date.now()
    })
    ops.patchNoteMeta(note.id, {
      title,
      preview: buildPreview(html),
      edited,
      hasImage: bodyHasImage(html),
      hasDrawing: bodyHasDrawing(html)
    })
  }, [note, ops, title])

  const scheduleSave = useCallback(() => {
    if (saveTimer.current !== null) {
      window.clearTimeout(saveTimer.current)
    }
    saveTimer.current = window.setTimeout(() => {
      saveTimer.current = null
      void save()
    }, SAVE_DELAY)
  }, [save])

  if (note === null) {
    return (
      <div className="sticky">
        <div className="sticky-strip" style={{ background: tint }} />
        <p className="empty">This note is gone.</p>
      </div>
    )
  }

  return (
    <div className="sticky">
      {/* The strip is the drag handle: the window is frameless. */}
      <div className="sticky-strip" style={{ background: tint }}>
        <div className="tints">
          {STICKY_TINTS.map((swatch) => (
            <button
              key={swatch}
              type="button"
              className={`tint${swatch === tint ? ' is-selected' : ''}`}
              style={{ background: swatch }}
              title="Tint"
              onClick={() => ops.patchNoteMeta(note.id, { tint: swatch })}
            />
          ))}
        </div>
        <button
          type="button"
          className={`strip-action${alwaysOnTop ? ' is-active' : ''}`}
          title="Always on top"
          onClick={() => {
            void window.nib.toggleAlwaysOnTop().then(setAlwaysOnTop)
          }}
        >
          ▲
        </button>
        <button
          type="button"
          className="strip-action"
          title="Close"
          onClick={() => {
            void save().finally(() => void window.nib.closeWindow())
          }}
        >
          ×
        </button>
      </div>

      <input
        className="sticky-title"
        value={title}
        placeholder="Untitled"
        onChange={(event) => {
          setTitle(event.target.value)
          scheduleSave()
        }}
      />

      <div
        ref={bodyRef}
        className="sticky-body"
        contentEditable
        suppressContentEditableWarning
        onInput={scheduleSave}
        onBlur={() => void save()}
      />

      <footer className="sticky-footer">{noteTrail(index.categories, note)}</footer>
    </div>
  )
}
