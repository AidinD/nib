import { randomBytes } from 'crypto'
import {
  promises as fs,
  watch as watchFs,
  watchFile as watchFileFs,
  unwatchFile as unwatchFileFs
} from 'fs'
import { basename, dirname, join } from 'path'
import type {
  AlertMeta,
  Category,
  NibIndex,
  NoteDoc,
  NoteMeta,
  Scope,
  SubCategory
} from '@shared/types'
import { INDEX_FILE, NOTES_DIR } from '@shared/paths'

const MAX_WRITE_ATTEMPTS = 4

/**
 * Is this error "something else is holding the file right now", rather than a
 * real failure?
 *
 * Windows reports BOTH a locked file and a permission-denied folder as EPERM, so
 * the code alone cannot tell them apart. `targetExists` separates them: you can
 * only be fighting over a file that is already there. A folder we are not
 * allowed to write in produces the same EPERM with no file at the end of it, and
 * retrying that just delays a wrong answer.
 */
function isTransientLock(error: unknown, targetExists: boolean): boolean {
  const code = (error as NodeJS.ErrnoException | null)?.code
  if (code === 'EBUSY') {
    return true
  }
  if (code === 'EPERM' || code === 'EACCES') {
    return targetExists
  }
  return false
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Write `contents` to `filePath` atomically (temp file + rename), retrying while
 * the target is momentarily locked.
 *
 * The data directory normally lives in Dropbox, and on Windows a sync client,
 * antivirus scanner or search indexer holding the destination makes the rename
 * fail with EPERM/EBUSY. Jot lost whole writes to exactly that before it
 * retried. Two details beyond the retry matter: the temp file carries a random
 * suffix per attempt so two writers never fight over one fixed name, and it is
 * cleaned up on failure so a crashed write leaves no litter.
 */
export async function writeFileAtomic(filePath: string, contents: string): Promise<void> {
  const directoryPath = dirname(filePath)
  const targetName = basename(filePath)
  await fs.mkdir(directoryPath, { recursive: true })

  for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt++) {
    const tempPath = join(directoryPath, `.${targetName}.${randomBytes(4).toString('hex')}.tmp`)
    try {
      await fs.writeFile(tempPath, contents, 'utf-8')
      await fs.rename(tempPath, filePath)
      return
    } catch (error) {
      await fs.unlink(tempPath).catch(() => {
        // best-effort cleanup; the write already failed
      })
      const targetExists = await fs
        .access(filePath)
        .then(() => true)
        .catch(() => false)
      if (isTransientLock(error, targetExists) && attempt < MAX_WRITE_ATTEMPTS - 1) {
        await delay(60 * (attempt + 1))
        continue
      }
      throw error
    }
  }
}

const EMPTY_INDEX: NibIndex = { version: 1, categories: [] }

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function normalizeScope(value: unknown): Scope {
  return value === 'W' || value === 'P' ? value : ''
}

// Capped on both axes: the index is read on every start and rendered into a
// strip, so one pathological note must not be able to bloat it.
const MAX_ALERTS_PER_NOTE = 24
const MAX_ALERT_TEXT = 160

function normalizeAlerts(raw: unknown): AlertMeta[] {
  if (!Array.isArray(raw)) {
    return []
  }
  return raw
    .filter((entry) => entry !== null && typeof entry === 'object')
    .map((entry) => ({
      id: str((entry as { id?: unknown }).id),
      text: str((entry as { text?: unknown }).text).slice(0, MAX_ALERT_TEXT)
    }))
    .filter((alert) => alert.id.length > 0)
    .slice(0, MAX_ALERTS_PER_NOTE)
}

function normalizeSub(raw: any): SubCategory {
  return { id: String(raw?.id ?? ''), name: str(raw?.name) }
}

/**
 * `categoryId` and `subId` are normalised against the note's actual position in
 * the index rather than trusted: the index is the authority on where a note
 * lives, so a stale field copied in by an external writer must not win.
 */
function normalizeNoteMeta(raw: any, categoryId: string, subIds: Set<string>): NoteMeta {
  const created = num(raw?.created, Date.now())
  const subId = str(raw?.subId)
  return {
    id: String(raw?.id ?? ''),
    categoryId,
    subId: subId.length > 0 && subIds.has(subId) ? subId : null,
    title: str(raw?.title),
    preview: str(raw?.preview),
    created,
    edited: num(raw?.edited, created),
    pinned: raw?.pinned === true,
    tint: str(raw?.tint),
    alerts: normalizeAlerts(raw?.alerts),
    hasImage: raw?.hasImage === true,
    hasDrawing: raw?.hasDrawing === true
  }
}

function normalizeCategory(raw: any): Category {
  const id = String(raw?.id ?? '')
  const subs: SubCategory[] = Array.isArray(raw?.subs)
    ? raw.subs.map(normalizeSub).filter((s: SubCategory) => s.id.length > 0)
    : []
  const subIds = new Set(subs.map((s) => s.id))
  return {
    id,
    name: str(raw?.name),
    color: str(raw?.color, '#9a9da3'),
    scope: normalizeScope(raw?.scope),
    open: raw?.open !== false,
    subs,
    notes: Array.isArray(raw?.notes)
      ? raw.notes
          .map((n: unknown) => normalizeNoteMeta(n, id, subIds))
          .filter((n: NoteMeta) => n.id.length > 0)
      : []
  }
}

