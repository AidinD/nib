import { createHash } from 'crypto'
import { promises as fs } from 'fs'
import { join, normalize, sep } from 'path'
import { pathToFileURL } from 'url'
import { app, BrowserWindow, ipcMain, net, protocol } from 'electron'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import type { DrawingDoc, NibIndex, NoteDoc } from '@shared/types'
import { ASSETS_DIR, migrateLegacyData, resolveDataDir } from './data-dir'
import { NoteStorage } from './storage'
import { allWindows, closeStickyWindow, createMainWindow, openStickyWindow } from './windows'

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
  })

  ipcMain.handle('note:read', (_event, id: string) => store().readNote(id))
  ipcMain.handle('note:write', async (_event, doc: NoteDoc) => {
    const edited = Date.now()
    await store().writeNote({ ...doc, edited })
    return edited
  })
  ipcMain.handle('note:delete', (_event, id: string) => store().deleteNote(id))

  ipcMain.handle('drawing:read', (_event, id: string) => store().readDrawing(id))
  ipcMain.handle('drawing:write', (_event, doc: DrawingDoc) => store().writeDrawing(doc))
  ipcMain.handle('drawing:delete', (_event, id: string) => store().deleteDrawing(id))

  ipcMain.handle('asset:write', (_event, dataUrl: string) => writeAsset(dataUrl))

  ipcMain.handle('sticky:open', (_event, noteId: string) => {
    openStickyWindow(noteId)
  })
  ipcMain.handle('sticky:close', (_event, noteId: string) => {
    closeStickyWindow(noteId)
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

  app.on('browser-window-created', (_event, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  createMainWindow()

  // Pinning a note is what produces its sticky window, and a pin outlives a
  // restart - so the windows have to come back with it, or a pinned note would
  // quietly stop being sticky until it was toggled again.
  void store()
    .loadIndex()
    .then((index) => {
      for (const category of index.categories) {
        for (const note of category.notes) {
          if (note.pinned) {
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

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
