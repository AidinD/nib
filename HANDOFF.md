# Handoff - latest session state

_Overwritten on each handoff (latest-only); prior handoffs are in git history._
_Saved 2026-09-05 17:09. For durable rationale see DECISIONS.md; for the roadmap, PLAN.md._

Handoff summary for a new session — Nib repo (`D:\Repo\Tools\nib`), continuing work by Aidin.

## Current state

All work described below is complete, committed, released, and pushed. `git log --oneline -3` should show `fd9ee93 0.17.0 - a glossary...`, `a0d3ef0 A glossary...`, `b316eb0 Stop naming a task-tracking category...`. Working tree is clean, `origin/main` is even with local `main`. `npm test` passes (142 tests). Nib is released as `v0.17.0` on GitHub (non-draft, verified).

Jot card `0e393129` (Flow category) is in `status: review`, with a review-record on file. Do not move it to `done` — that's the board owner's call.

This session shipped, in order: two feature additions to the transcription→summary pipeline (fill predefined note prompts from a transcript; a glossary that corrects likely mishearings in summaries), two live-data bug fixes (transcription lost on note switch; summary written into the wrong note), a sidebar/alerts restructuring (commitments vs. principles as two rows), a matching fix in the sibling app Tend, and visual styling tweaks for prompt/answer distinction. Full rationale for each is in `DECISIONS.md` (newest-first) — read the top ~6 entries there rather than having this summarized again. `PLAN.md` has current status/open items.

## Key decisions and why (not already in DECISIONS.md as rationale, but useful orientation)

- **The glossary is a hand-edited text file beside the notebook (`glossary.txt`), never derived from source or from Tend.** It cannot be seeded from source with real private names because Nib's repo is public and its own pre-push hook (`no-private-names.mjs`) blocks specific known-private terms. The in-repo seed list is public names only (`Roblox, Meta, Jot, Nib, Tend, Helm`); the real user's file at `D:\Dropbox\nib\glossary.txt` (not version-controlled) holds the actual private terms.
- **The transcript is never rewritten — hard constraint.** Corrections only ever land in the summary, shown as a `data-heard` line ("Rättat mot ordlistan: X → Y ... Transkriptet är oförändrat") placed above the provenance line. Verified byte-for-byte around a real model call.
- **Glossary correction applies only to the meeting-transcript summarization path, not the note-summarization path** — summarizing a note is mostly the user's own typing, and "correcting" his own spelling back at him isn't the point.
- **Prompt-answering unit is the LINE, not the question mark or the heading** — the user explicitly corrected an earlier heading/question-mark-based design because one prompt line can hold multiple questions and one heading can hold multiple prompt lines (the fortnightly-rotation template). This became `promptLayout`/`notePrompts`/`fillAnswers` in `src/renderer/src/lib/notes.ts`.
- **Both live-data bugs (transcription lost on switch, summary pasted into wrong note) share one root cause**: Nib reuses a single `contenteditable` DOM element across notes and swaps `innerHTML` wholesale on note change. Any reference captured before an `await` can go stale (element detached → silent no-op) or worse, silently still point at whatever note is now open (the body itself → writes to the wrong note). Both fixes now capture the target note's id up front and re-resolve/verify against the live DOM (or patch on-disk if the note is no longer open) before writing.
- **Alerts split into two rows (commitments vs. principles/practising)** is driven by a note's Principle tag, chosen by the user via AskUserQuestion despite an explicitly flagged tradeoff (a note with mixed content lands wholly on one side).
- **Tend's importer fix**: `indexNib` was turning every Nib flag — including principle-tagged "things to practise" — into a promise with a deadline. Fixed by computing `commitments = practising ? [] : note.alerts` once per note and feeding it into both the existing stale-withdrawal loop and the existing promise-creation loop, so retagging a note retracts (not resolves) any wrongly-imported promise.
- **Whisper-side glossary ("halva 2" — feeding the glossary to whisper itself as an initial prompt, to prevent mishearings rather than correct them after) is deliberately NOT started.** Its precondition is now resolved though: `whisper-cli.exe` (found via `WHISPER_DIR` user env var) confirms via `--help` that `--prompt PROMPT` exists, capped at `n_text_ctx/2` tokens, plus `--carry-initial-prompt`. The remaining open design question is that cap — the two "halves" (fill-prompts feature and whisper-prompt feature) must not end up maintaining two copies of the glossary.

## Verification approach used (repeat this pattern for future work here)

Every feature this session was verified with a real end-to-end model call (not mocked) using synthesized transcript text (never real recordings), plus unit tests, plus for anything with a "must not change" guarantee (the transcript), a byte-for-byte before/after comparison. See the review-record already on file for the glossary feature for the exact evidence structure expected.

## Standing constraints for this repo (also in `CLAUDE.md`, worth restating since they bit this session)

- Never write into Nib's index/notes while the app is running.
- Never point `NIB_DATA_DIR` at a scratch folder for testing without first seeding an index there — `migrateLegacyData()` will copy real private notes into it.
- The real data directory is in Dropbox (`NIB_DATA_DIR`), not `%APPDATA%\nib` (stale, pre-move copy).
- PowerShell (not Bash) for anything touching `%APPDATA%`.
- Releases go through `npm run release` only (clean → build → package → electron-builder's own publisher) — never hand-assembled.
- A Jot card is moved to `review`, never `done`.

## Pending / next steps

- No outstanding user request. The last explicit ask ("pusha och släpp" for the glossary work) is done.
- A duplicate/stale cross-session message arrived twice describing the glossary task as still pending; it was already fully done. If a similar stale message arrives again, check `git log`, the Jot card status, and `glossary.txt` contents before redoing any work — don't rebuild something already shipped.
- If picking up "halva 2" (whisper-prompt glossary): resolve the shared-list-vs-two-copies design question first, and check with the user before starting, since it was explicitly out of scope for the completed card.
