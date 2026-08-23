# Nib - project notes

Nib is a desktop note-taking app, a sibling to Jot (`D:\Repo\Tools\jot`) rather than a part of it.

## Read these first

- [PLAN.md](PLAN.md) - current status, scope, next steps, open questions.
- [DECISIONS.md](DECISIONS.md) - what was decided and why, newest first.
- [docs/design-spec.md](docs/design-spec.md) - the visual and interaction spec the implementation is checked against.

Keep both PLAN.md and DECISIONS.md current as work happens, not in a batch at the end.

## Releases

Nib follows Jot's rule: **a release is bump the version, commit, push, then build
the installer** - in that order.

- The version lives in `package.json` and is shown in the app header, so it is how you tell which build you are running. A build handed over under a version that has already been handed over is a build nobody can identify.
- Bump the patch digit for fixes, the minor for a batch of new behaviour. Commit it as `Release X.Y.Z: <what changed>`, which is also how Jot's history reads.
- Nib does **not** auto-update yet: there is no `electron-updater` and no publish target in `electron-builder.yml`, so an installer is something you build and run by hand. If that changes, the version increase becomes the delivery mechanism and skipping a bump means the fix never reaches the installed app - which is the mistake Jot's DECISIONS entry of 2026-08-04 records.

## Conventions

- Jot is the reference for project layout and build setup. When a structural question comes up, look at how Jot solved it before inventing something new.
- Nib is a separate application with its own data store. Do not reach into Jot's data.
- Task tracking lives in the Jot category **Note taking app**, bound to this repository via its `repoPath`.
