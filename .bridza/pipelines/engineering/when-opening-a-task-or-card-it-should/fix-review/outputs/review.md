# Review — opening a task no longer auto-starts anything (#39)

- Pipeline: `engineering` · Task #39 · Flow: bugfix · Branch: `bridza/engineering/when-opening-a-task-or-card-it-should`
- Landing branch: **`main`** · Scope: review only — no source files were changed by this stage.

## Verdict

**Approve.** The fix addresses the root cause named in `repro.md`, the regression tests genuinely bite, no sibling caller regressed, and the merge into `main` will be clean. Findings below are advisory (low severity), not merge blockers.

## 1. Does the fix address the root cause in `repro.md`?

Yes, on all three of the repro's asks, and at the right layer.

| repro.md root cause | Addressed | Evidence |
|---|---|---|
| §1 Mount-time effect calls `automate()` with no "has this been started" gate | Yes — effect **deleted outright** | The `autoStartedRef` `useEffect` (old `task.jsx:234-249`) is gone. `automate` is now reachable from exactly one call site: `automate(next)` inside `stageDone` (`task.jsx:269`). Verified by grep — no other `automate(` in `src/` outside tests. |
| §2 `automate()` sends the whole chain including the never-started first stage | Yes | `automate(from = 0)` slices: `stageObjs.slice(from)` (`task.jsx:224`). `stageDone` passes `indexOf(stageId) + 1`, so the chain can only ever move forward. |
| §3 No persisted "auto-advance enabled" preference, switch bound to ephemeral `automating` | Yes | New `autoAdvance` state, default on, persisted to `localStorage` under `bridza.autoAdvance.<pipeline>/<task>` (`task.jsx:57-90`). The switch is now `checked={autoAdvance}` and writes the setting rather than kicking a run. |
| §4 Regression locked in by the test suite | Yes | `task-auto.test.jsx` rewritten to the inverted contract (12 tests). |

The `stageDone` guard chain is correct on the edges I checked:
- `indexOf` returning `-1` → `next === 0` → caught by `next <= 0` (unknown stage, no chain).
- Last stage → `next >= task.stages.length` → no chain.
- Non-`done` outcome (`failed`/`stopped`) → no chain.
- `liveHere` deliberately excludes the stage that just finished (`k !== key + "/" + stageId`), which is right: the `runningStages` snapshot can still list the finished stage and would otherwise suppress every legitimate chain.
- Stale `task.tracking` can only cause an *extra* stage to be sent; the server re-checks the branch tip per stage and skips `done` ones, so it cannot cause a re-run.

## 2. Regressions in sibling callers

Checked every consumer of the `onDone` contract that changed signature (`onDone()` → `onDone(end, def.id)`):

| Call site | Passes | Effect | Verdict |
|---|---|---|---|
| `views.jsx:65` `StageRunner` | `(end, def.id)` | the one path that can chain | intended |
| `task.jsx:764` `Stage` ↺ Revise | no args | `end` undefined → refreshes, chains nothing | correct |
| `task.jsx:775` `Stage` ⏹ Stop | no args | `end` undefined → refreshes, chains nothing | correct |
| `task.jsx:386` `runnerFor` (Inspector/Canvas/Chat) | forwards `runner.onDone` | same `stageDone` | correct — one shared rule |
| `App.jsx:125,129` | `onDone(pid)` / `onDone(tid)` | `NewPipelineModal` / `NewTaskModal` — unrelated components | not affected |
| `ux-views.test.jsx:125` | `noop` | tolerant of extra args | not affected |

Both routes into `StageRunner` (the classic `Stage` card and `runnerFor`) converge on the same `stageDone`, so the rule lives in one place. `fix.md`'s claim on this point is accurate as written.

Full unit suite re-run by me: **9 files, 205 tests passed** — matches the fix report, no sibling test regressed.

## 3. Does the regression test fail without the fix?

**Yes — independently verified, not taken on trust.** I checked out the pre-fix `src/app/features/task.jsx` and `views.jsx` from `main`, kept the new test file, and re-ran:

```
Tests  8 failed | 4 passed (12)
```

Failing pre-fix, passing post-fix — including the headline case:

- × opens a task with every stage still to run and starts NO run at all
- × opens a half-done task (first stage already done) and still starts nothing
- × carries on after the first stage is run by hand — sending only the stages after it
- × never reaches back: running a middle stage advances forward only, skipping the unrun first stage
- × does not advance past the LAST stage
- × does not advance when the stage did not finish done
- × is off once you turn it off … and it is remembered
- × does NOT restart advancing on re-open once the run has stopped

The 4 that pass pre-fix are the pre-existing guards kept from #13 (finalized task, all-done task, another stage live elsewhere, live background run shown without restart) — correctly unchanged. Source was restored from `HEAD` afterwards; the working tree carries no source modification from this stage.

E2E selectors were checked statically against the components (Playwright was not run — it needs a live dev server and browsers): the label regex `/Run (stage|again)/` matches `▸ Run stage` / `▸ Run again` (`views.jsx:79`), and the first incomplete stage card is open on arrival (`task.jsx:42`), so the `.first()` Run button is on screen without an extra expand click. The updated specs are consistent with the new behavior.

## 4. Merge readiness into `main`

**The merge into `main` will be clean.**

- `git merge-tree --write-tree main HEAD` → returns a single tree SHA (`0ccbc7b…`) with no conflict section — a clean merge.
- Divergence: `main` is 44 commits ahead, this branch 3 ahead. **None of `main`'s 44 commits touch `src/` or `e2e/**` (`git log main --not HEAD -- src/ e2e/` is empty) — they are all `.bridza` plan/inbox bookkeeping. So the merge is clean textually *and* free of semantic drift on the code this task changes.
- Landing branch naming: task outputs and docs correctly reference `main`; no stale `master` reference anywhere in the task's documents.
- Housekeeping: the worktree carries an uncommitted `metadata.json` edit and the untracked `fix-review/` stage directory — normal pipeline bookkeeping for the in-flight stage, to be committed when this stage closes.

## 5. Findings (advisory — none blocking)

1. **Flipping the switch ON no longer starts anything, and no "resume advancing" affordance replaced it.** `repro.md:21` explicitly allowed the switch as an explicit start ("runs the stage, *or flips the Auto-advance switch themselves*"), and the old code commented that "the topbar switch still lets you re-kick advancing after a stop." After this change the switch is purely a setting. Recovering a stopped mid-task run now requires opening a stage card and pressing ▸ Run. This is a defensible — arguably safer — reading of the user's "it should not auto start at any steps," and the behavior is fully recoverable, but it is a deliberate narrowing of the repro's stated expectation and is not called out as such in `fix.md`. Worth a line in the task notes so it isn't later mistaken for a bug.

2. **The setting is browser-local, not task state.** `repro.md:93` suggested promoting it to persisted task-level state (e.g. `task.autoAdvance`); the fix used `localStorage`, matching the existing `bridza.taskView` / `bridza.railHidden` idiom in this screen. Consequence: "auto-advance off" does not follow the task across browsers, machines, or a cleared profile — it silently reverts to ON. Blast radius is small now that the setting can only ever *chain after a human start*, never auto-start. Reasonable trade-off; flagging it as a known limit rather than a defect.

3. **While a chained run is live the setting cannot be changed at all** — the input is `disabled={automating || task.finalized}`, so stopping an in-flight chain requires ⏹ Stop. Consistent and not a regression (the old switch was disabled the same way), just noting the only lever mid-run is Stop.

4. **Minor test-quality nit** — in `e2e/ux-views.spec.js` the throwaway-task test asserts `expect(page.locator(".stage .tag.done")).toHaveCount(0)`, which Playwright satisfies immediately since the count is already 0. It does not really prove "nothing ever started"; asserting `.term` has count 0 after the app has settled would bite harder. Does not weaken the unit-level coverage, which does cover this properly.

## Summary

Root cause in `repro.md` is fixed at its source (the mount-time effect is deleted, not patched around), the forward-only guarantee is enforced by slicing the stage list rather than by hoping the server declines, every sibling `onDone` caller behaves correctly under the new signature, the 12 regression tests demonstrably fail without the fix, the full 205-test suite is green, and the branch merges into `main` cleanly with no source-level drift. Ready to merge.
