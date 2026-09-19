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

Out of scope: writing/renaming folders, migrating existing tasks, UI truncation
call sites — those are separate sub-tasks. This contract only defines the
naming, and touches no existing repo folders.

## Verification

Unit tests (in `src/app/__tests__/bridza-model.test.js`) cover padding, the
`taskDirName` ↔ `parseTaskDir` round-trip, the 10-million width bound, and the
legacy no-prefix / leading-digit-slug fallback. `pnpm test`, `pnpm lint`, and
`pnpm build` pass.