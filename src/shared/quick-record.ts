/*
 * Quick record: a recording started from anywhere, with Ctrl+Alt+,.
 *
 * The sibling of Jot's quick capture (Ctrl+Alt+.), one key to the left. The key
 * opens a small prompt, an optional name and Enter start a recording, and the
 * recording goes into a new note in the Inbox folder - to be moved to where it
 * belongs afterwards, with the card's drag or the recording's own Move. See
 * DECISIONS 2026-11-27.
 *
 * Pure, so `npm test` reaches it without an app.
 */

import type { NibIndex } from './types'
import { today } from './templates.ts'

/**
 * The global hotkey, as Electron spells it.
 *
 * On a Swedish keyboard Ctrl+Alt is AltGr, so the hotkey takes AltGr+, with it
 * system-wide. That is safe because AltGr+, types nothing on that layout - the
 * comma key has no third character - unlike AltGr+2..0, +, < and ¨, which are
 * @ £ $ € { [ ] } \ | ~ and must never be taken.
 */
export const QUICK_ACCELERATOR = 'Control+Alt+,'

/** The same key, as it is shown to a person. */
export const QUICK_KEY_LABEL = 'Ctrl+Alt+,'

/**
 * The folder quick recordings land in.
 *
 * An ordinary folder, made the first time it is needed and found again by name.
 * Renamed or deleted, the next quick recording simply makes a new one: the name
 * is the whole contract, and there is no hidden id for it to drift from.
 */
export const INBOX_NAME = 'Inbox'

/** The Inbox folder's id, or null when the notebook has none yet. */
export function findInbox(index: NibIndex): string | null {
  const wanted = INBOX_NAME.toLocaleLowerCase()
  const found = index.categories.find(
    (category) => category.name.trim().toLocaleLowerCase() === wanted
  )
  return found?.id ?? null
}

/**
 * What a quick recording's note is called.
 *
 * The typed name when there is one. Without, the date and the minute - not the
 * date alone as an untitled note gets, because two recordings in one day are the
 * ordinary case here and the cards in the Inbox would otherwise be twins.
 */
export function quickTitle(typed: string, now: number = Date.now()): string {
  const wanted = typed.trim()
  if (wanted.length > 0) {
    return wanted
  }
  const d = new Date(now)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${today(now)} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** What the prompt is asked to do. */
export interface QuickStart {
  name: string
}

/** What the main window answers. */
export type QuickResult = { ok: true; noteId: string; title: string } | { ok: false; error: string }

/** What the prompt shows when it opens. */
export interface QuickState {
  /** The running recording, or null when nothing is recording. */
  recording: { title: string; seconds: number } | null
  /** Whether the hotkey itself is registered - false means somebody else has it. */
  registered: boolean
}
