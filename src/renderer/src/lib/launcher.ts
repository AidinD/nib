import type { NibIndex, NoteMeta, Template } from '@shared/types'

/**
 * Ctrl+K: everything the notebook can do to a word you type.
 *
 * ## The thing it is actually for
 *
 * Writing a note for somebody costs three deliberate acts today - find their
 * folder in the sidebar, click it, then reach for the template menu beside the
 * add field - and all three happen at the moment you are least willing to spend
 * effort, which is just after the conversation. That is the same argument
 * templates were built on, and templates only solved the second half of it. This
 * is the first half: type the person's name, press Enter, be in the note.
 *
 * ## A launcher, not a second search
 *
 * It matches titles and the names of folders and tags. It does NOT read the
 * notes - Ctrl+Shift+F does that, reading every body and quoting the line it
 * matched. Keeping them apart is deliberate rather than lazy: a launcher answers
 * "take me there" and has to answer while you are still typing, and a search
 * answers "where did I write that" and is allowed to think. Merging them would
 * make the fast one wait for the thorough one.
 *
 * ## Which template it offers, and how it knows
 *
 * From what the folder already holds. A template's tags are stamped on the notes
 * made from it, so a folder whose notes are mostly tagged `1-1` gets the 1-1
 * template offered first. Nothing is stored to make this work and nothing has to
 * be maintained - it is read off the notes each time - so a folder that changes
 * what it is for changes what it suggests, without anybody telling it.
 *
 * This file is pure. It builds rows out of the index and nothing else, which is
 * what lets the ordering be tested rather than eyeballed against a real notebook.
 */

/** A folder a note can be created in: a category, or a sub inside one. */
export interface Place {
  categoryId: string
  subId: string | null
  /** The leaf, which is what a person's folder is named. */
  name: string
  /** "Work / Vale", for showing where a row would land. */
  path: string
}

/**
 * One line in the list.
 *
 * Data, not a closure. The row says what it IS and the window decides what to do
 * about it, so the ordering can be tested without a React tree and without the
 * side effects that creating a note has.
 */
export interface LauncherRow {
  /** Stable for one query, so React and a test both have something to hold. */
  id: string
  kind: 'open' | 'goto' | 'new'
  /** The thing itself - a note's title, a template's name, a folder's name. */
  label: string
  /** Where it is, or where it would land. Shown dimmed beside the label. */
  where: string
  /** `open`: the note. */
  noteId?: string
  /** `goto` and `new`: the folder. Absent on a tag row, which is `tagId`. */
  place?: Place
  /** `goto`: a tag, which is a list rather than a folder and holds no new note. */
  tagId?: string
  /** `new`: the template to start from, or null for an empty note. */
  templateId?: string | null
  /** `new`: what was typed to title it with. Empty means let the template name it. */
  typed?: string
  score: number
}

/* ------------------------------------------------------ the matching -- */

/*
 * Four ways a query can fit, worth twenty points apart.
 *
 * The gap is bigger than any length penalty below, so a worse KIND of match
 * never outranks a better one however short the text is. Subsequence is last and
 * is what makes a launcher feel like one - `val` finds `Vale`, and so does
 * `vl` - but on its own it matches far too much to be ordered by, which is the
 * reason for the three tiers above it.
 */
const EXACT = 100
const PREFIX = 80
const WORD = 60
const INSIDE = 40
const LOOSE = 20

/** Where a word begins, so `chit` scores properly against "Casual Chit Chat". */
const BREAK = /[\s/\-_.,:]/

/** Every character of the query, in order, somewhere in the text. */
function loose(query: string, text: string): boolean {
  let at = 0
  for (const character of query) {
    at = text.indexOf(character, at)
    if (at === -1) {
      return false
    }
    at += 1
  }
  return true
}

/**
 * How well a query fits a piece of text. Zero when it does not fit at all.
 *
 * The length penalty breaks ties within a tier and only within one: a query that
 * is inside two titles prefers the shorter, because a short title containing the
 * word is far more likely to BE about it. Capped below the tier gap so it can
 * never promote a loose match over a real one.
 */
export function fit(query: string, text: string): number {
  const needle = query.trim().toLowerCase()
  const hay = text.toLowerCase()
  if (needle.length === 0 || hay.length === 0) {
    return 0
  }
  const penalty = Math.min(18, Math.floor(hay.length / 4))
  if (hay === needle) {
    return EXACT
  }
  if (hay.startsWith(needle)) {
    return PREFIX - penalty
  }
  const at = hay.indexOf(needle)
  if (at > 0 && BREAK.test(hay[at - 1])) {
    return WORD - penalty
  }
  if (at > 0) {
    return INSIDE - penalty
  }
  return loose(needle, hay) ? LOOSE - penalty : 0
}

