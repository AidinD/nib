/**
 * Tests for the glossary and the line that admits it was used.
 *
 * The failure being guarded is not a wrong word in a transcript - that is
 * whisper's, and it is allowed to stay wrong. It is a wrong word reaching the
 * SUMMARY, where it stops looking like broken text and starts reading as fact.
 * Three confirmed instances in one week, all of them technical terms or proper
 * nouns, one of them a KPI attributed to a product whose name does not exist.
 *
 * Two rules matter more than the correcting: the transcript is never rewritten,
 * and what was corrected is visible. A summary that silently diverges from its
 * own transcript blurs the line between what was said and what was inferred,
 * which is the one distinction this note format exists to keep.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { applyGlossary, readGlossary } from '../src/main/summary.ts'
import { summaryHtml } from '../src/renderer/src/lib/notes.ts'

/** A scratch notebook directory, never the real one. */
function scratch() {
  return mkdtempSync(join(tmpdir(), 'nib-glossary-'))
}

const base = {
  summary: 'Ett kort referat.',
  decisions: [],
  actions: [],
  questions: [],
  people: []
}

test('a notebook with no glossary gets one, seeded', () => {
  const dir = scratch()
  try {
    const terms = readGlossary(dir)
    assert.ok(terms.includes('Nib'), 'the seed is there')
    assert.ok(terms.length >= 5)
    const written = readFileSync(join(dir, 'glossary.txt'), 'utf8')
    // The header is the only instruction he will ever read about this file, so
    // it has to say the two things that are not obvious: what it does, and that
    // his own names belong here rather than in the app.
    assert.match(written, /one per line/i)
    assert.match(written, /never rewritten/i)
    assert.match(written, /your own project/i)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('comments and blank lines are not terms', () => {
  const dir = scratch()
  try {
    writeFileSync(
      join(dir, 'glossary.txt'),
      ['# a comment', '', '  Crewlike  ', '', '# another', 'IC-level'].join('\n'),
      'utf8'
    )
    assert.deepEqual(readGlossary(dir), ['Crewlike', 'IC-level'])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a glossary he emptied on purpose stays empty', () => {
  // Not re-seeded. Deleting every term is a choice, the same way an empty
  // template list is - see `normalizeTemplates`.
  const dir = scratch()
  try {
    writeFileSync(join(dir, 'glossary.txt'), '# nothing here\n', 'utf8')
    assert.deepEqual(readGlossary(dir), [])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('an unreadable glossary is no glossary, not a failed summary', () => {
  // A directory where the file should be: reading throws, and the summary has
  // to survive it. Losing the corrections is a small loss; losing the whole
  // call over a config file is not a trade worth making.
  assert.deepEqual(readGlossary(join(tmpdir(), 'nib-glossary-nonexistent', '\0bad')), [])
})

test('a pasted document cannot become the whole prompt', () => {
  const dir = scratch()
  try {
    const many = Array.from({ length: 500 }, (_, at) => `term-${at}`)
    writeFileSync(join(dir, 'glossary.txt'), many.join('\n'), 'utf8')
    assert.equal(readGlossary(dir).length, 200)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('the summary says which words it corrected, and that the transcript is not touched', () => {
  const html = summaryHtml(
    { model: 'claude-haiku-4-5', costUsd: 0.06 },
    { ...base, corrections: [{ heard: 'easy level', meant: 'IC-level' }] }
  )
  assert.match(html, /data-heard="1"/)
  assert.match(html, /easy level/)
  assert.match(html, /IC-level/)
  // The clause that stops a reader thinking the transcript was edited to match.
  assert.match(html, /Transkriptet är oförändrat/)
})

test('several corrections read as one line', () => {
  const html = summaryHtml(
    { model: 'm', costUsd: null },
    {
      ...base,
      corrections: [
        { heard: 'easy level', meant: 'IC-level' },
        { heard: 'Q-line', meant: 'Crewlike' }
      ]
    }
  )
  const line = /<p data-heard="1">(.*?)<\/p>/.exec(html)?.[1] ?? ''
  assert.match(line, /easy level/)
  assert.match(line, /Q-line/)
  assert.equal((html.match(/data-heard/g) ?? []).length, 1, 'one line, not one per correction')
})

test('nothing corrected says nothing', () => {
  // The line is evidence, not furniture. A summary that always carries it
  // teaches you to stop reading it, which is how the real ones get missed.
  assert.doesNotMatch(summaryHtml({ model: 'm', costUsd: null }, base), /data-heard/)
  assert.doesNotMatch(
    summaryHtml({ model: 'm', costUsd: null }, { ...base, corrections: [] }),
    /data-heard/
  )
})

test('a half-filled correction is dropped rather than drawn', () => {
  const html = summaryHtml(
    { model: 'm', costUsd: null },
    { ...base, corrections: [{ heard: '', meant: 'IC-level' }, { heard: 'x', meant: '  ' }] }
  )
  assert.doesNotMatch(html, /data-heard/)
})

test('a correction cannot inject markup into the note', () => {
  const html = summaryHtml(
    { model: 'm', costUsd: null },
    { ...base, corrections: [{ heard: '<script>x</script>', meant: '<b>y</b>' }] }
  )
  assert.doesNotMatch(html, /<script>/)
  assert.match(html, /&lt;script&gt;/)
})

test('the corrections sit above the provenance, not below it', () => {
  // A fact about the words in front of you, rather than a footnote about the
  // machinery that produced them.
  const html = summaryHtml(
    { model: 'm', costUsd: null },
    { ...base, corrections: [{ heard: 'a', meant: 'b' }] }
  )
  assert.ok(html.indexOf('data-heard') < html.indexOf('data-provenance'))
})

/*
 * The correction has to hold across the whole answer, not just where the model
 * was looking.
 *
 * Every case here is from one real 1-1 note, 2026-09-09. The product name was
 * right in the opening paragraph and wrong four more times: under "Sedan forra
 * gangen", in a question, in an action point, once with a genitive s and once
 * inside a hyphenated compound. The line at the bottom reported the correction as
 * applied, which it had been - to one paragraph.
 *
 * The fixture term is invented rather than borrowed. The real glossary holds
 * colleague and client names and this repository is public.
 */

/** A term whose homophone is an ordinary word, which is the hard case. */
const TERM = 'Moonquill'
const HEARD = 'Munquill'

const empty = {
  summary: '',
  decisions: [],
  actions: [],
  questions: [],
  people: []
}

test('the same word is corrected in every field, not only the summary', () => {
  const fixed = applyGlossary(
    {
      ...empty,
      summary: `Vi pratade lange om ${TERM}.`,
      lastTime: `Forra gangen bestamdes att han tar over agarskapet av ${HEARD}.`,
      decisions: [`${HEARD} pausas till oktober.`],
      questions: [`Vem tacker upp ${HEARD} om bada slutar?`],
      actions: [{ text: `Ga igenom ${HEARD}s nulage med honom.`, implied: false }],
      people: []
    },
    [TERM]
  )

  assert.equal(fixed.lastTime, `Forra gangen bestamdes att han tar over agarskapet av ${TERM}.`)
  assert.deepEqual(fixed.decisions, [`${TERM} pausas till oktober.`])
  assert.deepEqual(fixed.questions, [`Vem tacker upp ${TERM} om bada slutar?`])
  // The genitive comes along - a term with an inflection on it is the term.
  assert.equal(fixed.actions[0].text, `Ga igenom ${TERM}s nulage med honom.`)
})

test('a hyphenated compound is the term, and is corrected inside one', () => {
  const fixed = applyGlossary({ ...empty, summary: `${HEARD}-statusen kom upp igen.` }, [TERM])
  assert.equal(fixed.summary, `${TERM}-statusen kom upp igen.`)
})

test('what code corrected is reported, so the note still says what it changed', () => {
  const fixed = applyGlossary({ ...empty, summary: `Om ${HEARD}.` }, [TERM])
  assert.deepEqual(fixed.corrections, [{ heard: HEARD, meant: TERM }])
})

test('a correction the model reported is applied to the fields it missed', () => {
  const fixed = applyGlossary(
    {
      ...empty,
      summary: `${TERM} ar overhajpat.`,
      questions: ['Vad hander med Munkwill sen?'],
      decisions: ['Moonkvil ligger kvar hos honom.'],
      // The model answered with three variants slashed into one string rather
      // than as three corrections, so the value is split rather than trusted.
      corrections: [{ heard: 'Munkwill / Moonkvil / Munkfill', meant: TERM }]
    },
    [TERM]
  )
  assert.deepEqual(fixed.questions, [`Vad hander med ${TERM} sen?`])
  assert.deepEqual(fixed.decisions, [`${TERM} ligger kvar hos honom.`])
  // Already reported, so nothing is added on top of it.
  assert.equal(fixed.corrections?.length, 1)
})

test('a short term is never matched by sound', () => {
  /*
   * The floor is the whole safety of this. `Tend` with its vowels ignored is
   * `tand` and `tand` and `tond`, and a glossary term is not licence to rewrite
   * the language around it.
   */
  const kept = 'Han hade ont i en tand och vi tande ljuset.'
  const fixed = applyGlossary({ ...empty, summary: kept }, ['Tend', 'Jot', 'Nib', 'Meta'])
  assert.equal(fixed.summary, kept)
  assert.equal(fixed.corrections, undefined)
})

test('a term inside a longer word is left alone', () => {
  const kept = 'Robloxutvecklarna och munquilleriet gick bra.'
  const fixed = applyGlossary({ ...empty, summary: kept }, [TERM, 'Roblox'])
  assert.equal(fixed.summary, kept)
})

test('two terms that rhyme do not fight over each other', () => {
  const kept = `Bade ${TERM} och ${HEARD} finns i ordlistan.`
  const fixed = applyGlossary({ ...empty, summary: kept }, [TERM, HEARD])
  assert.equal(fixed.summary, kept)
})

test('a reported mishearing too short to be a word is not applied', () => {
  /*
   * A `heard` of `en` loosed on a Swedish summary would be vandalism, and the
   * model does occasionally answer with a fragment.
   */
  const kept = 'Han sa att en av dem ar klar.'
  const fixed = applyGlossary(
    { ...empty, summary: kept, corrections: [{ heard: 'en', meant: TERM }] },
    []
  )
  assert.equal(fixed.summary, kept)
})

test('an answer with nothing to correct comes back untouched', () => {
  const value = { ...empty, summary: `${TERM} rullar vidare.`, people: ['Ada'] }
  assert.equal(applyGlossary(value, [TERM]), value, 'the same object, not a rebuilt equal one')
})

test('the answers filled in under the note prompts are corrected too', () => {
  const fixed = applyGlossary(
    { ...empty, answers: [{ id: 'p1', answer: `Han vill ta over ${HEARD}.` }] },
    [TERM]
  )
  assert.deepEqual(fixed.answers, [{ id: 'p1', answer: `Han vill ta over ${TERM}.` }])
})

test('a name is corrected in the list of people mentioned', () => {
  // The glossary holds people as well as products, and a name heard wrong is
  // the case that made this feature exist.
  const fixed = applyGlossary({ ...empty, people: ['Vandermaar', 'Ada'] }, ['Vandermeer'])
  assert.deepEqual(fixed.people, ['Vandermeer', 'Ada'])
})
