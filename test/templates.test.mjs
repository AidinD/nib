/**
 * Tests for templates.
 *
 * The two that matter: a notebook written before templates existed gets the
 * defaults while one whose owner deleted them all stays empty, and the title
 * rule never produces an untitled note - a note you cannot find again is the one
 * failure a capture tool cannot afford.
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  DEFAULT_TEMPLATES,
  MAX_TEMPLATES,
  STORY_BODY,
  normalizeTemplates,
  titleFrom,
  today
} from '../src/shared/templates.ts'
import { STORY_PROMPTS } from '../src/shared/story.ts'

const NOW = Date.parse('2026-08-27T09:00:00')

describe('the seeded catalog', () => {
  it('gives every template a fixed id, so two machines do not end up with four', () => {
    for (const template of DEFAULT_TEMPLATES) {
      assert.match(template.id, /^tpl-/)
    }
  })

  it('says what each one is for, not only what it is called', () => {
    for (const template of DEFAULT_TEMPLATES) {
      assert.ok(template.name.trim().length > 0, 'a template with no name is unpickable')
      assert.ok(template.description.trim().length > 0, `${template.id} says nothing about when to use it`)
      assert.ok(template.body.trim().length > 0, `${template.id} has no body`)
    }
  })

  it('sets a note kind on the story and on nothing else', () => {
    // A template supplies a starting shape; a kind changes how the app treats
    // the note everywhere after that. Only one of the two is a claim worth
    // making, and only the story makes it.
    const withKind = DEFAULT_TEMPLATES.filter((t) => t.kind !== undefined)
    assert.deepEqual(
      withKind.map((t) => t.id),
      ['tpl-story']
    )
  })

  it('keeps the story body agreeing with the prompts that read it back', () => {
    // If these drift apart, every story reads as unanswered - the check looks
    // for these exact headings in the written note.
    for (const prompt of STORY_PROMPTS) {
      assert.ok(STORY_BODY.includes(prompt.heading), `the body lost "${prompt.heading}"`)
    }
  })

  it('tags the one-to-one, so the note counts as the conversation having happened', () => {
    // The half a title cannot do. Remembering to tag it afterwards is exactly
    // the step that gets skipped, which leaves the note written and the cadence
    // still reading as silence.
    const oneToOne = DEFAULT_TEMPLATES.find((t) => t.id === 'tpl-one-to-one')
    assert.deepEqual(oneToOne?.tags, ['tag-one-to-one'])
  })

  it('writes both halves of the alternating one-to-one, since the app cannot know which week it is', () => {
    const oneToOne = DEFAULT_TEMPLATES.find((t) => t.id === 'tpl-one-to-one')
    assert.ok(oneToOne?.body.includes('Vecka 1'))
    assert.ok(oneToOne?.body.includes('Vecka 2'))
  })

  it('keeps the Swedish characters intact', () => {
    const oneToOne = DEFAULT_TEMPLATES.find((t) => t.id === 'tpl-one-to-one')
    assert.ok(oneToOne?.body.includes('Öppen space'))
    assert.ok(oneToOne?.body.includes('trögt'))
  })
})

describe('the title a template produces', () => {
  const dated = { id: 't', name: '1-1', title: '{date} 1-1', body: 'x', description: '' }
  const plain = { id: 't2', name: 'Story', title: '', body: 'x', description: '' }

  it('substitutes today into the pattern', () => {
    assert.equal(titleFrom(dated, '', NOW), '2026-08-27 1-1')
  })

  it('lets what was typed win outright, since the folder already says who', () => {
    // The first version kept the date and appended the typed words, which named
    // a note in somebody's folder after that person - the title repeating the
    // location while saying nothing about what the note is.
    assert.equal(titleFrom(dated, 'Retro follow-up', NOW), 'Retro follow-up')
  })

  it('uses what was typed when the template does not name the note', () => {
    assert.equal(titleFrom(plain, 'The migration week', NOW), 'The migration week')
  })

  it('never produces an untitled note', () => {
    // A note you cannot find again is the one failure this whole app cannot
    // afford, so the last fallback is the template's own name.
    assert.equal(titleFrom(plain, '   ', NOW), 'Story')
    assert.equal(titleFrom({ ...plain, title: '   ' }, '', NOW), 'Story')
  })

  it('dates in a form that sorts', () => {
    assert.equal(today(NOW), '2026-08-27')
  })
})

describe('reading the catalog defensively', () => {
  it('gives the defaults to a notebook written before templates existed', () => {
    assert.equal(normalizeTemplates(undefined).length, DEFAULT_TEMPLATES.length)
    assert.equal(normalizeTemplates(null).length, DEFAULT_TEMPLATES.length)
  })

  it('leaves an empty catalog empty, because that was somebody deleting them', () => {
    // The distinction matters more than it looks: restoring the defaults here
    // would bring every deleted template back on the next launch, which reads as
    // the app arguing with you.
    assert.deepEqual(normalizeTemplates([]), [])
  })

  it('drops entries with no id or no name rather than drawing them', () => {
    const raw = [
      { id: '', name: 'nameless' },
      { id: 'tpl-a', name: '' },
      { id: 'tpl-b', name: 'Fine', title: '', body: '', description: '' }
    ]
    assert.deepEqual(
      normalizeTemplates(raw).map((t) => t.id),
      ['tpl-b']
    )
  })

  it('keeps the first of two entries sharing an id', () => {
    const raw = [
      { id: 'tpl-a', name: 'First' },
      { id: 'tpl-a', name: 'Second' }
    ]
    const out = normalizeTemplates(raw)
    assert.equal(out.length, 1)
    assert.equal(out[0].name, 'First')
  })

  it('stops at the cap, so a corrupt index cannot draw a thousand choices', () => {
    const raw = Array.from({ length: MAX_TEMPLATES + 20 }, (_, i) => ({ id: `tpl-${i}`, name: `T${i}` }))
    assert.equal(normalizeTemplates(raw).length, MAX_TEMPLATES)
  })

  it('reads tags off a template, and copes with there being none', () => {
    assert.deepEqual(normalizeTemplates([{ id: 'tpl-a', name: 'A', tags: ['tag-x', ''] }])[0].tags, ['tag-x'])
    assert.deepEqual(normalizeTemplates([{ id: 'tpl-a', name: 'A' }])[0].tags, [])
    assert.deepEqual(normalizeTemplates([{ id: 'tpl-a', name: 'A', tags: 'tag-x' }])[0].tags, [])
  })

  it('ignores a kind it does not know', () => {
    const out = normalizeTemplates([{ id: 'tpl-a', name: 'A', kind: 'invoice' }])
    assert.equal(out[0].kind, undefined)
  })

  it('returns nothing at all for something that is not a list', () => {
    assert.deepEqual(normalizeTemplates('templates'), [])
    assert.deepEqual(normalizeTemplates(42), [])
  })
})
