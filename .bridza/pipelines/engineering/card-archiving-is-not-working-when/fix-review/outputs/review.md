# Review — archive state moved to the base branch

Task #36 · `engineering/card-archiving-is-not-working-when` · stage: **fix-review**

**Verdict: approved.** The fix addresses the root cause named in
[repro.md](../../repro/outputs/repro.md), the regression tests are load-bearing
(each was driven red by mutating the fix), and no sibling caller regressed.
Four non-blocking notes below; none justify holding the merge.

## 1. Does it address the root cause?

repro.md's root cause: `setTaskArchived` committed `archived` onto
`bridza/<pipeline>/<task>`, a branch that is never pushed, so the flag could not
reach a second machine.

The fix moves the write to `.bridza/refs.json` at the repo root, committed on
the base branch — the same shelf as `#refs`, kanban order and pipeline-archive,
all of which already sync. `readProject` reads the flag from there
(`bridza-store.js:408`), falling back to a legacy `meta.archived` only when
refs.json has no entry for the key.

Verified by mutation, not by reading: reverting line 408 to the pre-fix
`archived: !!meta.archived` reproduces the reported symptom exactly —

```
× commits the archive on the base branch, so it survives a clone of it
  AssertionError: expected false to be true
× still honours a legacy flag on the task branch, and unarchive clears it
  AssertionError: expected true to be false
```

The first is the bug as filed: archive on device A, clone the base branch only,
card reads `archived: false`.

## 2. Are the regression tests load-bearing?

Three independent mutations, each run against
`bridza-store.test.js -t "task archive state"`:

| Mutation | Test that went red |
|---|---|
| `readProject` reads `!!meta.archived` (pre-fix behaviour) | cross-device clone + legacy-flag (2 failed) |
| drop `delete refs.archived[key]` in `deleteTask` | "deleting an archived task retires its archive entry too" |
| drop the archive line from `deletePipeline`'s retire loop | "deleting the whole pipeline retires its tasks' archive entries too" |

Each mutation was reverted and the file restored byte-identical
(`git diff -- server/` empty). Green afterwards: **201 passed, 9 files**,
`task archive state` 4/4.

The cross-device test earns particular credit for cloning with
`--single-branch --branch main` and asserting `refs/heads/bridza/` is empty in
the clone — it tests the actual transport failure, not a proxy for it. The old
`bridza-run.test.js` case asserted on the task worktree and the task branch,
which is precisely why the bug shipped green; replacing it was correct.

## 3. Sibling callers

Every reader and writer of the touched surfaces was checked:

- **refs.json writers** — `assignRefs`, `deleteTask`, `deletePipeline`,
  `setTaskArchived` all do `readRefs()` → mutate → `writeJSON(whole object)`.
  Since `readRefs` now always materialises `archived: {}`, none of them can drop
  the map on a round-trip. ✅
- **`readProject`** is the only consumer of `meta.archived`. ✅
- **`bridge.js:240`** — `/task/archive` request/response shape unchanged; only
  the import moved. `client.js:37` and `board.jsx:83` untouched and still
  correct (`t.archived`, `r.archived`). ✅
- **`bridza-run.js`** — no internal caller of the removed function remained;
  only the pointer comment at `:1070`. ✅
- **Import direction** — `bridza-store.js` now also imports `validRef` from
  `bridza-run.js`, which is the direction that already existed
  (`git`, `branchExists`, …). `bridza-run.js` does not import the store, so no
  cycle is introduced. ✅
- **`repro.mjs`** — updated for the moved import; still drives the real APIs. ✅

## 4. Notes (non-blocking)

1. **`setTaskArchived` no longer checks that the task exists.** The old path
   failed early through `ensureTaskWorktree`; the new one validates ref *syntax*
   only. Confirmed on a scratch repo:
   `setTaskArchived(root, "ghost", "nope", true)` → `{ ok: true }` plus a commit
   on `main` carrying `"ghost/nope": true`. Only the board calls this endpoint,
   with ids it just rendered, so the reachable risk is low — but a stray entry is
   invisible and permanent, and one existence check would close it.
2. **The commit lands on whatever branch the root checkout is on**, not
   necessarily the base branch. Inherited from the `#refs` / kanban-order
   pattern rather than introduced here, but archiving is a far more frequent
   click than assigning a ref, so it will hit this case sooner.
3. **refs.json becomes a hotter merge-conflict surface** — every archive toggle
   on every device rewrites one shared JSON file. Same class as `#ref`
   assignment, and the right trade for syncing at all; worth a keyed-merge
   follow-up if conflicts actually show up in practice.
4. **Entries can outlive their task** when a task disappears without going
   through `deleteTask` / `deletePipeline` (e.g. a task that only ever existed
   on an unmerged branch). Harmless — the key is simply never read — and the
   tombstone paths that matter are covered.

## 5. Backwards compatibility

A pre-fix archive (flag on the task branch, nothing in refs.json) still reads as
archived on the machine that made it, and unarchiving writes an explicit
`false` that outranks the stale flag. Both halves are asserted by the
legacy-flag test, and both went red under mutation 1 — so the compatibility path
is genuinely exercised, not just described.
