import type { AlertMeta, Category, NibIndex, NoteMeta } from '@shared/types'

/** What the note list is currently showing. */
export type Selection =
  | { kind: 'all' }
  | { kind: 'recent' }
  | { kind: 'sticky' }
  | { kind: 'alerts' }
  /**
   * The other kind of flag: something to get better at, not something owed.
   *
   * Split out because one list of both is a list you cannot act on. "Send the
   * underlying material" is finished by sending it; "listen longer than it is
   * comfortable" is never finished, and a row that mixes them makes the second
   * kind look permanently overdue.
   */
  | { kind: 'practice' }
  | { kind: 'archive' }
  | { kind: 'category'; categoryId: string }
  | { kind: 'sub'; categoryId: string; subId: string }
  /**
   * Every note carrying one tag, wherever it is filed.
   *
   * Cutting across the categories is the whole point of it: a tag answers "all
   * my 1-1 notes" and a folder answers "everything about this person", and
   * neither can answer the other's question.
   */
  | { kind: 'tag'; tagId: string }

/** The sidebar's Work/Private segmented control. */
export type ScopeFilter = 'all' | 'W' | 'P'

const RECENT_LIMIT = 30

/**
 * A note's text, as the search holds it.
 *
 * Both cases of it. The match is done on `lower` so a search is
 * case-insensitive, and the snippet is cut from `text` so what is shown reads the
 * way it was written. Keeping both costs another 600 kB of strings on a notebook
 * this size and saves lowercasing all of it on every keystroke.
 */
export interface NoteText {
  text: string
  lower: string
}

/**
 * The shortest search that looks inside the notes.
 *
 * One character is not a search once the bodies are in scope: it matches
 * essentially every note, and a list of everything is the same as no answer. The
 * title and the preview are still matched from the first character, so typing
 * does not feel gated - it widens at the second keystroke.
 */
export const BODY_SEARCH_MIN = 2

/**
 * The endings a search may be asked without.
 *
 * Longest first, and exactly one comes off - this trims an inflection, it does
 * not stem a word down to a root. Swedish and English inflections in one list
 * because a note here is written in either and often both, and a search field
 * cannot ask which language you meant.
 *
 * Which direction this fixes is worth being precise about, because it is easy to
 * state backwards. Matching is on substrings, so a search for `möte` ALREADY
 * finds `mötet`, `möten` and `mötesanteckningar` - Swedish inflects by adding to
 * the end, and so the base form is a prefix of its own inflections. What fails is
 * the other way round: you type the form that is in your head, `mötet`, and the
 * note says `möte`. Taking the ending off the query is what closes that.
 *
 * Which is also why this is not a stemmer. A real one rewrites the word - `bok`
 * to `bok` and `böcker` to `bok` - and that needs the text stemmed too, a
 * dictionary for the vowel changes, and it takes substring matching away: `rota`
 * would stop finding `rotavator`. This is a smaller claim that cannot break what
 * already works, because it only ever ADDS a term.
 */
const ENDINGS = [
  'erna',
  'arna',
  'orna',
  'ande',
  'ende',
  'ade',
  'are',
  'ast',
  'ing',
  'ens',
  'ers',
  'ors',
  'en',
  'et',
  'er',
  'ar',
  'or',
  'na',
  'ad',
  'at',
  'it',
  'te',
  'de',
  'ns',
  'es',
  'ed',
  's'
]

/**
 * Below this many characters a search is left exactly as typed.
 *
 * A short word is usually already the base form - `möte`, `plan`, `plus` - so
 * trimming it can only widen the search into words that have nothing to do with
 * it. `plus` without its `s` is `plu`, which matches `plugin`.
 */
const TRIM_FROM = 5

/** And what has to be left afterwards, so `huset` can become `hus` but no shorter. */
const STEM_MIN = 3

