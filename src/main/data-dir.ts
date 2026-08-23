import { existsSync, mkdirSync, copyFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'

import { ASSETS_DIR, DRAWINGS_DIR, INDEX_FILE, NOTES_DIR } from '@shared/paths'

export { ASSETS_DIR, DRAWINGS_DIR, INDEX_FILE, NOTES_DIR }

/**
 * Where Nib keeps user-facing data (the index, the note files, image assets).
 *
 * Default: Electron's userData folder (`%APPDATA%/nib` on Windows), so a fresh
 * install works with no setup and a distributed copy stays portable.
 *
 * Override: NIB_DATA_DIR relocates the data. That is per-machine configuration,
 * never baked into the app - the same arrangement Jot uses with JOT_DATA_DIR to
 * put the data in a synced folder that external tools can reach without Windows
 * filesystem virtualisation getting in the way.
 */
export function resolveDataDir(): string {
  const override = process.env.NIB_DATA_DIR
  if (override !== undefined && override.trim().length > 0) {
    return override.trim()
  }
  return app.getPath('userData')
}

/**
 * When NIB_DATA_DIR points somewhere that has no index yet, move the existing
 * userData contents across once. Runs on every start and is a no-op afterwards,
 * so it can never clobber newer data.
 */
export function migrateLegacyData(): void {
  const dataDir = resolveDataDir()
  const legacyDir = app.getPath('userData')

  if (dataDir === legacyDir) {
    return
  }
  if (existsSync(join(dataDir, INDEX_FILE))) {
    return
  }
  if (!existsSync(join(legacyDir, INDEX_FILE))) {
    return
  }

  try {
    mkdirSync(dataDir, { recursive: true })
    copyFileSync(join(legacyDir, INDEX_FILE), join(dataDir, INDEX_FILE))
    copyDirIfPresent(join(legacyDir, NOTES_DIR), join(dataDir, NOTES_DIR))
    copyDirIfPresent(join(legacyDir, ASSETS_DIR), join(dataDir, ASSETS_DIR))
    copyDirIfPresent(join(legacyDir, DRAWINGS_DIR), join(dataDir, DRAWINGS_DIR))
  } catch (error) {
    console.error('Failed to migrate Nib data to NIB_DATA_DIR', error)
  }
}

function copyDirIfPresent(source: string, destination: string): void {
  if (!existsSync(source)) {
    return
  }
  mkdirSync(destination, { recursive: true })
  for (const entry of readdirSync(source)) {
    const sourcePath = join(source, entry)
    const destPath = join(destination, entry)
    if (statSync(sourcePath).isDirectory()) {
      copyDirIfPresent(sourcePath, destPath)
    } else {
      copyFileSync(sourcePath, destPath)
    }
  }
}
