# Zero-padded numbered-folder naming contract

## WHAT & WHY

Every task's on-disk folder must carry the task's project-wide `#ref` at the
front, zero-padded to a FIXED width, so the folders sort in generation order
(creation order) wherever they are listed on disk. The scale target is up to
~10 million issues/bugs/requests, so the width must comfortably cover eight
digits. The padded form is ONLY for the folder name; everyone interacting with
the UI sees the plain integer (`#17`, never `#00000017`).

For the parent task (`every-task-when-they-are-converted-into`) the on-disk
format changes from:

    pipelines/<pipeline>/<slug-task-id>/            (today)

to:

    pipelines/<pipeline>/<padded-ref>-<slug-task-id>/   (target)

e.g. `pipelines/engineering/00000017-every-task-when-they-are-converted-into/`.

This sub-task is the ONE place where the folder-naming contract lives: pure
helpers in `core/domain.js` (no fs/git), imported by every other sub-task. Its
inputs/outputs are the source of truth for the write path, the read/enumerate
path, the migration, and the UI truncation.

## ACCEPTANCE CRITERIA

- `core/domain.js` exports a `REF_WIDTH` constant (8) that zero-pads the ref for
  the folder prefix. Width is a single named constant that satisfies "up to ~10
  million tasks".
- `padRef(n)` returns `String(n).padStart(REF_WIDTH, "0")` (e.g. `17` →
  `00000017`).
- `taskDirName(pipeline, task, ref)` returns the full on-disk dir name
  `<padded-ref>-<slug>` (e.g. `engineering`, `every-task-…`, `17` →
  `00000017-every-task-…`). Pipeline slug + task slug reuse the existing
  `safeRef`/`taskSlug` helpers.
- `parseTaskDir(dirName)` reverses it: returns `{ ref: 17, id: "every-task-…" }`
  for a padded dir, and treats any dir that does NOT start with exactly
  `REF_WIDTH` digits + `-` as a LEGACY unpadded dir (`{ ref: null, id:
  dirName }`) — so a slug that merely begins with digits (e.g. `2fa-rollout`)
  is never mis-parsed.
- `displayRef(ref)` returns the plain integer for UI rendering (leading zeros
  truncated) and is the single display helper all UI callers use.
- Unit tests in `src/app/__tests__/bridza-model.test.js` cover: padding,
  round-trip parse of `taskDirName`, the 10-million width bound, and the legacy
  no-prefix / leading-digit-slug fallback. `pnpm test` passes, `pnpm lint`
  passes.

Note: this contract itself writes no folders and touches no existing tasks —
existing repos keep current folders until the migration sub-task runs.