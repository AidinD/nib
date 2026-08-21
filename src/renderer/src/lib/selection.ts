import type { AlertMeta, Category, NibIndex, NoteMeta } from '@shared/types'

/** What the note list is currently showing. */
export type Selection =
  | { kind: 'all' }
  | { kind: 'recent' }
  | { kind: 'sticky' }
  | { kind: 'alerts' }
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

function allNotes(index: NibIndex, filter: ScopeFilter): NoteMeta[] {
  return index.categories
    .filter((category) => categoryInScope(category, filter))
    .flatMap((category) => category.notes)
}

/**
 * The notes the current selection resolves to, in the order they should render.
 *
 * Pinned notes float to the top of every category-backed list, so a note you
 * pinned as a sticky stays where you can find it. The smart lists sort by their
 * own rule instead: Recent by edit time, Sticky by trail.
 */
export function selectedNotes(
  index: NibIndex,
  selection: Selection,
  filter: ScopeFilter,
  search: string
): NoteMeta[] {
  let notes: NoteMeta[]

  switch (selection.kind) {
    case 'all':
      notes = pinnedFirst(allNotes(index, filter))
      break
    case 'recent':
      notes = allNotes(index, filter)
        .slice()
        .sort((a, b) => b.edited - a.edited)
        .slice(0, RECENT_LIMIT)
      break
    case 'sticky':
      notes = allNotes(index, filter).filter((note) => note.pinned)
      break
    // The review view for action points: the notes that hold one, newest first,
    // because an action point you wrote today is the one still on your mind.
    case 'alerts':
      notes = allNotes(index, filter)
        .filter((note) => note.alerts.length > 0)
        .sort((a, b) => b.edited - a.edited)
      break
    case 'category': {
      const category = index.categories.find((c) => c.id === selection.categoryId)
      notes = category === undefined ? [] : pinnedFirst(category.notes)
      break
    }
    case 'sub': {
      const category = index.categories.find((c) => c.id === selection.categoryId)
      notes =
        category === undefined
          ? []
          : pinnedFirst(category.notes.filter((note) => note.subId === selection.subId))
      break
    }
  }

  const needle = search.trim().toLowerCase()
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
): { all: number; recent: number; sticky: number; alerts: number } {
  const notes = allNotes(index, filter)
  return {
    all: notes.length,
    recent: Math.min(notes.length, RECENT_LIMIT),
    sticky: notes.filter((note) => note.pinned).length,
    // Counted in action points, not in notes: the row answers "how many things
    // need me", and one note can hold several.
    alerts: notes.reduce((total, note) => total + note.alerts.length, 0)
  }
}

/** Every flagged block in the app, with the note it lives in - what the strip shows. */
export function allAlerts(
  index: NibIndex,
  filter: ScopeFilter
): Array<{ note: NoteMeta; alert: AlertMeta }> {
  return allNotes(index, filter)
    .slice()
    .sort((a, b) => b.edited - a.edited)
    .flatMap((note) => note.alerts.map((alert) => ({ note, alert })))
}
