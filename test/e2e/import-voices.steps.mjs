/**
 * A phone recording, imported: converted, transcribed, split by voice, renamed
 * and summarised - in the built app, against the real engines.
 *
 * Needs a recording with at least two voices, given by path, and is skipped
 * without one. The audio is never part of this repo: make one locally - two or
 * three TTS voices with known change points is enough - and run
 *
 *   NIB_E2E_IMPORT=<file.m4a> node test/e2e/run.mjs import-voices
 *
 * Also needs whisper and the voice models installed (see README), and the
 * summary step needs Claude Code to be signed in; NIB_E2E_NO_SUMMARY skips that
 * step. What the transcript came out as is printed as one `RESULT` line of JSON,
 * so a run can be scored against the change points the file was built with.
 */

import { check } from './editor.mjs'

export default async (page) => {
  if ((process.env.NIB_E2E_IMPORT ?? '').length === 0) {
    console.log('  SKIPPED: NIB_E2E_IMPORT is not set, so there is no recording to import')
    return
  }

  await page.waitFor(`document.querySelector('.card') !== null`)
  await page.click('.card')
  await page.waitFor(`document.querySelector('.doc-body')?.textContent.includes('Start')`)

  // Import: the picker is answered by NIB_E2E_IMPORT, so the click goes straight on.
  await page.eval(
    `[...document.querySelectorAll('.toolbar button')].find(b => b.textContent.trim() === 'Import audio').click(); return true`
  )
  await page.waitFor(`document.querySelector('.record-panel .record-go') !== null`, 'import panel')
  const started = Date.now()
  await page.click('.record-panel .record-go')
  await page.waitFor(`document.querySelector('[data-source="import"]') !== null`, 'imported block', 120)
  const converted = (Date.now() - started) / 1000
  const block = await page.eval(`
    const b = document.querySelector('[data-source="import"]')
    return { seconds: Number(b.dataset.seconds), origin: b.dataset.origin, path: b.dataset.recording }`)
  check(block.seconds > 10, `imported as a ${block.seconds}s recording from ${block.origin}`)
  check(/\.wav$/.test(block.path), 'written as a WAV beside the recordings', block.path)

  // Transcribed and separated, without a second click - the words first, then the voices.
  await page.waitFor(
    `document.querySelector('[data-source="import"]')?.textContent.includes('separating voices')`,
    'words done, separating voices',
    900
  )
  const words = (Date.now() - started) / 1000
  await page.waitFor(
    `document.querySelector('[data-source="import"]')?.dataset.state === 'transcribed'`,
    'transcribed and separated',
    900
  )
  const took = (Date.now() - started) / 1000
  console.log(`  timing: converted ${converted}s, words at ${words}s, voices took ${(took - words).toFixed(1)}s, ${took}s in all`)
  const after = await page.eval(`
    const b = document.querySelector('[data-source="import"]')
    const t = document.querySelector('[data-transcript]')
    let voice = null
    const lines = [...t.querySelectorAll('p')].map((p) => {
      const label = p.querySelector('[data-speaker]')
      if (label) voice = label.dataset.speaker
      const em = p.querySelector('em')?.textContent ?? ''
      const text = [...p.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').trim()
      return { at: em, voice, text }
    })
    return {
      voices: b.dataset.voices, why: b.dataset.voicesWhy ?? null, block: b.textContent,
      summaryLine: t.querySelector('summary').textContent,
      legend: [...t.querySelectorAll('summary [data-speaker]')].map((s) => s.dataset.speaker),
      lines
    }`)
  console.log(`  block: ${after.block}`)
  console.log(`  summary line: ${after.summaryLine}`)
  check(Number(after.voices) >= 2, `${after.voices} voices told apart`, after.why ?? '')
  check(after.legend.length === Number(after.voices), 'every voice is listed on the summary line')

  // Rename the first voice from the folded summary line, and it changes everywhere.
  await page.eval(`
    document.querySelector('[data-transcript] summary [data-speaker="v1"]').click(); return true`)
  await page.waitFor(`document.querySelector('.voice-rename input') !== null`, 'rename box')
  const folded = await page.eval(`return document.querySelector('[data-transcript]').open`)
  check(folded === false, 'naming a voice does not unfold the transcript')
  await page.eval(`
    const input = document.querySelector('.voice-rename input')
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    set.call(input, 'Jag'); input.dispatchEvent(new Event('input', { bubbles: true }))
    return true`)
  await page.enter()
  await page.waitFor(`document.querySelector('.voice-rename') === null`, 'rename box closed')
  const renamed = await page.eval(`
    const all = [...document.querySelectorAll('[data-transcript] [data-speaker="v1"]')]
    return { count: all.length, names: [...new Set(all.map((s) => s.textContent))] }`)
  check(
    renamed.names.length === 1 && renamed.names[0] === 'Jag',
    `all ${renamed.count} labels of voice 1 now read Jag`,
    JSON.stringify(renamed)
  )

  // And it is what was saved, not only what is on screen.
  await page.sleep(2500)
  const stored = await page.eval(`
    const doc = await window.nib.readNote('note-e2e')
    return (doc.html.match(/data-speaker="v1">Jag</g) ?? []).length`)
  check(stored === renamed.count, `the rename is in the saved note (${stored} labels)`)

  let summary = null
  if ((process.env.NIB_E2E_NO_SUMMARY ?? '').length === 0) {
    await page.eval(
      `[...document.querySelectorAll('.toolbar button')].find(b => b.textContent.trim() === 'Summarise').click(); return true`
    )
    await page.waitFor(`document.querySelector('.summary-panel') !== null`, 'summary panel')
    await page.eval(`
      const kind = [...document.querySelectorAll('.summary-kinds button')].find(b => b.textContent.includes('Möte'))
      kind?.click(); return true`)
    await page.click('.summary-panel .record-go')
    await page.waitFor(
      `document.querySelector('[data-summary]') !== null || document.querySelector('.summary-error') !== null`,
      'summary written',
      300
    )
    summary = await page.eval(`
      const s = document.querySelector('[data-summary]')
      return s ? s.innerText : 'ERROR: ' + document.querySelector('.summary-error')?.textContent`)
    console.log(`  summary:\n${summary.split('\n').map((l) => '    ' + l).join('\n')}`)
    check(!summary.startsWith('ERROR'), 'the summary was written')
  }

  console.log(`RESULT ${JSON.stringify({ converted, words, took, ...after, renamed, summary })}`)
}
