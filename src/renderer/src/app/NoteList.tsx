import { useState } from 'react'
import type { NibIndex, NoteKind, NoteMeta } from '@shared/types'
import { tagsFor } from '@shared/tags'
import { TagPicker } from './TagPicker'
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
  onAdd: (title: string, kind?: NoteKind) => void
  onDelete: (note: NoteMeta) => void
  onArchive: (note: NoteMeta) => void
  onTogglePin: (note: NoteMeta) => void
  onReorder: (
    noteId: string,
    target: { categoryId: string; subId: string | null; beforeNoteId: string | null }
  ) => void
  onCycleFlag: (note: NoteMeta) => void
  onTickAlert: (note: NoteMeta, alertId: string, done: boolean) => void
  onToggleTag: (note: NoteMeta, tagId: string) => void
  /** Create a tag and put it straight on this note. */
  onCreateTag: (note: NoteMeta, name: string) => void
  /** How many archived notes the current search would reach if it were allowed. */
  archivedHits: number
  includeArchived: boolean
  onIncludeArchived: (include: boolean) => void
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
  onArchive,
  onTogglePin,
  onReorder,
  onCycleFlag,
  onTickAlert,
  onToggleTag,
  onCreateTag,
  archivedHits,
  includeArchived,
  onIncludeArchived
}: NoteListProps): React.JSX.Element {
  const [draft, setDraft] = useState('')
  const [slot, setSlot] = useState<DropSlot>(null)
  /** Which card's tag panel is open, and the button rect to hang it off. */
  const [picking, setPicking] = useState<{ noteId: string; anchor: DOMRect } | null>(null)
  const target = selectionTarget(selection)
  const showCrumb = selectionShowsCrumb(selection)

  /**
   * Where a card dropped in this list lands.
   *
   * In a category or a sub-category that is simply the position: the list IS the
   * stored order. In the flat lists - All notes, Recent, Sticky, Needs you -
   * there is no such order, so a drop means "put it where the card you dropped
   * it on lives, just before it". Dragging a note in All notes used to do
   * nothing at all, which read as drag and drop being missing.
   *
   * Recent and Needs you have sorts of their own (edit time, outstanding first),
   * so a card dropped there moves as asked and then sorts where that sort puts
   * it. The move is the point; the position within those lists is not ours.
   */
  const dropTarget = (
    beforeNoteId: string | null,
    over: NoteMeta | undefined
  ): { categoryId: string; subId: string | null; beforeNoteId: string | null } | null => {
    if (target !== null) {
      return { ...target, beforeNoteId }
    }
    return over === undefined ? null : { categoryId: over.categoryId, subId: over.subId, beforeNoteId }
  }

  const acceptsNote = (event: React.DragEvent): boolean =>
    event.dataTransfer.types.includes(DRAG_MIME) && draggedItem()?.kind === 'note'

  const drop = (event: React.DragEvent, over?: NoteMeta): void => {
    const payload = readDrop(event)
    const at = slot
    setSlot(null)
    if (payload === null || payload.kind !== 'note' || at === null) {
      return
    }
    const landing = dropTarget(at.before, over ?? notes.find((note) => note.id === at.before))
    if (landing === null) {
      return
    }
    event.preventDefault()
    onReorder(payload.noteId, landing)
  }

  return (
    <section className="note-list">
      <header className="list-header">
        <span className="dot" style={{ background: selectionColor(index, selection) }} />
        <span className="list-name">{selectionTitle(index, selection)}</span>
        <span className="row-count">{notes.length}</span>
      </header>

      <div className="add-row">
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
        {/*
          A story is filed wherever the thing happened, so this sits beside the
          note field rather than in a folder of its own. The point is capturing
          it while it is fresh - a button two clicks away is a button used in
          March, trying to remember October.
        */}
        <button
          type="button"
          className="add-story"
          disabled={target === null}
          title="A career story, in four questions. Fill it in while it is fresh."
          onClick={() => {
            onAdd(draft.trim().length > 0 ? draft.trim() : 'Untitled story', 'story')
            setDraft('')
          }}
        >
          Story
        </button>
      </div>

      {/*
        The archive toggle.
        
        Not a permanent switch beside the search field: that would be a control
        that does nothing almost every time it is looked at, and it would put the
        archive on the reader's mind constantly - the opposite of filing
        something away. It appears only when the search actually missed
        something, says how much, and goes when the search does.
      */}
      {archivedHits > 0 && (
        <button
          type="button"
          className={`archive-toggle${includeArchived ? ' is-on' : ''}`}
          onClick={() => onIncludeArchived(!includeArchived)}
        >
          <span className="marker marker-archive" />
          <span>
            {archivedHits === 1 ? '1 match' : `${archivedHits} matches`} in the archive
          </span>
          <span className="archive-toggle-action">{includeArchived ? 'Hide' : 'Show'}</span>
        </button>
      )}

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
              className={`card${note.id === activeNoteId ? ' is-active' : ''}${
                note.flag === '' ? '' : ` is-${note.flag}`
              }${note.kind === 'story' ? ' is-story' : ''}`}
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
              onDrop={(event) => drop(event, note)}
            >
              <div className="card-top">
                <span className="card-title">
                  {note.title.length > 0 ? note.title : 'Untitled'}
                </span>
                {/* The whole note as an action point, for the cards that are
                    themselves the thing to do. Same three states as a line. */}
                <button
                  type="button"
                  className={`card-flag${note.flag === '' ? '' : ` is-${note.flag}`}`}
                  title={
                    note.flag === 'open'
                      ? 'Dealt with'
                      : note.flag === 'done'
                        ? 'Clear the flag'
                        : 'Flag this note'
                  }
                  onClick={(event) => {
                    event.stopPropagation()
                    onCycleFlag(note)
                  }}
                >
                  ⚑
                </button>
                {/*
                  An affordance, so it hides until the card is hovered - the
                  tags themselves are state and show at rest, down in the meta
                  row. A "#" that sat there permanently would read as a mark on
                  the note rather than as a button.
                */}
                <button
                  type="button"
                  className={`card-tag-add${picking?.noteId === note.id ? ' is-open' : ''}`}
                  title="Tags"
                  onClick={(event) => {
                    event.stopPropagation()
                    setPicking(
                      picking?.noteId === note.id
                        ? null
                        : { noteId: note.id, anchor: event.currentTarget.getBoundingClientRect() }
                    )
                  }}
                >
                  #
                </button>
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
                {/*
                  Sits before the delete cross on purpose: the reversible action
                  is the one the pointer reaches first, and the destructive one
                  is the one further away. In the archive it reads Restore -
                  the same button, running the other way.
                */}
                <button
                  type="button"
                  className="row-action"
                  title={note.archived ? 'Restore from the archive' : 'Archive: out of the way, not gone'}
                  onClick={(event) => {
                    event.stopPropagation()
                    onArchive(note)
                  }}
                >
                  {/* Down into the archive, up out of it. The first try was
                      ⌦, which is the erase-forward glyph - a delete sign
                      sitting next to the actual delete. */}
                  {note.archived ? '↑' : '↓'}
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
                    <li key={alert.id} className={alert.done ? 'is-done' : ''}>
                      <button
                        type="button"
                        className={`alert-flag${alert.done ? ' is-done' : ''}`}
                        title={alert.done ? 'Still needs you after all' : 'Dealt with'}
                        onClick={(event) => {
                          event.stopPropagation()
                          onTickAlert(note, alert.id, !alert.done)
                        }}
                      >
                        ⚑
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
                {/* What the note IS, in the catalog's order so two cards
                    carrying the same pair show them the same way round. */}
                {tagsFor(note, index.tags).map((tag) => (
                  <span key={tag.id} className="tag tag-user" title={tag.description}>
                    <span className="tag-dot" style={{ background: tag.color }} />
                    {tag.name}
                  </span>
                ))}
                {/* Only in a list that mixes the two. The Archive list needs no
                    marking: every card in it is archived. */}
                {note.archived && selection.kind !== 'archive' && (
                  <span className="tag tag-archived">archived</span>
                )}
                {note.hasImage && <span className="tag tag-image">image</span>}
                {note.hasDrawing && <span className="tag tag-drawing">drawing</span>}
              </div>
            </article>
          </div>
        ))}

        {picking !== null &&
          (() => {
            const note = notes.find((n) => n.id === picking.noteId)
            return note === undefined ? null : (
              <TagPicker
                tags={index.tags}
                selected={note.tags}
                anchor={picking.anchor}
                onToggle={(tagId) => onToggleTag(note, tagId)}
                onCreate={(name) => onCreateTag(note, name)}
                onClose={() => setPicking(null)}
              />
            )
          })()}

        {slot !== null && slot.before === null && <div className="drop-marker" />}

        {notes.length === 0 && <p className="empty">No notes here yet.</p>}
      </div>
    </section>
  )
}
