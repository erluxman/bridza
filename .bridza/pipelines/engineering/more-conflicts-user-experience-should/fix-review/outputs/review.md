# Review — "More conflicts, user experience should be easier." (task #15)

**Status of the fix commit `5f1643a`:** APPROVED — addresses the root cause in
`repro.md`, regression test verified to fail without the fix, no regressions
found in sibling callers. 3 minor, non-blocking notes (§4).

Scope reviewed: `server/bridge.js`, `server/bridza-run.js`,
`src/app/__tests__/bridza-run.test.js`, `src/app/api/client.js`,
`src/app/features/task.jsx`, `src/app/features/diff.jsx` (commit `5f1643a`).

---

## 1. Root cause → fix mapping (repro.md §5)

Every root cause named in the repro is addressed by the fix:

| repro §5 root cause | Fix | Verified |
|---|---|---|
| 1. Conflicts not distinguished from any other merge failure; git stderr discarded | `conflictedFiles()` (`bridza-run.js:50`) detects unmerged entries via `git diff --name-only --diff-filter=U`; the catch in `finalizeTask` (`:1140-1148`) returns a **third outcome** `{ok:false, conflict:true, files, dir, target}` instead of the generic `Command failed: …` error | Regression test 1 asserts `r.conflict === true` and `r.files === ["app.txt"]` |
| 2. Out-of-place conflicts destroy the evidence (`_finalize` worktree deleted by `cleanup()` on conflict) | The catch **never calls `cleanup()` when `conflictedFiles(mwt)` is non-empty** — the worktree that holds the markers is kept, and its path is handed to the app as `dir` | Test 2: `r.dir` worktree still has `.git` + 3 unmerged blobs after the failed merge |
| 3. Editor affordance (`openWorktree`) points at the clean *task* worktree, never at the paused merge | New `POST /api/bridza/conflict/open` → `openDir(dir, conflictedFiles(dir))` → `code -n <dir>` at the **exact folder where the merge is paused** (VS Code Source Control auto-detects `UU` → "Merge Changes" with Accept Current/Incoming/Both + 3-way editor); conflicted files passed as tabs for CodeLens | Bridge/app wiring confirmed end-to-end; §4.1 notes a path-resolution nit |
| 4. "Resolve dirty main" dialog reused for conflicts — renders `path:""` marker garbage, Stash fails on unmerged index, Commit commits marker text | (a) `pendingConflict()` (`:84`) runs **before** the in-place dirty check, so the next Finalize re-surfaces the conflict instead of falling into `needsResolve`; (b) `workingDiff` (`:1282`) now returns `conflicts` and **drops** the broken `{path:"", …markers}` entries | Test 3 asserts a second Finalize returns the same conflict (never the stash/commit trap); test 1 asserts `wd.conflicts === ["app.txt"]` and no file has `path:""` |
| 5. No conflict primitives anywhere | `conflictedFiles`, `pendingConflict`, `openDir`, `finishConflict`, `abortConflict` + 3 bridge routes + client wrappers + `ConflictDialog` UI (Resolve in VS Code / Finish merge / Abort merge) | Tests 1-4 |

The fix also honors the reporter's stated constraint chain: in-app GitHub-style
Accept buttons were judged secondary; the chosen path is the explicitly-allowed
fallback — hand off to VS Code **with the parameters already provided** (right
folder + conflicted files), and keep open/finish/abort **app-driven** so the
user never touches a terminal. That matches "driven by this app".

## 2. Regression test fails without the fix — confirmed

Ran the new `finalize → merge conflict` describe block against the **parent**
commit `4d4b2af` (pre-fix source, same tests):

```
Test Files  1 failed (1)
      Tests  4 failed | 33 passed (37)
```

