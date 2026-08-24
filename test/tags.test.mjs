/**
 * Tests for tags.
 *
 * Two of these are about a migration that happens on Aidin's live notebook the
 * moment he takes the update, and a migration only gets one chance: seeding the
 * catalog on a notebook that predates tags, and NOT re-seeding it on one where
 * they were deleted on purpose. Getting the second wrong is the more annoying
 * failure - deleted tags that reappear every launch are a feature you cannot
 * remove.
 *
 * The rest guard the rule that a tag id is never checked against the catalog.
 * Enforcing it would look tidier and would mean deleting a tag by accident
 * erased it from every note that had it, with nothing to undo it with.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  DEFAULT_TAGS,
  MAX_TAGS_PER_NOTE,
  hasEveryTag,
  normalizeTagIds,
  normalizeTags,
  tagsById,
  tagsFor
} from '../src/shared/tags.ts'

const CATALOG = [
  { id: 'tag-a', name: 'Alpha', color: '#111111', description: '' },
  { id: 'tag-b', name: 'Beta', color: '#222222', description: '' },
  { id: 'tag-c', name: 'Gamma', color: '#333333', description: '' }
]

test('a notebook written before tags existed gets the defaults', () => {
  const seeded = normalizeTags(undefined)
  assert.equal(seeded.length, DEFAULT_TAGS.length)
  assert.deepEqual(
    seeded.map((tag) => tag.id),
    DEFAULT_TAGS.map((tag) => tag.id)
  )
})

test('an empty catalog is left empty, because deleting them all was a choice', () => {
  // Re-seeding here would put every default back on the next launch, which is
  // the difference between a default and something you cannot remove.
  assert.deepEqual(normalizeTags([]), [])
})

test('the seeded ids are fixed, so a mapping to them survives a second machine', () => {
  const first = normalizeTags(undefined)
  const second = normalizeTags(undefined)
  assert.deepEqual(
    first.map((tag) => tag.id),
    second.map((tag) => tag.id)
  )
  assert.ok(first.every((tag) => tag.id.startsWith('tag-')))
})

test('seeding hands back a copy, so editing one notebook cannot edit the constant', () => {
  const seeded = normalizeTags(undefined)
  seeded[0].name = 'Renamed'
  assert.notEqual(DEFAULT_TAGS[0].name, 'Renamed')
})

test('a tag with no name is dropped, and a duplicate id keeps the last', () => {
  const tags = normalizeTags([
    { id: 'tag-a', name: 'First' },
    { id: 'tag-b', name: '   ' },
    { id: '', name: 'Nameless id' },
    { id: 'tag-a', name: 'Second' }
  ])
  assert.deepEqual(tags.map((t) => [t.id, t.name]), [['tag-a', 'Second']])
})

test('a tag without a colour gets a neutral one rather than an empty string', () => {
  const [tag] = normalizeTags([{ id: 'tag-a', name: 'Alpha' }])
  assert.match(tag.color, /^#/)
})

test('a note keeps an id whose tag has been deleted', () => {
  // The whole point: deleting a tag must not erase it from every note that had
  // it. The id stays, renders as nothing, and comes back if the tag does.
  const ids = normalizeTagIds(['tag-a', 'tag-gone'])
  assert.deepEqual(ids, ['tag-a', 'tag-gone'])
})

test('a note with no tags field at all reads as no tags', () => {
  assert.deepEqual(normalizeTagIds(undefined), [])
  assert.deepEqual(normalizeTagIds('tag-a'), [])
})

test('the same tag twice on one note counts once', () => {
  assert.deepEqual(normalizeTagIds(['tag-a', 'tag-a', 'tag-b']), ['tag-a', 'tag-b'])
})

test('anything that could not be an id is thrown away', () => {
  assert.deepEqual(normalizeTagIds(['tag-a', '../escape', '', null, 42, 'ok_id']), ['tag-a', 'ok_id'])
})

test('a note cannot carry more tags than the cap', () => {
  const many = Array.from({ length: MAX_TAGS_PER_NOTE + 10 }, (_, i) => `tag-${i}`)
  assert.equal(normalizeTagIds(many).length, MAX_TAGS_PER_NOTE)
})

test('a note renders its tags in catalog order, not the order they were added', () => {
  // Two cards carrying the same pair must show them the same way round; chips
  // that swap places read as different tags at a glance.
  const note = { tags: ['tag-c', 'tag-a'] }
  assert.deepEqual(
    tagsFor(note, CATALOG).map((tag) => tag.id),
    ['tag-a', 'tag-c']
  )
})

test('an id with no tag behind it is skipped when rendering', () => {
  const note = { tags: ['tag-a', 'tag-gone'] }
  assert.deepEqual(
    tagsFor(note, CATALOG).map((tag) => tag.id),
    ['tag-a']
  )
})

test('filtering by two tags narrows rather than widens', () => {
  const both = { tags: ['tag-a', 'tag-b'] }
  const one = { tags: ['tag-a'] }
  assert.equal(hasEveryTag(both, ['tag-a', 'tag-b']), true)
  assert.equal(hasEveryTag(one, ['tag-a', 'tag-b']), false)
  assert.equal(hasEveryTag(one, []), true, 'no filter matches everything')
})

test('the lookup finds a tag by its id', () => {
  assert.equal(tagsById(CATALOG).get('tag-b')?.name, 'Beta')
  assert.equal(tagsById(CATALOG).get('tag-gone'), undefined)
})
