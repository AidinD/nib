import type { AlertMeta, Category, NibIndex, NoteMeta } from '@shared/types'

/** What the note list is currently showing. */
export type Selection =
  | { kind: 'all' }
  | { kind: 'recent' }
  | { kind: 'sticky' }
  | { kind: 'alerts' }
  | { kind: 'archive' }
  | { kind: 'category'; categoryId: string }
  | { kind: 'sub'; categoryId: string; subId: string }

/** The sidebar's Work/Private segmented control. */
export type ScopeFilter = 'all' | 'W' | 'P'

const RECENT_LIMIT = 30

export function categoryInScope(category: Category, filter: ScopeFilter): boolean {
  if (filter === 'all') {
    return true
  }
  return category.scope === filter
}

function everyNote(index: NibIndex, filter: ScopeFilter): NoteMeta[] {
  return index.categories
    .filter((category) => categoryInScope(category, filter))
    .flatMap((category) => category.notes)
}

/**
 * Every note that has not been archived - which is what every list means by
 * "the notes", the Archive row excepted.
 *
 * The filter lives here, in the one function the lists and the counts and the
 * alert strip all go through, rather than at each call site. An archived note
 * that still counted towards "Needs you" or still showed in the strip would be
 * the whole feature failing quietly.
 */
function allNotes(index: NibIndex, filter: ScopeFilter): NoteMeta[] {
  return everyNote(index, filter).filter((note) => !note.archived)
}

/** The notes in a category, or in one of its sub-categories, minus the archived. */
export function liveNotes(category: Category, subId?: string): NoteMeta[] {
  return category.notes.filter(
    (note) => !note.archived && (subId === undefined || note.subId === subId)
  )
}

/**
 * The notes the current selection resolves to, in the order they should render.
 *
 * Pinned notes float to the top of every category-backed list, so a note you
 * pinned as a sticky stays where you can find it. The smart lists sort by their
 * own rule instead: Recent by edit time, Sticky by trail.
 *
 * `includeArchived` widens a SEARCH, and only a search. With nothing typed there
 * is nothing to widen, and honouring it anyway would quietly merge the archive
 * into every list - which is the one thing archiving is for preventing. So the
 * flag is ignored unless there is a needle, and the toggle in the UI only exists
 * while there is one.
 */
export function selectedNotes(
  index: NibIndex,
  selection: Selection,
  filter: ScopeFilter,
  search: string,
  includeArchived = false
): NoteMeta[] {
  const needle = search.trim().toLowerCase()
  const wide = includeArchived && needle.length > 0
  const pool = (): NoteMeta[] => (wide ? everyNote(index, filter) : allNotes(index, filter))
  const within = (category: Category, subId?: string): NoteMeta[] =>
    wide
      ? category.notes.filter((note) => subId === undefined || note.subId === subId)
      : liveNotes(category, subId)

  let notes: NoteMeta[]

  switch (selection.kind) {
    case 'all':
      notes = pinnedFirst(pool())
      break
    case 'recent':
      notes = pool()
        .slice()
        .sort((a, b) => b.edited - a.edited)
        .slice(0, RECENT_LIMIT)
      break
    case 'sticky':
      notes = pool().filter((note) => note.pinned)
      break
    /*
     * The review view: every note carrying a flag at all, outstanding ones
     * first.
     *
     * Notes whose flags are all dealt with stay in the list rather than
     * vanishing from under the pointer that just ticked them - the strip and
     * the count are what they leave.
     */
    case 'alerts':
      notes = pool()
        .filter((note) => note.flag !== '' || note.alerts.length > 0)
        .sort((a, b) => {
          const open = Number(isOutstanding(b)) - Number(isOutstanding(a))
          return open !== 0 ? open : b.edited - a.edited
        })
      break
    /*
     * The one list that shows archived notes, and shows nothing else.
     *
     * Newest first, by edit time: the reason to open the archive is almost
     * always to pull back something recent that went in by mistake, not to
     * browse a filing cabinet.
     */
    case 'archive':
      notes = everyNote(index, filter)
        .filter((note) => note.archived)
        .slice()
        .sort((a, b) => b.edited - a.edited)
      break
    case 'category': {
      const category = index.categories.find((c) => c.id === selection.categoryId)
      notes = category === undefined ? [] : pinnedFirst(within(category))
      break
    }
    case 'sub': {
      const category = index.categories.find((c) => c.id === selection.categoryId)
      notes = category === undefined ? [] : pinnedFirst(within(category, selection.subId))
      break
    }
  }

  if (needle.length === 0) {
    return notes
  }
  // Title and preview only. The bodies live in their own files and are not loaded
  // for a list, so a full-text search is a later, deliberate feature.
  return notes.filter(
    (note) =>
      note.title.toLowerCase().includes(needle) || note.preview.toLowerCase().includes(needle)
  )
}

