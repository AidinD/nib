# Nib - plan

Last reconciled: 2026-08-21 (second pass).

## Status

**The app runs, and everything in the first version's scope is built and
exercised.** Notes survive restarts, images are pasted into the document and keep
their size, drag and drop moves and reorders, and pinning a note opens a sticky
window bound to the same file.

Everything below was verified by driving the built app against a seeded data
directory - clicking, dragging, pasting a real image from the clipboard, and
reading the files back off disk afterwards.

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
| Paste images directly into the document, not as attachments | Done - verified with a real clipboard paste |
| Sub-categories, e.g. `Manager meeting > February > note` | Done |
| Sticky notes | Done - a window per pinned note |
| Canvas drawing with a pressure-sensitive stylus (stretch goal) | Not started |
| **Alerts** - mark a note as an action point and see them in one "needs you" view | Done - block-level flags, a strip and a review row |

Alerts arrived in the Jot task list after the design spec was written, so the spec
does not cover them; the design is recorded in DECISIONS instead. A flag sits on a
block inside a note, a note counts as flagged when it holds one, and the flags
show up in two places: an ambient strip under the header and a "Needs you" row in
the sidebar for working through them.

## Built so far

- **Scaffold** mirroring Jot: Electron + electron-vite + React + TypeScript, `src/main`, `src/preload`, `src/renderer`, `src/shared`, electron-builder for a Windows NSIS build.
- **Storage** in [src/main/storage.ts](src/main/storage.ts): `index.json` for ordering and metadata, `notes/<id>.json` per note body, atomic writes with the Dropbox/antivirus retry Jot needed, index writes serialised, and an external-change watch (event-driven plus a poll, because `fs.watch` drops the atomic renames).
- **Data directory** in [src/main/data-dir.ts](src/main/data-dir.ts): `userData` by default, `NIB_DATA_DIR` to relocate, one-time migration across.
- **Main window**: header with wordmark, version, search and a measure slider; 210px sidebar with smart rows, the scope filter, categories, sub-categories, inline rename and the dashed add fields; 280px note list with previews, crumbs, relative times, pin and delete; the editor panel with the toolbar, title, metadata row and the document body.
- **Editor**: headings, body, bold/italic/underline/strike, inline code, bullet and numbered lists, quote, divider, image insert, 600ms debounced autosave with a Saved/Saving indicator, `Ctrl+Enter` to save now, `Ctrl+Shift+8` for a bullet list, paste and drop of images, and the floating Smaller/Larger/Remove toolbar on a selected image.
- **Sticky windows**: 280x320, frameless, always on top, tint swatches, editable in place, footer trail. Bound to the pinned note, editing the same file the main window edits.
- **Settings**: a popover in the header for the accent colour, the serif body and the measure - the three things the mock left adjustable. Per machine, not synced.
- **Alerts**: an `Alert` button flags the block the caret is in; the strip under the header lists them across every note and jumps to the exact line, flashing it on arrival; the "Needs you" sidebar row lists the notes with their flagged lines.
- **Drag and drop** on the native API: notes reorder within a category, categories reorder against each other, and a note dropped on a sub-category or category row moves there. The insertion marker is the spec's 3px inset accent bar with its glow, not a hairline - Jot's own CSS records why.

## Verified against the running app

- **Images.** A real clipboard paste is written to `assets/<sha256>.png`, referenced through `nib-asset://`, and rendered. Resizing it persists and survives a restart - which is where a real bug was found: the size was being sanitised away on save. See DECISIONS.
- **Drag and drop.** A note dropped on a sub-category row moves into it, a note dropped on a category row leaves its sub-category, cards reorder within a category, and categories reorder against each other. Each one checked in `index.json` afterwards, not just on screen.
- **Two windows on one note.** Typing in a sticky window shows up in the main window's editor, and vice versa, as soon as the window being typed into is not the one you are looking at.
- **The `NIB_DATA_DIR` migration.** Pointed at an empty folder with data in `userData`, the index, the note files and the assets all moved across on first start.
- **Alerts.** Flagging a heading wrote `data-alert` and an id into the note file and an entry into the index; the strip and the "Needs you" row both appeared; the chip jumped back to the flagged block.

## Next steps

1. The canvas block, plus the storage decision it depends on. This is the last thing on the original requirement list.
2. A sweep for unreferenced assets, once there is a reason to care - see the open question.
3. Worth considering once alerts have been lived with: clearing a flag from the strip itself, and whether a flagged block should be able to carry a deadline the way a Jot todo does.

Everything else in the first version's scope is done: the three panes, the
sidebar, the editor, persistence, inline images, sticky windows, drag and drop,
and the mock's three adjustable settings. Sticky windows now also come back on
start for notes that are still pinned.

## Open questions

- **How is a drawing stored inside a note?** Stroke data keeps it editable and small; a rendered image makes it portable. Probably both, but it is a decision for when the canvas is built.
- **Do deleted notes leave their images behind?** Assets are content-addressed and shared between notes, so deleting a note cannot simply delete its images. A sweep that drops unreferenced assets is the obvious answer and is not built.
- **Does anything move between Jot and Nib?** Turning a note into a todo, or attaching a note to a todo. Not planned yet.

Settled: the name, the separate-app question, the storage format and location, the
sub-category depth, the whole visual design, and - as of this session - where
images live and how the two window types share one renderer bundle.
See [DECISIONS.md](DECISIONS.md).
