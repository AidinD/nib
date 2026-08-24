// The Nib data model. Shared verbatim between the main process (which owns the
// files on disk) and the renderer, so both sides describe notes the same way.

/** A category's work/private classification. Empty string means unclassified. */
export type Scope = '' | 'W' | 'P'

/** A sub-category is an id and a name, nothing more. Nesting stops here. */
export interface SubCategory {
  id: string
  name: string
}

/**
 * One flagged block inside a note - an action point.
 *
 * The flag lives on the block in the note body; this is its shadow in the index,
 * so the alert strip and the "Needs you" list can be built without opening a
 * single note file. `text` is the block's own text, trimmed to a chip's worth.
 */
export interface AlertMeta {
  /** Matches `data-alert-id` on the block, which is how a click jumps to it. */
  id: string
  text: string
  /**
   * Ticked off, but still marked in the note.
   *
   * A done action point leaves the strip and stops counting, and stays visible
   * in the document as something that was needed and has been dealt with.
   */
  done: boolean
}

/**
 * Everything about a note except its body.
 *
 * This is what the index file carries and what the note list renders from, so
 * listing a category never has to open a single note file. `preview` is derived
 * from the body on every save rather than stored by the editor.
 */
export interface NoteMeta {
  id: string
  /** Redundant with the note's position in the index, and normalised to it on
   *  load. Carried anyway because every consumer in the renderer needs it. */
  categoryId: string
  /** null when the note sits directly in the category rather than in a sub. */
  subId: string | null
  title: string
  preview: string
  created: number
  edited: number
  pinned: boolean
  /** The sticky window's tint. Empty means the default amber. */
  tint: string
  /** The action points flagged inside this note, in document order. */
  alerts: AlertMeta[]
  /**
   * The notes this one links to, by id.
   *
   * Kept here rather than worked out from the text when it is needed, because the
   * question actually asked is the reverse one - "what points AT this note" - and
   * answering that from the text would mean reading every note in the notebook
   * every time one was opened. With this field it is a walk over the index, which
   * is in memory already.
   *
   * Written from the document on every save, so it cannot drift from the text.
   * Ids are not validated against anything: a link to a deleted note stays in the
   * list and is shown as gone, which is the honest answer.
   */
  links: string[]
  /**
   * The whole note as an action point, rather than a line inside it.
   *
   * Some notes are the action - a card that says "call the contractor" has no
   * line worth singling out - so the flag exists at both levels, and with the
   * same three states: unflagged, flagged, and dealt with but still marked.
   */
  flag: NoteFlag
  /**
   * What sort of note this is, when it is not just a note.
   *
   * Only `story` so far: a career story in STAR form, captured while it is fresh
   * rather than reconstructed in March from October.
   *
   * A marker on the note rather than a dedicated category, deliberately. A story
   * about an incident belongs filed with the incident, and forcing it into a
   * "Story bank" folder fights the filing you already have - the same reason
   * Tend binds Nib folders to people rather than relying on a naming convention.
   */
  kind: NoteKind
  /**
   * Ids from the index's tag catalog, in the order they were added.
   *
   * Ids and never names, the way Jot references its own tags: renaming a tag
   * must not quietly break everything pointing at it, and Tend maps these onto
   * what a note counts as, so a rename in here would stop it counting at all.
   *
   * Separate from `kind` deliberately, rather than subsuming it. `kind` changes
   * what a note IS - a story has its own structure and its own view - and a tag
   * is something you say about a note. Merged, deleting a tag would delete a
   * feature.
   */
  tags: string[]
  /**
   * Out of the way, not gone.
   *
   * Notes are reference material, and the regret over a deleted one turns up
   * months later - so a finished project should be able to leave the sidebar
   * without leaving the disk. An archived note is filtered out of every list
   * except the Archive row, and is otherwise an ordinary note: same file, same
   * category, restorable in one click.
   *
   * Only notes archive. A category or a sub-category still deletes, because
   * archiving one immediately raises "and what about the notes inside it",
   * which is the question the two delete paths already answer two different
   * ways. See PLAN's open questions.
   */
  archived: boolean
  hasImage: boolean
  hasDrawing: boolean
}