/**
 * How many archived notes this search would find if it were allowed to look.
 *
 * This is what makes the toggle quiet: it is offered only when it would change
 * the answer. A search that misses nothing shows no control at all, so the
 * default stays clean and the archive stays out of the way - and the one case
 * archiving makes worse, "I know I wrote this down somewhere", gets its answer
 * in the same place the answer was missing.
 */
export function archivedHits(
  index: NibIndex,
  selection: Selection,
  filter: ScopeFilter,
  search: string
): number {
  if (search.trim().length === 0 || selection.kind === 'archive') {
    return 0
  }
  return selectedNotes(index, selection, filter, search, true).filter((note) => note.archived).length
}

/** Does this note still need you, as opposed to carrying only dealt-with flags? */
export function isOutstanding(note: NoteMeta): boolean {
  return note.flag === 'open' || note.alerts.some((alert) => !alert.done)
}

function pinnedFirst(notes: NoteMeta[]): NoteMeta[] {
  return notes.slice().sort((a, b) => Number(b.pinned) - Number(a.pinned))
}

/**
 * The crumb on a card only earns its place when the list spans more than one
 * place - a whole category, or the sticky list.
 */
export function selectionShowsCrumb(selection: Selection): boolean {
  return selection.kind !== 'sub'
}

export function selectionTitle(index: NibIndex, selection: Selection): string {
  switch (selection.kind) {
    case 'all':
      return 'All notes'
    case 'recent':
      return 'Recent'
    case 'sticky':
      return 'Sticky notes'
    case 'alerts':
      return 'Needs you'
    case 'archive':
      return 'Archive'
    case 'category':
      return index.categories.find((c) => c.id === selection.categoryId)?.name ?? ''
    case 'sub': {
      const category = index.categories.find((c) => c.id === selection.categoryId)
      return category?.subs.find((s) => s.id === selection.subId)?.name ?? ''
    }
  }
}

export function selectionColor(index: NibIndex, selection: Selection): string {
  if (selection.kind === 'category' || selection.kind === 'sub') {
    return index.categories.find((c) => c.id === selection.categoryId)?.color ?? '#9a9da3'
  }
  if (selection.kind === 'sticky') {
    return '#ffb054'
  }
  return selection.kind === 'alerts' ? '#ff8c42' : '#9a9da3'
}

/** Where a new note goes for the current selection, or null when it has no home. */
export function selectionTarget(
  selection: Selection
): { categoryId: string; subId: string | null } | null {
  if (selection.kind === 'category') {
    return { categoryId: selection.categoryId, subId: null }
  }
  if (selection.kind === 'sub') {
    return { categoryId: selection.categoryId, subId: selection.subId }
  }
  return null
}

export function smartCounts(
  index: NibIndex,
  filter: ScopeFilter
): { all: number; recent: number; sticky: number; alerts: number; archived: number } {
  const notes = allNotes(index, filter)
  return {
    all: notes.length,
    recent: Math.min(notes.length, RECENT_LIMIT),
    sticky: notes.filter((note) => note.pinned).length,
    archived: everyNote(index, filter).filter((note) => note.archived).length,
    // Counted in action points, not in notes: the row answers "how many things
    // need me", and one note can hold several - plus the notes that are
    // themselves the action point.
    alerts: notes.reduce(
      (total, note) =>
        total +
        note.alerts.filter((alert) => !alert.done).length +
        (note.flag === 'open' ? 1 : 0),
      0
    )
  }
}

/**
 * One thing that needs you: a flagged block, or a whole note that is itself the
 * action point - which is what `alert: null` means.
 */
export interface AlertEntry {
  note: NoteMeta
  alert: AlertMeta | null
}

/** Everything outstanding, newest note first - what the strip shows. */
export function allAlerts(index: NibIndex, filter: ScopeFilter): AlertEntry[] {
  return allNotes(index, filter)
    .slice()
    .sort((a, b) => b.edited - a.edited)
    .flatMap((note) => [
      ...(note.flag === 'open' ? [{ note, alert: null }] : []),
      ...note.alerts.filter((alert) => !alert.done).map((alert) => ({ note, alert }))
    ])
}
