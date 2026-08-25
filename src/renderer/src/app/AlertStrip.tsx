import type { NibIndex, NoteMeta } from '@shared/types'
import { noteTrail } from '../lib/notes'
import type { ScopeFilter } from '../lib/selection'
import { allAlerts } from '../lib/selection'

/** How many chips the strip shows before it hands over to the review list. */
const VISIBLE = 6

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
          <span key={`${note.id}-${alert?.id ?? 'note'}`} className="alert-chip">
            <button
              type="button"
              className="alert-chip-open"
              title={`${noteTrail(index.categories, note)} › ${note.title}${
                alert === null ? '' : `\n${alert.text}`
              }`}
              onClick={() => onOpen(note, alert?.id ?? null)}
            >
              {/*
                Two lines, and the rule is the same for both kinds of chip: the
                top line says where it is, the bottom line says what it is.

                For a flagged LINE that is the note's title above the words of the
                action point. For a whole note flagged there is no line to quote,
                so the title moves down to be the thing itself and the trail takes
                the top - which also tells you which "1-1" you are looking at, and
                the one-line version never could.
              */}
              {/*
                Two lines: the top is the PATH to the thing, the bottom is the
                thing.

                The path runs all the way down to whatever the line below is not.
                For a whole note flagged, the thing is the note, so the path stops
                at its folder. For a flagged line, the thing is the line, so the
                path carries on through the note it is written in. Either way it
                starts at the category - which the first version of this got wrong
                by putting the note's title alone on top of an action point, so one
                kind of chip showed a category and the other did not, and the two
                sitting side by side read as a bug rather than as a rule.
              */}
              <span className="alert-chip-where">
                {alert === null ? trail : `${trail} › ${title}`}
              </span>
              {/*
                A flag on a line with no words yet still has to be findable: the
                chip is how you get back to it, and a blank one reads as a bug in
                the strip rather than as an empty line in a note.
              */}
              <span className="alert-chip-what">
                {alert === null ? title : alert.text.length > 0 ? alert.text : 'flagged line, no text'}
              </span>
            </button>
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
          </span>
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
