import { useState } from 'react'
import type { NibIndex, NoteMeta } from '@shared/types'
import { noteTrail, relativeTime } from '../lib/notes'
import type { Selection } from '../lib/selection'
import { selectionColor, selectionShowsCrumb, selectionTarget, selectionTitle } from '../lib/selection'
import type { DropSlot } from '../lib/dnd'
import { DRAG_MIME, draggedItem, endDrag, readDrop, slotEquals, slotFor, startDrag } from '../lib/dnd'

interface NoteListProps {
  index: NibIndex
  selection: Selection
  notes: NoteMeta[]
  activeNoteId: string | null
  onOpen: (noteId: string) => void
  onAdd: (title: string) => void
  onDelete: (note: NoteMeta) => void
  onTogglePin: (note: NoteMeta) => void
  onReorder: (categoryId: string, noteId: string, beforeNoteId: string | null) => void
  onClearAlert: (note: NoteMeta, alertId: string) => void
}

/** The 280px middle pane: a header line, an add field, then the cards. */
export function NoteList({
  index,
  selection,
  notes,
  activeNoteId,
  onOpen,
  onAdd,
  onDelete,
  onTogglePin,
  onReorder,
  onClearAlert
}: NoteListProps): React.JSX.Element {
  const [draft, setDraft] = useState('')
  const [slot, setSlot] = useState<DropSlot>(null)
  const target = selectionTarget(selection)
  const showCrumb = selectionShowsCrumb(selection)

  /**
   * Reordering only means something where the order is stored: inside a
   * category. The smart lists have their own sorts - Recent by edit time,
   * Sticky by pin - so a dropped card there would snap straight back, and no
   * marker is offered.
   */
  const reorderable = target !== null

  const reorderTargetId = target?.categoryId ?? null

  const acceptsNote = (event: React.DragEvent): boolean =>
    reorderable &&
    event.dataTransfer.types.includes(DRAG_MIME) &&
    draggedItem()?.kind === 'note' &&
    draggedItem()?.categoryId === reorderTargetId

  const drop = (event: React.DragEvent): void => {
    const payload = readDrop(event)
    setSlot(null)
    if (payload === null || payload.kind !== 'note' || reorderTargetId === null || slot === null) {
      return
    }
    event.preventDefault()
    onReorder(reorderTargetId, payload.noteId, slot.before)
  }

  return (
    <section className="note-list">
      <header className="list-header">
        <span className="dot" style={{ background: selectionColor(index, selection) }} />
        <span className="list-name">{selectionTitle(index, selection)}</span>
        <span className="row-count">{notes.length}</span>
      </header>

      <input
        className="add-note"
        placeholder={target !== null ? 'Add a note…' : 'Pick a category to add a note'}
        disabled={target === null}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && draft.trim().length > 0) {
            onAdd(draft.trim())
            setDraft('')
          }
        }}
      />

      <div
        className="cards"
        onDragLeave={(event) => {
          // Only when the pointer leaves the list itself, not when it crosses
          // from one card to the next inside it.
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
            setSlot(null)
          }
        }}
        onDrop={drop}
      >
        {notes.map((note, position) => (
          <div key={note.id} className="card-slot">
            {slot !== null && slot.before === note.id && <div className="drop-marker" />}
            <article
              className={`card${note.id === activeNoteId ? ' is-active' : ''}`}
              draggable
              onClick={() => onOpen(note.id)}
              onDragStart={(event) =>
                startDrag(event, { kind: 'note', noteId: note.id, categoryId: note.categoryId })
              }
              onDragEnd={() => {
                endDrag()
                setSlot(null)
              }}
              onDragOver={(event) => {
                if (!acceptsNote(event)) {
                  return
                }
                event.preventDefault()
                event.dataTransfer.dropEffect = 'move'
                const next = slotFor(
                  event,
                  event.currentTarget,
                  note.id,
                  notes[position + 1]?.id ?? null
                )
                if (!slotEquals(next, slot)) {
                  setSlot(next)
                }
              }}
              onDrop={drop}
            >
              <div className="card-top">
                <span className="card-title">
                  {note.title.length > 0 ? note.title : 'Untitled'}
                </span>
                <button
                  type="button"
                  className={`pin${note.pinned ? ' is-pinned' : ''}`}
                  title={note.pinned ? 'Unpin' : 'Pin as sticky'}
                  onClick={(event) => {
                    event.stopPropagation()
                    onTogglePin(note)
                  }}
                >
                  ●
                </button>
                <button
                  type="button"
                  className="row-action danger"
                  title="Delete note"
                  onClick={(event) => {
                    event.stopPropagation()
                    onDelete(note)
                  }}
                >
                  ×
                </button>
              </div>

              {/* In the review view a card shows its action points rather than
                its opening lines: that is what you came to the list for. */}
              {selection.kind === 'alerts' && note.alerts.length > 0 ? (
                <ul className="card-alerts">
                  {note.alerts.map((alert) => (
                    <li key={alert.id}>
                      <button
                        type="button"
                        className="alert-tick"
                        title="Done with this"
                        onClick={(event) => {
                          event.stopPropagation()
                          onClearAlert(note, alert.id)
                        }}
                      >
                        ✓
                      </button>
                      <span>{alert.text}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                note.preview.length > 0 && <p className="card-preview">{note.preview}</p>
              )}

              <div className="card-meta">
                {showCrumb && <span className="crumb">{noteTrail(index.categories, note)}</span>}
                <span>{relativeTime(note.edited)}</span>
                {note.hasImage && <span className="tag tag-image">image</span>}
                {note.hasDrawing && <span className="tag tag-drawing">drawing</span>}
              </div>
            </article>
          </div>
        ))}

        {slot !== null && slot.before === null && <div className="drop-marker" />}

        {notes.length === 0 && <p className="empty">No notes here yet.</p>}
      </div>
    </section>
  )
}
