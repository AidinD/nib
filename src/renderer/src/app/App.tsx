import { useEffect, useMemo, useState } from 'react'
import type { Category, NoteMeta } from '@shared/types'
import { AlertStrip } from './AlertStrip'
import { Editor } from './Editor'
import { NoteList } from './NoteList'
import { Settings } from './Settings'
import { Sidebar } from './Sidebar'
import { useNib } from '../lib/useNib'
import { selectedNotes } from '../lib/selection'
import type { ScopeFilter, Selection } from '../lib/selection'
import { applyPrefs, readPrefs, writePrefs } from '../lib/prefs'

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

  /** Pinning a note is what produces its sticky window, and unpinning closes it. */
  const togglePin = async (note: NoteMeta): Promise<void> => {
    ops.togglePin(note.id)
    if (note.pinned) {
      await window.nib.closeSticky(note.id)
    } else {
      await window.nib.openSticky(note.id)
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
      />

      <main className="panes">
        <Sidebar
          index={index}
          selection={selection}
          onSelect={setSelection}
          scope={scope}
          onScope={setScope}
          ops={ops}
          onDeleteCategory={(category) => void deleteCategory(category)}
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
          onDelete={(note) => void deleteNote(note)}
          onTogglePin={(note) => void togglePin(note)}
          onReorder={ops.moveNoteBefore}
        />

        <Editor
          index={index}
          note={activeNote}
          measure={prefs.measure}
          focusAlertId={focusAlertId}
          onAlertFocused={() => setFocusAlertId(null)}
          onSaved={(noteId, patch) => ops.patchNoteMeta(noteId, patch)}
          onTogglePin={(note) => void togglePin(note)}
        />
      </main>

      {loaded && index.categories.length === 0 && (
        <p className="first-run">Add a category in the sidebar to start writing.</p>
      )}
    </div>
  )
}
