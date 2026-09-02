# Nib - plan

Last reconciled: 2026-08-24 (fifth pass, after the first round of writing in it for real).

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
| Canvas drawing with a pressure-sensitive stylus (stretch goal) | Done - drawn, stored and shown; not yet tried with a real stylus |
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
- **Main window**: header with wordmark, version and a search field - `Ctrl+Shift+F` reaches it from anywhere in the window, Escape or its × clears it; 210px sidebar with smart rows, the scope filter, categories, sub-categories, inline rename and the dashed add fields; 280px note list with previews, crumbs, relative times, pin and delete; the editor panel with the toolbar, title, metadata row and the document body.
- **Editor**: headings, body, bold/italic/underline/strike, inline code, bullet and numbered lists, quote, divider, image insert, 600ms debounced autosave with a Saved/Saving indicator, `Ctrl+Enter` to save now, `Ctrl+Shift+8` for a bullet list, paste and drop of images, and the floating Smaller/Larger/Remove toolbar on a selected image.
- **Sticky windows**: 280x320, frameless, always on top, tint swatches, editable in place, footer trail. Bound to the pinned note, editing the same file the main window edits.
- **Archive** in [selection.ts](src/renderer/src/lib/selection.ts): an `archived` flag on the note, filtered out in `allNotes` so the lists, the counts and the alert strip all drop it at once, plus an Archive smart row that appears only when there is something in it and an archive/restore action on every card. Archiving lets go of the pin. Search leaves the archive alone until a line above the cards - offered only when the archive actually holds matches the search is not showing - is clicked. Categories and sub-categories are unchanged: they delete.
- **Settings**: a popover in the header for the accent colour, the serif body and the measure - the three things the mock left adjustable. Per machine, not synced.
- **Housekeeping**: images and drawings nothing refers to any more are swept from disk a few seconds after writing stops and once at startup, with a ten-minute grace period so a fresh paste is never mistaken for an orphan.
- **An installer**: `npm run package` produces a Windows NSIS installer under `dist/`, per-user and unsigned, with a generated app icon in `resources/`.
- **Canvas**: a drawing is a block inside a note. `Canvas` inserts one, clicking it opens the surface over the document - pen, highlighter and eraser, a 1-18 width slider, six inks, a live pressure readout and meter, undo and redo by whole stroke. Strokes go to their own file, a PNG cropped to the ink goes to the assets folder, and the block shows it as a 170px thumbnail.
- **Alerts**, at two levels. Every line has a flag in the document's left column - faint on hover, orange once flagged, grey once dealt with - and clicking it cycles the three states; `Ctrl+Shift+A` does the same from the keyboard, and flags the whole note when the caret is in no line. A card carries the same flag on hover, with the same three states, and a dealt-with card stays in the review list rather than vanishing from under the pointer. The strip under the header lists everything outstanding and jumps to the exact line, flashing it on arrival; the "Needs you" row is the review list, with the same box beside each line.
- **Confirmations**: deleting a note, a category or a sub-category asks first, in the app's own dialog, with a message that says what goes with it.
- **Drag and drop in every list**: dropping a card in a flat list - All notes, Recent, Needs you - moves the note to wherever the card it landed on lives. Only a category's own list can reorder freely, because that is the only place an order is stored.
- **A test harness** in [scripts/e2e.mjs](scripts/e2e.mjs): drives the renderer over the DevTools protocol instead of the pointer.
- **Drag and drop** on the native API: notes reorder within a category, categories reorder against each other, and a note dropped on a sub-category or category row moves there. The insertion marker is the spec's 3px inset accent bar with its glow, not a hairline - Jot's own CSS records why.

## Verified against the running app

