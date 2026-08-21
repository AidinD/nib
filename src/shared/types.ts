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
  version: 1
  categories: Category[]
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
