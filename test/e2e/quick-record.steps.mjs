/**
 * Quick record: Ctrl+Alt+, from anywhere, into the Inbox, and out again.
 *
 * The key press itself is the one thing not exercised here - a real Ctrl+Alt+,
 * would go to the whole desktop - so the script calls what the key calls, through
 * the door the app opens under NIB_E2E (see src/main/quick.ts). Everything after
 * it is the real path: the prompt window, typed into over CDP; the main window
 * starting the recording; the files on disk afterwards.
 *
 * Both captures are generated signals, as in mic-warning.steps.mjs - no device,
 * no room audio.
 *
 *   1. Named: the prompt opens, a name and Enter start a recording in a new
 *      "Inbox" folder, under that name, and the note is opened.
 *   2. The key again, while recording: the prompt shows the recording - its time
 *      and its note - instead of a new one.
 *   3. Another note is opened during the recording, and Enter in the prompt
 *      stops it: the recording lands in the Inbox note it was started in, on
 *      disk, and not in the note on screen.
 *   4. Unnamed: Enter on an empty field still records, into the same Inbox,
 *      titled with the date and minute.
 *   5. Moved: the recording's own Move takes it out of the Inbox note into
 *      another one.
 *   6. No language is asked when recording; the block's language switch flips
 *      it without transcribing, and a transcribed block offers the other one.
 *
 * Step 4 runs with the main window minimised, and checks that audio is still
 * being written and that the prompt's Open note brings the window back.
 */

import { check } from './editor.mjs'

const fakeCaptures = (page) =>
  page.eval(`
    const ctx = new AudioContext()
    const rate = ctx.sampleRate
    const tone = (f) => () => {
      const osc = ctx.createOscillator(); osc.frequency.value = f
      const gain = ctx.createGain(); gain.gain.value = 0.2
      const out = ctx.createMediaStreamDestination()
      osc.connect(gain); gain.connect(out); osc.start()
      return out.stream
    }
    navigator.mediaDevices.getUserMedia = async () => { await ctx.resume(); return tone(220)() }
    navigator.mediaDevices.getDisplayMedia = async () => { await ctx.resume(); return tone(330)() }
    return true`)

const inbox = (page) =>
  page.eval(`
    const index = await window.nib.loadIndex()
    const found = index.categories.filter(c => c.name === 'Inbox')
    return found.map(c => ({ id: c.id, notes: c.notes.map(n => ({ id: n.id, title: n.title })) }))`)

const press = (page) => page.eval(`await window.nib.quick.e2ePress(); return true`)

const html = (page, id) => page.eval(`return (await window.nib.readNote(${JSON.stringify(id)}))?.html ?? ''`)

