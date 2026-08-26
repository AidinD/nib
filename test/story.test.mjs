/**
 * Tests for the story template.
 *
 * Nib's first tests. Everything else here is either UI or a thin wrapper over
 * the filesystem, and the storage normalisers are exercised by the app on every
 * launch - but `unanswered` is pure logic that decides whether a story reads as
 * captured or half-written, and getting it wrong is silent.
 *
 * Node strips the types on import, so these run against the real source rather
 * than a build.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { STORY_PROMPTS, unanswered } from '../src/shared/story.ts'
import { STORY_BODY } from '../src/shared/templates.ts'

/*
 * The story's body moved into the template catalog, so these read it from there.
 * That is the point of the pair: the prompts and the half-captured check live
 * with the story, and what a new note starts with is one entry in a list of
 * templates like any other. The tests below are what keeps the two agreeing -
 * an edited template whose headings no longer match the prompts would make every
 * story read as unanswered.
 */
const storyTemplate = () => STORY_BODY

test('the template carries every prompt, as a heading', () => {
  const html = storyTemplate()
  for (const prompt of STORY_PROMPTS) {
    assert.ok(html.includes(`<h3>${prompt.heading}</h3>`), `${prompt.heading} is missing`)
  }
})

test('a fresh template counts as entirely unanswered', () => {
  // The hints are real paragraphs so they survive being edited around, which
  // means they must not read as answers.
  assert.deepEqual(
    unanswered(storyTemplate()),
    STORY_PROMPTS.map((p) => p.heading)
  )
})

test('a filled section stops being unanswered', () => {
  const html = storyTemplate().replace(
    `<p><em>${STORY_PROMPTS[0].hint}</em></p>`,
    '<p>Rendering pipeline, last October, two weeks before the deadline.</p>'
  )
  const missing = unanswered(html)
  assert.equal(missing.includes(STORY_PROMPTS[0].heading), false)
  assert.equal(missing.length, STORY_PROMPTS.length - 1)
})

test('a section holding only whitespace is still unanswered', () => {
  const html = storyTemplate().replace(
    `<p><em>${STORY_PROMPTS[1].hint}</em></p>`,
    '<p>&nbsp;</p><p>   </p>'
  )
  assert.ok(unanswered(html).includes(STORY_PROMPTS[1].heading))
})

test('a heading deleted altogether counts as unanswered, not as absent', () => {
  // Otherwise removing the hardest question is how a story looks finished.
  const html = storyTemplate().replace(`<h3>${STORY_PROMPTS[2].heading}</h3>`, '')
  assert.ok(unanswered(html).includes(STORY_PROMPTS[2].heading))
})

test('a fully written story is not nagged about', () => {
  const html = STORY_PROMPTS.map(
    (p, i) => `<h3>${p.heading}</h3><p>Something real for section ${i}, written at the time.</p>`
  ).join('')
  assert.deepEqual(unanswered(html), [])
})

test('a section reads to the next heading and no further', () => {
  // The bug this guards: reading to the end of the document would let one
  // answered section mark every later one as answered too.
  const html =
    `<h3>${STORY_PROMPTS[0].heading}</h3><p><em>${STORY_PROMPTS[0].hint}</em></p>` +
    `<h3>${STORY_PROMPTS[1].heading}</h3><p>A real answer here.</p>` +
    `<h3>${STORY_PROMPTS[2].heading}</h3><p><em>${STORY_PROMPTS[2].hint}</em></p>` +
    `<h3>${STORY_PROMPTS[3].heading}</h3><p><em>${STORY_PROMPTS[3].hint}</em></p>`

  assert.deepEqual(unanswered(html), [
    STORY_PROMPTS[0].heading,
    STORY_PROMPTS[2].heading,
    STORY_PROMPTS[3].heading
  ])
})

test('the action prompt asks what YOU did, which is the one people collapse', () => {
  // Load-bearing wording. "We shipped it" is the sentence this field exists to
  // prevent, and a rewrite that softens the heading brings it back.
  const action = STORY_PROMPTS[2]
  assert.match(action.heading, /you did/i)
  assert.match(action.hint, /We shipped it/)
})
