import { useEffect, useMemo, useRef, useState } from 'react'
import type { NibIndex } from '@shared/types'
import { launcherRows } from '../lib/launcher'
import type { LauncherRow, Standing } from '../lib/launcher'

/**
 * The Ctrl+K window.
 *
 * Deliberately the same shape as Helm's, down to the keys: Escape closes,
 * Up/Down move, Enter runs, and the mouse selects what it hovers so the
 * highlight never lies about what Enter would do. Two apps in the same suite
 * teaching two different palettes would waste the only advantage of having
 * written both.
 *
 * It knows nothing about what a row DOES. `launcherRows` decides what is on
 * offer and `onRun` carries it out - which is what keeps the ordering testable
 * and keeps note creation in one place in `App`, rather than in a second copy
 * living behind a keyboard shortcut.
 */
export function Launcher({
  index,
  standing,
  onRun,
  onClose
}: {
  index: NibIndex
  /** The folder the note list is pointing at, for "a note titled what I typed". */
  standing: Standing | null
  onRun: (row: LauncherRow) => void
  onClose: () => void
}): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [at, setAt] = useState(0)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)

  const rows = useMemo(() => launcherRows(index, query, standing), [index, query, standing])

  // A shorter list can leave the highlight past the end, which would make Enter
  // do nothing while a row looks selected.
  useEffect(() => {
    setAt(0)
  }, [query])

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // Keep the highlighted row on screen when it is walked past the fold.
  useEffect(() => {
    listRef.current?.querySelector('.launcher-row.is-at')?.scrollIntoView({ block: 'nearest' })
  }, [at, rows])

  const run = (row: LauncherRow | undefined): void => {
    if (row === undefined) {
      return
    }
    onClose()
    onRun(row)
  }

  const move = (delta: number): void => {
    if (rows.length === 0) {
      return
    }
    setAt((current) => (current + delta + rows.length) % rows.length)
  }

  return (
    <div className="launcher-backdrop" onMouseDown={onClose}>
      {/*
        The keys are handled here rather than on the window, so the palette
        cannot swallow anything while it is shut - and so the input keeps its own
        text editing. Only the four that steer the list are taken.
      */}
      <div
        className="launcher"
        role="dialog"
        aria-label="Quick open"
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            onClose()
          } else if (event.key === 'ArrowDown') {
            event.preventDefault()
            move(1)
          } else if (event.key === 'ArrowUp') {
            event.preventDefault()
            move(-1)
          } else if (event.key === 'Enter') {
            event.preventDefault()
            run(rows[at])
          }
        }}
      >
        <input
          ref={inputRef}
          className="launcher-input"
          value={query}
          placeholder="A name, a note, a folder…"
          onChange={(event) => setQuery(event.target.value)}
        />
        <div className="launcher-list" ref={listRef}>
          {rows.length === 0 ? (
            <p className="launcher-empty">
              Nothing matches. Pick a category in the sidebar and this will offer to make the note
              there.
            </p>
          ) : (
            rows.map((row, position) => (
              <button
                type="button"
                key={row.id}
                className={`launcher-row is-${row.kind}${position === at ? ' is-at' : ''}`}
                onMouseEnter={() => setAt(position)}
                onClick={() => run(row)}
              >
                <span className="launcher-kind">
                  {row.kind === 'new' ? 'New' : row.kind === 'goto' ? 'Go' : 'Open'}
                </span>
                <span className="launcher-label">{row.label}</span>
                <span className="launcher-where">{row.where}</span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