function normalizeIndex(parsed: unknown): NibIndex {
  if (parsed === null || typeof parsed !== 'object') {
    return { ...EMPTY_INDEX }
  }
  const raw = parsed as { categories?: unknown }
  return {
    version: 1,
    categories: Array.isArray(raw.categories)
      ? raw.categories.map(normalizeCategory).filter((c) => c.id.length > 0)
      : []
  }
}

/**
 * The storage layer: an index file for ordering and metadata, one file per note
 * for the bodies.
 *
 * One file per note is what makes embedded images survivable (see DECISIONS
 * 2026-08-19) and what keeps a synced folder happy: editing one note touches one
 * file, so two machines editing different notes never collide.
 *
 * The index is the exception - it is one shared file, and every reorder, rename
 * or metadata change rewrites it. It stays small because it holds no bodies, and
 * writes to it are serialised through a one-slot chain so two saves in flight can
 * never interleave.
 */
export class NoteStorage {
  private readonly dataDir: string
  private readonly indexPath: string
  private readonly notesDir: string
  private indexWrite: Promise<void> = Promise.resolve()

  constructor(dataDir: string) {
    this.dataDir = dataDir
    this.indexPath = join(dataDir, INDEX_FILE)
    this.notesDir = join(dataDir, NOTES_DIR)
  }

  get directory(): string {
    return this.dataDir
  }

  private notePath(id: string): string {
    // Ids are generated by us, but this builds a path out of renderer input, so
    // anything that could escape the notes folder is rejected outright.
    if (!/^[A-Za-z0-9_-]+$/.test(id)) {
      throw new Error(`Refusing to touch a note file for an unsafe id: ${id}`)
    }
    return join(this.notesDir, `${id}.json`)
  }

  async loadIndex(): Promise<NibIndex> {
    try {
      const raw = await fs.readFile(this.indexPath, 'utf-8')
      return normalizeIndex(JSON.parse(raw.replace(/^﻿/, '')))
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'ENOENT') {
        return { ...EMPTY_INDEX }
      }
      throw error
    }
  }

  /**
   * Serialised against itself: whatever the renderer sends last wins, and two
   * saves in flight can never interleave their writes.
   */
  async saveIndex(index: NibIndex): Promise<void> {
    const run = this.indexWrite.then(() =>
      writeFileAtomic(this.indexPath, JSON.stringify(normalizeIndex(index), null, 2))
    )
    // The stored chain swallows failures so one bad write does not poison every
    // later one; the promise returned to the caller still rejects.
    this.indexWrite = run.catch(() => undefined)
    await run
  }

  async readNote(id: string): Promise<NoteDoc | null> {
    try {
      const raw = await fs.readFile(this.notePath(id), 'utf-8')
      const parsed = JSON.parse(raw.replace(/^﻿/, '')) as Partial<NoteDoc>
      const created = num(parsed.created, Date.now())
      const subId = str(parsed.subId)
      return {
        id,
        categoryId: str(parsed.categoryId),
        subId: subId.length > 0 ? subId : null,
        title: str(parsed.title),
        html: str(parsed.html),
        created,
        edited: num(parsed.edited, created)
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null
      }
      throw error
    }
  }

  async writeNote(doc: NoteDoc): Promise<void> {
    await writeFileAtomic(this.notePath(doc.id), JSON.stringify(doc, null, 2))
  }

  /** Deleting a note with no file on disk is a success, not an error. */
  async deleteNote(id: string): Promise<void> {
    await fs.unlink(this.notePath(id)).catch((error) => {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error
      }
    })
  }

  /**
   * Watch the index for changes made outside this process - another machine's
   * Dropbox sync, or an external tool writing the file.
   *
   * Both mechanisms are needed. fs.watch is event-driven and fast but drops
   * events on Windows and in synced folders, exactly for the atomic tmp+rename
   * writes this module makes. fs.watchFile stat-polls and therefore never
   * misses. They funnel through one debounce so a burst produces one reload.
   */
  watchIndex(onChange: () => void): () => void {
    let closed = false
    let debounceTimer: NodeJS.Timeout | null = null

    const trigger = (): void => {
      if (closed) {
        return
      }
      if (debounceTimer !== null) {
        clearTimeout(debounceTimer)
      }
      debounceTimer = setTimeout(() => {
        debounceTimer = null
        onChange()
      }, 150)
    }

    void fs.mkdir(this.dataDir, { recursive: true }).catch((error) => {
      console.error('Failed to prepare the Nib data directory', error)
    })

    const targetFile = basename(this.indexPath)
    let watcher: ReturnType<typeof watchFs> | null = null
    try {
      watcher = watchFs(this.dataDir, (_event, filename) => {
        if (filename !== undefined && filename !== null && String(filename) !== targetFile) {
          return
        }
        trigger()
      })
    } catch (error) {
      // Non-fatal: the poll below still catches every change.
      console.error('Failed to start fs.watch on the Nib data directory', error)
      watcher = null
    }

    watchFileFs(this.indexPath, { interval: 1000 }, (curr, prev) => {
      if (curr.mtimeMs !== prev.mtimeMs || curr.size !== prev.size) {
        trigger()
      }
    })

    return () => {
      closed = true
      if (debounceTimer !== null) {
        clearTimeout(debounceTimer)
        debounceTimer = null
      }
      if (watcher !== null) {
        watcher.close()
      }
      unwatchFileFs(this.indexPath)
    }
  }
}
