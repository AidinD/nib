/**
 * View preferences: the three things the design mock left adjustable.
 *
 * They live in localStorage rather than in the data directory on purpose. These
 * are per-machine display choices - how wide the column is on this screen, which
 * accent this monitor suits - not note data, and putting them in the synced
 * folder would mean one machine's window width fighting another's.
 *
 * Every window of the app shares the same origin, so a sticky window reads the
 * same values the main window wrote.
 */

export const ACCENTS = {
  blue: '#6f9cff',
  green: '#5fd0a0',
  amber: '#ffb054',
  violet: '#b98cff'
} as const

export type AccentName = keyof typeof ACCENTS

export const MEASURE_MIN = 600
export const MEASURE_MAX = 1000
export const MEASURE_STEP = 20
const MEASURE_DEFAULT = 720

/*
 * How wide the note list may be dragged.
 *
 * The floor is where a card stops being able to show a title and a crumb on one
 * line each; the ceiling is where the editor starts losing more than the list
 * gains, on a 1240px window with the sidebar beside it.
 */
export const LIST_MIN = 200
export const LIST_MAX = 560
const LIST_DEFAULT = 280

export interface Prefs {
  accent: AccentName
  /** Switches the document font to a serif face. */
  serif: boolean
  /** The editor column width in pixels. */
  measure: number
  /** The note list column width in pixels, set by dragging its edge. */
  listWidth: number
}

const KEY = 'nib.prefs'

export function readPrefs(): Prefs {
  const fallback: Prefs = {
    accent: 'blue',
    serif: false,
    measure: MEASURE_DEFAULT,
    listWidth: LIST_DEFAULT
  }
  try {
    const raw = window.localStorage.getItem(KEY)
    if (raw === null) {
      return fallback
    }
    const parsed = JSON.parse(raw) as Partial<Prefs>
    return {
      accent: parsed.accent !== undefined && parsed.accent in ACCENTS ? parsed.accent : 'blue',
      serif: parsed.serif === true,
      measure:
        typeof parsed.measure === 'number' &&
        parsed.measure >= MEASURE_MIN &&
        parsed.measure <= MEASURE_MAX
          ? parsed.measure
          : MEASURE_DEFAULT,
      // Clamped rather than trusted: the stored value outlives the window it was
      // set in, and a width that made sense on a second monitor can leave nothing
      // for the editor here.
      listWidth:
        typeof parsed.listWidth === 'number' &&
        parsed.listWidth >= LIST_MIN &&
        parsed.listWidth <= LIST_MAX
          ? parsed.listWidth
          : LIST_DEFAULT
    }
  } catch {
    // A corrupt preferences blob is not worth failing a window over.
    return fallback
  }
}

export function writePrefs(prefs: Prefs): void {
  window.localStorage.setItem(KEY, JSON.stringify(prefs))
}

/**
 * Push the preferences into the document.
 *
 * The accent is written over the `--accent` token, so everything already built
 * against it - focus rings, the drop marker, the image tag, the pressure meter -
 * follows without knowing a setting exists.
 */
export function applyPrefs(prefs: Prefs): void {
  document.documentElement.style.setProperty('--accent', ACCENTS[prefs.accent])
  document.documentElement.classList.toggle('is-serif', prefs.serif)
}
