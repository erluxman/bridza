# Choose and change a task's target branch from the UI

## Intent

Delivers ticket #14 (`you-just-should-be-able-to-change-the`): a task's landing
branch is not always `main`, but today `target` is only ever set when the task
is created and there is no way to change it afterwards. A task aimed at the
wrong branch currently has to be recreated.

Make `target` editable on the task detail: pick any existing local or remote
branch, persist it to the task's `metadata.json`, and have every downstream
surface read that one value instead of assuming `main` — the finalize button
label and action, the readiness line from [[merge-preflight-check]], and the
PR base branch used by the Create PR work.

Changing the target is a real decision with consequences, so it must be
explicit and it must re-run the readiness check: a branch that was clean to
land on `main` may well conflict with the new target.

## Acceptance Criteria

- [ ] Task detail shows the current target and lets the user change it from a
      list of real branches (local + `origin/*`, de-duplicated); free text that
      names no existing branch is rejected with a readable message.
- [ ] The choice persists to `target` in the task's `metadata.json` through the
      existing task-flag write path in `server/bridza-run.js`, and survives
      reload.
- [ ] `taskTarget` stays the single source of truth — no surface hardcodes
      `main`. Finalize label/action, readiness line and PR base all follow the
      stored value.
- [ ] Changing the target invalidates and re-runs the preflight check
      immediately; a previously-clean task correctly flips to `conflict` when
      the new target diverges.
- [ ] Target cannot be changed on a `finalized` task; the control is disabled
      with a reason.
- [ ] A task whose stored target branch no longer exists surfaces that plainly
      and stays editable instead of erroring on open.
- [ ] vitest coverage with the temp-repo helpers in `src/app/__tests__/`:
      persistence round-trip, unknown-branch rejection, finalized → disabled,
      deleted-target-branch handling, preflight re-run on change.
- [ ] `pnpm test`, `pnpm lint`, `pnpm build` pass.
