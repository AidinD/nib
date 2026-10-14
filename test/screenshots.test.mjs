/**
 * Tests for the screenshots a meeting summary is shown.
 *
 * The rule being guarded is that a picture lands on its own moment. The
 * transcript says `(skärmbild 3)` and the image goes out under the same label,
 * so a screenshot that cannot be sent must leave a gap - not let every later
 * one slide down a number onto a moment it was not taken at.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { instruction, loadScreenshots, MAX_SCREENSHOTS, screenshotLabel } from '../src/main/summary.ts'

function assets() {
  const dir = mkdtempSync(join(tmpdir(), 'nib-screenshots-'))
  const resolve = (src) => {
    const m = /^nib-asset:\/\/asset\/(.+)$/.exec(src)
    return m ? join(dir, m[1]) : null
  }
  const put = (name, bytes = Buffer.from([1, 2, 3])) => {
    writeFileSync(join(dir, name), bytes)
    return `nib-asset://asset/${name}`
  }
  return { resolve, put }
}

test('each screenshot keeps the number the transcript gave it', () => {
  const { resolve, put } = assets()
  const loaded = loadScreenshots([put('a.png'), put('b.jpg'), put('c.webp')], resolve)
  assert.deepEqual(
    loaded.map((s) => [s.number, s.mediaType]),
    [
      [1, 'image/png'],
      [2, 'image/jpeg'],
      [3, 'image/webp']
    ]
  )
  assert.equal(loaded[0].data, Buffer.from([1, 2, 3]).toString('base64'))
})

test('one that cannot be sent leaves a gap rather than shifting the rest', () => {
  const { resolve, put } = assets()
  const loaded = loadScreenshots(
    [put('a.png'), 'nib-asset://asset/gone.png', put('drawn.svg'), 'data:image/png;base64,AAAA', put('d.png')],
    resolve
  )
  assert.deepEqual(
    loaded.map((s) => s.number),
    [1, 5]
  )
})

test('a picture too large for the API, or empty, is skipped', () => {
  const { resolve, put } = assets()
  const loaded = loadScreenshots(
    [put('huge.png', Buffer.alloc(4_000_000)), put('empty.png', Buffer.alloc(0)), put('ok.png')],
    resolve
  )
  assert.deepEqual(
    loaded.map((s) => s.number),
    [3]
  )
})

test('there is a ceiling on how many are sent', () => {
  const { resolve, put } = assets()
  const sources = Array.from({ length: MAX_SCREENSHOTS + 5 }, (_, i) => put(`s${i}.png`))
  assert.equal(loadScreenshots(sources, resolve).length, MAX_SCREENSHOTS)
})

test('the label is the words the transcript uses', () => {
  assert.equal(screenshotLabel(2), '(skärmbild 2)')
})

const MEETING = { kind: 'meeting', transcript: '[3:04] (skärmbild 1)\n03:13 Jag vet inte.', notes: '', language: 'sv', model: 'm' }

test('with pictures attached the model is told to read them, and how far it may go', () => {
  const text = instruction({ ...MEETING, images: [{ number: 1, mediaType: 'image/png', data: 'AA==' }] })
  assert.match(text, /attached after the transcript/)
  assert.match(text, /describe only what is actually visible/)
  assert.doesNotMatch(text, /You cannot see the screenshots/)
})

test('without them it is still told it cannot see them, so it does not invent one', () => {
  for (const images of [undefined, []]) {
    const text = instruction({ ...MEETING, images })
    assert.match(text, /You cannot see the screenshots/)
    assert.doesNotMatch(text, /attached after the transcript/)
  }
})
