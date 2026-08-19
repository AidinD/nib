# Nib - project notes

Nib is a desktop note-taking app, a sibling to Jot (`D:\Repo\Tools\jot`) rather than a part of it.

## Read these first

- [PLAN.md](PLAN.md) - current status, scope, next steps, open questions.
- [DECISIONS.md](DECISIONS.md) - what was decided and why, newest first.
- [docs/design-spec.md](docs/design-spec.md) - the visual and interaction spec the implementation is checked against.

Keep both PLAN.md and DECISIONS.md current as work happens, not in a batch at the end.

## Conventions

- Jot is the reference for project layout and build setup. When a structural question comes up, look at how Jot solved it before inventing something new.
- Nib is a separate application with its own data store. Do not reach into Jot's data.
- Task tracking lives in the Jot category **Note taking app**, bound to this repository via its `repoPath`.