export default async (page) => {
  await page.waitFor(`document.querySelector('.card') !== null`)
  await fakeCaptures(page)
  check((await inbox(page)).length === 0, 'the notebook starts with no Inbox')

  // --- 1. Named.
  await press(page)
  const prompt = await page.window('#quick')
  await prompt.waitFor(`document.activeElement?.classList.contains('quick-name')`, 'the name field has the focus')
  check(await prompt.eval(`return document.querySelector('.quick-hint').textContent.includes('Inbox')`), 'the prompt says where it will go')
  await prompt.type('Kundsamtal')
  await prompt.key(13, 'Enter', 'Enter')
  await page.waitFor(`document.querySelector('.recording-bar') !== null`, 'the main window is recording')
  let folders = await inbox(page)
  check(folders.length === 1 && folders[0].notes.length === 1 && folders[0].notes[0].title === 'Kundsamtal', 'a note named Kundsamtal in a new Inbox folder', JSON.stringify(folders))
  const named = folders[0].notes[0].id
  await page.waitFor(`document.querySelector('.doc-title')?.value === 'Kundsamtal'`, 'the new note is the one open')
  check(await prompt.eval(`return document.visibilityState`) === 'hidden', 'the prompt put itself away')

  // --- 2. The key again, while recording.
  await page.sleep(2200)
  await press(page)
  await prompt.waitFor(`document.querySelector('.quick-stop') !== null`, 'the prompt shows the running recording')
  const running = await prompt.eval(`return document.querySelector('.quick').textContent`)
  check(running.includes('Kundsamtal') && /Recording \d+:\d\d/.test(running), `it names the note and the time (${running})`)

  // --- 3. Another note opened, then stopped from the prompt.
  await page.eval(`[...document.querySelectorAll('.category-row .row-label')].find(r => r.textContent.trim() === 'E2E').click(); return true`)
  await page.waitFor(`[...document.querySelectorAll('.card')].some(c => c.textContent.includes('E2E'))`, 'the E2E folder')
  await page.eval(`[...document.querySelectorAll('.card')].find(c => c.textContent.includes('E2E')).click(); return true`)
  await page.waitFor(`document.querySelector('.doc-title')?.value === 'E2E'`, 'the other note is open')
  await prompt.eval(`document.querySelector('.quick').focus(); return true`)
  await prompt.key(13, 'Enter', 'Enter')
  await page.waitFor(`document.querySelector('.recording-bar') === null`, 'stopped from the prompt')
  await page.waitFor(`(async () => (await window.nib.readNote(${JSON.stringify(named)}))?.html.includes('data-recording'))()`, 'the recording reaches the Inbox note on disk')
  check((await html(page, named)).includes('data-recording'), 'the recording is in the note it was started in')
  check(!(await page.eval(`return document.querySelector('.doc-body').innerHTML.includes('data-recording')`)), 'and not in the note that was on screen')
  check(!(await html(page, 'note-e2e')).includes('data-recording'), 'nor in that note on disk')

  // --- 4. Unnamed, with the main window minimised - the background case.
  await page.eval(`await window.nib.minimizeWindow(); return true`)
  // Logged rather than required: whether Windows has finished minimising by now
  // is the desktop's business, and the check that matters is the clock below.
  await page.sleep(800)
  console.log(`  main window visibility after minimise: ${await page.eval(`return document.visibilityState`)}`)
  await press(page)
  await prompt.waitFor(`document.activeElement?.classList.contains('quick-name')`, 'a fresh prompt')
  check(await prompt.eval(`return document.querySelector('.quick-name').value === ''`), 'last time\'s name is gone')
  await prompt.key(13, 'Enter', 'Enter')
  await page.waitFor(`document.querySelector('.recording-bar') !== null`, 'recording without a name')
  folders = await inbox(page)
  const unnamed = folders[0]?.notes.find((n) => n.id !== named)
  check(folders.length === 1 && unnamed !== undefined && /^\d{4}-\d\d-\d\d \d\d:\d\d$/.test(unnamed.title), `the same Inbox, titled with the minute (${unnamed?.title})`, JSON.stringify(folders))
  // Audio is flowing while minimised: the prompt's clock, read off the bytes
  // written in the main process, moves.
  await page.sleep(2500)
  await press(page)
  await prompt.waitFor(`document.querySelector('.quick-stop') !== null`, 'the prompt shows the recording')
  const clock = await prompt.eval(`return document.querySelector('.quick-title').textContent`)
  check(/Recording 0:0[2-9]/.test(clock), `the recording runs while the window is minimised (${clock})`)
  // Open note brings the window back, on the recording's note.
  await prompt.click('.quick-actions button:not(.quick-stop)')
  await page.waitFor(`document.visibilityState === 'visible'`, 'Open note restored the main window')
  check(await page.eval(`return document.querySelector('.doc-title').value === ${JSON.stringify(unnamed.title)}`), 'on the note being recorded')
  // Stopped from the window this time, with the note on screen.
  await page.click('.recording-stop')
  await page.waitFor(`document.querySelector('.doc-body [data-recording]') !== null`, 'the block in the open note')

  // --- 5. Moved out of the Inbox into the E2E note.
  await page.click('.doc-body [data-recording] [data-move-note]')
  await page.waitFor(`document.querySelector('.note-picker-input') !== null`, 'the note picker')
  await page.click('.note-picker-input')
  await page.type('E2E')
  await page.waitFor(`[...document.querySelectorAll('.note-picker-row')].some(r => r.textContent.includes('E2E'))`, 'the E2E note offered')
  await page.eval(`[...document.querySelectorAll('.note-picker-row')].find(r => r.textContent.includes('E2E')).click(); return true`)
  await page.waitFor(`(async () => (await window.nib.readNote('note-e2e'))?.html.includes('data-recording'))()`, 'moved into the E2E note')
  await page.waitFor(`document.querySelector('.doc-body [data-recording]') === null`, 'and out of the Inbox note')
  check(!(await html(page, unnamed.id)).includes('data-recording'), 'the Inbox note no longer holds it on disk')

  // --- 6. The language is chosen on the block, not when recording.
  // Nothing in the prompt or the record panel asks for it any more.
  await press(page)
  await prompt.waitFor(`document.querySelector('.quick-name') !== null`, 'the prompt')
  check(await prompt.eval(`return document.querySelector('.lang-toggle') === null`), 'the prompt asks no language')
  await prompt.key(27, 'Escape', 'Escape')
  await page.eval(`[...document.querySelectorAll('.category-row .row-label')].find(r => r.textContent.trim() === 'E2E').click(); return true`)
  await page.eval(`[...document.querySelectorAll('.card')].find(c => c.textContent.includes('E2E')).click(); return true`)
  await page.waitFor(`document.querySelector('.doc-body [data-recording] [data-language-toggle]') !== null`, 'the language switch on the block')
  const before = await page.eval(`return document.querySelector('.doc-body [data-recording]').dataset.language`)
  await page.click('.doc-body [data-recording] [data-language-toggle]')
  const after = await page.eval(`const b = document.querySelector('.doc-body [data-recording]'); return { language: b.dataset.language, state: b.dataset.state ?? 'recorded', label: b.querySelector('[data-language-toggle]')?.textContent }`)
  check(after.language !== before && after.state === 'recorded', `a click flips it (${before} -> ${after.language}) and transcribes nothing`, JSON.stringify(after))
  check(after.label === (after.language === 'en' ? 'English' : 'Svenska'), `and the block says so (${after.label})`)
  await page.eval(`[...document.querySelectorAll('.toolbar button')].find(b => b.textContent.trim() === 'Record').click(); return true`)
  await page.waitFor(`document.querySelector('.record-panel') !== null`, 'the record panel')
  check(await page.eval(`return document.querySelector('.record-panel .lang-toggle') === null`), 'the record panel asks no language either')
  await page.click('.record-cancel')

  // A transcribed recording offers the other language. Written as transcribed
  // into the Kundsamtal note on disk - running whisper on a test tone proves
  // nothing - and opened.
  await page.eval(`
    const doc = await window.nib.readNote(${JSON.stringify(named)})
    await window.nib.writeNote({ ...doc, html: doc.html.replace('data-state="recorded"', 'data-state="transcribed"').replace(/data-language="[a-z]+"/, 'data-language="sv"') })
    return true`)
  await page.eval(`[...document.querySelectorAll('.category-row .row-label')].find(r => r.textContent.trim() === 'Inbox').click(); return true`)
  await page.waitFor(`[...document.querySelectorAll('.card')].some(c => c.textContent.includes('Kundsamtal'))`, 'the Inbox list')
  await page.eval(`[...document.querySelectorAll('.card')].find(c => c.textContent.includes('Kundsamtal')).click(); return true`)
  await page.waitFor(`document.querySelector('.doc-body [data-retranscribe-as]') !== null`, 'the offer on a transcribed block')
  const offer = await page.eval(`const o = document.querySelector('.doc-body [data-retranscribe-as]'); return { as: o.dataset.retranscribeAs, text: o.textContent }`)
  check(offer.as === 'en' && offer.text === 'in English', `"transcribe again in English" on a Swedish transcript`, JSON.stringify(offer))
}
