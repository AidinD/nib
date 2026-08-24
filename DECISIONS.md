# Nib - decisions

Newest first.
Each entry records the decision, what else was considered, and why the choice was made.

## 2026-08-24 - Backlinks are stored, not searched for

**Decided.** Every note's meta carries `links`, the ids it links to, written from
the document on every save. A note's backlinks are then a walk over the index,
which is in memory already.

**Why not read the notebook when the question is asked.** The question actually
asked is the reverse of what the text holds: a note's body says what it points
at, and "what points at me" can only be answered by reading every other note.
That is a read of the whole notebook every time a note is opened - fine today,
and quietly worse every month the notebook grows.

**The index version went from 1 to 2**, because the links cannot be derived from
an old index - they are in the bodies. Loading a version 1 notebook reads every
note once, fills the field in and saves. Leaving existing notes empty until they
happened to be edited would have looked exactly like the feature not working.

**The migration runs after the file watcher is set up**, so the renderer hears
about the rewritten index through the same path as any other external change and
reloads itself. No "migration finished" message to wire up.

**A note is never listed as mentioning itself.** A link to the note you are
reading tells you nothing.

## 2026-08-24 - Where a card says what it needs, and where it says what it is

**Decided.** The count of open action points inside a note goes beside the card's
title. Not in the meta row with the tags, and not on the left edge.

**The split it keeps.** The card's top row is what the note needs from you - the
flag, the action-point count - and the meta row is what the note IS: where it
lives, when it changed, what it is tagged with. Both rows stay scannable as long
as neither borrows the other's job.

**Why not the left edge.** A flagged NOTE already owns that edge. Two different
things in the same place in the same colour would mean neither could be trusted.

**Why a count and not a mark.** A note holding one loose end and a note holding
five look identical otherwise, and the difference is the whole reason to look.

## 2026-08-24 - Mouse back and forward are ordinary mouse events

**Decided.** Note navigation has a history, walked with the mouse's side buttons
or Alt+Left / Alt+Right. The buttons are read in the renderer, from `mouseup`
with `button` 3 or 4 - the way Jot and Helm have both done it for months.

**Superseded, same day: the first version routed them through the main process.**
The reasoning was that Windows turns those buttons into an `app-command` on the
window, which only the main process can hear. That is true in a browser, where
the buttons already mean "go back". In an Electron window with nothing to
navigate, Chromium hands them to the page as buttons 3 and 4 and no app-command
is emitted - so the wiring was correct, listening in the right place for an event
that never came, and the buttons did nothing at all.

**The lesson is not about Electron.** Two sibling apps in this suite already had
this working, and the answer was twenty lines away in Jot's `App.tsx`. The suite
is the reference; reaching for it first would have cost a minute and saved a
release. That is what CLAUDE.md means by "look at how Jot solved it before
inventing something new", and this is the second time it has been the shortest
path to a right answer.

**One mechanism, not two with a guard.** The main-process forwarding is removed
rather than kept as a fallback: if both ever fired, every gesture would step
twice, and a dedupe window measured in milliseconds is a worse thing to own than
a single event source that two other apps have proved.

**The trail is recorded from an effect on the open note**, not at each place that
opens one. There are five such places already - a card, a link in the text, the
action-point strip, a search result, a fresh note - and a list of call sites to
keep in step is a list that will fall out of step.

**Walking the trail is self-cancelling.** A step back opens a note, the effect
offers it to be recorded, and `visit` drops it because the cursor already points
at it. Without that, every step back would append a new entry and there would
always be somewhere further back to go.

## 2026-08-24 - A note can link to another note

**Decided.** `/link` opens a search over the notebook and inserts a link to the
note chosen. Clicking it opens that note and takes the list and the sidebar with
it. The link stores `data-note="<id>"` and nothing else.

**Why an id and not a title.** Titles change. A link that carried the title would
be wrong the moment a note was renamed, and there would be no way to tell a stale
link from a link to a different note. The label is refreshed from the index on
every load, so renaming a note updates every sentence that mentions it.

**Why not an `href`.** There is no URL for a note. A fake one would have to be
intercepted before the browser tried to navigate, and any that escaped would open
a browser window pointed at nothing.

**A link to a deleted note is marked, not removed.** It keeps the title it had and
is struck through. "This pointed at the 1-1 from March, which is gone" is worth
more than a blank, and quietly editing a word out of someone's sentence is not a
thing an editor should do.

**The picker takes focus, unlike the slash menu and the calendar.** It needs a
field of its own, because what is typed into it is a search over the notebook
rather than text going into the note. The caret survives because the editor
already keeps the last range inside the body and restores it before inserting -
the same mechanism the toolbar buttons use.

**Inserted with DOM calls, not `insertHTML`.** `insertHTML` will not be told where
whitespace goes: given a space, a link and a zero-width space, it wrapped both
spaces in styled spans and moved the leading one to the far side of the link, so
`Se ocksa /link` came out with the words run together.

## 2026-08-24 - A paste is stripped down to Nib's own blocks

**Decided.** `class` is no longer an allowed attribute, and `div` and empty `span`
wrappers are taken apart on load. The one class Nib needs - the drawing block's -
is put back from its `data-canvas` when the note loads.

**What made it necessary.** The 1-1 template in this notebook was pasted out of a
web app and arrived as a list buried three `div`s deep, with `mat-mdc-menu-trigger`
and `ng-star-inserted` on the wrappers and a `span` around every line. None of it
styles anything here. It is not merely weight: a `div` is not a block this editor
recognises, so a list inside one was out of reach of the markdown shortcuts, Tab
and the alert marker - and a `span` splitting a line into pieces is enough to stop
an inline shortcut from finding its own pair.

**Rejected: cleaning only on paste.** Then the notes already carrying the mess
would stay broken, and the one that mattered was the template every future 1-1
gets copied from.

