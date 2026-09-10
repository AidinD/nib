import type { NibIndex, NoteMeta } from '@shared/types'
import { noteTrail } from '../lib/notes'
import type { ScopeFilter } from '../lib/selection'
import { practising } from '../lib/selection'
import { Chip, VISIBLE } from './AlertStrip'

/**
 * The violet lane: the principles being worked on right now.
 *
 * ## Why it is a lane of its own
 *
 * Under "Needs you", not beside it and not inside it. "Needs you" means
 * something precise - flagged action points still outstanding - and a principle
 * in practice is not outstanding. Mixed into that row it would sit there
 * permanently, and within a week the row would mean "stuff", which is the point
 * at which it stops saying anything and you stop reading it. The counts in the
 * sidebar were split for exactly this reason once already: one number said nine
 * when three were owed.
 *
 * ## Why it exists at all
 *
 * The principles being practised were one click away, behind a rail row showing
 * a number. A number is a reminder that something exists; the lane is the daily
 * reminder of WHAT, which is the only kind that changes what you do in a
 * meeting an hour later.
 *
 * ## The flag is the source, and it is read every time
 *
 * The cards are the notes tagged as principles whose own flag is open. Nothing
 * is stored and no list is kept: the flag is changed in the app, in the gutter,
 * without telling anybody, so a parallel list would start disagreeing with the
 * document within a day - and a reminder you have caught lying once is a
 * reminder you stop believing. The tag says what a note IS; the flag says
 * whether it is live.
 *
 * ## No tick
 *
 * The alert lane has one because an action point is finished by doing it. A
 * principle is not: taking one off this lane is a judgement that you have it
 * now, and that belongs in the note beside what you have been writing about it,
 * not behind a check mark on a strip you are walking past.
 */
export function PracticeStrip({
  index,
  scope,
  onOpen,
  onShowAll
}: {
  index: NibIndex
  scope: ScopeFilter
  onOpen: (note: NoteMeta) => void
  onShowAll: () => void
}): React.JSX.Element | null {
  const notes = practising(index, scope)
  if (notes.length === 0) {
    return null
  }

  const shown = notes.slice(0, VISIBLE)
  const hidden = notes.length - shown.length

  return (
    <div className="alert-strip is-practice">
      {/* The rail's own word for this list, so the lane and the row it overflows
          into are recognisably the same thing. */}
      <span className="alert-label">Practising</span>
      <div className="alert-chips">
        {shown.map((note) => {
          const title = note.title.length > 0 ? note.title : 'Untitled'
          const trail = noteTrail(index.categories, note)
          return (
            <Chip
              key={note.id}
              title={`${trail} › ${title}`}
              /* A principle is a whole note, so there is no line to quote: the
                 path stops at the folder and the title is the thing itself. */
              where={trail}
              what={title}
              onOpen={() => onOpen(note)}
            />
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
