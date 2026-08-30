import { createHash } from 'crypto'
import { existsSync, promises as fs } from 'fs'
import { join, normalize, sep } from 'path'
import { pathToFileURL } from 'url'
import { app, BrowserWindow, clipboard, ipcMain, net, protocol } from 'electron'
import { electronApp, is, optimizer } from '@electron-toolkit/utils'
// electron-updater is CommonJS, so a named ESM import does not work here - the
// same shape Jot ended up with.
import electronUpdater from 'electron-updater'

const { autoUpdater } = electronUpdater
import type { DrawingDoc, NibIndex, NoteDoc } from '@shared/types'
import { ASSETS_DIR, migrateLegacyData, resolveDataDir } from './data-dir'
import {
  appendSamples,
  deleteRecording,
  isRecording,
  startRecording,
  stopRecording,
  sweepRecordings
} from './recordings'
import { transcribe, whisperStatus } from 'keel/whisper'
import { summarise } from './summary'
import type { SummaryRequest } from './summary'
import { NoteStorage } from './storage'
import {
  allWindows,
  closeStickyWindow,
  createMainWindow,
  mainWindows,
  onStickyClosed,
  openStickyWindow
} from './windows'

/**
 * Images pasted into a note are written to the assets folder and referenced
 * through this scheme rather than embedded as base64 in the note file.
 *
 * A note file stays small and diffable that way, and the same image pasted into
 * two notes is stored once. It has to be registered as privileged before the app
 * is ready, so the renderer may load it from a page with a strict CSP.
 */
const ASSET_SCHEME = 'nib-asset'

protocol.registerSchemesAsPrivileged([
  {
    scheme: ASSET_SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true }
  }
])

let storage: NoteStorage | null = null

/**
 * Set once the app is on its way out.
 *
 * Quitting closes every sticky window, and unpinning notes because the app is
 * closing would mean coming back to none of them.
 */
let quitting = false

function store(): NoteStorage {
  if (storage === null) {
    throw new Error('The Nib storage layer was used before the app was ready')
  }
  return storage
}

/** Broadcast that the data on disk changed, so every open window reloads. */
function broadcastIndexChanged(): void {
  for (const window of allWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send('index:changed')
    }
  }
}

/**
 * Resolve an asset URL to a file inside the assets folder, or null when the path
 * tries to climb out of it. The renderer supplies these paths, so the containment
 * check is not optional.
 */
function resolveAssetPath(url: string): string | null {
  const assetsRoot = join(store().directory, ASSETS_DIR)
  let pathname: string
  try {
    pathname = decodeURIComponent(new URL(url).pathname)
  } catch {
    return null
  }
  const resolved = normalize(join(assetsRoot, pathname))
  if (resolved !== assetsRoot && !resolved.startsWith(assetsRoot + sep)) {
    return null
  }
  return resolved
}

const IMAGE_EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'image/bmp': 'bmp'
}

/**
 * Write a pasted or dropped image into the assets folder and hand back its URL.
 *
 * The filename is the content hash, so pasting the same image twice writes one
 * file, and re-pasting after an undo cannot produce a second copy.
 */
async function writeAsset(dataUrl: string): Promise<string> {
  const match = /^data:([a-z+/-]+);base64,([A-Za-z0-9+/=]+)$/i.exec(dataUrl)
  if (match === null) {
    throw new Error('Only base64 data URLs can be stored as note assets')
  }
  const [, mime, base64] = match
  const extension = IMAGE_EXTENSIONS[mime.toLowerCase()]
  if (extension === undefined) {
    throw new Error(`Unsupported image type: ${mime}`)
  }

  const bytes = Buffer.from(base64, 'base64')
  const name = `${createHash('sha256').update(bytes).digest('hex').slice(0, 32)}.${extension}`
  const target = join(store().directory, ASSETS_DIR, name)

  // Content-addressed, so an existing file with this name already holds exactly
  // these bytes and rewriting it would be pure churn.
  const exists = await fs
    .access(target)
    .then(() => true)
    .catch(() => false)
  if (!exists) {
    // Temp file plus rename, as with the note files - a half-written image must
    // never be reachable under its final name. No retry loop is needed here: the
    // name is a content hash, so two writers racing produce identical bytes.
    await fs.mkdir(join(store().directory, ASSETS_DIR), { recursive: true })
    const temp = `${target}.${Math.random().toString(36).slice(2)}.tmp`
    await fs.writeFile(temp, bytes)
    await fs.rename(temp, target).catch(async (error) => {
      await fs.unlink(temp).catch(() => undefined)
      throw error
    })
  }

  return `${ASSET_SCHEME}://asset/${name}`
}