**Rejected: keeping `class` and filtering by name.** A list of another app's class
prefixes is a list that grows every time something is pasted from somewhere new.
Nothing in a note needs a class, so the attribute goes.

## 2026-08-24 - A card shows state at rest, and affordances on hover

**Decided.** The pin is hidden until the card is hovered, like the flag, the
archive arrow and the delete cross. A note that IS pinned still shows its amber
dot at all times.

**Why it was the odd one out.** It sat at 0.35 opacity - dim but present - which
the design spec asked for, and which was right when the pin was the only thing in
a card's top row. Three affordances have joined it since, all appearing on hover,
so the pin became the one mark on a resting card and read as a state rather than
as a button.

**The line it draws.** A state is always visible: pinned, flagged, dealt with. An
affordance appears when the pointer is on the card. The pin is both, and it splits
along exactly that line - invisible when there is nothing to say, amber when
there is.

**The spec is updated rather than overruled quietly.** Its original wording
described a card with one affordance; leaving it as written would have made the
implementation look like a mistake to the next reader.

## 2026-08-24 - Enter in a list is ours, not the browser's

**Decided.** Enter on an empty bullet is handled in Nib: a sub-bullet outdents
one level, a top-level bullet becomes a paragraph after the list, and items below
the one being left travel with it. `document.execCommand('outdent')` is no longer
in that path.

**What went wrong.** Two Enters in a sub-bullet did not walk out of it. Chromium
moved the whole sub-list out to sit BESIDE the item it belonged to -
`<li>Two</li><ul>...</ul>` - which is invalid, since a `ul` cannot be a child of
a `ul`, and put the caret on a new top-level bullet several lines up. The next
line typed joined the list again. Reported as "Enter at a bullet sometimes jumps
to another line", and the jump was the list being rebuilt underneath the caret.
Worse, the invalid shape is exactly what `normaliseLists` repairs on load - so
the lines moved again the next time the note was opened, which is what made it
feel intermittent.

**Rejected: let the browser do it and repair afterwards.** That is the pattern
used everywhere else here, and it is why the editor is small. It fails for this
one: the repair has to run while the caret is inside the nodes being moved, and
the shape Chromium produced does not carry enough information to know which item
the author was on. Repairing on load is fine; repairing under the caret is not.

**The cost is the undo stack.** Moving nodes by hand keeps this one step off the
browser's own undo, so Ctrl+Z does not put the bullet back. Accepted, because the
alternative was a command that wrote a document needing repair on its next read.
Everything else - the markdown shortcuts, every toolbar button - still goes
through `execCommand` precisely to stay undoable.

**`li > li` is now healed on load too**, so notes already carrying the shape come
back right rather than staying broken.

## 2026-08-24 - One flag column, outside the bullets

**Decided.** A list item's flag is pushed back out of the list's indent, one step
per level of nesting, so every line's flag sits in the same column in the
document's margin. And a flagged line in the main window gets the margin bar
only - the border-and-padding version is now for sticky windows alone.

**What it looked like.** The flag is positioned relative to its line, and a
bullet's line starts one indent further in - so the flag was drawn exactly where
the bullet is, and hovering the document put a grey smudge on every bullet in the
note. A flagged bullet was worse: two orange bars with the bullet trapped between
them, and flagging a line shunted its text sideways.

**Rejected: hiding the flag on list items.** Simpler, and it would have taken the
feature away from the lines most likely to be action points - a bullet is what a
follow-up gets written as.

**Enumerated per level rather than computed**, because CSS cannot count
ancestors. Three levels, the same limit the bullet shapes already have.

**And a flagged flag no longer fades on hover.** The reveal-on-hover rule was one
step more specific than the flagged rule, so moving the pointer into the document
dimmed every flag that meant something to a quarter.

## 2026-08-24 - `/date` opens a calendar; `/today` does not need one

**Decided.** `/today` and `/tomorrow` insert a date directly. `/date` opens a
month at the caret, driven by the arrow keys, Enter to take it.

**Why both.** Today's date is one keystroke and the app already knows it; a
calendar for it would be a click in the way. A date a fortnight out is the case
worth a calendar - a follow-up, a deadline - and working that out by counting is
what the calendar exists to stop.

**It takes no focus.** The highlighted day lives in the editor beside the caret it
is going to write to, and the arrow keys reach it through the same handler as the
slash menu. A picker that took focus would have lost the caret, and there would
be nowhere to put the date. Same reason its buttons swallow mousedown.

**Dates are written `YYYY-MM-DD`.** Sortable, unambiguous, and the same string
whichever command produced it.

## 2026-08-24 - The slash menu counts a non-breaking space as a space

**Decided.** The trigger accepts any whitespace before the `/`, including
` `.

**Why it had to.** A contenteditable stores the space at the end of a line as
`&nbsp;`, because an ordinary one would collapse. So `endsWith(' ')` was false in
exactly the situation the menu is for - typing `Deadline: /` - and the menu opened
at the start of a line and nowhere else. It read as the menu being unreliable
rather than as a rule, which is the worst way for a rule to be wrong.

## 2026-08-24 - Search reaches the archive only when it would have missed something

**Decided.** A search never shows an archived note by default. When the archive
holds matches the search is not showing, a line appears above the cards saying so
and how many, and one click brings them in. Clearing the search clears the choice.

**The problem archiving created.** "I know I wrote this down somewhere" is half
the reason to archive rather than delete, and hiding archived notes from search
is precisely what makes that fail. Archiving something and then being unable to
find it is worse than not having archived it.

**Rejected: a permanent "include archived" checkbox beside the search field.** It
would be a control that does nothing almost every time it is looked at, and it
would keep the archive on the reader's mind constantly - which is the opposite of
filing something away. Worse, it invites being left switched on, and then the
archive is quietly back in every search.

