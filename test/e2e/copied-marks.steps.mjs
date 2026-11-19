/**
 * A note that already has a mark copied down its lines is put right as it opens.
 *
 * The shape the Enter bug left behind: one line marked, the three written after
 * it carrying the same moment and the same recording, one of them holding a
 * screenshot with a moment of its own. Opened, only the first line keeps its
 * time and the screenshot keeps its own; the copies lose theirs.
 *
 * Every line here is invented.
 */

import { check } from './editor.mjs'

const REC = 'C:\\\\rec\\\\note-e2e-2026-01-01T10-00-00.wav'
const mark = (at) => `<p data-at="${at}" data-rec="${REC}"><span data-at-label="1">0:00</span>`

export const seed =
  '<p>Start</p>' +
  `${mark(300)}the marked line</p>` +
  `${mark(300)}copied once</p>` +
  `${mark(300)}copied twice<img src="data:image/png;base64,iVBORw0KGgo=" alt="" data-at="420" data-rec="${REC}"></p>` +
  `${mark(300)}copied three times</p>` +
  `${mark(1500)}a second real mark</p>` +
  `${mark(1500)}its copy</p>`

export default async (page) => {
  await page.waitFor(`document.querySelector('.card') !== null`)
  await page.click('.card')
  await page.waitFor(`document.querySelector('.doc-body')?.textContent.includes('Start')`)
  const lines = await page.eval(`
    return [...document.querySelectorAll('.doc-body p')].map((p) => ({
      at: p.dataset.at ?? null,
      words: [...p.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join(''),
      label: p.firstElementChild?.dataset.atLabel === '1' ? p.firstElementChild.textContent : null
    }))`)
  console.log('    ' + lines.map((l) => `${l.words}: ${l.at ?? '-'}${l.label ? ` [${l.label}]` : ''}`).join(' | '))
  const at = Object.fromEntries(lines.map((l) => [l.words, l.at]))
  check(at['the marked line'] === '300' && at['a second real mark'] === '1500', 'each real mark keeps its moment')
  check(at['copied once'] === null && at['copied twice'] === null && at['copied three times'] === null && at['its copy'] === null, 'every copy loses it')
  const labelled = lines.filter((l) => l.label !== null).map((l) => `${l.words} ${l.label}`)
  check(labelled.join(',') === 'the marked line 5:00,a second real mark 25:00', 'labels only on the real marks', labelled.join(','))
  const image = await page.eval(`const img = document.querySelector('.doc-body img'); return [img.dataset.at, img.nextElementSibling?.textContent]`)
  check(image[0] === '420' && image[1] === '7:00', 'the screenshot keeps its own moment and label', JSON.stringify(image))
}
