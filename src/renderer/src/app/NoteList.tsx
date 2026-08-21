import { useState } from 'react'
import type { NibIndex, NoteMeta } from '@shared/types'
import { noteTrail, relativeTime } from '../lib/notes'
import type { Selection } from '../lib/selection'
import { selectionColor, selectionShowsCrumb, selectionTarget, selectionTitle } from '../lib/selection'

interface NoteListProps {
  index: NibIndex
  selection: Selection
  notes: NoteMeta[]
  activeNoteId: string | null
  onOpen: (noteId: string) => void
  onAdd: (title: string) => void
  onDelete: (note: NoteMeta) => void
  onTogglePin: (note: NoteMeta) => void
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
  onTogglePin
}: NoteListProps): React.JSX.Element {
  const [draft, setDraft] = useState('')
  const canAdd = selectionTarget(selection) !== null
  const showCrumb = selectionShowsCrumb(selection)

  return (
    <section className="note-list">
      <header className="list-header">
        <span className="dot" style={{ background: selectionColor(index, selection) }} />
        <span className="list-name">{selectionTitle(index, selection)}</span>
        <span className="row-count">{notes.length}</span>
      </header>

      <input
        className="add-note"
        placeholder={canAdd ? 'Add a note…' : 'Pick a category to add a note'}
        disabled={!canAdd}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && draft.trim().length > 0) {
            onAdd(draft.trim())
            setDraft('')
          }
        }}
      />

      <div className="cards">
        {notes.map((note) => (
          <article
            key={note.id}
            className={`card${note.id === activeNoteId ? ' is-active' : ''}`}
            onClick={() => onOpen(note.id)}
          >
            <div className="card-top">
              <span className="card-title">{note.title.length > 0 ? note.title : 'Untitled'}</span>
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

            {note.preview.length > 0 && <p className="card-preview">{note.preview}</p>}

            <div className="card-meta">
              {showCrumb && <span className="crumb">{noteTrail(index.categories, note)}</span>}
              <span>{relativeTime(note.edited)}</span>
              {note.hasImage && <span className="tag tag-image">image</span>}
              {note.hasDrawing && <span className="tag tag-drawing">drawing</span>}
            </div>
          </article>
        ))}

        {notes.length === 0 && <p className="empty">No notes here yet.</p>}
      </div>
    </section>
  )
}
