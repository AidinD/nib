/*
 * Quick record: Ctrl+Alt+, from anywhere.
 *
 * The key opens a small prompt over whatever is on screen. An optional name and
 * Enter start a recording in a new note in the Inbox folder; Escape puts the
 * prompt away. Pressed while a recording is running, the same prompt shows that
 * recording instead - its time and its note - with Enter to stop it and Escape
 * to leave it running. Two presses to stop, never one: a stray key must not end
 * a meeting.
 *
 * The recording itself runs where every recording runs, in the main window's
 * editor, which may well be behind other windows or minimised. Nothing here
 * brings it forward - the point is to start recording without leaving the call -
 * so the taskbar button carries an orange dot for as long as audio is being written,
 * whichever way the recording was started.
 *
 * See DECISIONS 2026-11-27.
 */

import { BrowserWindow, globalShortcut, ipcMain, nativeImage, screen } from 'electron'
import type { NativeImage } from 'electron'
import { QUICK_ACCELERATOR } from '@shared/quick-record'
import type { QuickResult, QuickStart, QuickState } from '@shared/quick-record'
import { currentRecording, stopRecording } from './recordings'
import { createMainWindow, existingQuickWindow, mainWindows, quickRecordWindow } from './windows'

/** Whether the hotkey is ours. False when another program already holds it. */
let registered = false

/**
 * Take the hotkey, and say so either way.
 *
 * `register` answers false rather than throwing when another program has the
 * combination, and an unanswered false is a key that silently does nothing. So
 * the answer is logged, and kept for the main window, which shows a line about
 * it - see HotkeyStrip.
 */
export function registerQuickRecord(lookupTitle: (noteId: string) => Promise<string>): void {
  try {
    registered = globalShortcut.register(QUICK_ACCELERATOR, () => {
      void toggleQuickPrompt(lookupTitle)
    })
  } catch (error) {
    console.error(`[quick] ${QUICK_ACCELERATOR} could not be registered`, error)
    registered = false
  }
  console.log(`[quick] register ${QUICK_ACCELERATOR}: ${registered}`)

  ipcMain.handle('quick:state', () => quickState(lookupTitle))
  ipcMain.handle('quick:registered', () => registered)
  ipcMain.handle('quick:start', (_event, request: QuickStart) => startFromPrompt(request))
  ipcMain.handle('quick:stop', () => stopFromPrompt())
  ipcMain.handle('quick:open', () => openRecordingNote())
  ipcMain.on('quick:close', () => existingQuickWindow()?.hide())

  /*
   * The key press, for the e2e scripts only.
   *
   * A real Ctrl+Alt+, would go to the whole desktop - whoever is using the
   * machine, and the installed Nib if it is running - so the scripts call the
   * handler the key calls instead. Absent unless the harness set the variable.
   */
  if (process.env['NIB_E2E'] === '1') {
    ipcMain.handle('e2e:quick-hotkey', () => toggleQuickPrompt(lookupTitle))
  }
}

/**
 * A main window closing mid-recording stops the recording first.
 *
 * The capture runs in that window's page and the file is open in this process;
 * closing the one without the other leaves a file nothing can stop or finish -
 * the header unpatched until quit, every later start refused as "already
 * recording" - whenever a sticky keeps the app alive. So the close waits for
 * the page to stop, which also files the block in its note, then goes ahead.
 */
export function stopBeforeClosing(window: BrowserWindow): void {
  let stopping = false
  window.on('close', (event) => {
    if (stopping || currentRecording() === null || window.webContents.isCrashed()) {
      return
    }
    event.preventDefault()
    stopping = true
    const stopped = window.webContents
      .executeJavaScript('window.__nibQuick ? window.__nibQuick.stop() : null', true)
      .catch(() => null)
    // A page that never answers must not hold the window open for ever.
    const timeout = new Promise((done) => setTimeout(done, 5000))
    void Promise.race([stopped, timeout]).then(async () => {
      if (currentRecording() !== null) {
        // The page did not stop it: finish the file here, so it is at least whole.
        await stopRecording().catch(() => null)
        showRecordingIndicator(false)
      }
      if (!window.isDestroyed()) {
        window.close()
      }
    })
  })
}

export function unregisterQuickRecord(): void {
  globalShortcut.unregister(QUICK_ACCELERATOR)
}

async function quickState(lookupTitle: (noteId: string) => Promise<string>): Promise<QuickState> {
  const running = currentRecording()
  if (running === null) {
    return { registered, recording: null }
  }
  // The title is a courtesy. An index Dropbox is holding at that instant must
  // not stop the prompt from opening - this is the press that stops a meeting.
  const title = await lookupTitle(running.noteId).catch(() => 'a note')
  return { registered, recording: { title, seconds: running.seconds } }
}

/** On the display the pointer is on, a little above the middle - where you are looking. */
function position(window: BrowserWindow): void {
  const cursor = screen.getCursorScreenPoint()
  const { x, y, width, height } = screen.getDisplayNearestPoint(cursor).workArea
  const [w] = window.getSize()
  window.setPosition(Math.round(x + (width - w) / 2), Math.round(y + height * 0.28))
}

