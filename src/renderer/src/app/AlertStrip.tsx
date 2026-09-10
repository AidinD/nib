import type { NibIndex, NoteMeta } from '@shared/types'
import { noteTrail } from '../lib/notes'
import type { ScopeFilter } from '../lib/selection'
import { allAlerts } from '../lib/selection'

/** How many chips a lane shows before it hands over to its list. */
export const VISIBLE = 6

/**
 * One chip: two lines, the top saying where it is and the bottom what it is.
 *
 * Shared by both lanes rather than written twice. They are the same object with
 * different contents and a different colour, and two copies of this markup would
 * be two chips that drift - which a second lane sitting directly under the first
 * would make visible immediately.
 *
 * One line was the first version and it meant the note's title and the action
 * point competed for the same width and both lost: three of them on a 1240px
 * window, every one cut mid-word, half the row empty.
 *
 * The path on top runs all the way down to whatever the line below is NOT. For a
 * whole note, the thing is the note, so the path stops at its folder; for a
 * flagged line, the thing is the line, so the path carries on through the note it
 * is written in. Either way it starts at the category - which the first version
 * got wrong by putting the note's title alone above an action point, so one kind
 * of chip showed a category and the other did not, and the two side by side read
 * as a bug rather than as a rule.
 */
export function Chip({
  where,
  what,
  title,
  onOpen,
  children
}: {
  where: string
  what: string
  title: string
  onOpen: () => void
  /** Anything that acts on the chip from outside it - the alert lane's tick. */
  children?: React.ReactNode
}): React.JSX.Element {
  return (
    <span className="alert-chip">
      <button type="button" className="alert-chip-open" title={title} onClick={onOpen}>
        <span className="alert-chip-where">{where}</span>
        <span className="alert-chip-what">{what}</span>
      </button>
      {children}
    </span>
  )
}

/**
 * The alert strip: one horizontal row under the header holding the action points
 * flagged across every note.
 *
 * It earns its place by being ambient. Action points cut across categories, so
 * they do not belong to any one list, and a row that is simply *there* nags in a
 * way a list you have to open cannot. It costs nothing when there is nothing to
 * show: with no alerts, the strip does not render at all.
 *
 * A strip cannot hold twenty of them, which is what the "Needs you" row in the
 * sidebar is for - the strip reminds, the list is where you work through them.
 * The overflow chip is the handover between the two.
 *
 * What it deliberately does NOT hold is the principles being practised. That is
 * the violet lane below it - see `PracticeStrip`.
 */
export function AlertStrip({
  index,
  scope,
  onOpen,
  onShowAll,
  onClear
}: {
  index: NibIndex
  scope: ScopeFilter
  onOpen: (note: NoteMeta, alertId: string | null) => void
  onShowAll: () => void
  onClear: (note: NoteMeta, alertId: string | null) => void
}): React.JSX.Element | null {
  const alerts = allAlerts(index, scope)
  if (alerts.length === 0) {
    return null
  }

  const shown = alerts.slice(0, VISIBLE)
  const hidden = alerts.length - shown.length

  return (
    <div className="alert-strip">
      <span className="alert-label">Needs you</span>
      <div className="alert-chips">
        {shown.map(({ note, alert }) => {
          const title = note.title.length > 0 ? note.title : 'Untitled'
          const trail = noteTrail(index.categories, note)
          return (
            <Chip
              key={`${note.id}-${alert?.id ?? 'note'}`}
              title={
                alert === null
                  ? `${trail} › ${note.title}`
                  : `${trail} › ${note.title}\n${alert.text}`
              }
              where={alert === null ? trail : `${trail} › ${title}`}
              /*
               * A flag on a line with no words yet still has to be findable: the
               * chip is how you get back to it, and a blank one reads as a bug in
               * the strip rather than as an empty line in a note.
               */
              what={
                alert === null ? title : alert.text.length > 0 ? alert.text : 'flagged line, no text'
              }
              onOpen={() => onOpen(note, alert?.id ?? null)}
            >
              {/* Ticking it off here marks the block done, or unflags the note,
                  without opening it and hunting for the line. */}
              <button
                type="button"
                className="alert-tick"
                title="Done with this"
                onClick={() => onClear(note, alert?.id ?? null)}
              >
                ✓
              </button>
            </Chip>
          )
        })}
        {hidden > 0 && (
          <button type="button" className="alert-more" onClick={onShowAll}>
            +{hidden} more
          </button>
        )}
      </div>
    </div>
  )
}
