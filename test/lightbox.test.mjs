/**
 * Tests for the image viewer's arithmetic and its lookup.
 *
 * The rules being guarded: a picture that fits is shown at 100% and never
 * upscaled, the arrow keys wrap, and a drawing block's rendered image is not one
 * of the pictures in the note - clicking it opens the drawing, so stepping onto
 * it from the viewer would show something the note does not present as a picture.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { assetName, collectImages, fitScale, stepIndex } from '../src/renderer/src/lib/lightbox.ts'

test('a picture that fits the window is shown at 100%, not stretched', () => {
  assert.equal(fitScale({ width: 400, height: 300 }, { width: 1200, height: 800 }), 1)
})

test('a larger picture is shrunk by whichever side is tighter', () => {
  assert.equal(fitScale({ width: 2000, height: 500 }, { width: 1000, height: 800 }), 0.5)
  assert.equal(fitScale({ width: 500, height: 2000 }, { width: 1000, height: 800 }), 0.4)
})

test('a picture or window with no size yet is left at 100%', () => {
  assert.equal(fitScale({ width: 0, height: 0 }, { width: 1000, height: 800 }), 1)
  assert.equal(fitScale({ width: 500, height: 500 }, { width: 0, height: 0 }), 1)
})

test('the arrow keys wrap at both ends and stay put for a single picture', () => {
  assert.equal(stepIndex(0, 3, 1), 1)
  assert.equal(stepIndex(2, 3, 1), 0)
  assert.equal(stepIndex(0, 3, -1), 2)
  assert.equal(stepIndex(0, 1, 1), 0)
  assert.equal(stepIndex(0, 0, -1), 0)
})

test('the asset name is the last part of the URL', () => {
  assert.equal(assetName('nib-asset://asset/abc123.png'), 'abc123.png')
})

/** Enough of an image for the lookup: a src, and whether a drawing block holds it. */
function image(src, inCanvas = false) {
  return {
    getAttribute: (name) => (name === 'src' ? src : null),
    closest: (selector) => (inCanvas && selector === '[data-canvas]' ? {} : null)
  }
}

test('the pictures of a note are its images in order, without a drawing\'s render', () => {
  const a = image('nib-asset://asset/a.png')
  const drawn = image('nib-asset://asset/drawn.png', true)
  const b = image('nib-asset://asset/b.png')
  const blank = image('')
  const root = { querySelectorAll: () => [a, drawn, blank, b] }

  assert.deepEqual(collectImages(root, b), {
    sources: ['nib-asset://asset/a.png', 'nib-asset://asset/b.png'],
    index: 1
  })
  assert.deepEqual(collectImages(root, a).index, 0)
})
