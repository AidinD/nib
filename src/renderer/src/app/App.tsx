import { useEffect, useMemo, useRef, useState } from 'react'
import type { Category, NoteMeta } from '@shared/types'
import { NOTE_COLORS } from '@shared/types'
import { titleFrom } from '@shared/templates'
import { TemplateModal } from './TemplateModal'
import { AlertStrip } from './AlertStrip'
import { ConfirmModal } from './ConfirmModal'
import { Editor } from './Editor'
import { NibMark } from './NibMark'
import { NoteList } from './NoteList'
import { Splitter } from './Splitter'
import { Settings } from './Settings'
import { Sidebar } from './Sidebar'
import { useNib } from '../lib/useNib'
import { useNoteHistory } from '../lib/useNoteHistory'
import { archivedHits, selectedNotes } from '../lib/selection'
import type { ScopeFilter, Selection } from '../lib/selection'
import { LIST_MAX, LIST_MIN, applyPrefs, readPrefs, writePrefs } from '../lib/prefs'
import { setAlertDone } from '../lib/alerts'

/** What is waiting to be confirmed, and everything needed to say it out loud. */
type PendingDelete =
  | { kind: 'note'; note: NoteMeta }
  | { kind: 'category'; category: Category }
  | { kind: 'sub'; categoryId: string; subId: string; name: string }
  | { kind: 'tag'; tagId: string; name: string; notes: number }
  | null

function deleteTitle(pending: NonNullable<PendingDelete>): string {
  if (pending.kind === 'note') {
    return 'Delete this note?'
  }
  if (pending.kind === 'tag') {
    return 'Delete this tag?'
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
  if (pending.kind === 'tag') {
    // Worth saying out loud, because it is the opposite of what deleting
    // usually means here: the notes keep the id, so re-creating the tag with
    // the same name brings every chip back. Nothing is lost, it stops showing.
    const on = pending.notes > 0 ? ` It is on ${plural(pending.notes, 'note', 'notes')}.` : ''
    return `"${pending.name}" will stop appearing.${on} The notes themselves keep it, so making the tag again brings it back.`
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
  /** The note being turned into a template, while the dialog is up. */
  const [savingTemplate, setSavingTemplate] = useState<NoteMeta | null>(null)
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

  /*
   * The trail of notes visited, walked with the mouse's side buttons or
   * Alt+Arrow.
   *
   * Recorded from an effect on the open note rather than at each place that opens
   * one - a card, a link in the text, the action-point strip, a fresh note - so
   * there is no path that navigates without being recorded, and no list of call
   * sites to keep in step.
   */
  const history = useNoteHistory((noteId) => {
    const target = index.categories
      .flatMap((category) => category.notes)
      .find((candidate) => candidate.id === noteId)
    if (target !== undefined) {
      revealNote(target)
    }
  })

  useEffect(() => {
    if (activeNoteId !== null) {
      history.visit(activeNoteId)
    }
  }, [activeNoteId, history.visit])

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
    } else if (pending.kind === 'tag') {
      ops.deleteTag(pending.tagId)
      // The list you were looking at just stopped existing.
      if (selection.kind === 'tag' && selection.tagId === pending.tagId) {
        setSelection({ kind: 'all' })
      }
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
          onDeleteTag={(tagId, name) =>
            setPendingDelete({
              kind: 'tag',
              tagId,
              name,
              notes: index.categories.reduce(
                (total, category) =>
                  total + category.notes.filter((note) => note.tags.includes(tagId)).length,
                0
              )
            })
          }
        />

        <NoteList
          width={prefs.listWidth}
          index={index}
          selection={selection}
          notes={notes}
          activeNoteId={activeNoteId}
          onOpen={setActiveNoteId}
          onAdd={(title, template) => {
            const target =
              selection.kind === 'category'
                ? { categoryId: selection.categoryId, subId: null }
                : selection.kind === 'sub'
                  ? { categoryId: selection.categoryId, subId: selection.subId }
                  : null
            if (target === null) {
              return
            }
            // A template names the note and fills it in. An empty note asking you
            // to remember the shape is an empty note, and typing the same title
            // format every week is the other half of why it never gets written.
            const named = template === undefined ? title : titleFrom(template, title)
            const id = ops.addNote(target.categoryId, target.subId, named, template?.kind, template?.tags)
            if (template !== undefined && template.body.length > 0) {
              void window.nib.writeNote({
                id,
                categoryId: target.categoryId,
                subId: target.subId,
                title: named,
                html: template.body,
                created: Date.now(),
                edited: Date.now()
              })
            }
            setActiveNoteId(id)
          }}
          onSaveTemplate={
            activeNote === null
              ? null
              : () => {
                  setSavingTemplate(activeNote)
                }
          }
          onDeleteTemplate={(templateId) => ops.deleteTemplate(templateId)}
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
          onToggleTag={(note, tagId) => ops.toggleNoteTag(note.id, tagId)}
          onCreateTag={(note, name) => {
            // Created and applied in one go: the moment a tag is worth
            // making is the moment you are looking at the note that needs
            // it, and a trip to Settings and back is where that stops.
            const id = ops.addTag(name, NOTE_COLORS[index.tags.length % NOTE_COLORS.length], '')
            ops.toggleNoteTag(note.id, id)
          }}
        />

        {/*
          The list's width is a drag, not a setting.
          
          It belongs to the thing being sized rather than to a panel three clicks
          away: the reason to widen it is a truncated title you are looking at
          right now. It is remembered per machine, like the editor's measure and
          for the same reason - a width chosen for this screen should not follow
          the notes to another one.
        */}
        <Splitter
          label="Note list width"
          value={prefs.listWidth}
          min={LIST_MIN}
          max={LIST_MAX}
          reset={280}
          onChange={(listWidth) => setPrefs((current) => ({ ...current, listWidth }))}
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
          onOpenNote={(noteId) => {
            // The link carries an id; where it lives is looked up here, because
            // that is what `revealNote` needs to open the right category.
            const target = index.categories
              .flatMap((category) => category.notes)
              .find((candidate) => candidate.id === noteId)
            if (target !== undefined) {
              revealNote(target)
            }
          }}
        />
      </main>

      {loaded && index.categories.length === 0 && (
        <p className="first-run">Add a category in the sidebar to start writing.</p>
      )}

      {savingTemplate !== null && (
        <TemplateModal
          suggestedName={savingTemplate.title}
          tagCount={savingTemplate.tags.length}
          onCancel={() => setSavingTemplate(null)}
          onSave={(fields) => {
            const note = savingTemplate
            setSavingTemplate(null)
            // The body lives in the note file rather than in the index, so it is
            // read at the moment of saving. A template made from a note that
            // cannot be read would be an empty template, which is worse than no
            // template - so nothing is written when the read comes back empty.
            void window.nib.readNote(note.id).then((doc) => {
              if (doc === null) {
                return
              }
              ops.addTemplate({
                name: fields.name,
                title: fields.title,
                description: fields.description,
                body: doc.html,
                tags: [...note.tags]
              })
            })
          }}
        />
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
