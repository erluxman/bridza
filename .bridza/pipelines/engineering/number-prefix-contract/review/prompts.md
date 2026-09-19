# Prompt history — Review

One entry per "Run stage" press (oldest first). The same text is in each
run record in metadata.json and in the stage's commit message.

## 2026-09-19T16:59:42.273Z · run 1 · opencode

Task: Zero-padded numbered-folder naming contract

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

## KEY-SHAPE CONSEQUENCE (added after #36)

The folder name is also the KEY shape used across the project's board state.
`.bridza/refs.json` stores three maps keyed `"<pipeline>/<task>"` — `refs`
(#numbers), `deleted` (tombstones) and `archived` (board archive state, added
by #36) — and `.bridza/plan.json` keys `deps`, `est` and milestone `tasks` the
same way.

So this contract must define which of the two forms is the canonical key — the
plain task id (`every-task-…`) or the padded folder name (`00000017-every-task-…`)
— and expose ONE helper that every reader and writer of those maps calls.
Recommendation: keep the plain id as the key (folder names then carry ordering
only, and no key rewrite is needed when a folder is renamed); if the padded form
wins instead, `migration-existing-tasks` must rewrite all three refs.json
namespaces plus plan.json in the same commit.

Merge readiness — this task's change will be merged into the branch "main" (on finalize Bridza merges this task's branch into it). Make the change READY TO BE MERGED into "main": review the task's branch against that branch (`git diff main...HEAD`, `git merge-tree`), resolve or flag conflicts with it, make sure outputs and docs name "main" (not "main") where a landing branch matters, and state plainly in your review output whether the merge into "main" will be clean. A delivered task must be merge-ready into "main", not just done.