All 4 new tests fail on the root-cause assertions — `r.conflict` is `undefined`
because pre-fix `finalizeTask` only ever returns the generic
`{ok:false, error:"Command failed: git merge --squash …"}`. With the fix,
`pnpm test` is green: **182 passed (7 files)**, `pnpm build` clean, `eslint`
clean (changed files fall under the repo's ignore patterns; full `eslint .` has
no errors).

## 3. Sibling callers — no regressions found

- **`finalizeTask`** — sole caller is bridge `POST /api/bridza/finalize`
  (`bridge.js:314`). Pre-fix return contracts preserved: normal merge returns
  `{ok:true,…}`; the `needsResolve` / `resolveMain:"stash"|"commit"` path is
  unchanged (new `pendingConflict` guard only short-circuits when a genuine
  unmerged state exists). The 33 pre-existing finalize/merge tests all pass.
- **`workingDiff`** — sole consumers: bridge `GET /api/bridza/working-diff`
  (`bridge.js:282`) and the working-mode `DiffView` (the "dirty main" resolve
  dialog, `task.jsx:407`). The `conflicts` key is additive; the only behavioral
  change is *removing* the previously-broken empty-path entries, which no caller
  depended on.
- **`openWorktree`** — unchanged; kept its own launcher loop (the new
  `launchEditor` is shared only by `openDir`). No effect on the existing
  "Open in VS Code" button.
- **New bridge routes/endpoints, client wrappers, `ConflictDialog`** — purely
  additive; no existing route is shadowed.
- **Repo safety** — the "merge stranded in the user's live main" landmine is
  neutralized: paused conflicts are re-surfaced (never re-run), and the only
  escape hatches are explicit Finish (commit resolution) or Abort (`merge
  --abort` / `rebase --abort` / `reset --hard HEAD` for in-place squash — safe
  because in-place merges only start from a clean tree after the
  stash/commit-resolve step).

## 4. Non-blocking notes

1. **`launchEditor` resolves extra tab paths against the server's cwd, not the
   target dir** (`bridza-run.js:187` — `path.resolve(String(p))` should be
   `path.resolve(dir, p)`). When the server cwd ≠ the repo, the conflicted-file
   "tabs" could point at wrong absolute paths. Impact is low: the primary
   handoff — the `code -n <dir>` window on the paused-merge folder, whose Source
   Control lists the `UU` files with Accept buttons — is correct and unaffected.
   Suggest `path.resolve(dir, p)`.
2. **Dead UI branch** — `task.jsx:151` checks `r.conflictResolved`, but nothing
   emits it: finishing a resolved merge through a re-run Finalize returns
   `{ok:true,…}` (spread of `finishConflict`), handled by the `r.ok` branch.
   Harmless; can be removed.
3. **Changing the finalize target mid-conflict** silently discards the pending
   merge: `pendingConflict` is matched against the *current* `target`, so
   finalizing into a different branch with an old conflict sitting in
   `_finalize` reaches step 4's `if (fs.existsSync(mwt))` removal
   (`bridza-run.js:1113`) and deletes the markers. Edge case (user would have to
   abandon a merge and pick a new target in the same session); the "never
   destroy a half-finished merge" invariant could be extended to any existing
   `_finalize` worktree that is still mid-merge.

Also noted: `finishConflict` completes paused merges with `git add -A` +
commit, which is correct for merge/squash states; a paused **rebase** would
nominally need `git rebase --continue`. In practice unreachable here (the task
branch is checked out in its own worktree, so the in-repo `git rebase target
branch` already fails at checkout — pre-existing behavior, not introduced).

## 5. Flow fit

Filed under the **bugfix** flow; the fit-check was reasonable — while the ask
("easier conflict UX") has feature flavor, this is a genuine bugfix: conflicts
currently strand or destroy state and force the user into a terminal. The fix
lands as one coherent, well-tested change without expanding scope. Fits the
flow.

## 6. Verdict

**Approve.** Root cause fully addressed, regression tests proven to fail
pre-fix, full suite/build/lint green, sibling callers unaffected. The three
notes in §4 are minor polish, not blockers.