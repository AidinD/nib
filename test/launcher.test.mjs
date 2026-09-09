/**
 * What Ctrl+K offers, and in what order.
 *
 * The ordering IS the feature. A launcher that has the right row fourth is a
 * launcher you stop trusting, because trusting it means pressing Enter without
 * reading - so every test here is about which row comes first rather than about
 * whether a row exists at all.
 *
 * The names are invented. The real notebook's folders are named after colleagues
 * and this repository is public.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { fit, launcherRows, places, templatesFor } from '../src/renderer/src/lib/launcher.ts'

/** A note, with only the fields the launcher looks at. */
function note(id, title, categoryId, subId, tags = [], edited = 0) {
  return {
    id,
    categoryId,
    subId,
    title,
    preview: '',
    created: 0,
    edited,
    pinned: false,
    tint: '',
    alerts: [],
    links: [],
    flag: 'none',
    tags,
    archived: false,
    hasImage: false,
    hasDrawing: false
  }
}

/**
 * A notebook shaped like the real one: a folder per person under Work, and a
 * catalog of two templates whose tags are what a folder's history is read from.
 */
function notebook() {
  return {
    version: 2,
    tags: [
      { id: 'tag-one-to-one', name: '1-1', color: '', description: '' },
      { id: 'tag-story', name: 'Story', color: '', description: '' }
    ],
    templates: [
      { id: 'tpl-story', name: 'Story', title: '', description: '', body: '<p>s</p>', tags: ['tag-story'] },
      { id: 'tpl-1-1', name: '1-1', title: '{date} 1-1', description: '', body: '<p>q</p>', tags: ['tag-one-to-one'] }
    ],
    categories: [
      {
        id: 'cat-work',
        name: 'Work',
        color: '',
        scope: 'W',
        open: true,
        subs: [
          { id: 'sub-vale', name: 'Vale' },
          { id: 'sub-quill', name: 'Quill' }
        ],
        notes: [
          note('n1', '2026-08-01 1-1', 'cat-work', 'sub-vale', ['tag-one-to-one'], 300),
          note('n2', '2026-08-15 1-1', 'cat-work', 'sub-vale', ['tag-one-to-one'], 400),
          note('n3', 'The onboarding rota', 'cat-work', 'sub-quill', [], 200),
          note('n4', 'Vale asked about tooling', 'cat-work', null, [], 100)
        ]
      },
      {
        id: 'cat-home',
        name: 'Reading',
        color: '',
        scope: 'P',
        open: true,
        subs: [],
        notes: [note('n5', 'Quill of the wind', 'cat-home', null, [], 500)]
      }
    ]
  }
}

const at = { categoryId: 'cat-work', subId: 'sub-quill' }

test('typing a name offers a note in that folder before anything else', () => {
  const rows = launcherRows(notebook(), 'vale', at)
  assert.equal(rows[0].kind, 'new', `first row was ${rows[0].kind}: ${rows[0].label}`)
  assert.equal(rows[0].where, 'Work / Vale')
  // The folder's own history decides which template, not the catalog's order:
  // both of Vale's notes are 1-1s, and 1-1 is second in the catalog.
  assert.equal(rows[0].label, 'New 1-1')
})

test('a folder with no history keeps the catalog order', () => {
  const rows = launcherRows(notebook(), 'quill', at)
  const news = rows.filter((row) => row.kind === 'new' && row.where === 'Work / Quill')
  assert.deepEqual(
    news.map((row) => row.label),
    ['New Story', 'New 1-1', 'New note']
  )
})

test('going to the folder is offered, below making something in it', () => {
  const rows = launcherRows(notebook(), 'vale', at)
  const go = rows.findIndex((row) => row.kind === 'goto' && row.where === 'Work / Vale')
  const make = rows.findIndex((row) => row.kind === 'new' && row.where === 'Work / Vale')
  assert.ok(go > make, 'looking at the folder should come after writing in it')
  assert.ok(go !== -1, 'but it should still be there')
})

test('a note whose title matches is offered too, and says where it lives', () => {
  const rows = launcherRows(notebook(), 'rota', at)
  assert.equal(rows[0].kind, 'open')
  assert.equal(rows[0].noteId, 'n3')
  assert.equal(rows[0].where, 'Work / Quill')
})

test('an exact title beats a folder that merely contains the word', () => {
  // "Quill of the wind" contains it; the folder Quill IS it.
  const rows = launcherRows(notebook(), 'quill', at)
  assert.equal(rows[0].where, 'Work / Quill')
})

test('a folder and then words makes a note titled with the words', () => {
  const rows = launcherRows(notebook(), 'vale standup', at)
  assert.equal(rows[0].kind, 'new')
  assert.equal(rows[0].where, 'Work / Vale')
  assert.equal(rows[0].typed, 'standup')
})