**So the control is offered rather than parked.** It exists only when it would
change the answer: no search, no line; a search the archive cannot help with, no
line. What is left is a footnote that reads "1 match in the archive - Show", in
the one place the answer was missing. When there is nothing to say, the feature
is invisible, which is what a default of "don't pollute the search" means.

**The flag widens a search, not a mode.** `selectedNotes` ignores
`includeArchived` when the needle is empty: honoured with nothing typed, it would
merge the archive into every list and there would be no archive left. A test
asserts that, because it is the one line that would quietly undo the whole
feature.

**It is not remembered between launches, and resets when the search is cleared.**
A decision made about one search should not silently apply to the next one a week
later. Filing something away has to keep meaning it stays away.

**An archived card in a mixed list carries an `archived` tag**, since that list is
now the only place the two can appear side by side. The Archive list itself still
carries no tags: every card in it is archived.

## 2026-08-24 - Archive is a note-level flag, and delete stays final

**Decided.** `archived` on `NoteMeta`, an Archive smart row, and an archive/restore
action on every card. Categories and sub-categories still only delete.

**Why archiving at all.** Every delete in Nib was final - no trash, no undo - and
notes are the kind of thing whose loss is discovered months later, when you go
looking for something you half remember. That is exactly the case a confirmation
does not cover: the click was deliberate, the regret was not.

**Notes only, deliberately.** Archiving a category immediately raises "and the
notes inside it?", which is the question the two delete paths already answer two
different ways - a category takes its notes, a sub-category does not. A third
answer on top of those would make the confirmation dialog harder to write than
the one just fixed, and the dialog is the part that has to stay legible.

**Not a trash, and not a replacement for delete.** Two different needs get
confused here. Getting a finished project out of the sidebar is what archive is
for; surviving a mis-click is what a trash is for, and a trash was not built -
the data is plain files in a synced folder, so file history already covers the
catastrophic case. An archive that doubled as a safety net would also make the
delete confirmation feel less final, which makes the mis-click *more* likely.

**The filter lives in `allNotes`**, the one function the lists, the counts and
the alert strip all pass through - not at each call site. The way this feature
fails quietly is an archived note that still counts towards "Needs you", or still
shows in the strip, or inflates a sidebar number the list then contradicts. Tests
assert each of those, because none of them is visible until weeks later.

**Archiving lets go of the pin.** A sticky window is a note kept in front of you,
which is the opposite of what archiving says. Restoring does not bring the pin
back: it was given up, not stashed. The start-up sticky restore also refuses an
archived note outright, because a synced index can carry a pin from a machine
that had not archived it yet.

**A category delete still takes the archived notes, and now says so** - "and the
5 notes inside it, 2 of them archived". Archiving promises "not gone", and the
sidebar has been showing the smaller number all along, so the count in the dialog
would otherwise be the first and last warning.

**Verified in the running app**: a pinned, flagged note carrying a block alert
left every list and every count, the strip went with it, the Archive row appeared,
the round trip reached `index.json`, and an index planted with `archived` and
`pinned` both true opened no sticky window.

## 2026-08-24 - The delete confirmation names the sub-categories too

**Decided.** The category delete dialog says what is in the category - the
sub-categories as well as the notes - and an empty category is not described as
taking "0 notes" with it.

The dialog's one job is to say what is about to be lost, and it was leaving out a
whole level of it: `"Work" and 7 notes inside it will be deleted for good.` A
category holds sub-categories, and deleting it takes them, because they live
inside the category object the index filters out. Somebody reading that sentence
with three sub-categories on screen has to already know the answer to trust it.

The note count was never wrong - `Category.notes` is flat and already includes the
notes sitting in sub-categories - which is exactly why the omission was easy to
miss. It reads correct and is incomplete.

**The behaviour is unchanged, and worth writing down while it is in view:**
deleting a category removes the sub-categories and deletes every note file,
including the ones inside subs; deleting a sub-category keeps its notes and moves
them up to the category (`subId` becomes null); images and drawings are not
deleted with either, because they are content-addressed and shared, so
`note:delete` schedules the orphan sweep instead.

**Verified against the running app**, four fixture categories through
`scripts/e2e.mjs`: subs and loose notes, one of each for the singular wording,
no subs, and empty - then a real delete, checking the sub-categories left the
sidebar and the note files left the disk.

## 2026-08-24 - The e2e harness refuses a port it does not own

**Decided.** `scripts/e2e.mjs` fails if something already answers on the
debugging port, and `NIB_E2E_PORT` overrides it.

Every sibling app's harness was copied from this one and every copy picked 9333.
Two runs at once collide, and the collision is silent: Chromium logs `Cannot
start http server for devtools` and carries on, `findPage` then finds the *other*
app's window on the port, and the steps drive it. This was found by a Nib run
attaching to a Helm run - with a steps file whose next click was a delete button.

Failing to start is the whole fix. Guessing a free port would hide the collision
again, one layer down.

## 2026-08-24 - Story bank: a note kind, not a folder

**Decided.** `NoteKind` on `NoteMeta`, currently `'' | 'story'`, plus a Story
button beside the note field and a template of four questions.

**A marker on the note rather than a category.** A story about an incident
belongs filed with the incident. Sorting stories into a "Story bank" folder
fights the filing you already have, and it is the same objection as binding Nib
folders to people by naming convention rather than by an explicit binding.

`kind` copies the shape of `flag` on purpose: a small enum on the note that
drives a view and a marker, not a new entity. The idea note called for "a
template and a tag" - Nib has no tags, so the tag is this.

**The headings are questions, and the wording is load-bearing.** "Result"
invites a summary; "What changed, and how you know" invites a number. `Action`
is split from `Task` because collapsing them is what produces "we shipped it" -
a sentence that says nothing about you - and the hint says so outright. A rewrite
that softens those headings brings the problem back, so a test asserts the
action prompt still asks what *you* did.