/**
 * The words whose plural changes the vowel, as pairs of stems.
 *
 * `bok` and `böcker` have no ending in common, so nothing that trims endings can
 * get from one to the other: taking `er` off `böcker` leaves `böck`, which is not
 * a prefix of `bok` and never will be. This is the only part of the language that
 * cannot be handled by a rule - the vowel change is a closed group of words,
 * inherited rather than derived - so it is a list, and a list is what it will
 * stay.
 *
 * A curated list, and short on purpose. Anything not in it behaves exactly as it
 * did: this only ever adds a term.
 *
 * TWO ARE DELIBERATELY MISSING, and both for the same reason - one side of the
 * pair is a string that turns up inside unrelated words, and the match is on
 * substrings.
 *
 *  - `man` / `män`. `man` is also the impersonal pronoun, and as a substring it
 *    is inside `manager`, `management` and `manuell`. Searching `män` would pull
 *    in half the management shelf.
 *  - `broder` / `bröder`. The plural stem is `bröd`, which is the word for bread.
 *
 * Verbs are missing too, as a class. `tog` from `ta`, `skrev` from `skriva`,
 * `sprang` from `springa`: that is not a list of thirty words, it is Swedish
 * morphology, and it needs a real dictionary and the text stemmed as well as the
 * query. See DECISIONS.
 */
const VOWEL_SHIFTS: ReadonlyArray<readonly [string, string]> = [
  ['bok', 'böck'],
  ['fot', 'fött'],
  ['rot', 'rött'],
  ['tand', 'tänd'],
  ['hand', 'händ'],
  ['land', 'länd'],
  ['natt', 'nätt'],
  ['stad', 'städ'],
  ['son', 'sön'],
  ['dotter', 'döttr'],
  ['mus', 'möss'],
  ['lus', 'löss'],
  ['gås', 'gäss']
]

/** Whether what is left after a stem is an ending, rather than more word. */
function isEnding(rest: string): boolean {
  return rest.length === 0 || ENDINGS.includes(rest)
}

/**
 * The other side of a vowel change, if this word is one of them.
 *
 * Ending-tolerant, so every inflection of a listed word finds its counterpart:
 * `böckerna` starts with `böck` and what is left is an ending, so it maps to
 * `bok`. `bokhylla` starts with `bok` and what is left is not an ending, so it
 * maps to nothing - a compound is a different word, and mapping it would search
 * for books whenever a bookshelf was mentioned.
 */
function vowelShift(word: string): string | null {
  for (const pair of VOWEL_SHIFTS) {
    for (const [from, to] of [pair, [pair[1], pair[0]] as const]) {
      if (word.startsWith(from) && isEnding(word.slice(from.length))) {
        return to
      }
    }
  }
  return null
}

/** One inflectional ending off a word, or null when there is nothing to take. */
function trimEnding(needle: string): string | null {
  if (needle.length < TRIM_FROM) {
    return null
  }
  for (const ending of ENDINGS) {
    if (!needle.endsWith(ending)) {
      continue
    }
    const stem = needle.slice(0, needle.length - ending.length)
    return stem.length >= STEM_MIN ? stem : null
  }
  return null
}

/**
 * What a search means: what was typed, the same without an inflection, and the
 * other side of a vowel change when the word has one.
 *
 * All of them, never one instead of another. A note holding the exact word you
 * typed has to stay in the list, so everything here is an addition - anything
 * that matched before any of this existed still matches.
 */
export function searchTerms(search: string): string[] {
  const needle = search.trim().toLowerCase()
  if (needle.length === 0) {
    return []
  }
  const terms = [needle]
  const stem = trimEnding(needle)
  if (stem !== null) {
    terms.push(stem)
  }
  // Asked of the typed word AND of its stem, since either can be the form that
  // is listed: `böckerna` is reached through neither on its own.
  for (const term of [...terms]) {
    const other = vowelShift(term)
    if (other !== null && !terms.includes(other)) {
      terms.push(other)
    }
  }
  return terms
}

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
 *
 * `bodies` is the note text, when it has been read. Optional because it arrives
 * later than the first keystroke and because the lists that are not searching
 * never need it: without it this behaves exactly as it did before there was a
 * full-text search, which is also what the first moments of a search look like.
 */