/**
 * The orphan sweep, debounced.
 *
 * Every note write is a chance for an image or a drawing to have lost its last
 * reference - deleting a section takes its images with it - but a sweep per
 * keystroke would be absurd. One run a few seconds after the writing stops
 * catches the same files.
 */
let sweepTimer: NodeJS.Timeout | null = null

function scheduleSweep(): void {
  if (sweepTimer !== null) {
    clearTimeout(sweepTimer)
  }
  sweepTimer = setTimeout(() => {
    sweepTimer = null
    void store()
      .sweepOrphans()
      .then(({ assets, drawings }) => {
        if (assets > 0 || drawings > 0) {
          console.log(`Nib swept ${assets} orphaned asset(s) and ${drawings} drawing(s)`)
        }
      })
      .catch((error) => {
        console.error('Failed to sweep orphaned files', error)
      })
  }, 5000)
}

/**
 * Check GitHub for a newer release, once, at startup.
 *
 * Nib is unsigned, which does not stop electron-updater on Windows: the first
 * install triggers SmartScreen, updates after that are silent. The download is
 * installed on quit rather than mid-session, which is the library's default and
 * the right one for an app you leave open all day.
 *
 * Never in development: there is no packaged app to replace, and the check only
 * produces a confusing error in the log.
 */
function checkForUpdates(): void {
  if (is.dev) {
    return
  }
  autoUpdater.on('update-available', (info) => {
    console.log(`Nib update available: ${info.version}`)
  })
  autoUpdater.on('update-downloaded', (info) => {
    console.log(`Nib update ${info.version} downloaded; it installs on quit`)
  })
  autoUpdater.on('error', (error) => {
    // Being offline is the common case here, and it is not worth a dialog.
    console.error('Nib update check failed', error)
  })
  void autoUpdater.checkForUpdatesAndNotify().catch((error) => {
    console.error('Nib update check could not start', error)
  })
}

/*
 * Recordings live with the app, not with the notes.
 *
 * The notebook is in a synced folder, and a 45-minute meeting is about 86MB -
 * so writing them there means uploading a temporary file the whole time it is
 * being written, on every machine, for something that is deleted as soon as it
 * has been transcribed. They are scratch, they are local, and they belong in
 * userData.
 */
const recordingsDir = (): string => join(app.getPath('userData'), 'recordings')