**Capture, not composition.** Nobody writes career stories in advance; everybody
tries to remember them afterwards, when the numbers are gone and "what I did"
has blurred into "what the team did". So the button sits next to the note field
rather than behind a menu: a button two clicks away is a button used in March,
trying to remember October.

**`unanswered()` tells a half-captured story from a finished one**, reading each
section only as far as the next heading. Reading to the end of the document would
let one answered section mark every later one as answered, which is the failure
that makes such a check worthless.

**Nib has tests now.** Eight, against `src/shared/story.ts`, which Node type-strips
on import so they run against the source rather than a build. It was the only app
in the suite with none.

**A latent CSS bug came out with it:** `--accent-soft` was referenced by an
existing rule and never defined, so that background painted nothing. Defined now.

## 2026-08-24 - NIB_DATA_DIR is a relocation, not an isolation

Worth its own entry because the habit from every sibling app is wrong here.

Pointing `NIB_DATA_DIR` at an empty scratch folder does not isolate a test run
from real notes. `migrateLegacyData()` copies the entire notebook into it, which
is exactly right for its job - moving your data to a synced folder - and exactly
wrong as a test habit.

It surfaced the only way it could: a dev run against a fresh scratch directory
came up showing a real note about a named colleague resigning. It copies rather
than moving, so nothing was lost, and a copy of a private notebook sitting in
`%TEMP%` is still a copy. Deleted, and written into CLAUDE.md as a rule.

The general shape, which has now cost time twice in one day: a default that
reaches for real data is not made safe by the caller being careful. Tend read the
real Jot board until its harness was given a fixture; this copies the real
notebook until the scratch directory already has an index.

## 2026-08-23 - The header mark was missing its slit, and the ladder was missing two rungs

Two defects in the mark, both found while giving Loom the same treatment.

**The slit did not render.** `NibMark`'s slit is `M50 52 V86`, a vertical line,
so its bounding box has zero width - and an `objectBoundingBox` gradient (the
SVG default) on a shape with a zero-width or zero-height box renders *nothing at
all*. So the window showed a nib with a vent hole and no slit, while the taskbar
icon showed both, because the icon script paints with distance fields rather than
an SVG gradient. Two drawings where the whole point of the previous entry was
one. Fixed with `gradientUnits="userSpaceOnUse"`, which also makes a single ramp
span the mark instead of restarting inside every path.

It is worth naming why this survived review: the mark still looked like a nib.
Nothing was obviously broken, and the only way to catch it was to render the
component and compare against the icon, which is now the habit.

**20 and 24 were missing from the .ico.** Windows asks for those at 125% and
150% display scaling; without them it resamples a neighbouring frame and the
mark goes soft at exactly the scales most displays actually run at. The ladder is
now 16/20/24/32/48/64/128/256. Jot and Loom carry the same set.

## 2026-08-23 - One mark, at every size and in the window too

The icon is one drawing. An earlier version had two - the full nib for 48px and
up, a simpler tip-and-drop for 16 and 32 - on the reasoning that detail turns to
mud at small sizes. It does, but the cure was worse: Windows showed one logo in
the taskbar and a different one in search, and the honest reaction to that is
"which one did we pick?".

So the silhouette, the slit and the colour are the same at every size, and what
changes is weight and detail: below 32px the stroke thickens and the vent hole
goes, because a one-pixel ring is a smudge. Recognisably the same mark, drawn for
the space it has.

The mark is also in the window now, beside the wordmark - drawn as inline SVG
rather than the packaged PNG, because it sits at 20px next to 20px text and a
downscaled 512px bitmap is soft exactly where the eye is most critical. The same
mark went into Jot's header in the same change, so the two apps introduce
themselves the same way.

A note on how the marks were checked, since one of them could not be: Jot takes a
single-instance lock, so a second copy exits rather than opening a window, and
driving the author's own running copy is not on. Its mark was rendered in a
header that *can* be driven - Nib's - purely to be looked at. The test harness
gained a screenshot helper for it, which is the missing half of not using the
pointer: a check about how something looks still needs an image, and one taken
from inside the renderer cannot catch another window by accident.


## 2026-08-23 - Alerts stay in Nib, and any bridge to Jot is a manual button, later

Nib keeps its own action points. The overlap with Jot's todos is real and known -
a flagged line collected in a "Needs you" strip is a to-do list living inside a
notes app - and it is accepted rather than resolved.

The reason to keep it: an action point comes out of the note it was written in, and
it is useful where it was written. Reading back a meeting note and flagging the
line you need to act on is one gesture in one place; the same thing routed to
another app is two apps and a context switch, for a note you may deal with in the
next five minutes anyway.

Considered and rejected for now:

- **An automatic bridge**, where flagging a line creates a Jot todo. Rejected today on two counts: it would have Nib writing into another application's store as a side effect of typing, and it would promote every flag to a tracked commitment whether it deserved one or not. Most flags are read-and-clear within the hour.
- **Dropping alerts and letting Jot own everything that needs doing.** Cleaner on paper, and it is the answer if the overlap ever becomes annoying in practice. It is not what the author wants while using the two side by side.

What is left open, deliberately: a **manual** `Add to Jot` on a flagged line, for
the ones that turn out to be real commitments. A button, pressed on purpose, for
the few - not a rule that fires for all of them. Not built, and not scheduled.

The thing that would change this decision is usage, not argument: if the flags in
Nib start being things that live for days, they belong in Jot and the strip is in
the way.


## 2026-08-23 - The alert mark is a flag, and a card carries the same three states

The mark beside a line is a flag, not a checkbox, and a note's own flag has the
same three states a line's does: unflagged, needs you, dealt with.

Two things were wrong with the checkbox:

