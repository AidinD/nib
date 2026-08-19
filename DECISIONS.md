# Nib - decisions

Newest first.
Each entry records the decision, what else was considered, and why the choice was made.

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
