import { useEffect, useMemo, useRef, useState } from 'react'
import type { Category, NoteMeta } from '@shared/types'
import { storyTemplate } from '@shared/story'
import { AlertStrip } from './AlertStrip'
import { ConfirmModal } from './ConfirmModal'
import { Editor } from './Editor'
import { NibMark } from './NibMark'
import { NoteList } from './NoteList'
import { Settings } from './Settings'
import { Sidebar } from './Sidebar'
import { useNib } from '../lib/useNib'
import { archivedHits, selectedNotes } from '../lib/selection'
import type { ScopeFilter, Selection } from '../lib/selection'
import { applyPrefs, readPrefs, writePrefs } from '../lib/prefs'
import { setAlertDone } from '../lib/alerts'

/** What is waiting to be confirmed, and everything needed to say it out loud. */
type PendingDelete =
  | { kind: 'note'; note: NoteMeta }
  | { kind: 'category'; category: Category }
  | { kind: 'sub'; categoryId: string; subId: string; name: string }
  | null

function deleteTitle(pending: NonNullable<PendingDelete>): string {
  if (pending.kind === 'note') {
    return 'Delete this note?'
  }
  return pending.kind === 'category' ? 'Delete this category?' : 'Delete this sub-category?'
}

/** "1 note" / "3 notes", so the message never reads "1 notes". */
function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`
}

/**
 * The message says what goes with it, because that is the part that is easy to
 * get wrong: a category takes its notes, a sub-category does not.
 *
 * A category takes its sub-categories too, and the notes counted here include
 * the ones sitting inside them - the category's note list is flat. Saying only
 * the note count left the sub-categories unmentioned in the one dialog whose
 * whole job is to say what is about to be lost.
 *
 * The archived ones are counted in the total and then called out, for the same
 * reason. Archiving promises "not gone", and a delete that silently takes the
 * archive with it breaks that promise - quietly, since the sidebar has been
 * showing a smaller number all along.
 */
function deleteMessage(pending: NonNullable<PendingDelete>): string {
  if (pending.kind === 'note') {
    const title = pending.note.title.trim()
    return `"${title.length > 0 ? title : 'Untitled'}" and its text will be deleted for good.`
  }
  if (pending.kind === 'category') {
    const noteCount = pending.category.notes.length
    const subCount = pending.category.subs.length
    if (noteCount === 0 && subCount === 0) {
      return `"${pending.category.name}" will be deleted for good.`
    }
    const notes = plural(noteCount, 'note', 'notes')
    const contents =
      subCount > 0 ? `${plural(subCount, 'sub-category', 'sub-categories')} and ${notes}` : notes
    const archived = pending.category.notes.filter((note) => note.archived).length
    const aside = archived > 0 ? `, ${archived} of them archived,` : ''
    return `"${pending.category.name}" and the ${contents} inside it${aside} will be deleted for good.`
  }
  return `"${pending.name}" will be deleted. The notes in it stay, and move up to the category.`
}

export function App(): React.JSX.Element {
  const { index, loaded, ops } = useNib()
  const [selection, setSelection] = useState<Selection>({ kind: 'all' })
  const [scope, setScope] = useState<ScopeFilter>('all')
  const [search, setSearch] = useState('')
  /*
   * Whether a search is allowed to reach into the archive.
   *
   * Off by default and NOT remembered between launches: filing something away
   * has to mean it stays away, and a preference silently left on from last week
   * would undo that. It is a widening of one search, not a mode.
   */
  const [includeArchived, setIncludeArchived] = useState(false)
  const [activeNoteId, setActiveNoteId] = useState<string | null>(null)
  const [prefs, setPrefs] = useState(readPrefs)
  // Set when arriving from the alert strip: the editor scrolls to this block and
  // flashes it once, then clears the request.
  const [focusAlertId, setFocusAlertId] = useState<string | null>(null)
  // The deletion waiting to be confirmed. Deleting a category or a note cannot
  // be undone, and all three used to happen on one stray click.
  const [pendingDelete, setPendingDelete] = useState<PendingDelete>(null)
  const searchRef = useRef<HTMLInputElement | null>(null)

  const notes = useMemo(
    () => selectedNotes(index, selection, scope, search, includeArchived),
    [index, selection, scope, search, includeArchived]
  )

  const archived = useMemo(
    () => archivedHits(index, selection, scope, search),
    [index, selection, scope, search]
  )

  // Clearing the search puts the archive back out of reach, so the next search
  // starts clean rather than inheriting a decision made about a different one.
  useEffect(() => {
    if (search.trim().length === 0 && includeArchived) {
      setIncludeArchived(false)
    }
  }, [search, includeArchived])

  const activeNote = useMemo(
    () =>
      index.categories.flatMap((category) => category.notes).find((note) => note.id === activeNoteId) ??
      null,
    [index, activeNoteId]
  )

  // A note that vanished - deleted here, or removed by another machine's sync -
  // must not leave the editor holding a note that no longer exists.
  useEffect(() => {
    if (activeNoteId !== null && activeNote === null) {
      setActiveNoteId(null)
    }
  }, [activeNote, activeNoteId])

  useEffect(() => {
    applyPrefs(prefs)
    writePrefs(prefs)
  }, [prefs])

  /**
   * Ctrl+Shift+F puts the caret in the search field, wherever it was.
   *
   * On the window rather than on the field, because the point is to reach the
   * field from the note you are typing in - which is also why it has to
   * preventDefault before the editor sees the keystroke. Existing text is
   * selected, so the shortcut starts a new search as readily as it revisits one.
   */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.ctrlKey && event.shiftKey && event.code === 'KeyF') {
        event.preventDefault()
        searchRef.current?.focus()
        searchRef.current?.select()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [])

  const deleteNote = async (note: NoteMeta): Promise<void> => {
    ops.deleteNote(note.id)
    if (note.pinned) {
      await window.nib.closeSticky(note.id)
    }
    await window.nib.deleteNote(note.id)
  }

  /**
   * Archive a note, or bring it back.
   *
   * A pinned note loses its pin on the way in: a sticky window is a note kept in
   * front of you, which is the opposite of what archiving it says, and leaving
   * the two states to disagree would put an archived note back on screen at the
   * next start.
   *
   * The note itself is untouched - same file, same category - so restoring it is
   * the same click the other way, and there is nothing to undo.
   */
  const archiveNote = async (note: NoteMeta): Promise<void> => {
    ops.setArchived(note.id, !note.archived)
    if (!note.archived && note.pinned) {
      ops.setPinned(note.id, false)
      await window.nib.closeSticky(note.id)
    }
  }

  /** Deleting a category takes its notes' files with it, not just the index rows. */
  const deleteCategory = async (category: Category): Promise<void> => {
    ops.deleteCategory(category.id)
    for (const note of category.notes) {
      if (note.pinned) {
        await window.nib.closeSticky(note.id)
      }
      await window.nib.deleteNote(note.id)
    }
  }

  /**
   * Tick off an action point, from the strip or from the review list.
   *
   * A null id means the whole note is the action point, which is simply
   * unflagged; a block keeps its mark and is set done.
   */
  const tickAlert = async (note: NoteMeta, alertId: string | null, done = true): Promise<void> => {
    if (alertId === null) {
      // The note itself: dealt with, and still marked as having been an action
      // point. Clearing it altogether is the card's flag, one more click on.
      ops.setFlag(note.id, done ? 'done' : 'open')
      return
    }
    const result = await setAlertDone(note, alertId, done)
    if (result !== null) {
      ops.patchNoteMeta(note.id, { alerts: result.alerts, edited: result.edited })
    }
  }

  /**
   * Show a note where it lives, not just in the editor.
   *
   * Opening an action point from the strip used to load the note and leave the
   * rest of the window where it was, so the note appeared with no clue as to
   * which category it came from - and the list beside it was still showing
   * something else entirely.
   *
   * Three things could hide it once we get there, and all three are cleared:
   * a collapsed category, a scope filter the note is not in, and a search that
   * it does not match. Landing on an empty list is worse than not navigating.
   */
  const revealNote = (note: NoteMeta): void => {
    const category = index.categories.find((candidate) => candidate.id === note.categoryId)
    if (category !== undefined && scope !== 'all' && category.scope !== scope) {
      setScope('all')
    }
    if (search.trim().length > 0) {
      setSearch('')
    }
    if (category !== undefined && !category.open && note.subId !== null) {
      ops.setCategoryOpen(note.categoryId, true)
    }
    setSelection(
      note.subId === null
        ? { kind: 'category', categoryId: note.categoryId }
        : { kind: 'sub', categoryId: note.categoryId, subId: note.subId }
    )
    setActiveNoteId(note.id)
  }

  /** Pinning a note is what produces its sticky window, and unpinning closes it. */
  const togglePin = async (note: NoteMeta): Promise<void> => {
    ops.togglePin(note.id)
    if (note.pinned) {
      await window.nib.closeSticky(note.id)
    } else {
      await window.nib.openSticky(note.id)
    }
  }

  // A sticky window is the note's pin: if the window goes, so does the pin.
  useEffect(() => {
    return window.nib.onStickyClosed((noteId) => {
      ops.setPinned(noteId, false)
    })
  }, [ops])

  const confirmDelete = async (): Promise<void> => {
    const pending = pendingDelete
    setPendingDelete(null)
    if (pending === null) {
      return
    }
    if (pending.kind === 'note') {
      await deleteNote(pending.note)
    } else if (pending.kind === 'category') {
      await deleteCategory(pending.category)
    } else {
      ops.deleteSub(pending.categoryId, pending.subId)
    }
  }

  return (
    <div className="app">
      <header className="app-header">
        {/* Frameless window: this row is the drag handle. */}
        <div className="brand">
          <NibMark />
          <span className="wordmark">Nib</span>
          <span className="version">v{__APP_VERSION__}</span>
        </div>
        <div className="header-right">
          <div className="search-field">
            <input
              ref={searchRef}
              className="search"
              placeholder="Search notes  (Ctrl+Shift+F)"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={(event) => {
                // Escape clears rather than merely blurring: a stale filter you
                // cannot see the end of is worse than no filter.
                if (event.key === 'Escape') {
                  setSearch('')
                }
              }}
            />
            {search.length > 0 && (
              <button
                type="button"
                className="search-clear"
                title="Clear the search"
                onClick={() => {
                  setSearch('')
                  searchRef.current?.focus()
                }}
              >
                ×
              </button>
            )}
          </div>
          <Settings prefs={prefs} onChange={setPrefs} />
          <div className="window-controls">
            <button type="button" onClick={() => void window.nib.minimizeWindow()} title="Minimise">
              –
            </button>
            <button
              type="button"
              onClick={() => void window.nib.toggleMaximizeWindow()}
              title="Maximise"
            >
              □
            </button>
            <button
              type="button"
              className="danger"
              onClick={() => void window.nib.closeWindow()}
              title="Close"
            >
              ×
            </button>
          </div>
        </div>
      </header>

      <AlertStrip
        index={index}
        scope={scope}
        onOpen={(note, alertId) => {
          revealNote(note)
          setFocusAlertId(alertId)
        }}
        onShowAll={() => setSelection({ kind: 'alerts' })}
        onClear={(note, alertId) => void tickAlert(note, alertId)}
      />

      <main className="panes">
        <Sidebar
          index={index}
          selection={selection}
          onSelect={setSelection}
          scope={scope}
          onScope={setScope}
          ops={ops}
          onDeleteCategory={(category) => setPendingDelete({ kind: 'category', category })}
          onDeleteSub={(categoryId, subId, name) =>
            setPendingDelete({ kind: 'sub', categoryId, subId, name })
          }
        />

        <NoteList
          index={index}
          selection={selection}
          notes={notes}
          activeNoteId={activeNoteId}
          onOpen={setActiveNoteId}
          onAdd={(title, kind) => {
            const target =
              selection.kind === 'category'
                ? { categoryId: selection.categoryId, subId: null }
                : selection.kind === 'sub'
                  ? { categoryId: selection.categoryId, subId: selection.subId }
                  : null
            if (target === null) {
              return
            }
            const id = ops.addNote(target.categoryId, target.subId, title, kind)
            // A story opens with its four questions already in it. An empty note
            // asking you to remember the STAR shape is an empty note.
            if (kind === 'story') {
              void window.nib.writeNote({
                id,
                categoryId: target.categoryId,
                subId: target.subId,
                title,
                html: storyTemplate(),
                created: Date.now(),
                edited: Date.now()
              })
            }
            setActiveNoteId(id)
          }}
          onDelete={(note) => setPendingDelete({ kind: 'note', note })}
          onArchive={(note) => void archiveNote(note)}
          archivedHits={archived}
          includeArchived={includeArchived}
          onIncludeArchived={setIncludeArchived}
          onTogglePin={(note) => void togglePin(note)}
          onReorder={(noteId, landing) => {
            // A drop can be a move and a reorder at once: in the flat lists the
            // card you drop on decides which category the note joins.
            const note = index.categories
              .flatMap((category) => category.notes)
              .find((candidate) => candidate.id === noteId)
            if (note === undefined) {
              return
            }
            if (note.categoryId !== landing.categoryId || note.subId !== landing.subId) {
              ops.moveNote(noteId, landing.categoryId, landing.subId)
            }
            ops.moveNoteBefore(landing.categoryId, noteId, landing.beforeNoteId)
          }}
          onCycleFlag={(note) => ops.cycleFlag(note.id)}
          onTickAlert={(note, alertId, done) => void tickAlert(note, alertId, done)}
        />

        <Editor
          index={index}
          note={activeNote}
          measure={prefs.measure}
          focusAlertId={focusAlertId}
          onAlertFocused={() => setFocusAlertId(null)}
          onSaved={(noteId, patch) => ops.patchNoteMeta(noteId, patch)}
          onTogglePin={(note) => void togglePin(note)}
          onCycleFlag={(note) => ops.cycleFlag(note.id)}
        />
      </main>

      {loaded && index.categories.length === 0 && (
        <p className="first-run">Add a category in the sidebar to start writing.</p>
      )}

      {pendingDelete !== null && (
        <ConfirmModal
          title={deleteTitle(pendingDelete)}
          message={deleteMessage(pendingDelete)}
          confirmLabel="Delete"
          onConfirm={() => void confirmDelete()}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </div>
  )
}
