# Fix — opening a task no longer auto-starts anything (#39)

- Pipeline: `engineering` · Task #39 · Flow: bugfix · Branch: `bridza/engineering/when-opening-a-task-or-card-it-should`
- Fit check: this IS a single bugfix — one behavioral rule in one screen (`TaskDetail`) plus its tests. Stays in the **Bugfix** flow.

## The contract, after this change

1. **Opening a task or card starts nothing.** Mounting `TaskDetail` never calls a runner — not the first stage, not any stage.
2. **Auto-advance is a setting, on by default, and it is remembered per task.** It says only whether a *finished* stage may carry the task on; flipping it never starts a run.
3. **Auto-advance is forward-only and can never reach the first stage.** It runs only after a stage the user started finishes `done`, and only over the stages *after* that one.

## Root cause (from `repro.md`) and what changed

The mount-time effect in `src/app/features/task.jsx` called `automate()` for any task with a non-`done` stage, so merely opening a never-started task ran stage 1. And the topbar switch was bound to `automating` — live-run state, not a setting — so "auto-advance off" had nothing to store.

| # | Change | File |
|--:|--------|------|
| 1 | Deleted the mount-time `autoStartedRef` effect that called `automate()` on open. Nothing runs from mounting any more. | `src/app/features/task.jsx` |
| 2 | New `stageDone(end, stageId)` — the single shared completion path for every stage run in the screen. Refreshes as before, then chains **only** when: the setting is on, the run came back `status === "done"`, the stage isn't the last one, work remains after it, and no other stage of the task is live elsewhere. | `src/app/features/task.jsx` |
| 3 | `automate(from = 0)` now slices the stage list from `from`. `stageDone` passes the *next* index, so an earlier or never-started stage — the first stage above all — is never pulled into a chained run. The server still re-checks the branch tip and skips stages already done. | `src/app/features/task.jsx` |
| 4 | Auto-advance is now a real per-task setting: `autoAdvance` state, default **on**, persisted in `localStorage` under `bridza.autoAdvance.<pipeline>/<task>` (the same idiom as `bridza.taskView` / `bridza.railHidden` in this screen). The topbar switch reads/writes the setting instead of the ephemeral `automating` flag, and the label still reads "⚡ Auto-advancing…" while a chained run is live. | `src/app/features/task.jsx` |
| 5 | `StageRunner` now reports the outcome: `onDone(end, def.id)` instead of `onDone()`. | `src/app/features/views.jsx` |
| 6 | Dropped the now-unused `briefLoaded` state (it existed only to delay the removed auto-start). | `src/app/features/task.jsx` |

### Every caller checked, fixed at the shared path

`StageRunner` is the ONLY thing that runs a stage from the task screen, and it reaches the task through one `onDone` prop. Both routes into it — the classic `Stage` card and the Inspector/Canvas/Chat views via `runnerFor` — now point at the same `stageDone`, so the rule lives in one place. Stage's other `onDone()` calls (↺ Revise, ⏹ Stop) pass no run result, so they refresh and chain nothing, which is what they should do. `App.jsx`'s `onDone` props belong to the pipeline/task *modals* — unrelated. No server change: `automateTask` already resumes from the first incomplete stage in whatever list it's handed, and it now simply isn't handed the earlier ones.

## Tests

`src/app/__tests__/task-auto.test.jsx` rewritten to the corrected contract (12 tests):

- opening a never-started task, and a half-done one, calls neither `automate` nor `runStage` (and the switch still shows on)
- finalized / all-done tasks still start nothing (kept from #13)
- running the first stage by hand chains forward, sending **only** `["build"]` — never back into the first stage
- three-stage task, user runs the middle stage while the first has never run → chains `["review"]` only
- no chaining past the last stage, none when the run came back `failed`, none while another stage of the task is live
- the setting: turn it off → the stage still runs but nothing chains after it; the "off" survives reopening the task
- the run-log pane still survives navigation, a live background run is shown without restarting, and re-opening after a run stopped no longer restarts advancing

E2E specs that asserted the old auto-start were updated to press ▸ Run first: `e2e/ux-views.spec.js` ("auto-advance carries the task to done once a stage is started by hand", plus the throwaway-task test, which now asserts nothing ran on open) and `e2e/app.spec.js` (handoff test).

## Verification

```
vitest run   →  9 files, 205 tests passed   (whole unit suite)
vitest run src/app/__tests__/task-auto.test.jsx  →  12 passed
```

The new tests were run against the pre-fix `task.jsx`/`views.jsx` as a check that they bite: **8 of 12 failed**, including "opens a task with every stage still to run and starts NO run at all". Lint: `src/app` is excluded by `eslint.config.js`, so no lint surface here. E2E (Playwright) was not run — it needs a live dev server and browsers, unavailable in this worktree.

Note: this worktree had no `node_modules`; deps were installed locally (gitignored) to run the suite.