function registerIpc(): void {
  ipcMain.handle('app:info', () => ({
    version: app.getVersion(),
    dataDir: store().directory
  }))

  ipcMain.handle('index:load', () => store().loadIndex())
  ipcMain.handle('index:save', async (_event, index: NibIndex) => {
    await store().saveIndex(index)
    // The writer already has this state; every OTHER window needs telling.
    broadcastIndexChanged()
    scheduleSweep()
  })

  ipcMain.handle('note:read', (_event, id: string) => store().readNote(id))
  ipcMain.handle('note:write', async (_event, doc: NoteDoc) => {
    const edited = Date.now()
    await store().writeNote({ ...doc, edited })
    scheduleSweep()
    return edited
  })
  ipcMain.handle('note:delete', async (_event, id: string) => {
    await store().deleteNote(id)
    scheduleSweep()
  })

  ipcMain.handle('drawing:read', (_event, id: string) => store().readDrawing(id))
  ipcMain.handle('drawing:write', (_event, doc: DrawingDoc) => store().writeDrawing(doc))
  ipcMain.handle('drawing:delete', (_event, id: string) => store().deleteDrawing(id))

  ipcMain.handle('asset:write', (_event, dataUrl: string) => writeAsset(dataUrl))

  /*
   * Recording a meeting.
   *
   * The samples arrive here as they are captured rather than in one piece at the
   * end - see recordings.ts. `recording:chunk` is `on`, not `handle`: it fires
   * every few hundred milliseconds for the length of a meeting, and a round trip
   * for each one buys nothing when there is no answer to wait for.
   */
  ipcMain.handle('recording:start', (_event, noteId: string) =>
    startRecording(recordingsDir(), noteId)
  )
  ipcMain.on('recording:chunk', (_event, chunk: Uint8Array) => appendSamples(chunk))
  ipcMain.handle('recording:stop', () => stopRecording())
  ipcMain.handle('recording:delete', (_event, path: string) => deleteRecording(path))
  ipcMain.handle('recording:exists', (_event, path: string) => existsSync(path))

  /*
   * The summary: the one step that leaves the machine.
   *
   * Through keel, which borrows Claude Code's own sign-in - so there is no second
   * credential to store and the spend is the one the user already has.
   */
  ipcMain.handle('summary:run', (_event, request: SummaryRequest) => summarise(request))

  /*
   * Turning a recording into text.
   *
   * The work happens in a child process that keel spawns, so a crash in the
   * transcriber cannot take the window with it, and a long meeting does not block
   * anything here. Progress is pushed to the renderer as whisper reports its
   * position - a 45-minute meeting is a few minutes of waiting, and a spinner
   * that cannot say how far along it is turns that into an unknown.
   */
  /*
   * Where THIS app would keep the engine, on top of what keel knows.
   *
   * keel cannot work these out - it has no idea which app is asking - so the two
   * places that belong to Nib are passed in: beside the notebook, for someone who
   * keeps everything in one synced folder, and in the app's own userData, which is
   * where an installed copy would put something it downloaded.
   */
  const whisperRoots = (): string[] => [
    join(resolveDataDir(), 'whisper'),
    join(app.getPath('userData'), 'whisper')
  ]

  ipcMain.handle('transcribe:status', (_event, language: 'sv' | 'en') =>
    whisperStatus(language, { roots: whisperRoots() })
  )
  ipcMain.handle(
    'transcribe:run',
    async (
      event,
      { path, language, seconds }: { path: string; language: 'sv' | 'en'; seconds: number }
    ) => {
      const result = await transcribe({
        file: path,
        language,
        seconds,
        roots: whisperRoots(),
        onProgress: (fraction) => {
          if (!event.sender.isDestroyed()) {
            event.sender.send('transcribe:progress', fraction)
          }
        }
      })
      return result
    }
  )

  ipcMain.handle('sticky:open', (_event, noteId: string) => {
    openStickyWindow(noteId)
  })
  ipcMain.handle('sticky:close', (_event, noteId: string) => {
    closeStickyWindow(noteId)
  })

  /*
   * The clipboard, through the main process.
   *
   * Not `navigator.clipboard` in the renderer: that needs a secure context and a
   * permission the app would have to grant itself, and it fails by resolving
   * quietly rather than by throwing. Electron's own clipboard has neither
   * problem and is two lines.
   */
  ipcMain.handle('clipboard:write', (_event, text: unknown) => {
    clipboard.writeText(String(text ?? ''))
  })

  // Window controls, because the window is frameless and the header row owns them.
  ipcMain.handle('window:minimize', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize()
  })
  ipcMain.handle('window:toggle-maximize', (event) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (window === null) {
      return
    }
    if (window.isMaximized()) {
      window.unmaximize()
    } else {
      window.maximize()
    }
  })
  // A sticky window opens always-on-top; this is how it is turned off again.
  ipcMain.handle('window:toggle-always-on-top', (event) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (window === null) {
      return false
    }
    const next = !window.isAlwaysOnTop()
    window.setAlwaysOnTop(next)
    return next
  })
  ipcMain.handle('window:close', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close()
  })
}

