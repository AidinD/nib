import { useEffect, useRef } from 'react'

/*
 * The slash menu: type `/` and pick a command, the way Slack and Notion do.
 *
 * It exists because the toolbar is the slow path. Anything reachable by a button
 * belongs here too, plus the things a button cannot sensibly hold - today's date
 * chief among them.
 *
 * The menu owns no editing logic. It reports which command was chosen and the
 * editor performs it, so there is exactly one place in the app that knows how a
 * heading is made.
 */

export interface SlashCommand {
  id: string
  /** What the row says. */
  label: string
  /** Typed to reach it, beyond the label - "date" finds `/today`. */
  keywords: string[]
  hint?: string
}

export const SLASH_COMMANDS: SlashCommand[] = [
  { id: 'today', label: 'Today', keywords: ['datum', 'idag'], hint: 'Insert the date' },
  { id: 'tomorrow', label: 'Tomorrow', keywords: ['imorgon', 'morgon'], hint: 'Tomorrow’s date' },
  { id: 'date', label: 'Pick a date…', keywords: ['date', 'datum', 'calendar', 'kalender'], hint: 'Calendar' },
  { id: 'now', label: 'Now', keywords: ['time', 'tid', 'nu'], hint: 'Date and time' },
  { id: 'h1', label: 'Heading 1', keywords: ['title', 'rubrik'] },
  { id: 'h2', label: 'Heading 2', keywords: ['subheading', 'rubrik'] },
  { id: 'h3', label: 'Heading 3', keywords: ['rubrik'] },
  { id: 'body', label: 'Body text', keywords: ['paragraph', 'text', 'brödtext'] },
  { id: 'bullets', label: 'Bulleted list', keywords: ['ul', 'punkter', 'lista'] },
  { id: 'numbers', label: 'Numbered list', keywords: ['ol', 'nummer', 'lista'] },
  { id: 'quote', label: 'Quote', keywords: ['blockquote', 'citat'] },
  { id: 'code', label: 'Code', keywords: ['monospace', 'kod'] },
  { id: 'divider', label: 'Divider', keywords: ['hr', 'line', 'avdelare'] },
  { id: 'alert', label: 'Flag as action point', keywords: ['alert', 'todo', 'flagga'] },
  { id: 'canvas', label: 'Drawing', keywords: ['canvas', 'sketch', 'rita'] },
  { id: 'image', label: 'Image', keywords: ['picture', 'bild'] },
  { id: 'bold', label: 'Bold', keywords: ['strong', 'fet'] },
  { id: 'italic', label: 'Italic', keywords: ['emphasis', 'kursiv'] },
  { id: 'strike', label: 'Strikethrough', keywords: ['struck', 'genomstruken'] },
  { id: 'clear', label: 'Clear formatting', keywords: ['plain', 'rensa', 'format'] }
]

/** The commands matching what has been typed after the slash. */
export function matchCommands(query: string): SlashCommand[] {
  const needle = query.trim().toLowerCase()
  if (needle.length === 0) {
    return SLASH_COMMANDS
  }
  return SLASH_COMMANDS.filter(
    (command) =>
      command.label.toLowerCase().includes(needle) ||
      command.keywords.some((keyword) => keyword.includes(needle))
  )
}

interface SlashMenuProps {
  /** Where the caret is, in viewport coordinates. */
  at: { left: number; top: number }
  query: string
  active: number
  onPick: (command: SlashCommand) => void
  onHover: (index: number) => void
}

export function SlashMenu({ at, query, active, onPick, onHover }: SlashMenuProps): React.JSX.Element | null {
  const listRef = useRef<HTMLDivElement | null>(null)
  const matches = matchCommands(query)

  // Keep the highlighted row in view when the arrows walk past the edge.
  useEffect(() => {
    listRef.current?.querySelector('.slash-row.is-active')?.scrollIntoView({ block: 'nearest' })
  }, [active])

  if (matches.length === 0) {
    return null
  }

  return (
    <div
      className="slash-menu"
      ref={listRef}
      // Positioned at the caret rather than anchored to the panel: the menu is
      // about the word being typed, and a menu in a corner makes you look away
      // from it.
      style={{ left: at.left, top: at.top }}
    >
      {matches.map((command, index) => (
        <button
          key={command.id}
          type="button"
          className={`slash-row${index === active ? ' is-active' : ''}`}
          // Mousedown would move focus out of the document before the click
          // lands, and the command needs the caret where it was.
          onMouseDown={(event) => event.preventDefault()}
          onMouseEnter={() => onHover(index)}
          onClick={() => onPick(command)}
        >
          <span className="slash-label">{command.label}</span>
          {command.hint !== undefined && <span className="slash-hint">{command.hint}</span>}
        </button>
      ))}
    </div>
  )
}
