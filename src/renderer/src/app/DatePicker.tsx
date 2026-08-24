import { useRef } from 'react'

/*
 * A month at the caret, for `/date`.
 *
 * `/today` needs no picker - it is one keystroke and it knows the answer. A date
 * a fortnight out is the case this is for: a follow-up, a deadline, the day
 * someone said they would come back to you. Working that out by counting is
 * exactly what a calendar is for.
 *
 * It holds no state and takes no focus. Which day is highlighted lives in the
 * editor, beside the caret it is going to write to, and the arrow keys reach it
 * through the same handler as the slash menu - because the moment this took
 * focus, the caret in the document would be gone and there would be nowhere to
 * put the date.
 */

/** Monday-first, which is what a Swedish week looks like. */
const WEEKDAYS = ['må', 'ti', 'on', 'to', 'fr', 'lö', 'sö']

/** The date, as a note should hold it: sortable, unambiguous, short. */
export function formatDate(date: Date): string {
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

export function sameDay(a: Date, b: Date): boolean {
  return formatDate(a) === formatDate(b)
}

/** Shift a date by days or months, without mutating the one passed in. */
export function shiftDate(date: Date, { days = 0, months = 0 }): Date {
  const next = new Date(date.getTime())
  if (months !== 0) {
    // Clamp: a month step from the 31st must not land in the month after next.
    const day = next.getDate()
    next.setDate(1)
    next.setMonth(next.getMonth() + months)
    const lastDay = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate()
    next.setDate(Math.min(day, lastDay))
  }
  if (days !== 0) {
    next.setDate(next.getDate() + days)
  }
  return next
}

/** The six weeks that cover a month, so the grid never changes height. */
function weeksOf(cursor: Date): Date[][] {
  const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1)
  // getDay is Sunday-first; shift it so Monday is 0.
  const lead = (first.getDay() + 6) % 7
  const start = shiftDate(first, { days: -lead })
  const weeks: Date[][] = []
  for (let week = 0; week < 6; week++) {
    weeks.push(Array.from({ length: 7 }, (_, day) => shiftDate(start, { days: week * 7 + day })))
  }
  return weeks
}

interface DatePickerProps {
  /** Where the caret is, in viewport coordinates. */
  at: { left: number; top: number }
  /** The highlighted day - owned by the editor, moved by the arrow keys. */
  cursor: Date
  onPick: (date: Date) => void
  onMove: (date: Date) => void
}

export function DatePicker({ at, cursor, onPick, onMove }: DatePickerProps): React.JSX.Element {
  const today = useRef(new Date()).current
  const weeks = weeksOf(cursor)

  return (
    <div className="date-picker" style={{ left: at.left, top: at.top }}>
      <div className="date-head">
        <button
          type="button"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onMove(shiftDate(cursor, { months: -1 }))}
          aria-label="Föregående månad"
        >
          ‹
        </button>
        <span>
          {cursor.toLocaleDateString('sv-SE', { month: 'long', year: 'numeric' })}
        </span>
        <button
          type="button"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onMove(shiftDate(cursor, { months: 1 }))}
          aria-label="Nästa månad"
        >
          ›
        </button>
      </div>

      <div className="date-grid">
        {WEEKDAYS.map((day) => (
          <span key={day} className="date-weekday">
            {day}
          </span>
        ))}
        {weeks.flat().map((day) => {
          const outside = day.getMonth() !== cursor.getMonth()
          return (
            <button
              key={formatDate(day)}
              type="button"
              className={
                'date-day' +
                (outside ? ' is-outside' : '') +
                (sameDay(day, today) ? ' is-today' : '') +
                (sameDay(day, cursor) ? ' is-active' : '')
              }
              // Same reason as the slash menu: mousedown would take the caret
              // away before the click could write to it.
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => onPick(day)}
            >
              {day.getDate()}
            </button>
          )
        })}
      </div>

      <div className="date-hint">Piltangenter, Enter väljer</div>
    </div>
  )
}