- **It said the wrong thing.** A column of empty boxes down a note reads as a checklist of things not done yet. Most lines are not tasks, and the mark means "this needs attention" - so it is a flag, in the alert colour, grey once it has been dealt with.
- **Ticking a card off made it disappear.** The review list filtered to notes that still needed you, so the card you had just ticked vanished from under the pointer, which reads as deletion rather than completion. The list now shows every note carrying a flag at all, outstanding ones first; the strip and the count are what a dealt-with note leaves.

`done` is deliberately not the same as unflagged, at both levels. A note that
needed doing and has been dealt with keeps a quiet grey edge and a grey flag - the
history is the useful part, and clearing it altogether is one more click.

## 2026-08-23 - Verify by driving the renderer, never the mouse

Checks against the running app go through the Chrome DevTools Protocol -
`scripts/e2e.mjs` starts its own instance with a debugging port, dispatches input
into the page and reads the DOM back.

The alternative was what came before it, and it was bad in three separate ways: it
moved the pointer of whoever was using the machine, it clicked into their other
windows whenever the app was not in front (twice into their own apps, once
navigating a browser tab they were reading), and every coordinate was a guess
from a screenshot that went stale as soon as a toolbar wrapped to two rows.

Synthetic input into the page has none of those problems and is more precise: a
selector cannot drift, and the DOM can be asserted on directly rather than
inferred from pixels.

The same session produced the other half of the rule: **never kill a process by
name.** `Stop-Process -Name Nib` was closing the author's own installed copy on
every test run, because the packaged app's process is also called `Nib`. Kill the
PID you started, nothing else.


## 2026-08-23 - Releases publish themselves, with a token nobody stores

Nib now ships the way Jot does: `npm run release` cleans, builds, packages and
uploads to GitHub Releases, and the installed app updates itself from there.

Three choices inside that:

- **The token comes from `gh auth token` at release time.** The gh CLI is already logged in with `repo` scope, so nothing new had to be created and no long-lived `GH_TOKEN` sits in a shell profile or a file. electron-builder does not read gh's keyring itself, which is why a script feeds it.
- **The upload is electron-builder's publisher, not `gh release create`.** `latest.yml` names the installer in a dashed form; a local package produces spaces and a hand-made upload produces dots, and electron-updater then 404s on the asset in a release that looks published. Jot's DECISIONS entry of 2026-07-04 is the record of finding that out.
- **The release script cleans `out/` and `dist/` first**, because electron-builder packages whatever is already there. Jot shipped a release from the previous day's build that way.

The check runs once at startup and installs on quit, and it is skipped in
development, where there is no packaged app to replace. Until the first release
exists the check fails with `ERR_XML_MISSED_ELEMENT` - GitHub's feed has no
entries to read - which is logged and otherwise ignored.

What this changes about the version number: it stops being a label and becomes
the delivery mechanism. An unbumped version reaches nobody, and a bad release is
corrected by bumping to the next one, never by republishing the same.


## 2026-08-23 - A toolbar button must not take the focus

Every button in the editor's toolbar swallows its own `mousedown`, so pressing
one never moves focus out of the document.

Without it the formatting buttons did nothing at all - not intermittently,
always. Pressing a button focused it, the selection in the contenteditable
collapsed, and `execCommand` then had nothing to act on. The same cause made the
Alert button need several tries: it looks for the block the caret is in, and by
the time it ran there was no caret.

There is a second line of defence for the cases where focus legitimately left the
body first - the title field, another pane: the last selection seen inside the
body is remembered and restored before a command runs. The mousedown fix is what
makes the ordinary case work; this is what makes the awkward one work.

The lesson generalises past this app: a contenteditable's selection is global
state that any focus change can wipe, so every control acting on it has to either
preserve focus or restore the range.

## 2026-08-23 - An action point has three states, in a marker beside the line

A line is not flagged, flagged, or done - and one marker in the document's left
column carries all three, cycling in that order as it is clicked.

Ticking one off used to remove the flag, which threw away the interesting part: a
line that needed doing and has been dealt with should still read as one. So `done`
keeps the mark - the box, now ticked, the bar gone grey, the text dimmed - while
leaving the strip and the count. One more click clears it, for the line that
should never have been flagged at all.

Where the control lives matters as much as what it does. It began as a button at
the right-hand end of the toolbar, which is a long way from the sentence it is
about; now every line has a marker in its own margin, faint while the pointer is
in the document and solid once the line is flagged.

Three details that had to be got right:

- **The column is permanent**, not conjured on hover. A marker that appeared inside the line would push every paragraph sideways as the pointer crossed it.
- **The markers appear on hovering the document, not the line.** The marker sits beside the line, so reaching for it leaves the line - and a marker that fades as you reach for it cannot be clicked.
- **It is drawn by CSS, not as an element.** A real checkbox in the document would be content: selectable, deletable halfway through, and visible in the note's preview and word count.

The same box appears beside each line in the "Needs you" list, doing the same job
from the outside, and `Ctrl+Shift+A` is the keyboard route - which, with the caret
in no particular line, flags the whole note.

## 2026-08-23 - A note can be the action point, not just a line in it

Alerts exist at both levels: a block inside a note, and the whole note.

Some notes are the action. A card that says "call the contractor" has no line
worth singling out, and flagging its only paragraph to make it show up in the strip
is a workaround, not a design. So a note carries `flagged` as well, toggled by the
flag that appears on its card on hover - or by `Ctrl+Shift+A` with the caret in no
particular line, so the editor is not a dead end for it.

A flagged note shows an orange edge on its card, appears in the strip as its own
chip with no line to quote, and counts as one thing that needs you.

## 2026-08-23 - Destructive actions ask first, in the app's own dialog

Deleting a note, a category or a sub-category now opens a confirmation. All three
used to happen on a single stray click, next to controls you click all the time -
the pin, the scope chip, the disclosure caret.