- **Images.** A real clipboard paste is written to `assets/<sha256>.png`, referenced through `nib-asset://`, and rendered. Resizing it persists and survives a restart - which is where a real bug was found: the size was being sanitised away on save. See DECISIONS.
- **Drag and drop.** A note dropped on a sub-category row moves into it, a note dropped on a category row leaves its sub-category, cards reorder within a category, and categories reorder against each other. Each one checked in `index.json` afterwards, not just on screen.
- **Two windows on one note.** Typing in a sticky window shows up in the main window's editor, and vice versa, as soon as the window being typed into is not the one you are looking at.
- **The `NIB_DATA_DIR` migration.** Pointed at an empty folder with data in `userData`, the index, the note files and the assets all moved across on first start.
- **This round, through the harness.** No standing sub-category fields and a `+` on each category row; a card's delete cross hidden until hover and a delete that goes through; flag markers orange when open, grey when done, absent on empty lines; a `work` tag beside the `private` one; and a ticked-off card that stays in the review list as done.
- **Moments, this round.** A seeded note holding a labelled transcript, a marked
  line and a pasted screenshot was opened in the built app: the timestamps are put
  back on load (they are not stored), the speaker labels survive the sanitiser,
  and clicking a timestamp opens the folded transcript and lands on the last line
  at or before it - `1:05` on the `01:00` line, `0:42` on the `00:40` one. The
  highlight fades on its own.
- **The stereo capture graph**, in the renderer that will run it, with two
  oscillators standing in for the two captures: the processor sees two channels
  and the interleaved output comes back with peaks of 0.9 and 0.3, matching the
  two sources rather than a sum of them.
- **The labels themselves**, through keel against a real stereo file: 23 segments,
  the label turning over at the seam, `speaker ?` on the segment lying across it,
  and the prefix stripped out of the words rather than left in them.
- **The toolbar.** Selecting a line and pressing `B` now bolds it, and the tag is in the saved file - it did nothing at all before, for every formatting button.
- **Alerts.** Hovering the document showed the markers; clicking one flagged its line, clicking a flagged one wrote `data-alert="done"` to the note file and dimmed the line while keeping it marked.
- **Confirmations.** Deleting a note opens the app's own dialog naming the note, with Cancel focused.
- **Sticky windows.** Closing one set its note's `pinned` back to false in the index, so the card stops claiming to be sticky.
- **The sweep.** With an orphaned image planted in the assets folder and back-dated, a start of the app removed it, along with a superseded drawing render and an orphaned drawing file - and left every referenced file alone.
- **The packaged build.** `npm run package` produced `dist/Nib Setup 0.1.0.exe`, and the unpacked build started and opened its window.
- **The canvas.** Drawing with a mouse, switching tools, undoing a stroke and closing it wrote the strokes to `drawings/<id>.json` and a cropped PNG to the assets folder, and the block came back as a thumbnail. Reopening the drawing kept the strokes and let more be added. Closing an untouched canvas removed its block.
- **Alerts.** Flagging a heading wrote `data-alert` and an id into the note file and an entry into the index; the strip and the "Needs you" row both appeared; the chip jumped back to the flagged block.
- **Searching with an archive.** A search showed only the live note and said nothing about the archive; a search the archive could not help with offered nothing at all; the offered line named the count, brought the archived match in on one click with an `archived` tag on it, took it out again, and reset itself when the search was cleared.
- **Archiving.** A pinned, flagged note carrying a block alert left every list, every count and the alert strip; the Archive row appeared; the pin was let go and did not come back on restore; the round trip reached `index.json`. An index planted with `archived` and `pinned` both true - which only a sync can produce - opened no sticky window.
- **The delete confirmation.** Four fixture categories through the harness - subs and loose notes, one of each for the singular wording, no subs, and empty - each naming exactly what it holds; then a real delete, with the sub-categories gone from the sidebar and the note files, including the ones inside subs, gone from disk.

## Next steps

Every requirement on the original list is now built. What is left is smaller:

1. **Try the canvas with a real stylus.** The pressure curve, the per-tool nibs and the palm rejection are all implemented, but this machine has only a mouse - which reports a constant 0.5 - so none of the pressure behaviour has been seen for real.
2. The `Select` tool the design spec lists in the canvas strip is not built. Pen, highlighter and eraser are. A dead button seemed worse than a missing one.
3. Worth considering once alerts have been lived with: whether a flagged block should carry a deadline the way a Jot todo does.
4. **Editing is the part that use keeps finding faults in**, and they are the faults that matter most, since writing is what the app is for. Fixed so far: markdown shortcuts and a `/` menu (0.4.0), then Enter in a list, the flag column beside bullets, the divider leaving text in no block at all, and the slash menu missing a non-breaking space (0.4.1). Anything else in this area is worth fixing before new features.
5. **Links between notes are in (0.5.0), and so are backlinks.** `/link`, a search
   over the notebook, a click that navigates, labels kept in step with titles,
   and a "Mentioned in N notes" footnote showing what points AT a note. Use found
   the footnote's limit before it found anything else: on a hub note that lists a
   dozen others it took 58% of the editor and could not be put away, so it now
   folds from its own heading and the fold is remembered as a view preference.
   What is still not built is any view of the graph itself, which only becomes
   worth it if the linking gets much denser than it is.
