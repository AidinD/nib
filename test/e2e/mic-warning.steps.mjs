/**
 * The microphone warning, rendered during a real recording.
 *
 * The microphone and the system capture are replaced in the page by generated
 * signals - no device, no recorded audio. Three recordings: constant loud noise
 * on the microphone, which must raise the noise warning within the ten-second
 * window; a dead microphone while the call talks, which must raise the silent
 * one after twenty; and speech with pauses, which must raise nothing. The
 * warning is checked as a box on screen - its size, that it is inside the
 * window, and that it is the element actually at its own centre - not as state.
 */

import { check } from './editor.mjs'

/** Replace both captures with generated signals. `mic` is 'noise', 'silent' or 'speech'. */
const fake = (page, mic) =>
  page.eval(`
    const ctx = new AudioContext()
    const rate = ctx.sampleRate
    let seed = 7
    const next = () => (seed = (seed * 16807) % 2147483647) / 2147483647
    const gauss = () => { let s = 0; for (let i = 0; i < 12; i++) s += next(); return s - 6 }
    const looped = (seconds, fill) => {
      const buffer = ctx.createBuffer(1, Math.round(seconds * rate), rate)
      fill(buffer.getChannelData(0))
      const source = ctx.createBufferSource(); source.buffer = buffer; source.loop = true; source.start()
      // A fresh stream per call: the record panel's level check stops the tracks
      // it was given before the recording asks again.
      return () => { const out = ctx.createMediaStreamDestination(); source.connect(out); return out.stream }
    }
    const speech = (level) => (data) => {
      let at = 0
      while (at < data.length) {
        const phrase = Math.round((1 + next() * 2) * rate), f0 = 110 + next() * 110
        for (let i = 0; i < phrase && at < data.length; i++, at++) {
          const t = i / rate, syl = 0.35 + 0.65 * Math.abs(Math.sin(Math.PI * 4 * t))
          data[at] = level * syl * 0.6 * (Math.sin(2 * Math.PI * f0 * t) + 0.5 * Math.sin(4 * Math.PI * f0 * t))
        }
        const pause = Math.round((0.5 + next()) * rate)
        for (let i = 0; i < pause && at < data.length; i++, at++) data[at] = gauss() * 0.0008
      }
    }
    const noise = (data) => { let p = 0; for (let i = 0; i < data.length; i++) { p = 0.5 * p + gauss() * 0.36; data[i] = Math.max(-1, Math.min(1, p)) } }
    const micStream = ${JSON.stringify(mic)} === 'noise' ? looped(3, noise)
      : ${JSON.stringify(mic)} === 'speech' ? looped(30, speech(0.25))
      : looped(1, () => {})
    const callStream = looped(30, speech(0.2))
    // Resumed here, inside the click on Start: a context made without a user
    // gesture starts suspended, and a suspended one sends silence - which the
    // first run of this script recorded faithfully as a dead microphone.
    navigator.mediaDevices.getUserMedia = async () => { await ctx.resume(); return micStream() }
    navigator.mediaDevices.getDisplayMedia = async () => { await ctx.resume(); return callStream() }
    return true`)

const record = async (page) => {
  await page.eval(`[...document.querySelectorAll('.toolbar button')].find(b => b.textContent.trim() === 'Record').click(); return true`)
  await page.waitFor(`document.querySelector('.record-go') !== null`, 'record panel')
  await page.click('.record-go')
  await page.waitFor(`document.querySelector('.recording-bar') !== null`, 'recording started')
  return Date.now()
}

const stop = async (page) => {
  await page.click('.recording-stop')
  await page.waitFor(`document.querySelector('.recording-bar') === null`, 'recording stopped')
}

/** The warning as a box on screen, or null. */
const warningBox = (page) =>
  page.eval(`
    const el = document.querySelector('.mic-warning')
    if (el === null) return null
    const r = el.getBoundingClientRect()
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
    return { problem: el.dataset.problem, text: el.textContent, x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height),
      inside: r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight, onTop: el.contains(hit),
      opacity: getComputedStyle(el).opacity, display: getComputedStyle(el).display }`)

export default async (page) => {
  await page.waitFor(`document.querySelector('.card') !== null`)
  await page.click('.card')
  await page.waitFor(`document.querySelector('.doc-body')?.textContent.includes('Start')`)

  // --- (b) constant loud noise on the microphone.
  await fake(page, 'noise')
  let started = await record(page)
  await page.waitFor(`document.querySelector('.mic-warning[data-problem="noise"]') !== null`, 'noise warning', 25)
  const noise = await warningBox(page)
  console.log(`  noise warning after ${((Date.now() - started) / 1000).toFixed(1)}s: ${JSON.stringify(noise)}`)
  check(noise.w > 200 && noise.h > 20 && noise.inside && noise.onTop && noise.display !== 'none', 'the noise warning is a visible box on screen')
  check(noise.text.includes('constant loud noise') && noise.text.includes('input volume'), 'it says what is wrong and what to check')
  const running = await page.eval(`return document.querySelector('.recording-time').textContent`)
  await page.sleep(1500)
  const later = await page.eval(`return document.querySelector('.recording-time').textContent`)
  check(running !== later, `the recording keeps running under the warning (${running} -> ${later})`)
  await page.click('.mic-warning-hide')
  check((await warningBox(page)) === null, 'it can be put away')
  await stop(page)

  // --- (a) a dead microphone while the call talks.
  await fake(page, 'silent')
  started = await record(page)
  await page.waitFor(`document.querySelector('.mic-warning[data-problem="silent"]') !== null`, 'silent warning', 35)
  const silent = await warningBox(page)
  console.log(`  silent warning after ${((Date.now() - started) / 1000).toFixed(1)}s: ${JSON.stringify(silent)}`)
  check(silent.w > 200 && silent.h > 20 && silent.inside && silent.onTop, 'the silent warning is a visible box on screen')
  check(silent.text.includes('heard nothing') && silent.text.includes('Nib is not hearing you'), 'it says what is wrong')
  await stop(page)

  // --- speech with pauses: nothing.
  await fake(page, 'speech')
  started = await record(page)
  await page.sleep(25000)
  const none = await warningBox(page)
  check(none === null, `speech with pauses raises nothing in ${((Date.now() - started) / 1000).toFixed(0)}s`, JSON.stringify(none))
  await stop(page)
}