The dialog is the app's own, never `window.confirm`. The native one is a
light-mode Windows box in the middle of a dark frameless app, and it blocks the
renderer thread while it is up. Cancel takes focus, so an absent-minded Enter
cancels rather than deletes, and the message says what goes with it - a category
takes its notes, a sub-category leaves them behind and moves them up.

## 2026-08-23 - Closing a sticky window unpins its note

A sticky window is what a pin means, so closing the window clears the pin and the
card stops being marked sticky. It was possible to end up with a card claiming to
be sticky and no window anywhere.

The signal comes from the window's own `closed` event rather than from its × - Alt+F4,
the taskbar and every other way of closing a window has to count too. The one
exception is quitting: shutting the app down closes every sticky window, and
unpinning them all would mean coming back to none.


## 2026-08-23 - Orphaned images are swept, not deleted with the note

Deleting a note - or a section of one - does not delete "its" images, because
assets are content-addressed and shared: the same image pasted into two notes is
one file on disk. What can be said for certain is which files no note refers to
any more, and a sweep removes those.

It runs a few seconds after writing stops (a sweep per keystroke would be absurd)
and once at startup, which catches anything orphaned by a crash or by a note
deleted on another machine and synced down while this one was closed.

The grace period is the part that matters. An image is written the moment it is
pasted, and the note referring to it is saved 600ms later; a sweep in between
would see an unreferenced file and delete the paste. Nothing younger than ten
minutes is touched, so that window is never a race. Drawings are swept the same
way, keyed by the `data-canvas` id still present in some note.

Considered and rejected: reference counting, incremented on paste and decremented
on delete. It is exact until the first crash, external edit or sync, and then it
is silently wrong for good. Recomputing from the notes on disk cannot drift.

## 2026-08-23 - An action point is ticked off, not checked off

There is no checkbox in the document. The flag is an attribute on the block, and
it is cleared in one of three places: the `Alert` button in the editor toggles the
block the caret is in, and a tick appears on the alert strip's chip and beside
each line in the "Needs you" list.

The reason is that the flag is not part of the note's text. A checkbox in the
document would be content - it would show up in the note's preview, be selectable,
be deletable halfway - and would then need reconciling with the index. Clearing it
from the strip, on the other hand, means the note you are reminded about does not
have to be opened at all, which is the whole point of the strip.

Clearing from outside the editor edits the note file directly and re-derives the
alert list from it. The index is a shadow of the body; changing only the shadow
would put the two out of step and the flag would come back on the note's next save.


## 2026-08-21 - A drawing is stored twice: its strokes and a cropped PNG

This closes the question the canvas was waiting on. A drawing is kept as **both**:

- `drawings/<drawingId>.json` - the strokes, so the drawing stays editable and reopens exactly as it was left. Not pretty-printed: it is thousands of coordinates, and indenting them triples the file for nobody's benefit.
- a PNG in the assets folder - so a note can show the drawing without a canvas, and so the note renders anywhere the images do.

The note body holds neither. It holds a block - `<div class="canvas-block"
data-canvas="<drawingId>">` - with the rendered image inside it. The id ties the
block to its stroke file; the image is what makes the block worth looking at.

Three things came out of building it:

- **The PNG is cropped to the ink**, not to the surface. Exporting the whole canvas gave a mostly empty image, which then had to be scaled down into a 170px block - so the drawing itself came out tiny. Cropping to the ink's bounding box, padded by the widest nib, means the thumbnail shows the drawing and the asset is smaller.
- **The block is inserted with DOM calls, not `execCommand('insertHTML')`.** A div is not valid inside a paragraph, so when the caret sat in one the browser unwrapped the block and left its contents behind as text - which then turned up in the note's preview. It is placed as a sibling of that paragraph instead.
- **The block's header is drawn in CSS**, not markup, for the same reason: "Drawing · click to open" is chrome, and chrome in the DOM leaks into previews, word counts and search.

Closing a canvas with nothing drawn removes the block and its file. Opening a
canvas, changing your mind and closing it should leave the note as it was, not
leave a 170px hole in it.

## 2026-08-21 - A translucent stroke is one path, not a run of segments

The pen paints each segment separately, because each segment's width comes from
the pressure at that point - which is the whole reason a stylus stroke tapers.
The highlighter cannot: overlapping round caps compound their alpha, and a sweep
came out as a string of beads rather than a band.

So any tool with alpha below 1 is painted as a single path at the stroke's mean
pressure, and a live translucent stroke repaints whole on each move rather than
appending a segment. The cost is that a highlighter does not taper with pressure,
which is fair - a real one does not either.


## 2026-08-21 - Alerts are block-level flags, shown in a strip and a review row

An action point is a flag on a **block** inside a note - `data-alert="1"` plus a
`data-alert-id` on the paragraph, heading, bullet or quote itself. A note counts as
needing you when it holds at least one. Both levels exist, and the block is the
truth.

The flag lives on the block rather than in a list of positions because text moves:
a stored offset would be stale the moment a paragraph was inserted above it. The
id is minted when the flag is set, which is what lets a click jump back to that
exact line.

The index carries a shadow of each note's alerts (id plus the block's text, capped
at 24 per note and 160 characters each), so both views can be built without
opening a single note file - the same reason the index carries a preview.

Two surfaces, doing different jobs:

- **A horizontal strip under the header**, holding up to six chips. Action points cut across categories, so they belong to no single list, and a row that is simply *there* nags in a way a list you have to open cannot. It renders nothing when there is nothing to show, so it costs no space until it means something.
- **A "Needs you" row in the sidebar**, appearing only when the count is above zero, whose list shows each note's flagged lines instead of its opening lines. This is the review view; the strip's "+N more" chip hands over to it.

Considered and rejected: **a separate always-on-top window** for the action points,
like the sticky windows. Stickies already do the floating-list job, and two
competing floating lists on one desktop is one too many - the pinned note you
chose to float would end up next to a window listing things you did not choose.