6. **Transcription is the open thread, after the first real meeting.** It came
   back about nine tenths right, with some words heard as entirely different
   ones. The audio is kept now rather than deleted the moment the transcript
   appears, so a run can be done again - that part is built and verified.
   The engine is settled too: KBLab's `large` is installed as the Swedish model
   as of 2026-08-31, measured against `small` on a real clip rather than on a
   benchmark - 6.3x real time against 10.5x, and small was the one inventing
   proper nouns out of phrases it could not hear. See DECISIONS. What is still
   not built are the two things that bear more directly on names than the model
   does: `--prompt` with a word list, which nothing passes today, and `--vad`,
   which is off. The worry about `--vad` is smaller than this file used to claim:
   fed 93 seconds of a dead capture on 2026-09-01, the Swedish model returned
   empty segments labelled `speaker ?` rather than inventing sentences. Real room
   noise is still untested.
   **Two things landed on top of it on 2026-08-31**, both verified in the running
   app:
   - **The transcript says who spoke.** A meeting is captured as two channels -
     microphone left, the machine's own output right - and whisper's `-di` labels
     each segment by which channel was louder. Eighteen percent slower, not
     double; the file doubles. Names come from the note's folder. Telling one
     person from another *within* the far side is deliberately not built - see
     DECISIONS.
   - **Screenshots and lines remember when they happened.** Anything pasted or
     marked while a recording runs carries the offset in seconds, shows a
     timestamp that jumps into the transcript, and is threaded into what the
     summary reads. Nothing is written into the audio file.
   **A real meeting has now been through it**, on 0.12.0: 53 minutes of an
   English company meeting, captured stereo, 746 segments, nine turns. The
   labels are corroborated by the content rather than taken on trust - the
   transcript has somebody asking the author by name how long he needs, the next
   segment labelled as his answering "perhaps 10 minutes", a handover four
   minutes later, and then a 150-segment run labelled as his that lasts nine
   minutes fifty-eight. Not one segment came back as `?`, which says the channel
   margin is wide: on speakers, the microphone's pickup of the far side is
   nowhere near loud enough to compete with the same audio taken straight off the
   machine. That is the question `echoCancellation` was left off over, answered.
   203MB for the 53 minutes - 3.84MB a minute, against the 3.8 estimated.

   What it also showed is that the English model hears the author's own name as a
   different name throughout, which is the case `--prompt` with a word list
   exists for and nothing passes one today.

   **Moments have now been used in a real meeting**, on 0.13.0: nine screenshots
   marked across a 30-minute call, every one carrying the right offset and the
   right file, from 2:51 to 24:40.
   The feature works. What it exposed is where the recording ended up - below all
   nine of them, because the block was appended at the end of the document - so a
   note whose point is the meeting opened on a stack of images. The block now goes
   to the top, under a summary if there is one. See DECISIONS for why the
   obvious version of that rule is wrong when there are two recordings.

   **A third thing landed on 2026-09-01, from the second real meeting: the
   recording offers to stop where the call did.** That meeting ran 19 minutes for
   a 14-minute call - Stop was forgotten, and what the note ended up holding was
   five minutes of a different conversation, transcribed and filed under the
   manager meeting. Twice out of two real meetings the mistake has been the
   stopping, not the recording.

   The file can answer it: when a call drops, both streams stop delivering at the
   same instant, and that is not something a live capture produces. `findCallEnd`
   looks for it and the block offers to trim, audio and transcript together,
   after asking. Verified against both real recordings on this machine - it found
   14:10 on the one that needed it and stayed quiet on the 53-minute one that did
   not - and end to end in the running app. See DECISIONS.

   What it does NOT cover is the recording that runs on with the call still up:
   somebody stays on the line, so there is no dead stretch and nothing to find.
   Nothing detects that, and probably nothing should.

   **A summary no longer flags its own action points**, as of 2026-09-01. A
   meeting's used to; a note's already did not. A flagged line is an open promise
   in the index and therefore in Tend, so what the old behaviour did was hand you
   a list of commitments the model chose, before you had read it. They are listed
   instead, and the control under the list flags all of them in one click, or one
   gutter click does a single line. Summaries written under the old rule keep
   their flags and gain the control they never had. Verified through the running
   app in both directions, as far as `index.json`. See DECISIONS.

   **And the same mistake by another route, found the same day.** A real note came
   back with the heading `Sammanfattning` itself flagged, so the index held an
   action point whose text was the first 160 characters of the summary. Nothing
   sets that automatically - the gutter runs the full height of the left margin and
   a heading is a valid target in it, so a stray click level with the summary's
   first line flags the summary, and the three-state cycle turns the attempt to
   undo it into a green tick. A summary's own headings are no longer flaggable;
   clearing one that already is stays possible, or the fix would strand the note
   that reported it.

   **The summary now also answers the questions the note came with**, as of
   2026-09-02, ahead of a day of 1-1s. A templated note already holds the
   questions you meant to ask - the 1-1 template is six headings and eight prompt
   lines - and summarising a recording of that conversation used to leave every
   one of them blank while writing four sections of its own at the top. It now
   answers the ones the conversation answered, each under its own prompt line and
   below anything you typed there yourself. The summary block is unchanged; this
   is in addition to it.

   The unit is the LINE and that is the whole design: a prompt in that template
   holds two questions and has one place for an answer, and one heading can hold
   two prompt lines because the fortnightly rotation writes both weeks into the
   note. Keying on the heading or splitting on the question mark both produce
   answers in the wrong shape. Verified with a real Haiku call against the shipped
   template: six of eight answered, the two nobody reached left alone, both
   rotation weeks answered separately. See DECISIONS.

   Untested by a real meeting yet - the first one is today. The thing to watch is
   the voice: the answers came back addressed to the other person ("du flyttade
   den till ny runner"), which reads naturally in a 1-1 note and is a choice
   nobody made deliberately.
7. The flag column is enumerated three levels deep, in CSS. A fourth level of nesting shares the third's column. Not worth solving until someone nests four deep.

Everything else in the first version's scope is done: the three panes, the
sidebar, the editor, persistence, inline images, sticky windows, drag and drop,
and the mock's three adjustable settings. Sticky windows now also come back on
start for notes that are still pinned.

## Writing in it, and what that found

The three reports that came out of using it for notes, all in the editor, all
verified through `scripts/e2e.mjs` before and after:

- **Enter at a bullet sometimes jumped to another line.** It was Chromium moving a
  whole sub-list out to sit beside its parent item; see DECISIONS.
- **Something grey appeared around every bullet on hover.** The alert flag was
  being drawn on top of the bullet, at every level of nesting.
- **`/date` was missing, and the menu felt unreliable.** The calendar is built,
  and the unreliability was a non-breaking space.

Two more were found while checking those, neither reported: clicking the flag
column beside a sub-bullet flagged the line above it, and a flagged line's flag
faded out when the pointer entered the document.

## Open questions

- **Does anything move between Jot and Nib?** Settled for now: nothing automatic. A manual `Add to Jot` button on a flagged line is the shape it would take, and it is not scheduled - see DECISIONS 2026-08-23. Alerts stay in Nib meanwhile, overlap and all.

Settled: the name, the separate-app question, the storage format and location, the
sub-category depth, the whole visual design, where images live, how the two window
types share one renderer bundle, and - as of 2026-08-24 - that archiving is a
note-level flag beside delete rather than a replacement for it, and that
categories and sub-categories still only delete.
See [DECISIONS.md](DECISIONS.md).