test('a query that matches nothing becomes a note where you are standing', () => {
  const rows = launcherRows(notebook(), 'zzz nothing like this', at)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].kind, 'new')
  assert.equal(rows[0].where, 'Work / Quill')
  assert.equal(rows[0].typed, 'zzz nothing like this')
  assert.equal(rows[0].templateId, null, 'an unrecognised title gets no template')
})

test('with nothing selected, a query that matches nothing offers nothing', () => {
  // Rather than inventing a folder to put it in. A note has to be filed
  // somewhere real, and guessing which is worse than saying so.
  const rows = launcherRows(notebook(), 'zzz nothing like this', null)
  assert.deepEqual(rows, [])
})

test('an empty query is the notes you touched last, newest first', () => {
  const rows = launcherRows(notebook(), '', at)
  assert.deepEqual(
    rows.map((row) => row.noteId),
    ['n5', 'n2', 'n1', 'n3', 'n4']
  )
  assert.ok(rows.every((row) => row.kind === 'open'))
})

test('an archived note is not offered', () => {
  const index = notebook()
  index.categories[0].notes[2].archived = true
  const rows = launcherRows(index, 'rota', at)
  assert.ok(!rows.some((row) => row.noteId === 'n3'))
})

test('a tag is a place to look, never a place to write', () => {
  const rows = launcherRows(notebook(), 'story', at)
  const tag = rows.find((row) => row.tagId === 'tag-story')
  assert.ok(tag !== undefined)
  assert.equal(tag.kind, 'goto')
  assert.equal(tag.where, 'Tag')
})

test('a category with no subs is a folder like any other', () => {
  const rows = launcherRows(notebook(), 'reading', at)
  assert.equal(rows[0].kind, 'new')
  assert.equal(rows[0].where, 'Reading')
  assert.equal(rows[0].place.subId, null)
})

test('every row has an id of its own, so nothing is drawn twice', () => {
  for (const query of ['', 'vale', 'quill', 'story', 'vale standup', 'a']) {
    const rows = launcherRows(notebook(), query, at)
    const ids = new Set(rows.map((row) => row.id))
    assert.equal(ids.size, rows.length, `duplicate row for "${query}"`)
  }
})

test('the folders are every category and every sub inside them', () => {
  assert.deepEqual(
    places(notebook()).map((place) => place.path),
    ['Work', 'Work / Vale', 'Work / Quill', 'Reading']
  )
})

test('a template with no tags of its own cannot be recognised, and is not guessed at', () => {
  const index = notebook()
  index.templates.push({
    id: 'tpl-plain',
    name: 'Plain',
    title: '',
    description: '',
    body: '<p>x</p>',
    tags: []
  })
  const order = templatesFor(index, {
    categoryId: 'cat-work',
    subId: 'sub-vale',
    name: 'Vale',
    path: 'Work / Vale'
  })
  assert.equal(order[0].id, 'tpl-1-1', 'the one the folder has used')
  // The other two keep the order they have in the catalog rather than being
  // sorted by something invented.
  assert.deepEqual(
    order.slice(1).map((template) => template.id),
    ['tpl-story', 'tpl-plain']
  )
})

/* ---------------------------------------------------- the matching -- */

test('a better kind of match always wins, however long the text', () => {
  // An exact hit on a long name beats a prefix on a short one, and a prefix
  // beats a word start, and so on down. The length penalty only breaks ties
  // inside one tier - if it could cross tiers, "a" would outrank everything.
  // Exact on a long name over a prefix on a three-letter one.
  assert.ok(fit('one to one review', 'One to one review') > fit('on', 'One'))
  // A word start over the same letters buried mid-word.
  assert.ok(fit('rota', 'The onboarding rota') > fit('rota', 'Prorated'))
  // And exactness is exactness: two exact hits are worth the same, whatever
  // they are the length of, because there is nothing left to prefer.
  assert.equal(fit('one to one review', 'One to one review'), fit('one', 'One'))
})

test('a word inside the text beats the same letters scattered through it', () => {
  assert.ok(fit('quill', 'Quill of the wind') > fit('quill', 'Quite ill'))
})

test('the letters have to be in order, and all of them', () => {
  assert.equal(fit('vale', 'Eval'), 0)
  assert.equal(fit('valex', 'Vale'), 0)
  assert.ok(fit('vl', 'Vale') > 0, 'a subsequence still counts')
})

test('an empty query fits nothing, which is what keeps the list from being everything', () => {
  assert.equal(fit('', 'Vale'), 0)
  assert.equal(fit('   ', 'Vale'), 0)
})
