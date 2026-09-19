# Fix — card archive state now lives on the base branch, so it syncs

Task #36 · `engineering/card-archiving-is-not-working-when` · stage: **fix**

## Root cause (from [repro.md](../../repro/outputs/repro.md))

`setTaskArchived` wrote `archived: true` into the task's `metadata.json` **inside
the task worktree** and committed it onto `bridza/<pipeline>/<task>`. Those
branches are never pushed, and both readers only look at local heads — so the
flag could not physically reach a second computer. Device B fell back to the
base branch's `metadata.json`, read `!!undefined === false`, and put the card
back in its stage column.

## The change

Archive is board-level display state, like pipeline-archived and the kanban
column order — so it is now stored where those are: at the repo root, on the
base branch, in the already-syncing `.bridza/refs.json`.

| File | Change |
|---|---|
| `server/bridza-store.js` | `readRefs` gains `archived: { "<pipe>/<task>": bool }`; new `setTaskArchived` writes it and `commitPaths(root, [".bridza/refs.json"], …)`; `readProject` reads the flag from there; `deleteTask` drops the entry with the `#ref`. |
| `server/bridza-run.js` | Branch-local `setTaskArchived` removed (comment left pointing at its new home). No worktree is created just to archive a card any more. |
| `server/bridge.js` | `/task/archive` imports `setTaskArchived` from the store. Request/response shape unchanged. |

The HTTP endpoint, the client call and `board.jsx` are untouched — the card
still reads `t.archived`.

### Backwards compatibility

`refs.json` is authoritative, but a task with **no** entry there still honours a
legacy `archived: true` left in its own metadata by the old code, so archives
made before this fix keep showing as archived on the machine that made them.
Unarchiving stores an explicit `false`, which outranks that stale flag.

## Verification

`npx vitest run` over the six node suites — **166 passed**, including three new
cases in `bridza-store.test.js` → `task archive state`:

1. **cross-device**: archive → asserts `readProject().…archived === true`, a
   clean working tree, the commit on `main`, then **clones the base branch
   only** (no `bridza/*` head in the clone) and asserts the clone reads
   `archived: true`. This is the reported bug; it fails against the old code.
2. **legacy flag**: an `archived: true` committed on the task branch the old way
   still reads as archived, and unarchiving clears it.
3. **delete**: deleting an archived task retires its archive entry, so a task
   later created with the same id is not archived.

The old `bridza-run.test.js` case asserted only on the task worktree and the
task branch — exactly why the bug shipped — and was replaced by the above.

`repro/outputs/repro.mjs` was updated for the moved import (one line) and now
reports device B as archived.

## Follow-up review — one missed caller

`deleteTask` retired the new `refs.archived` entry, but `deletePipeline`
(`bridza-store.js:590`) — the other place that retires a task's `#ref` and
tombstones it — did not. A stale `true` therefore outlived the pipeline: delete
a pipeline holding an archived card, recreate it with the same ids, and the new
card came back already archived (invisible outside the Archived column).

One line, in the existing retire loop next to the `#ref` deletion:

```js
if (refs.archived[key] !== undefined) { delete refs.archived[key]; refsTouched = true; }
```

Covered by `bridza-store.test.js` → `"deleting the whole pipeline retires its
tasks' archive entries too"` (verified red without the line). Full suite:
**201 passed**, 9 files.