Also considered: flagging **only whole notes**, which is simpler and reuses the
note list as it stands. Rejected because a long meeting note with one action point
in it is a coarse hit - the requirement was written as marking a line, not a
document.


## 2026-08-21 - View preferences are per machine, not part of the notes

The accent colour, the serif body switch and the measure live in the renderer's
localStorage, not in the data directory beside the notes.

They are display choices, not note data: how wide a column should be on this
screen, which accent this monitor suits. Putting them in the synced folder would
mean the laptop's window width fighting the desktop's on every start, for no gain.

Every window of the app shares one origin, so a sticky window reads the values the
main window wrote - which is how a sticky picks up the accent without any wiring
between the two.

The accent is applied by overwriting the `--accent` token on the root element.
Everything already built against that token - focus rings, the drop marker, the
image tag, the pressure meter to come - follows without knowing a setting exists.


## 2026-08-21 - An image's size is stored in a data attribute, not a style or a width

The width of an image in a note is stored as `data-w` and applied as an inline
style every time a note is loaded.

Two more obvious approaches were tried and both lost the size silently:

- **An inline `style`.** `style` is not on the sanitiser's allowed-attribute list, on purpose - letting arbitrary CSS in from a paste is exactly what a sanitiser is for. The resize looked right and was gone after a reload.
- **A plain `width` attribute.** Allowed on paper, and still not present in the saved HTML. Data attributes, on the other hand, survive this configuration.

So the size is kept as data and turned back into a width in one place,
`applyImageWidths`, which every load path calls. Found by resizing a real pasted
image, saving, and reading the note file back: the DOM said 375px and the file
said nothing.

## 2026-08-21 - Drag and drop is the native API, not Jot's @dnd-kit

Jot reorders its lists with @dnd-kit. Nib uses the browser's own HTML5 drag and
drop instead.

What Nib has to drag decides it: a note card is dropped on three different kinds
of target across two panes - between cards, on a category row, on a sub-category
row - and the editor already handles native file drops for pasted images. One API
for all of it beats a sortable-list library plus the native path side by side.

Two things the native API forces and are worth knowing:

- `dataTransfer` cannot be read during `dragover` (the spec calls it protected mode), so the dragged item is also kept in a module-level variable. A target has only `types` to go on otherwise.
- Reordering is expressed as "place this before that", not "move to index N". The index form has to be corrected for the fact that pulling the item out shifts everything after it, and that correction is exactly the off-by-one everyone writes twice.

Reordering is offered only inside a category, where the order is actually stored.
The smart lists have their own sorts - Recent by edit time, Sticky by pin - so a
card dropped there would snap straight back, and no marker is shown.

## 2026-08-21 - A window picks up edits made to the same note elsewhere

A note open in both the main window and its sticky window is one file, and either
window reloads its body when the other one saves - but only while it is clean and
unfocused.

Both halves of that condition matter. Replacing the text under a caret that is
mid-sentence is worse than showing the change a moment late, and a body with
unsaved edits must never lose them to a reload. The result is that the two views
converge as soon as you look away from one of them, instead of drifting apart and
then overwriting each other.

This is also what makes another machine's sync visible without a restart: the
index watch fires, the note's `edited` stamp moves, and any window showing it that
is not being typed into reloads.


## 2026-08-21 - Pasted images live in a content-addressed assets folder

Images pasted into a note are written to `assets/<sha256>.<ext>` in the data
directory and referenced from the note body through a custom `nib-asset://`
scheme, rather than embedded in the note file as a base64 data URL.

This closes the question left open by the file-per-note decision below.

- A note file stays small and readable. A screenshot embedded as base64 is a megabyte of unreadable text in the middle of the document, and it is rewritten on every keystroke's save.
- The filename is the content hash, so the same image pasted into two notes - or re-pasted after an undo - is stored once.
- The scheme is registered as privileged and resolved in the main process, which also refuses any path that climbs out of the assets folder. The renderer never gets filesystem access to make this work.

The cost is that an image is no longer *inside* the note it belongs to: deleting a
note cannot delete its images, because another note may reference the same bytes.
A sweep for unreferenced assets is the answer and is not built yet. That is
recorded in PLAN.md as an open question rather than solved speculatively.

Considered and rejected: base64 in the note file. It keeps a note perfectly
self-contained and portable, which is genuinely attractive for a local-first
tool, but it loses on every write and makes the note file unreadable by hand -
and readability is exactly why this app is not a database.

## 2026-08-21 - Rich text uses the browser's own editing commands

The editor is a `contenteditable` region formatted through `document.execCommand`.

`execCommand` is deprecated and its replacement is not shipping, so every
contenteditable editor either uses it or ships a whole editing engine. For a
local notes app run in one known Chromium version, the trade is worth it: the
whole formatting layer is a few lines per command instead of a dependency with a
document model of its own.

The fallback, when it does break, is a real editor library - not a hand-rolled
selection model. That is the point of writing this down.

Two details that came out of building it:

- Pasted HTML is sanitised on the way in **and** on the way out. A paste from a browser brings scripts, inline styles and remote images; a note file is also something an external tool or a synced folder can write, so it is never trusted just because we wrote it.
- The bullet-list shortcut is matched on `event.code === 'Digit8'`, not on the character. On a Swedish layout Shift+8 produces `(`, not `*`, so keying off the character would have made `Ctrl+Shift+8` silently disappear on the author's own keyboard.

## 2026-08-21 - One renderer bundle, two window types, routed by the hash

The main window and the sticky windows are the same built renderer. Which one a
window is comes from its hash: `#sticky/<noteId>` is a sticky, anything else is
the main window.

Jot ships a second HTML entry point for its capture window. That works, but the
sticky window shares almost everything with the main one - the tokens, the index
store, the sanitiser, the note read/write path - so a second entry point would
duplicate a bundle to change two components.