async function toggleQuickPrompt(lookupTitle: (noteId: string) => Promise<string>): Promise<void> {
  console.log(`[quick] ${QUICK_ACCELERATOR} pressed`)
  const window = quickRecordWindow()
  if (window.isVisible()) {
    window.hide()
    return
  }
  const state = await quickState(lookupTitle)
  const show = (): void => {
    position(window)
    window.show()
    window.focus()
    window.webContents.send('quick:reset', state)
  }
  if (window.webContents.isLoading()) {
    window.webContents.once('did-finish-load', show)
  } else {
    show()
  }
}

/**
 * The main window, made if there is none, once its app has said it can record.
 *
 * Only sticky windows open is a real state - closing the main window does not
 * close them - and a quick recording then needs somewhere to run. A new main
 * window shows itself; that is the cost of having closed it.
 */
async function recordingWindow(): Promise<BrowserWindow | null> {
  const window = mainWindows().find((candidate) => !candidate.isDestroyed()) ?? createMainWindow()
  for (let attempt = 0; attempt < 60; attempt++) {
    if (window.isDestroyed()) {
      return null
    }
    if (!window.webContents.isLoading()) {
      const ready = await window.webContents
        .executeJavaScript('window.__nibQuick !== undefined')
        .catch(() => false)
      if (ready === true) {
        return window
      }
    }
    await new Promise((done) => setTimeout(done, 250))
  }
  return null
}

/**
 * Ask the main window to do something, and wait for its answer.
 *
 * `executeJavaScript` rather than a send-and-reply pair: the answer comes back
 * as the promise's value, and `userGesture` makes the call count as a click,
 * so nothing in the capture path can refuse it for having no user behind it.
 */
async function inMainWindow<T>(call: string): Promise<T | { ok: false; error: string }> {
  const window = await recordingWindow()
  if (window === null) {
    return { ok: false, error: 'The Nib window did not come up.' }
  }
  try {
    return (await window.webContents.executeJavaScript(call, true)) as T
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

/** A start in flight. A second Enter - or a second prompt - must not begin another. */
let starting = false

async function startFromPrompt(request: QuickStart): Promise<QuickResult> {
  if (starting) {
    return { ok: false, error: 'Already starting.' }
  }
  starting = true
  const name = typeof request?.name === 'string' ? request.name.slice(0, 200) : ''
  let result: QuickResult
  try {
    result = await inMainWindow<QuickResult>(`window.__nibQuick.start(${JSON.stringify({ name })})`)
  } finally {
    starting = false
  }
  console.log(`[quick] start: ${result.ok ? 'recording' : result.error}`)
  settle(result.ok)
  return result
}

/**
 * Put the prompt away on success, and bring it back on a failure.
 *
 * Back, because it may have gone: a click elsewhere hides it, and so does a
 * main window that had to be made and took the focus. A failure said in a
 * hidden window is a recording you believe is running.
 */
function settle(ok: boolean): void {
  const prompt = existingQuickWindow()
  if (prompt === null) {
    return
  }
  if (ok) {
    prompt.hide()
  } else if (!prompt.isVisible()) {
    prompt.show()
    prompt.focus()
  }
}

async function stopFromPrompt(): Promise<{ ok: boolean; error?: string }> {
  const result = await inMainWindow<{ ok: boolean; error?: string }>('window.__nibQuick.stop()')
  console.log(`[quick] stop: ${result.ok ? 'stopped' : result.error}`)
  settle(result.ok)
  return result
}

/** Bring the main window forward, on the note being recorded into. */
async function openRecordingNote(): Promise<void> {
  existingQuickWindow()?.hide()
  const window = await recordingWindow()
  if (window === null) {
    return
  }
  if (window.isMinimized()) {
    window.restore()
  }
  window.show()
  window.focus()
  await window.webContents.executeJavaScript('window.__nibQuick.reveal()', true).catch(() => undefined)
}

/*
 * The dot on the taskbar button.
 *
 * Drawn rather than shipped as a file: sixteen pixels of circle is less than the
 * code that would find an image inside the asar, and an overlay that failed to
 * load would fail silently - the one indicator that must not.
 */
let dot: NativeImage | null = null

function recordingDot(): NativeImage {
  if (dot !== null) {
    return dot
  }
  const size = 16
  const pixels = Buffer.alloc(size * size * 4)
  const centre = (size - 1) / 2
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const distance = Math.hypot(x - centre, y - centre)
      // A soft edge, so it is a dot at 100% scaling rather than a jagged square.
      const alpha = Math.max(0, Math.min(1, 7.5 - distance))
      const at = (y * size + x) * 4
      // BGRA, premultiplied.
      // --alert, #ff8c42: the colour of the recording bar's own dot.
      pixels[at] = Math.round(0x42 * alpha)
      pixels[at + 1] = Math.round(0x8c * alpha)
      pixels[at + 2] = Math.round(0xff * alpha)
      pixels[at + 3] = Math.round(255 * alpha)
    }
  }
  dot = nativeImage.createFromBitmap(pixels, { width: size, height: size })
  return dot
}

/** Put the dot on every main window's taskbar button, or take it off. */
export function showRecordingIndicator(on: boolean): void {
  console.log(`[quick] taskbar indicator ${on ? 'on' : 'off'}`)
  for (const window of mainWindows()) {
    if (window.isDestroyed()) {
      continue
    }
    window.setOverlayIcon(on ? recordingDot() : null, on ? 'Recording' : '')
  }
}
