/**
 * Tags: reading them defensively, and looking them up.
 *
 * Kept out of the storage layer so it can be tested against the real source
 * without a main process, the same way `story.ts` is - and because the renderer
 * needs the lookups too, and a second copy of "what does this id mean" is how
 * two parts of one app start disagreeing about a note.
 *
 * The rule running through all of it: **a tag id is never validated against the
 * catalog.** An id pointing at a tag that no longer exists is harmless - it
 * renders as nothing and costs a few bytes. Dropping it would mean deleting a
 * tag by accident silently erased it from every note that had it, with nothing
 * to undo it with, and Nib's stance on notes is that the regret over something
 * deleted turns up months later.
 */

import type { NoteMeta, Tag } from './types'


/**
 * Caps on the catalog and on one note's tags.
 *
 * Not an opinion about how many tags are useful - a bound, so a corrupt or
 * hostile index cannot make the renderer draw ten thousand chips on one card.
 * Both sit far above any real use.
 */
export const MAX_TAGS = 64
export const MAX_TAGS_PER_NOTE = 12
export const MAX_TAG_NAME = 40
export const MAX_TAG_DESCRIPTION = 200

/**
 * The tags a new notebook starts with.
 *
 * They are the kinds of note somebody leading a team actually writes, which is
 * also - not by accident - what Tend needs to tell a conversation from
 * something you merely heard. Seeded rather than required: rename them, delete
 * them, add your own. Nothing in Nib breaks if the catalog is empty.
 *
 * `Story` overlaps the `story` note KIND on purpose rather than by accident.
 * The kind drives the template and the half-captured check; the tag is what
 * makes them findable in the sidebar and filterable across every folder they
 * are filed in - which is the whole point of not keeping them in one.
 *
 * Fixed ids, because Tend's mapping points at ids. A seeded tag that got a
 * fresh id on every machine would map on one and not the other.
 */
export const DEFAULT_TAGS: Tag[] = [
  {
    id: 'tag-one-to-one',
    name: '1-1',
    color: '#6f9cff',
    description: 'A conversation with someone you lead.'
  },
  {
    id: 'tag-casual',
    name: 'Casual',
    color: '#5fd0a0',
    description: 'You spoke, but it was not a sit-down conversation.'
  },
  {
    id: 'tag-second-hand',
    name: 'Second-hand',
    color: '#b98cff',
    description: 'Something you heard about someone from somebody else.'
  },
  {
    id: 'tag-feedback',
    name: 'Feedback',
    color: '#5fd0a0',
    description: 'Feedback you gave them directly, close to the event.'
  },
  {
    id: 'tag-observation',
    name: 'Observation',
    color: '#ffb054',
    description: 'Their work as you saw it yourself, not as it was reported.'
  },
  {
    id: 'tag-sideways',
    name: 'Sideways',
    color: '#ff6b6b',
    description: 'Contact with a peer lead rather than with your own team.'
  },
  {
    id: 'tag-story',
    name: 'Story',
    color: '#b98cff',
    description: 'A career story in STAR form, captured while it is still fresh.'
  },
  {
    id: 'tag-principle',
    name: 'Principle',
    color: '#9a9da3',
    description: 'Something from a book or a talk that is worth keeping.'
  }
]

const text = (value: unknown, fallback = ''): string => {
  const s = typeof value === 'string' ? value.trim() : ''
  return s.length > 0 ? s : fallback
}

/**
 * A note's tag ids: strings that could safely be an id, de-duplicated, capped.
 *
 * @param raw Whatever was in the file.
 */
export function normalizeTagIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) {
    return []
  }
  const seen = new Set<string>()
  for (const entry of raw) {
    const id = typeof entry === 'string' ? entry : ''
    if (/^[A-Za-z0-9_-]+$/.test(id)) {
      seen.add(id)
    }
  }
  return [...seen].slice(0, MAX_TAGS_PER_NOTE)
}

function normalizeTag(raw: unknown): Tag {
  const entry = (raw ?? {}) as Partial<Tag>
  return {
    id: typeof entry.id === 'string' ? entry.id : '',
    name: text(entry.name).slice(0, MAX_TAG_NAME),
    color: text(entry.color, '#9a9da3'),
    description: text(entry.description).slice(0, MAX_TAG_DESCRIPTION)
  }
}

/**
 * The catalog, seeded on a notebook that has never had one.
 *
 * `tags` missing entirely means an index written before tags existed, and that
 * notebook gets the defaults. An index carrying an empty array means they were
 * deleted on purpose, and re-seeding it would put them straight back on every
 * launch - which is the difference between a default and a feature you cannot
 * remove.
 *
 * This is the same shape as `normalizeFlag` accepting the boolean the flag used
 * to be: there is no migration step anywhere in Nib, the normalisers are the
 * migration.
 *
 * @param raw Whatever was in the file.
 */
export function normalizeTags(raw: unknown): Tag[] {
  if (!Array.isArray(raw)) {
    return DEFAULT_TAGS.map((tag) => ({ ...tag }))
  }
  const byId = new Map<string, Tag>()
  for (const entry of raw) {
    const tag = normalizeTag(entry)
    if (tag.id.length > 0 && tag.name.length > 0) {
      byId.set(tag.id, tag)
    }
  }
  return [...byId.values()].slice(0, MAX_TAGS)
}

/** The catalog as a lookup, for rendering a note's chips. */
export function tagsById(tags: Tag[]): Map<string, Tag> {
  return new Map(tags.map((tag) => [tag.id, tag]))
}

/**
 * The tags a note actually has, in catalog order rather than in the order they
 * were added.
 *
 * Catalog order so that two cards carrying the same pair of tags show them the
 * same way round - chips that swap places between cards read as different
 * tags at a glance.
 *
 * Ids with no tag behind them are skipped here rather than removed from the
 * note. See the header.
 */
export function tagsFor(note: Pick<NoteMeta, 'tags'>, tags: Tag[]): Tag[] {
  const wanted = new Set(note.tags)
  return tags.filter((tag) => wanted.has(tag.id))
}

/**
 * Whether a note carries every one of these tags.
 *
 * All, not any: filtering by two tags means narrowing, which is the thing a
 * second filter is for.
 */
export function hasEveryTag(note: Pick<NoteMeta, 'tags'>, tagIds: string[]): boolean {
  return tagIds.every((id) => note.tags.includes(id))
}
