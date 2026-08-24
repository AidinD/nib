import { useEffect, useRef, useState } from 'react'
import type { Tag } from '@shared/types'
import { NOTE_COLORS } from '@shared/types'

interface TagPickerProps {
  /** The whole catalog, in its own order. */
  tags: Tag[]
  /** The ids this note carries, including any whose tag has been deleted. */
  selected: string[]
  /** Where to hang the panel: the rect of the button that opened it. */
  anchor: DOMRect
  onToggle: (tagId: string) => void
  /** Create a tag and put it on the note in one go. */
  onCreate: (name: string) => void
  onClose: () => void
}

const PANEL_WIDTH = 232
const MARGIN = 8

/**
 * The panel for putting tags on one note.
 *
 * Fixed rather than absolute, positioned off the opening button's rect, for the
 * same reason the slash menu is: the card list scrolls and the cards clip their
 * own overflow, so a panel drawn inside a card would be cut off by it.
 *
 * Typing filters, and whatever is typed doubles as the name for a new tag - so
 * "I need a tag for this and it does not exist yet" is one field and one Enter
 * rather than a trip to Settings and back. That is the moment a tag is worth
 * creating, and a tagging system nobody adds to is a tagging system nobody uses.
 */
export function TagPicker({
  tags,
  selected,
  anchor,
  onToggle,
  onCreate,
  onClose
}: TagPickerProps): React.JSX.Element {
  const [query, setQuery] = useState('')
  const panel = useRef<HTMLDivElement>(null)
  const field = useRef<HTMLInputElement>(null)

  useEffect(() => {
    field.current?.focus()
  }, [])

  // Escape and a click anywhere outside. Captured on the document rather than
  // by an overlay div, so the rest of the app stays clickable - closing this
  // and pressing something else should be one click, not two.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
      }
    }
    const onDown = (event: MouseEvent): void => {
      if (!(event.target instanceof Node) || panel.current?.contains(event.target) !== true) {
        onClose()
      }
    }
    document.addEventListener('keydown', onKey, true)
    document.addEventListener('mousedown', onDown, true)
    return () => {
      document.removeEventListener('keydown', onKey, true)
      document.removeEventListener('mousedown', onDown, true)
    }
  }, [onClose])

  const needle = query.trim().toLowerCase()
  const matches = tags.filter((tag) => tag.name.toLowerCase().includes(needle))
  const exists = tags.some((tag) => tag.name.toLowerCase() === needle)
  const canCreate = needle.length > 0 && !exists

  const create = (): void => {
    if (!canCreate) {
      return
    }
    onCreate(query.trim())
    setQuery('')
  }

  return (
    <div
      ref={panel}
      className="tag-picker"
      style={{
        left: Math.min(anchor.left, window.innerWidth - PANEL_WIDTH - MARGIN),
        top: Math.min(anchor.bottom + 4, window.innerHeight - 280)
      }}
      onClick={(event) => event.stopPropagation()}
    >
      <input
        ref={field}
        className="tag-search"
        value={query}
        placeholder="Filter, or type a new tag"
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== 'Enter') {
            return
          }
          event.preventDefault()
          // Enter takes the single match when there is exactly one, and creates
          // otherwise. Typing a name in full and pressing Enter should put THAT
          // tag on the note, not make a second one with the same name.
          if (matches.length === 1) {
            onToggle(matches[0].id)
            setQuery('')
            return
          }
          create()
        }}
      />

      <div className="tag-options">
        {matches.map((tag) => (
          <button
            key={tag.id}
            type="button"
            className={`tag-option${selected.includes(tag.id) ? ' is-on' : ''}`}
            title={tag.description}
            onClick={() => onToggle(tag.id)}
          >
            <span className="tag-dot" style={{ background: tag.color }} />
            <span className="tag-name">{tag.name}</span>
            <span className="tag-check">{selected.includes(tag.id) ? '✓' : ''}</span>
          </button>
        ))}

        {matches.length === 0 && !canCreate && <p className="tag-empty">No tags yet.</p>}
      </div>

      {canCreate && (
        <button type="button" className="tag-create" onClick={create}>
          <span
            className="tag-dot"
            style={{ background: NOTE_COLORS[tags.length % NOTE_COLORS.length] }}
          />
          <span className="tag-name">
            New tag <strong>{query.trim()}</strong>
          </span>
        </button>
      )}
    </div>
  )
}
