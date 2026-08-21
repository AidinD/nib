# Nib - plan

Last reconciled: 2026-08-21.

## Status

**The app runs.** The scaffold, the storage layer and the three-pane main window
are in place, notes survive a restart, and pinning a note opens a real sticky
window bound to the same note file.

Verified by running the built app against a seeded data directory: the sidebar,
the note list, the editor and a sticky window were all exercised on screen. What
has *not* been exercised end to end yet is listed under "Not verified" below.

## What Nib is

A desktop note-taking app that sits beside Jot rather than inside it.
Jot holds todos; Nib holds notes.
Same feel, same local-first approach, separate app and separate data.

## Requirements

From the author's own list, with where each one stands.

| Requirement | State |
| --- | --- |
| Same shape as Jot, with the list on the left | Done - three panes, Jot's tokens |
| Real formatting (headings, emphasis, lists, quotes, code) | Done |
| Paste images directly into the document, not as attachments | Built, not yet exercised on a real paste |
| Sub-categories, e.g. `Manager meeting > February > note` | Done |
| Sticky notes | Done - a window per pinned note |
| Canvas drawing with a pressure-sensitive stylus (stretch goal) | Not started |
| **Alerts** - mark a note as an action point and see them in one "needs you" view | Not started; new since the design spec |

The Alerts requirement arrived in the Jot task list after the design spec was
written, so the spec does not cover it. It needs a design decision before it is
built: what carries the flag (a note, or a block inside a note), and whether the
view is a fourth smart row or something else.

## Built so far

- **Scaffold** mirroring Jot: Electron + electron-vite + React + TypeScript, `src/main`, `src/preload`, `src/renderer`, `src/shared`, electron-builder for a Windows NSIS build.
- **Storage** in [src/main/storage.ts](src/main/storage.ts): `index.json` for ordering and metadata, `notes/<id>.json` per note body, atomic writes with the Dropbox/antivirus retry Jot needed, index writes serialised, and an external-change watch (event-driven plus a poll, because `fs.watch` drops the atomic renames).
- **Data directory** in [src/main/data-dir.ts](src/main/data-dir.ts): `userData` by default, `NIB_DATA_DIR` to relocate, one-time migration across.
- **Main window**: header with wordmark, version, search and a measure slider; 210px sidebar with smart rows, the scope filter, categories, sub-categories, inline rename and the dashed add fields; 280px note list with previews, crumbs, relative times, pin and delete; the editor panel with the toolbar, title, metadata row and the document body.
- **Editor**: headings, body, bold/italic/underline/strike, inline code, bullet and numbered lists, quote, divider, image insert, 600ms debounced autosave with a Saved/Saving indicator, `Ctrl+Enter` to save now, `Ctrl+Shift+8` for a bullet list, paste and drop of images, and the floating Smaller/Larger/Remove toolbar on a selected image.
- **Sticky windows**: 280x320, frameless, always on top, tint swatches, editable in place, footer trail. Bound to the pinned note, editing the same file the main window edits.

## Not verified

Worth a pass before this is called finished:

- Pasting a real image, and what a stored asset looks like on disk afterwards.
- Two windows editing the same note at once (main window and its sticky).
- The `NIB_DATA_DIR` migration path, which has only been read, not run.

## Next steps

1. Drag and drop: reorder categories and notes, and move a note by dropping it on a category or sub-category row. The spec's insertion marker (3px accent bar, inset, rounded, glowing) is not built yet.
2. Exercise the image path for real, then decide whether the asset folder needs a garbage collection pass when notes are deleted.
3. Decide and build **Alerts**, since it is the one requirement with no design behind it.
4. The canvas block, plus the storage decision it depends on.
5. The remaining spec settings: accent colour and the serif body switch. The measure slider is built.

## Open questions

- **How is a drawing stored inside a note?** Stroke data keeps it editable and small; a rendered image makes it portable. Probably both, but it is a decision for when the canvas is built.
- **What does an Alert attach to?** A whole note is the simple answer and matches the note list; a block inside a note matches how the requirement was written ("mark a subtitle as an alert").
- **Do deleted notes leave their images behind?** Assets are content-addressed and shared between notes, so deleting a note cannot simply delete its images. A sweep that drops unreferenced assets is the obvious answer and is not built.
- **Does anything move between Jot and Nib?** Turning a note into a todo, or attaching a note to a todo. Not planned yet.

Settled: the name, the separate-app question, the storage format and location, the
sub-category depth, the whole visual design, and - as of this session - where
images live and how the two window types share one renderer bundle.
See [DECISIONS.md](DECISIONS.md).
