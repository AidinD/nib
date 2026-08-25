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
        {shown.map(({ note, alert }) => (
          <span key={`${note.id}-${alert?.id ?? 'note'}`} className="alert-chip">
            <button
              type="button"
              className="alert-chip-open"
              title={`${noteTrail(index.categories, note)} › ${note.title}${
                alert === null ? '' : `\n${alert.text}`
              }`}
              onClick={() => onOpen(note, alert?.id ?? null)}
            >
              <span className="alert-chip-note">
                {note.title.length > 0 ? note.title : 'Untitled'}
              </span>
              {/* A whole note flagged as the action point has no line to quote,
                  so the chip is just its name. */}
              {/*
                A flag on a line with no words yet still has to be findable: the
                chip is how you get back to it, and a blank one reads as a bug in
                the strip rather than as an empty line in a note.
              */}
              {alert !== null && (
                <span className="alert-chip-text">
                  {alert.text.length > 0 ? alert.text : 'flagged line, no text'}
                </span>
              )}
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
        ))}
        {hidden > 0 && (
          <button type="button" className="alert-more" onClick={onShowAll}>
            +{hidden} more
          </button>
        )}
      </div>
    </div>
  )
}
