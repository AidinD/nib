import { useEffect, useMemo, useState } from 'react'
import type { Category, NoteMeta } from '@shared/types'
import { AlertStrip } from './AlertStrip'
import { ConfirmModal } from './ConfirmModal'
import { Editor } from './Editor'
import { NoteList } from './NoteList'
import { Settings } from './Settings'
import { Sidebar } from './Sidebar'
import { useNib } from '../lib/useNib'
import { selectedNotes } from '../lib/selection'
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

/**
 * The message says what goes with it, because that is the part that is easy to
 * get wrong: a category takes its notes, a sub-category does not.
 */
function deleteMessage(pending: NonNullable<PendingDelete>): string {
  if (pending.kind === 'note') {
    const title = pending.note.title.trim()
    return `"${title.length > 0 ? title : 'Untitled'}" and its text will be deleted for good.`
  }
  if (pending.kind === 'category') {
    const count = pending.category.notes.length
    const notes = count === 1 ? '1 note' : `${count} notes`
    return `"${pending.category.name}" and ${notes} inside it will be deleted for good.`
  }
  return `"${pending.name}" will be deleted. The notes in it stay, and move up to the category.`
}

export function App(): React.JSX.Element {
  const { index, loaded, ops } = useNib()
  const [selection, setSelection] = useState<Selection>({ kind: 'all' })
  const [scope, setScope] = useState<ScopeFilter>('all')
  const [search, setSearch] = useState('')
  const [activeNoteId, setActiveNoteId] = useState<string | null>(null)
  const [prefs, setPrefs] = useState(readPrefs)
  // Set when arriving from the alert strip: the editor scrolls to this block and
  // flashes it once, then clears the request.
  const [focusAlertId, setFocusAlertId] = useState<string | null>(null)
  // The deletion waiting to be confirmed. Deleting a category or a note cannot
  // be undone, and all three used to happen on one stray click.
  const [pendingDelete, setPendingDelete] = useState<PendingDelete>(null)

  const notes = useMemo(
    () => selectedNotes(index, selection, scope, search),
    [index, selection, scope, search]
  )

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

  const deleteNote = async (note: NoteMeta): Promise<void> => {
    ops.deleteNote(note.id)
    if (note.pinned) {
      await window.nib.closeSticky(note.id)
    }
    await window.nib.deleteNote(note.id)
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
      ops.toggleFlag(note.id)
      return
    }
    const result = await setAlertDone(note, alertId, done)
    if (result !== null) {
      ops.patchNoteMeta(note.id, { alerts: result.alerts, edited: result.edited })
    }
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
          <span className="wordmark">Nib</span>
          <span className="version">v{__APP_VERSION__}</span>
        </div>
        <div className="header-right">
          <input
            className="search"
            placeholder="Search notes"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
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
          setActiveNoteId(note.id)
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
          onAdd={(title) => {
            const target =
              selection.kind === 'category'
                ? { categoryId: selection.categoryId, subId: null }
                : selection.kind === 'sub'
                  ? { categoryId: selection.categoryId, subId: selection.subId }
                  : null
            if (target === null) {
              return
            }
            setActiveNoteId(ops.addNote(target.categoryId, target.subId, title))
          }}
          onDelete={(note) => setPendingDelete({ kind: 'note', note })}
          onTogglePin={(note) => void togglePin(note)}
          onReorder={ops.moveNoteBefore}
          onToggleFlag={(note) => ops.toggleFlag(note.id)}
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
          onToggleFlag={(note) => ops.toggleFlag(note.id)}
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