/**
 * A category holds its sub-categories and a FLAT list of notes, where each note
 * carries the `subId` it belongs to. See DECISIONS 2026-08-19: this mirrors how
 * Jot models subtasks, and it makes moving a note between sub-categories one
 * field write instead of a splice across two arrays.
 */
export interface Category {
  id: string
  name: string
  color: string
  scope: Scope
  /** Whether the sidebar row is expanded. Part of the data on purpose: the
   *  disclosure state is worth surviving a restart. */
  open: boolean
  subs: SubCategory[]
  notes: NoteMeta[]
}

/** The whole index file: ordering and metadata, no note bodies. */
export interface NibIndex {
  /**
   * The shape of the file, so an older one can be recognised and upgraded.
   *
   * 1 was the original; 2 added `links` on a note. An index is always normalised
   * to the current version on load, so this is only ever read from the raw file -
   * see `backfillLinks`.
   */
  version: number
  categories: Category[]
  /**
   * Every tag that exists, whether or not a note uses it.
   *
   * A catalog rather than free strings on each note, so a tag has one name, one
   * colour and one meaning everywhere, and renaming it is one edit. The same
   * shape Jot uses.
   */
  tags: Tag[]
}

/**
 * One tag in the catalog.
 *
 * `description` is not decoration. A tag whose meaning is obvious to you in
 * August is a tag you will hesitate over in March, and the hesitation is what
 * makes tagging stop - so every tag says what it is for, and the seeded ones
 * say it in a sentence.
 */
export interface Tag {
  id: string
  name: string
  color: string
  description: string
}

/**
 * A note-level flag: none, needs you, or dealt with.
 *
 * `done` is not the same as none. A note that needed doing and has been dealt
 * with should still say so on its card - it leaves the strip and the count, not
 * the list.
 */
export type NoteFlag = '' | 'open' | 'done'

/**
 * A note that is a particular kind of thing.
 *
 * Same shape as `flag` on purpose: a small enum on the note that drives a view
 * and a count, rather than a new entity.
 */
export type NoteKind = '' | 'story'

/** The tools a stroke can be drawn with. */
export type StrokeTool = 'pen' | 'highlighter' | 'eraser'

/** One sampled point: position plus the stylus pressure that produced it. */
export interface StrokePoint {
  x: number
  y: number
  /** 0..1. A mouse reports a constant 0.5, which is what makes it draw evenly. */
  p: number
}

export interface Stroke {
  tool: StrokeTool
  color: string
  /** The nib width before pressure is applied. */
  width: number
  points: StrokePoint[]
}

/**
 * One drawing, stored as its own file.
 *
 * A drawing is kept twice over: the strokes, so it stays editable, and a
 * rendered PNG in the assets folder, so a note can show it without a canvas.
 * See DECISIONS 2026-08-21.
 */
export interface DrawingDoc {
  id: string
  /** The surface size the strokes were drawn against, in CSS pixels. */
  width: number
  height: number
  strokes: Stroke[]
  /** The `nib-asset://` URL of the rendered PNG, or empty before the first render. */
  image: string
}

/** One note file. Self-describing, so a lost index can be rebuilt from these. */
export interface NoteDoc {
  id: string
  categoryId: string
  subId: string | null
  title: string
  /** The document body as sanitised HTML. */
  html: string
  created: number
  edited: number
}

/** What the renderer sends when saving a note body. */
export interface NoteDocPatch {
  id: string
  title: string
  html: string
}

/** The tints a sticky window can be given, per the design spec's swatch row. */
export const STICKY_TINTS = ['#ffb054', '#6f9cff', '#5fd0a0', '#b98cff', '#ff6b6b'] as const

export const NOTE_COLORS = ['#6f9cff', '#5fd0a0', '#ffb054', '#b98cff', '#ff6b6b', '#9a9da3'] as const