The sticky window edits the same note file the main window edits, rather than
holding a copy. There is no reconciliation step because there is nothing to
reconcile: the note is the single source of truth, and both windows reload when
the index changes.

## 2026-08-21 - The frameless window keeps three small window controls

The design spec says no title bar and no window buttons, with the header row
doing that job. The header is the drag handle as specified, but it also carries
minimise, maximise and close at its right end.

A frameless window with no close affordance has to be closed from the taskbar or
by a keyboard shortcut, which is worse than the three 26px buttons it takes to
avoid. This is a deliberate, documented departure from the spec, not a detail
that slipped through: if it turns out to be wrong, the fix is to delete the
controls and restore the frame decision, not to re-derive why they are there.


## 2026-08-19 - The data directory follows Jot's pattern

Nib stores its notes in Electron's `userData` folder by default (`%APPDATA%/nib` on
Windows), and honours a `NIB_DATA_DIR` environment variable that relocates them.
On the author's machines that variable points at a Dropbox folder, the same way
`JOT_DATA_DIR` does for Jot.

The reasons are Jot's, and they still hold:

- A fresh install works with no setup, so a distributed copy stays portable. The synced location is per-machine configuration, never baked into the app.
- It puts the data somewhere an external tool can reach without Windows' filesystem virtualisation getting in the way. Writes to `%APPDATA%` from a sandboxed process can land in a private overlay the app never sees; a path on a real drive does not have that problem.
- Sync comes free from the folder itself, with no sync layer to build or run.

Copy Jot's one-time migration too: when `NIB_DATA_DIR` points somewhere that has no data
yet, move the existing `userData` contents across once. It runs on every start and is a
no-op afterwards, so it can never clobber newer data.

The file-per-note decision below is what makes the synced folder work well: editing one
note touches one file, so two machines editing different notes do not collide.

## 2026-08-19 - Notes are a flat list carrying a sub-category id

A category holds `subs` (id and name only) and a **flat** `notes` array, where each note
carries `subId`, which is null when the note sits directly in the category.
Notes are not nested inside the sub-category they belong to.

This is how Jot already models subtasks: a flat todo list where a `parentId` does the
nesting. Following it keeps the two apps' storage legible in the same way, and it makes
moving a note between sub-categories one field write instead of a splice across two
arrays. Counting everything under a category is one filter rather than a walk.

Considered and rejected: nesting `notes` inside each sub-category. It reads more
naturally on paper, but every operation that spans a category - counting, searching,
listing all notes, moving between levels - has to walk two shapes instead of one.

## 2026-08-19 - Nib uses Jot's design tokens verbatim

The first mock had its own dark palette and an indigo accent. It was replaced with the
exact tokens from Jot's `styles.css`, along with Jot's layout language: no window chrome,
no column backgrounds or dividers, row actions hidden until hover, and colour reserved
for active state.

The two apps sit side by side on the same desktop and are meant to be recognisably one
family. A second, similar-but-different dark theme would read as a near-miss rather than
a sibling. The cost is that a change to Jot's palette now has two places to land, which
is accepted: the tokens have been stable for the life of Jot.

One detail worth keeping when implementing: Jot's drag insertion marker is a glowing,
inset, rounded 3px bar rather than a hairline. Its CSS records why - a thin full-width
line read as a section divider and nobody noticed it.

## 2026-08-19 - The name is Nib

A nib is the tip of a pen.
It is short, it is unclaimed as a product name, and it sits naturally beside Jot without being derivative of it.

Considered and rejected:

- **Jot Notes.** The mock was drawn under this name, and it borrows Jot's vocabulary throughout. Rejected because the app is a separate product with its own data and its own window, and a shared name would imply a shared install and a shared store.
- **Vellum.** Suggests an archive of long documents. The app is closer to a working surface than an archive.
- **Cairn.** A trail marker. Evocative but needs explaining.
- **Margin.** The clearest meaning of the four, but too common a word to own in search results.

## 2026-08-19 - A separate app, not a tab inside Jot

Nib ships as its own application, installed alongside Jot, with its own data store.

The mock arrived titled "Jot Notes" and reused Jot's list-and-scope vocabulary, which made a Jot tab look like the natural home.
It was rejected: notes and todos have different lifetimes, different editing models and very different storage needs - a todo is a line of text, a note is a document with images embedded in it.
Folding them together would mean one store serving two shapes and one window serving two jobs.

Nothing rules out a later link between the two, such as attaching a note to a todo.
That is a bridge between two apps, not an argument for one app.

## 2026-08-19 - One file per note, not one file for everything

Notes are stored as one file per note, with an index for ordering and metadata, rather than a single JSON document like Jot's `todos.json`.

The deciding factor is images.
Requirement: images are pasted **into** the document rather than attached beside it, which means every note can carry embedded image data.
A single JSON file holding every note plus every image would grow into the tens of megabytes and be rewritten in full on each keystroke's save.

It also behaves better in a synced folder: editing one note touches one file, so two machines editing different notes do not collide over the same document the way they would with one shared file.

Considered and rejected:

- **Single JSON, as in Jot.** Simple and proven for todos, but a todo is a line of text. It does not survive embedded images.
- **A database file, such as SQLite.** Solves size and write amplification, but the notes stop being readable or recoverable without the app - a real cost for a local-first tool whose data lives in a synced folder.

Open, and deliberately not decided yet: whether image data is embedded in each note file or written to a sibling assets folder and referenced.
That is a storage-layer detail and does not change the file-per-note shape.

## 2026-08-19 - The design spec is checked in, the mock is not

The Claude Design mock was distilled into [docs/design-spec.md](docs/design-spec.md) rather than committed as a file.

The mock depends on Claude Design's own runtime to render, so a copy in this repository would not open and would not be editable.
A spec, on the other hand, states the measurements, colours and interactions in a form the implementation can be checked against, and a reviewer can read without any tooling.
