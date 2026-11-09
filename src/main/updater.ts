/**
 * Keeping the installed app current: when it looks for a newer release, what it
 * says when it has one, and a log that says what happened.
 *
 * What it exists to achieve: Nib is left open all day, often for days. The first
 * version checked GitHub once, at launch, downloaded in the background and
 * installed on quit - which is correct and invisible, and so a release published
 * while the app was open reached nobody until they happened to quit it. "Nib is
 * not auto-updating" was exactly that: the updater worked (the installer was in
 * the cache, byte for byte the size `latest.yml` promised) and the person had no
 * reason to know, because nothing was ever shown and nothing was ever written down.
 *
 * So three things changed. It checks again every hour, so an app that has been
 * open since before a release still finds it. It tells the renderer when an update
 * is downloaded, which shows a strip with a Restart button. And it writes a log
 * beside the app's other files, because the updater's default logger is the
 * console, and a packaged app has no console to read afterwards.
 *
 * Install-on-quit stays as the fallback: someone who ignores the strip still
 * gets the update the next time the app closes.
 *
 * Rejected: restarting by itself when the download lands. The app may be
 * recording a meeting, and a window that vanishes under someone is worse than a
 * strip they dismiss. Rejected: electron-log, a dependency for one file append.
 */

import { appendFileSync, readFileSync, statSync, writeFileSync } from 'fs'
import { join } from 'path'
import { app, BrowserWindow } from 'electron'
// electron-updater is CommonJS, so a named ESM import does not work here - the
// default export is the module and the pieces are destructured off it.
import electronUpdater from 'electron-updater'

const { autoUpdater } = electronUpdater

/** How often an app that stays open asks again. GitHub's release feed is not rate limited. */
const CHECK_EVERY_MS = 60 * 60 * 1000

/** The log is trimmed to its newer half when it passes this. */
const MAX_LOG_BYTES = 200 * 1024

/** The version that has been downloaded and is waiting for a restart, if any. */
let downloaded: string | null = null

function logPath(): string {
  return join(app.getPath('userData'), 'updater.log')
}

function write(level: string, message: unknown): void {
  const text = message instanceof Error ? (message.stack ?? message.message) : String(message)
  try {
    appendFileSync(logPath(), `${new Date().toISOString()} ${level} ${text}\n`)
  } catch {
    // A log that cannot be written must never take the app down with it.
  }
}

/** Cut the log to its last half, so it cannot grow for ever. Once, at start. */
function trimLog(): void {
  try {
    if (statSync(logPath()).size > MAX_LOG_BYTES) {
      const text = readFileSync(logPath(), 'utf-8')
      writeFileSync(logPath(), text.slice(Math.floor(text.length / 2)))
    }
  } catch {
    // No log yet.
  }
}

/** The version waiting for a restart, for a window that opened after the download. */
export function pendingUpdate(): string | null {
  return downloaded
}

/**
 * Restart into the downloaded update.
 *
 * Silent and run-after, which the library's default is not: the default shows the
 * installer's wizard and leaves the app closed, and for someone who clicked a
 * button called "Restart" both are wrong.
 */
export function installUpdateNow(): void {
  if (downloaded !== null) {
    write('info', `restarting to install ${downloaded}`)
    autoUpdater.quitAndInstall(true, true)
  }
}

function check(): void {
  autoUpdater.checkForUpdates().catch((error) => write('error', error))
}

/**
 * Start checking: now, and then every hour until an update has been downloaded.
 * A no-op in development, where there is no installed app to replace and the check
 * only produces a confusing error.
 */
export function startUpdateChecks(): void {
  if (!app.isPackaged) {
    return
  }
  trimLog()
  write('info', `Nib ${app.getVersion()} starting update checks`)

  autoUpdater.logger = {
    info: (message) => write('info', message),
    warn: (message) => write('warn', message),
    error: (message) => write('error', message),
    debug: (message) => write('debug', message)
  }

  autoUpdater.on('update-available', (info) => write('info', `update available: ${info.version}`))
  autoUpdater.on('update-not-available', () => write('info', 'up to date'))
  autoUpdater.on('error', (error) => write('error', error))
  autoUpdater.on('update-downloaded', (info) => {
    downloaded = info.version
    write('info', `update ${info.version} downloaded; waiting for a restart or a quit`)
    clearInterval(timer)
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) {
        window.webContents.send('update:ready', info.version)
      }
    }
  })

  check()
  const timer = setInterval(check, CHECK_EVERY_MS)
}
