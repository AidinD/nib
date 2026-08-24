import { join } from 'path'
import { BrowserWindow, shell } from 'electron'
import { is } from '@electron-toolkit/utils'

const preload = join(__dirname, '../preload/index.mjs')

/**
 * Shared window setup: the same preload bridge, no node integration in the
 * renderer, and external links opened in the real browser rather than swallowed
 * by a frameless app window with no way back.
 */
function baseWebPreferences(): Electron.WebPreferences {
  return {
    preload,
    sandbox: false,
    contextIsolation: true,
    nodeIntegration: false,
    /*
     * Swedish first, then English.
     *
     * The spell checker defaults to the app's own locale, which is English - so
     * a notebook written in Swedish came up with a red line under almost every
     * word, and the one language it could not check was the one being used. Both
     * are listed because notes here mix them freely.
     */
    spellcheck: true
  }
}

/**
 * Which dictionaries the spell checker uses.
 *
 * Set per window rather than once at startup because a sticky window can be the
 * first one opened, and a session's languages are only honoured from the point
 * they are set - the window already loaded keeps the locale it started with.
 */
function setDictionaries(window: BrowserWindow): void {
  try {
    window.webContents.session.setSpellCheckerLanguages(['sv', 'en-US'])
  } catch {
    // An unavailable dictionary throws rather than degrading; English on its own
    // is better than no window.
  }
}

/**
 * The mouse's back and forward buttons, forwarded to the renderer.
 *
 * On Windows those two buttons do not arrive as mouse events at all - Chromium
 * turns them into an `app-command`, which only the main process can hear. So
 * listening for a `mousedown` with button 3 or 4 in the renderer, which is the
 * obvious first attempt, hears nothing.
 *
 * What "back" MEANS is the renderer's business: it keeps the trail of notes that
 * have been opened. This side only says which direction was asked for.
 */
function forwardHistoryButtons(window: BrowserWindow): void {
  window.on('app-command', (_event, command) => {
    if (command === 'browser-backward') {
      window.webContents.send('history:step', 'back')
    } else if (command === 'browser-forward') {
      window.webContents.send('history:step', 'forward')
    }
  })
}

function openLinksExternally(window: BrowserWindow): void {
  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })
}

/**
 * Load the renderer, from the dev server when one is running and from the built
 * files otherwise. `hash` is what tells one window type from another: the main
 * window gets none, a sticky window gets `#sticky/<noteId>`.
 */
function loadRenderer(window: BrowserWindow, hash = ''): void {
  const devServer = process.env['ELECTRON_RENDERER_URL']
  if (is.dev && devServer !== undefined) {
    void window.loadURL(`${devServer}${hash.length > 0 ? `/#${hash}` : ''}`)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'), {
      hash: hash.length > 0 ? hash : undefined
    })
  }
}

/**
 * The main window: 1240x780 and frameless, per the design spec - no title bar
 * and no window buttons, because the header row does that job.
 */
export function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1240,
    height: 780,
    minWidth: 900,
    minHeight: 560,
    show: false,
    frame: false,
    backgroundColor: '#1b1c1f',
    autoHideMenuBar: true,
    webPreferences: baseWebPreferences()
  })

  window.once('ready-to-show', () => {
    window.show()
  })
  openLinksExternally(window)
  setDictionaries(window)
  // Only the main window: a sticky shows one note and has nowhere to go back to.
  forwardHistoryButtons(window)
  loadRenderer(window)
  return window
}

/**
 * Sticky windows, one per pinned note, keyed by note id so asking twice focuses
 * the existing window instead of opening a second copy of the same note.
 */
const stickyWindows = new Map<string, BrowserWindow>()

/**
 * Called when a sticky window closes, so the note can stop being pinned.
 *
 * A sticky window IS the note's pin - closing the window and leaving the card
 * marked sticky would be a lie. This has to come from the window's own `closed`
 * event rather than from the × button, so that Alt+F4 and every other way of
 * closing a window is covered too.
 */
let stickyClosedHandler: ((noteId: string) => void) | null = null

export function onStickyClosed(handler: (noteId: string) => void): void {
  stickyClosedHandler = handler
}

/** 280x320, always on top, frameless - the drag strip in the window does that job. */
export function openStickyWindow(noteId: string): BrowserWindow {
  const existing = stickyWindows.get(noteId)
  if (existing !== undefined && !existing.isDestroyed()) {
    existing.focus()
    return existing
  }

  // Fanned out from the top-right of the primary display so a second sticky does
  // not land exactly on top of the first.
  const offset = stickyWindows.size * 28

  const window = new BrowserWindow({
    width: 280,
    height: 320,
    x: undefined,
    y: undefined,
    show: false,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    backgroundColor: '#26282c',
    webPreferences: baseWebPreferences()
  })

  window.setPosition(window.getPosition()[0] + offset, window.getPosition()[1] + offset)
  window.once('ready-to-show', () => {
    window.show()
  })
  window.on('closed', () => {
    stickyWindows.delete(noteId)
    stickyClosedHandler?.(noteId)
  })
  openLinksExternally(window)
  setDictionaries(window)
  loadRenderer(window, `sticky/${noteId}`)

  stickyWindows.set(noteId, window)
  return window
}

export function closeStickyWindow(noteId: string): void {
  const window = stickyWindows.get(noteId)
  if (window !== undefined && !window.isDestroyed()) {
    window.close()
  }
}

/** Every window that is not a sticky - today that is just the main window. */
export function mainWindows(): BrowserWindow[] {
  const sticky = new Set(stickyWindows.values())
  return BrowserWindow.getAllWindows().filter((window) => !sticky.has(window))
}

/** Every open window, used to broadcast "the data on disk changed". */
export function allWindows(): BrowserWindow[] {
  return BrowserWindow.getAllWindows()
}