/* -------------------------------------------------------- the places -- */

/** Every folder a note could go in, category and sub alike. */
export function places(index: NibIndex): Place[] {
  const out: Place[] = []
  for (const category of index.categories) {
    out.push({
      categoryId: category.id,
      subId: null,
      name: category.name,
      path: category.name
    })
    for (const sub of category.subs) {
      out.push({
        categoryId: category.id,
        subId: sub.id,
        name: sub.name,
        path: `${category.name} / ${sub.name}`
      })
    }
  }
  return out
}

/** Where a note lives, written the way a row shows it. */
export function pathOf(index: NibIndex, note: NoteMeta): string {
  const category = index.categories.find((candidate) => candidate.id === note.categoryId)
  if (category === undefined) {
    return ''
  }
  const sub = category.subs.find((candidate) => candidate.id === note.subId)
  return sub === undefined ? category.name : `${category.name} / ${sub.name}`
}

/**
 * The templates a folder actually uses, most-used first.
 *
 * Read off the notes rather than recorded when one is made. A template stamps
 * its tags on the note, so the notes are already the evidence - and evidence
 * that is a side effect of normal use cannot drift out of date the way a stored
 * counter would. A template with no tags of its own cannot be recognised this
 * way and simply keeps its place in the catalog, which is the honest outcome:
 * nothing about the note it made says where it came from.
 */
export function templatesFor(index: NibIndex, place: Place): Template[] {
  const category = index.categories.find((candidate) => candidate.id === place.categoryId)
  const notes = (category?.notes ?? []).filter((note) => note.subId === place.subId)
  const used = new Map<string, number>()
  for (const template of index.templates) {
    const stamped = template.tags ?? []
    if (stamped.length === 0) {
      continue
    }
    const count = notes.filter((note) => stamped.every((tag) => note.tags.includes(tag))).length
    if (count > 0) {
      used.set(template.id, count)
    }
  }
  return [...index.templates].sort(
    (left, right) => (used.get(right.id) ?? 0) - (used.get(left.id) ?? 0)
  )
}

/* ---------------------------------------------------------- the rows -- */

/** Caps, so one keystroke cannot produce a list nobody can read. */
const PLACES_MAX = 3
const TEMPLATES_MAX = 3
const NOTES_MAX = 8
const RECENT_MAX = 8
const TAGS_MAX = 3
export const ROWS_MAX = 24

/** Where the note list is pointing, when that is a folder a note can go in. */
export interface Standing {
  categoryId: string
  subId: string | null
}

/** The `new` rows for one folder: its templates, then a note with no shape at all. */
function newRows(index: NibIndex, place: Place, score: number, typed: string): LauncherRow[] {
  const rows: LauncherRow[] = []
  for (const template of templatesFor(index, place).slice(0, TEMPLATES_MAX)) {
    rows.push({
      id: `new:${place.categoryId}:${place.subId ?? ''}:${template.id}`,
      kind: 'new',
      label: `New ${template.name}`,
      where: place.path,
      place,
      templateId: template.id,
      typed,
      score
    })
  }
  rows.push({
    id: `new:${place.categoryId}:${place.subId ?? ''}:blank`,
    kind: 'new',
    // The typed words are shown, because this is the row where they become the
    // title rather than being thrown away as a search that found nothing.
    label: typed.length > 0 ? `New note “${typed}”` : 'New note',
    where: place.path,
    place,
    templateId: null,
    typed,
    // Below the templates for the same folder, and only just: an empty note is
    // the fallback, not the offer.
    score: score - 1
  })
  return rows
}

/**
 * What Ctrl+K shows for what has been typed.
 *
 * Ordered by fit rather than by kind, with one thumb on the scale: a folder
 * whose name is what you typed puts its `new` rows above its own `go to`, which
 * is the whole point of the feature. Typing a person's name is a sentence about
 * writing something, not about looking at what is already there.
 *
 * `standing` is where the note list is currently pointing, and is what makes a
 * query that matches nothing still useful: it becomes the title of a note in the
 * folder you are already standing in.
 */
