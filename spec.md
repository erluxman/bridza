# Zero-padded numbered-folder naming contract

## What

Every task's on-disk folder is prefixed with the task's project-wide `#ref`,
zero-padded to a fixed width, so folders sort in generation (creation) order
wherever they are listed on disk. The padded form exists only in folder names;
everywhere in the UI the plain integer is shown (`#17`, never `#00000017`).

On-disk format changes from:

    pipelines/<pipeline>/<slug-task-id>/                  (today)

to:

    pipelines/<pipeline>/<padded-ref>-<slug-task-id>/     (target)

e.g. `pipelines/engineering/00000017-every-task-when-they-are-converted-into/`.

## Why

At scale (~10 million issues/bugs/requests), bare slugs sort alphabetically, not
by order of creation. A fixed-width zero-padded `#ref` prefix gives lexicographic
sorting == generation order, while keeping the folder name stable and unique
(`#ref` never repeats). The `#ref` already exists in `.bridza/refs.json`, so
prefixing costs no new identity — only naming.

## How

The contract lives in `core/domain.js` as pure helpers (no fs/git) — the single
source of truth imported by the write path, read/enumerate path, migration, and
UI display:

- `REF_WIDTH` — single constant `8` (covers one to ten million: `00000001` …
  `10000000`).
- `padRef(n)` — `String(n).padStart(REF_WIDTH, "0")`; `17` → `00000017`.
- `taskDirName(pipeline, task, ref)` — `<padded-ref>-<slug>`, reusing the
  existing `safeRef`/`taskSlug` helpers.
- `parseTaskDir(dirName)` — inverse of `taskDirName`, returning
  `{ ref, id }`. A dir NOT beginning with exactly `REF_WIDTH` digits + `-` is
  treated as a legacy unpadded dir (`{ ref: null, id: dirName }`), so a slug
  that merely starts with digits (e.g. `2fa-rollout`) is never mis-parsed.
- `displayRef(ref)` — plain integer for UI rendering, the single display helper
  all UI callers use.

Key shape: `.bridza/refs.json` and `.bridza/plan.json` stay keyed by the plain
task id (`<pipeline>/<slug>`, the `id` from `parseTaskDir`); the folder prefix
carries ordering only, so renaming a folder never rewrites board state.

The write path (`createTask`) names the folder once the `#ref` is assigned, and
the read path resolves an id to whichever folder exists. Both live behind two
resolvers in `server/bridza-run.js`, so a read and a write can never disagree:

- `taskDirOn(treeRoot, p, t)` — against a checked-out tree (repo root or a task
  worktree). Order: an existing folder whose parsed id matches (padded wins) →
  the name the contract says it should have, from `.bridza/refs.json` → the
  bare id. Step 2 is what lets a write into a fresh worktree land on the padded
  name before the folder exists.
- `taskDirAt(root, branch, p, t)` — the same against a branch tip, for
  `git show <branch>:<path>` reads; falls back to `taskDirOn`.

Legacy folders are never touched: a task created before the contract keeps its
bare slug forever and resolves through the same two functions. `scanBranches`
and every directory listing parse the folder name back to the plain id, so the
board, the plan network and every `bridza/*` branch name are unchanged.

Out of scope: migrating existing folders to the padded form, and the UI
truncation call sites — those remain separate sub-tasks.

## Verification

Unit tests (`src/app/__tests__/bridza-model.test.js`) cover padding, the
`taskDirName` ↔ `parseTaskDir` round-trip, the 10-million width bound, and the
legacy no-prefix / leading-digit-slug fallback.

Store tests (`src/app/__tests__/bridza-store.test.js`, "zero-padded task
folders") cover the end-to-end behaviour: a new task lands in
`00000001-<id>` while its id, branch name and `refs.json` key stay plain;
folders sort in creation order rather than alphabetically; a legacy unpadded
folder is still enumerated, read, context-edited and deleted, and coexists with
padded ones; and a duplicate id is refused without burning a `#ref`.

`pnpm test` (230), `pnpm lint`, `pnpm build` pass.