export function selectedNotes(
  index: NibIndex,
  selection: Selection,
  filter: ScopeFilter,
  search: string,
  includeArchived = false,
  bodies?: Map<string, NoteText>
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
    case 'tag':
      notes = pinnedFirst(pool().filter((note) => note.tags.includes(selection.tagId)))
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
    case 'practice': {
      /*
       * The same list twice, cut by which kind of flag the note carries.
       *
       * One predicate and one sort, because they are the same view of the same
       * thing - what differs is only whether these are things owed or things
       * being worked on, and writing them as two branches is how the two would
       * drift apart.
       */
      const wanted = selection.kind === 'practice'
      notes = pool()
        .filter((note) => (note.flag !== '' || note.alerts.length > 0) && isPractice(note) === wanted)
        .sort((a, b) => {
          const open = Number(isOutstanding(b)) - Number(isOutstanding(a))
          return open !== 0 ? open : b.edited - a.edited
        })
      break
    }
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
  const terms = searchTerms(needle)
  return notes.filter((note) => matchesSearch(note, terms, bodies))
}

/**
 * Whether a note's title or preview answers a search.
 *
 * Separate from the whole question because the card asks it too: a note that
 * matched here already shows the word on screen, so it wants no snippet.
 */
export function matchesMeta(note: NoteMeta, terms: string[]): boolean {
  const title = note.title.toLowerCase()
  const preview = note.preview.toLowerCase()
  return terms.some((term) => title.includes(term) || preview.includes(term))
}

/**
 * Whether a note answers a search: its title, its preview, or its text.
 *
 * The title and the preview are metadata and always here; the text has to be
 * read, so a note whose body has not been loaded yet simply does not match on it
 * rather than being held back until it can.
 */
export function matchesSearch(
  note: NoteMeta,
  terms: string[],
  bodies?: Map<string, NoteText>
): boolean {
  if (terms.length === 0 || matchesMeta(note, terms)) {
    return terms.length > 0
  }
  // The floor is on what was TYPED, not on the trimmed form: it is about how much
  // the person has committed to, not about how long the word ends up.
  if (terms[0].length < BODY_SEARCH_MIN || bodies === undefined) {
    return false
  }
  const text = bodies.get(note.id)?.lower
  return text !== undefined && terms.some((term) => text.includes(term))
}

/**
 * The line a search matched on, with a little either side of it.
 *
 * Shown on the card in place of the preview when the match is in the body,
 * because otherwise a full-text search answers with a card whose every visible
 * word is missing the thing that was typed - which reads as a bug in the search
 * rather than as a hit deeper in the note.
 *
 * Cut on spaces where there is one nearby, so the snippet starts and ends at a
 * word. The ellipses say the text carries on, and are left off at whichever end
 * really is the start or the end of the note.
 */
/**
 * The snippet for whichever of the terms is actually in the text.
 *
 * The typed word first, because that is what the reader is looking for; the
 * trimmed form only when the note does not contain what was typed. Without this
 * a note found by its inflection showed its opening lines instead of the line it
 * matched on, which is the thing the snippet exists to prevent.
 */
export function snippetFor(text: string, terms: string[], span = 140): string {
  for (const term of terms) {
    const snippet = searchSnippet(text, term, span)
    if (snippet.length > 0) {
      return snippet
    }
  }
  return ''
}

export function searchSnippet(text: string, needle: string, span = 140): string {
  const at = text.toLowerCase().indexOf(needle.toLowerCase())
  if (at === -1) {
    return ''
  }
  const before = Math.floor((span - needle.length) / 2)
  let from = Math.max(0, at - before)
  let to = Math.min(text.length, at + needle.length + before)

  if (from > 0) {
    const space = text.indexOf(' ', from)
    // Only when the word break is close by: hunting forward for one could
    // otherwise walk past the match itself and cut it off.
    if (space !== -1 && space < at) {
      from = space + 1
    }
  }
  if (to < text.length) {
    const space = text.lastIndexOf(' ', to)
    if (space > at + needle.length) {
      to = space
    }
  }

  const cut = text.slice(from, to).trim()
  return `${from > 0 ? '…' : ''}${cut}${to < text.length ? '…' : ''}`
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
  search: string,
  bodies?: Map<string, NoteText>
): number {
  if (search.trim().length === 0 || selection.kind === 'archive') {
    return 0
  }
  // The same bodies as the visible list, or the count would offer to widen a
  // search into notes it had not looked inside - and then find them.
  return selectedNotes(index, selection, filter, search, true, bodies).filter(
    (note) => note.archived
  ).length
}

