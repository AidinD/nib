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

import { readGlossary } from '../src/main/summary.ts'
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
