# Review — "You should be able to change the target branch of the task or the issue"

**Verdict: APPROVED.** The fix addresses every root cause in `repro.md`, both code paths and the flow-prompt path, with no regressions found in the full suite. The regression tests demonstrably fail on the pre-fix commit and pass on the fix.

## 1. Root cause — addressed (repro.md mapping)

repro.md's failing path has five items; each is closed:

| # | repro.md root cause | Fix | Verified |
|---|---|---|---|
| 1 | No `target` field in metadata; `readProject` exposes none | `createTask` persists + returns `target` (default = `baseBranchName`, rejects non-existent branches); `readProject` exposes `target: meta.target \|\| base`; task commit message records `Target:` | store test "createTask persists + returns a target and readProject exposes it" |
| 2 | `ensureTaskBranch` hard-codes fork from main | Forks from `taskTarget()` — the stored target, else repo default | run test "ensureTaskBranch forks the task branch from the stored target, not main" (fork sha == `release/1.x` sha, ≠ `main`) |
| 3 | `branchDiff` base always main | `branchDiff`, `blastRadius`, `taskTimeline` all resolve `taskTarget()` (three-dot vs the target) | run test "branchDiff reviews against the task's target branch, not main" (base = `release/1.x`; the target's own newer commits stay out of the review) |
| 4 | `finalizeTask` defaults `into \|\| main`, never persisted | `finalizeTask` resolves `into \|\| taskTarget()`; stored target survives edits/reuse sessions; button + README render the real target | run test "finalize merges into the task's target branch when no into is passed" (squash lands on `release/1.x`, `main` untouched: `main` == `release/1.x~1`) |
| 5 | No way to change it; `retargetTask` silently ignored `target` | `retargetTask` accepts + persists `target`, validates the ref, rejects non-existent branches (`nope`) and invalid refs (`??`); bridge forwards `b.target`; new UI `<select>` in the task topbar lists local branches (`GET /api/bridza/branches`) and retargets live | run test "retargetTask sets a target branch and rejects one that doesn't exist"; `getBranches` in client |

Second complaint (tied to repro.md): the fix also makes "in every single flow … the review process makes the change ready to be merged to the reference branch":

- `core/domain.js:mergeGateStageId` — picks each flow's review/release/merge stage (bugfix `fix-review`, feature `review`, sdlc `release`), else the flow's final stage.
- `format.js:mergeStepFor`, appended to `runPrompt` for exactly that gate stage — names the task's target branch, tells the agent to review `git diff <target>...HEAD`, resolve/flag conflicts, and state whether the merge into `<target>` will be clean.
- Applied in both manual runs (`task.jsx:179`) and auto-advance (`views.jsx:53`). All engineering, product, brand, content and marketing flows (739 → `core/domain.js` flow defs) end with a non-empty gate.

## 2. Regression checks — sibling callers

- **Full suite:** `pnpm test` → 183/183 pass (was 178 pre-fix); `pnpm build` (tsc + vite) and `pnpm lint` clean.
- **Backward compatibility:** pre-existing tasks have no `meta.target` → `target: meta.target \|\| base` and `taskTarget()` fall back to `baseBranchName` (main) exactly as before; `healTaskFlow` now only *adopts* a source target, never guesses.
- **Create/branch callers:** `promoteInbox→createTask` (no target → main default), `ensureTaskWorktree→ensureTaskBranch` (same fork helper), `board.jsx` flow retarget (no `target` arg → untouched) all behave as before.
- **API contract:** new endpoint `/api/bridza/branches` is additive; `retargetTask` keeps `flow`/`type` semantics and the destructive flow-switch path (progress discarded) is unchanged — target changes alone are non-destructive (`removed: 0`).
- **Finalize edge cases:** dirty-checkout resolution and the temp-worktree path key off `currentBranch(root) === target`, not `main`; legacy `into` override still wins. Non-existent target at finalize fails gracefully ("target branch X does not exist").
- **e2e** (`e2e/app.spec.js`) does not touch finalize/target UI — unaffected.

## 3. Regression tests fail without the fix

Tests dropped onto the pre-fix commit (`9683b89`): **5 failed / 5 new tests** across both files — `createTask` returns no target, `branchDiff.base` still `main`, `retargetTask` silently ignores `target` (error undefined), `finalize` fails to land on `release/1.x`, and the pre-fix modules lack `taskTarget`/`listBranches` entirely (import error). Same tests on the fix: **5/5 pass**. The repro script (`/tmp/opencode/repro-target-branch.mjs`) now shows `retargetTask → target: "release/1.x"` and `finalizeTask → target: release/1.x` (pre-fix: main).

## 4. Minor observations (non-blocking)

- **Stale copy:** `task.jsx:157/159` flash text and the `resolveMain`/`mainCommitMessage` params still say "main" when the actual target is e.g. `release/1.x` (functionally drive `currentBranch === target`, purely cosmetic naming).
- **repro.md line refs now stale** (finalize moved to `bridza-run.js:1045+`, task.jsx to 281/343) — the locations were the pre-fix snapshot; harmless, but worth an edit if the doc is reused.
- **Doc-only flows** (e.g. content "Captions & publish", brand, marketing) get the git-diff-centric merge block even though they ship docs, not code — a deliberate reading of the "every flow" requirement; the wording lands awkwardly on those final stages.
- The repo also rebuilt `dist/` during review — not part of the fix commit (deploy builds fresh), no action.

**Recommended merge target for this fix:** `main` (this task's stored target; no other `target` set).