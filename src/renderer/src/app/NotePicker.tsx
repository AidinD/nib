import { useEffect, useMemo, useRef, useState } from 'react'
import type { NibIndex, NoteMeta } from '@shared/types'

/*
 * Pick a note to link to.
 *
 * Unlike the slash menu and the calendar, this one DOES take focus: it needs a
 * text field of its own, because what is typed here is a search over the whole
 * notebook rather than something being written into the note. The caret is not
 * lost - the editor keeps the last range inside the body and restores it before
 * inserting - which is the same mechanism the toolbar buttons rely on.
 */

export interface NoteChoice {
  note: NoteMeta
  /** Where it lives, shown so two notes with the same title can be told apart. */
  trail: string
}

/** Every note in the notebook, with the trail that says where it is. */
export function listNotes(index: NibIndex, exceptId: string | null): NoteChoice[] {
  const choices: NoteChoice[] = []
  for (const category of index.categories) {
    for (const note of category.notes) {
      if (note.id === exceptId || note.archived === true) {
        continue
      }
      const sub = category.subs.find((candidate) => candidate.id === note.subId)
      choices.push({
        note,
        trail: sub === undefined ? category.name : `${category.name} · ${sub.name}`
      })
    }
  }
  return choices
}

function score(choice: NoteChoice, needle: string): number {
  const title = (choice.note.title.length > 0 ? choice.note.title : 'Untitled').toLowerCase()
  if (needle.length === 0) {
    return 1
  }
  if (title.startsWith(needle)) {
    return 3
  }
  if (title.includes(needle)) {
    return 2
  }
  // The trail is searchable too, so "manager" finds everything filed under it.
  return choice.trail.toLowerCase().includes(needle) ? 1 : 0
}

interface NotePickerProps {
  at: { left: number; top: number }
  choices: NoteChoice[]
  onPick: (choice: NoteChoice) => void
  onClose: () => void
}

export function NotePicker({ at, choices, onPick, onClose }: NotePickerProps): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return choices
      .map((choice) => ({ choice, rank: score(choice, needle) }))
      .filter((entry) => entry.rank > 0)
      .sort((a, b) => b.rank - a.rank || b.choice.note.edited - a.choice.note.edited)
      .slice(0, 40)
      .map((entry) => entry.choice)
  }, [choices, query])

  const take = (index: number): void => {
    const choice = matches[index]
    if (choice !== undefined) {
      onPick(choice)
    }
  }

  return (
    <div className="note-picker" style={{ left: at.left, top: at.top }}>
      <input
        ref={inputRef}
        className="note-picker-input"
        placeholder="Link to a note…"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value)
          setActive(0)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            onClose()
            return
          }
          if (event.key === 'Enter') {
            event.preventDefault()
            take(active)
            return
          }
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()
            const step = event.key === 'ArrowDown' ? 1 : -1
            setActive((current) =>
              matches.length === 0 ? 0 : (current + step + matches.length) % matches.length
            )
          }
        }}
      />

      <div className="note-picker-list">
        {matches.length === 0 && <p className="note-picker-empty">No note by that name.</p>}
        {matches.map((choice, index) => (
          <button
            key={choice.note.id}
            type="button"
            className={`note-picker-row${index === active ? ' is-active' : ''}`}
            onMouseEnter={() => setActive(index)}
            onClick={() => onPick(choice)}
          >
            <span className="note-picker-title">
              {choice.note.title.length > 0 ? choice.note.title : 'Untitled'}
            </span>
            <span className="note-picker-trail">{choice.trail}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