export function launcherRows(
  index: NibIndex,
  query: string,
  standing: Standing | null
): LauncherRow[] {
  const needle = query.trim()
  const all = places(index)
  const here = all.find(
    (place) =>
      standing !== null &&
      place.categoryId === standing.categoryId &&
      place.subId === standing.subId
  )

  /*
   * Nothing typed: the notes you touched last.
   *
   * A launcher opens empty every time, and the commonest thing to want at that
   * moment is the note you were in ten minutes ago. Creating still needs a name
   * typed, so it has nothing to show here that the folder's own add field does
   * not already show better.
   */
  if (needle.length === 0) {
    const recent = index.categories
      .flatMap((category) => category.notes)
      .filter((note) => !note.archived)
      .sort((left, right) => right.edited - left.edited)
      .slice(0, RECENT_MAX)
    return recent.map((note, position) => ({
      id: `open:${note.id}`,
      kind: 'open' as const,
      label: note.title.trim().length > 0 ? note.title : 'Untitled',
      where: pathOf(index, note),
      noteId: note.id,
      score: RECENT_MAX - position
    }))
  }

  const rows: LauncherRow[] = []

  /*
   * A folder by name, which is the case this was built for.
   *
   * Scored against the leaf and against the whole path, the leaf winning ties -
   * a person's folder is named after them, and `vale` should not have to beat
   * `Work / Vale` on its own terms.
   */
  const matched = all
    .map((place) => ({ place, score: Math.max(fit(needle, place.name), fit(needle, place.path) - 5) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, PLACES_MAX)

  for (const { place, score } of matched) {
    rows.push(...newRows(index, place, score, ''))
    rows.push({
      id: `goto:${place.categoryId}:${place.subId ?? ''}`,
      kind: 'goto',
      label: place.name,
      where: place.subId === null ? 'Category' : place.path,
      place,
      // Under this folder's own new rows, deliberately. Going somewhere to look
      // is what the sidebar is for and it is two clicks; arriving with the note
      // already made is what this saves.
      score: score - 2
    })
  }

  /*
   * "vale standup" - a folder, then a title for the note in it.
   *
   * The first word is tried on its own, because a query with a space in it will
   * never match a one-word folder name and would otherwise fall all the way
   * through to the folder you happen to be standing in. This is the shape a
   * launcher is typed in once you trust it.
   */
  const space = needle.indexOf(' ')
  if (space > 0) {
    const first = needle.slice(0, space)
    const rest = needle.slice(space + 1).trim()
    const target = all
      .map((place) => ({ place, score: fit(first, place.name) }))
      .filter((entry) => entry.score >= WORD - 18)
      .sort((left, right) => right.score - left.score)[0]
    if (target !== undefined && rest.length > 0) {
      rows.push(...newRows(index, target.place, target.score + 1, rest))
    }
  }

  /*
   * The notes themselves, by title only - see the note at the top of this file
   * about why the bodies are the other shortcut's job.
   *
   * Capped after being ordered rather than while collecting, so the eight shown
   * are the best eight rather than the first eight found in category order.
   */
  const hits = index.categories
    .flatMap((category) => category.notes)
    .filter((note) => !note.archived)
    .map((note) => ({ note, score: fit(needle, note.title) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, NOTES_MAX)
  for (const { note, score } of hits) {
    rows.push({
      id: `open:${note.id}`,
      kind: 'open',
      label: note.title.trim().length > 0 ? note.title : 'Untitled',
      where: pathOf(index, note),
      noteId: note.id,
      score
    })
  }

  const tags = index.tags
    .map((tag) => ({ tag, score: fit(needle, tag.name) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, TAGS_MAX)
  for (const { tag, score } of tags) {
    rows.push({
      id: `goto:tag:${tag.id}`,
      kind: 'goto',
      label: tag.name,
      where: 'Tag',
      tagId: tag.id,
      // A tag is a way of looking at notes rather than a place to put one, so it
      // sits below a folder that matched the same word just as well.
      score: score - 2
    })
  }

  /*
   * And a note titled with what was typed, where you are already standing.
   *
   * Last, and always there when a folder is selected. It is what stops the
   * launcher from ever being a dead end: a query that matched nothing is a title
   * nobody has used yet, which is exactly what a new note wants.
   */
  if (here !== undefined && !rows.some((row) => row.kind === 'new' && row.typed === needle)) {
    rows.push(...newRows(index, here, 1, needle).slice(-1))
  }

  const seen = new Set<string>()
  return rows
    .sort((left, right) => right.score - left.score)
    .filter((row) => {
      if (seen.has(row.id)) {
        return false
      }
      seen.add(row.id)
      return true
    })
    .slice(0, ROWS_MAX)
}
