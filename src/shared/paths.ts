/**
 * The layout of the data directory. Shared rather than owned by the main
 * process so the storage layer carries no Electron dependency - the same split
 * Jot's core makes, and what lets the storage code be exercised on its own.
 */

/** Ordering and metadata for every note. Holds no note bodies. */
export const INDEX_FILE = 'index.json'
/** One file per note, named `<noteId>.json`. */
export const NOTES_DIR = 'notes'
/** Content-addressed images pasted into notes, and rendered drawings. */
export const ASSETS_DIR = 'assets'
/** One file per drawing, named `<drawingId>.json`, holding its strokes. */
export const DRAWINGS_DIR = 'drawings'