/** Does this note still need you, as opposed to carrying only dealt-with flags? */
/**
 * The tag that decides which of the two lists a note's flags belong in.
 *
 * The note's tag rather than the flag's own kind, which was the choice made when
 * it was put as a question. It costs the case where one note holds both - a 1-1
 * where "send the underlying material" and "listen longer" sit under the same
 * summary - and it buys a rule with nothing to learn and no second gesture,
 * matching how Tend already splits the same two ideas.
 */
export const PRACTICE_TAG = 'tag-principle'

/** Whether a note's flags are things to practise rather than things owed. */
export function isPractice(note: Pick<NoteMeta, 'tags'>): boolean {
  return (note.tags ?? []).includes(PRACTICE_TAG)
}

/**
 * The principles being practised right now - what the violet lane shows.
 *
 * Read off the FLAG every time, never kept. A principle stops being one you are
 * working on the moment the flag is cleared in the app, and a stored list of
 * them would start disagreeing with the gutter within a day. The tag says what
 * the note IS; the flag says whether it is live.
 *
 * The note's own flag, not a flagged line inside it. A principle is a whole
 * note - there is no sentence to quote and nothing to tick off halfway - which
 * is also why this returns notes where `allAlerts` returns one entry per line.
 */
export function practising(index: NibIndex, filter: ScopeFilter): NoteMeta[] {
  return allNotes(index, filter)
    .filter((note) => isPractice(note) && note.flag === 'open')
    .slice()
    .sort((a, b) => b.edited - a.edited)
}

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
    /*
     * Named for what it is rather than for what to do about it.
     *
     * "Needs you" is a demand and gets answered; this is a habit in progress and
     * does not. A row called "To do" beside it would have made them the same
     * thing again, which is the whole problem being fixed.
     */
    case 'practice':
      return 'Practising'
    case 'archive':
      return 'Archive'
    case 'tag':
      return index.tags.find((tag) => tag.id === selection.tagId)?.name ?? 'Tag'
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
  if (selection.kind === 'tag') {
    return index.tags.find((tag) => tag.id === selection.tagId)?.color ?? '#9a9da3'
  }
  if (selection.kind === 'sticky') {
    return '#ffb054'
  }
  if (selection.kind === 'alerts') {
    return '#ff8c42'
  }
  // Violet rather than a paler orange: near-orange would read as a weaker
  // version of the same thing, and it is a different thing.
  if (selection.kind === 'practice') {
    return '#b98cff'
  }
  return '#9a9da3'
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

/** Open flags across a set of notes, plus the notes that are themselves one. */
function outstanding(notes: NoteMeta[]): number {
  return notes.reduce(
    (total, note) =>
      total + note.alerts.filter((alert) => !alert.done).length + (note.flag === 'open' ? 1 : 0),
    0
  )
}

export function smartCounts(
  index: NibIndex,
  filter: ScopeFilter
): {
  all: number
  recent: number
  sticky: number
  alerts: number
  practice: number
  archived: number
} {
  const notes = allNotes(index, filter)
  return {
    all: notes.length,
    recent: Math.min(notes.length, RECENT_LIMIT),
    sticky: notes.filter((note) => note.pinned).length,
    archived: everyNote(index, filter).filter((note) => note.archived).length,
    // Counted in action points, not in notes: the row answers "how many things
    // need me", and one note can hold several - plus the notes that are
    // themselves the action point.
    //
    // Practice notes are counted separately and NOT here. A count that included
    // them is the thing that made the number meaningless: it said nine when
    // three were owed.
    alerts: outstanding(notes.filter((note) => !isPractice(note))),
    practice: outstanding(notes.filter(isPractice))
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

/**
 * Everything outstanding, newest note first - what the strip shows.
 *
 * Things to practise are left out. The strip is the ambient "you owe these"
 * line under the header, and a principle you are working on is not owed to
 * anybody - it would sit there permanently, which is how you learn to stop
 * reading the strip.
 */
export function allAlerts(index: NibIndex, filter: ScopeFilter): AlertEntry[] {
  return allNotes(index, filter)
    .filter((note) => !isPractice(note))
    .slice()
    .sort((a, b) => b.edited - a.edited)
    .flatMap((note) => [
      ...(note.flag === 'open' ? [{ note, alert: null }] : []),
      ...note.alerts.filter((alert) => !alert.done).map((alert) => ({ note, alert }))
    ])
}