void app.whenReady().then(() => {
  electronApp.setAppUserModelId('io.github.aidind.nib')

  migrateLegacyData()
  storage = new NoteStorage(resolveDataDir())

  protocol.handle(ASSET_SCHEME, async (request) => {
    const filePath = resolveAssetPath(request.url)
    if (filePath === null) {
      return new Response('Not found', { status: 404 })
    }
    return net.fetch(pathToFileURL(filePath).toString())
  })

  registerIpc()

  // An external write - Dropbox syncing the folder down from another machine, or
  // a tool editing the index - reaches the renderer the same way our own does.
  store().watchIndex(broadcastIndexChanged)

  /*
   * A notebook written before links were recorded gets them filled in once.
   *
   * After the watcher is set up, so the renderer hears about the rewritten index
   * through the same path as any other external change and reloads on its own -
   * no separate "the migration finished" message to wire up. Failures are logged
   * and dropped: without it backlinks are empty until notes are edited, which is
   * a smaller problem than refusing to start.
   */
  void store()
    .backfillLinks()
    .then((changed) => {
      if (changed) {
        console.log('[nib] filled in note links for a version 1 notebook')
      }
    })
    .catch((error) => console.error('[nib] link backfill failed', error))

  /*
   * Recordings whose note is gone, cleared at startup.
   *
   * The audio is deleted when it becomes a transcript, so this only ever finds
   * the two cases where that never happened: a note thrown away with a recording
   * still attached, and a transcription never asked for on a note since deleted.
   * Both leave a file nothing can point at, and 1.9MB a minute is quiet until it
   * is not.
   */
  void store()
    .loadIndex()
    .then((index) =>
      sweepRecordings(
        recordingsDir(),
        new Set(index.categories.flatMap((category) => category.notes.map((note) => note.id)))
      )
    )
    .then(({ removed, bytes }) => {
      if (removed > 0) {
        console.log(`[nib] removed ${removed} orphaned recording(s), ${Math.round(bytes / 1024 / 1024)}MB`)
      }
    })
    .catch((error) => console.error('[nib] recording sweep failed', error))

  // A sweep at startup catches anything orphaned by a crash, or by a note
  // deleted on another machine and synced down while this one was closed.
  scheduleSweep()

  app.on('browser-window-created', (_event, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // A sticky window closing is the note being unpinned - unless the whole app is
  // going down, in which case the pins are exactly what should survive.
  onStickyClosed((noteId) => {
    if (quitting) {
      return
    }
    for (const window of mainWindows()) {
      if (!window.isDestroyed()) {
        window.webContents.send('sticky:closed', noteId)
      }
    }
  })

  createMainWindow()
  checkForUpdates()

  // Pinning a note is what produces its sticky window, and a pin outlives a
  // restart - so the windows have to come back with it, or a pinned note would
  // quietly stop being sticky until it was toggled again.
  void store()
    .loadIndex()
    .then((index) => {
      for (const category of index.categories) {
        for (const note of category.notes) {
          // Archiving unpins, so the two should never disagree - but the index
          // is a synced file, and a note archived on one machine can arrive here
          // still carrying a pin from before. Archived wins: putting an archived
          // note back on screen at every start is the one way this feature
          // becomes an annoyance.
          if (note.pinned && !note.archived) {
            openStickyWindow(note.id)
          }
        }
      }
    })
    .catch((error) => {
      console.error('Failed to reopen sticky windows', error)
    })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow()
    }
  })
})

app.on('before-quit', (event) => {
  quitting = true

  /*
   * Close the WAV before the process goes.
   *
   * Its header carries two lengths that are only known when recording stops, and
   * a file left with zeroes in them plays as empty and transcribes as silence.
   * Quitting mid-meeting is exactly when someone would most want the recording,
   * so the quit waits for the patch - once, and only while a recording is open.
   */
  if (isRecording()) {
    event.preventDefault()
    void stopRecording().finally(() => app.quit())
  }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
