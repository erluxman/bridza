# Reproduce — "You should be able to change the target branch of the task or the issue"

## Symptom

A task (or issue) has **no target branch** anywhere in the model. Bridza hard-wires
every task to the repo default branch (`main`/`master`): the task branch is created
from it, every diff is reviewed against it, and finalize always merges into it. You
cannot set or change where a task's work will land — e.g. `release/1.x`, `ux-revamp`,
a feature branch — even though `release/1.x` exists as an integration branch.

Second complaint (tied): no flow step ever makes a change "ready to be merged to the
reference branch it is going to be merged into". The engineering `feature`/`bugfix`
flows and the product flows end at a *review* stage that writes prose (`review.md`,
`CHANGELOG.md`) but never targets, prepares, or validates a merge into the branch the
feature was supposed to land on.

## Root cause

The "target branch" concept does not exist in the model:

1. **No field in task metadata.** `createTask` writes `metadata.json` with
   branch/stages/status/tracking only — no `target`, `base`, or `into`
   (`server/bridza-store.js:600-604`). `readProject` returns no such field
   (`server/bridza-store.js:378-386`).
2. **Branch creation hard-codes main.** `ensureTaskBranch` forks the task branch from
   `baseBranchName(root)`, which is literally `main`/`master` when either exists
   (`server/bridza-run.js:47-51,75-87`).
3. **Review diff always vs main.** `branchDiff` computes everything against
   `baseBranchName(root)` (`server/bridza-run.js:1139-1150`) — so the Review step can
   never see the task's delta against the *intended* integration branch.
4. **Finalize defaults to main and the UI never overrides it.** `finalizeTask` picks
   `into || baseBranchName(root)` (`server/bridza-run.js:1006-1011`). The `into`
   option exists in the API (`server/bridge.js:316`) but nothing in the UI passes it:
   `src/app/features/task.jsx:147-152` calls `api.finalize(dir, { pipeline, task,
   resolveMain, mainCommitMessage })` and the button is hard-coded
   **"Finalize → main"** (`task.jsx:277`). Even when `into` is passed it is a
   one-shot argument — never persisted, so re-diffs and reuse sessions still assume
   main.
5. **No way to change it.** The only post-creation mutation API is `retargetTask`
   (`server/bridza-run.js:933`), which handles `flow`/`type` only — there is no
   `target` option, and no UI control anywhere (board, task topbar, settings) sets or
   edits a target branch.

Voice-to-text note on the report: "always merging domain" = always merging to
**main**; "main-minute we always have the target" = the user pointing out the target
(integration branch) is known at creation time and should be stored/used.

## Reproduction (verified end-to-end)

Script: `/tmp/opencode/repro-target-branch.mjs` — real temp git repo, real
`server/` modules via `node`, stub tool via `BRIDZA_TOOL_OVERRIDE`.

**Setup:** repo with `main` plus a real integration branch `release/1.x`
(commit `1894f30`), then a task whose intent is "ship to release/1.x" created and run
through its `spec` stage.

**Observed:**

```
=== Repo state ===
default base branch   : main
release/1.x tip       : 1894f30
task branch forked at : 81c07a2 (sha of main, prior to release/1.x commit 1894f30)
task branch commits   : ["bridza(engineering/feature-1/spec): done · opencode · exit 0 · 1 file"]

=== branchDiff (what the Review step sees) ===
base reported: main   (task targets release/1.x, so the diff misses the release/1.x delta)

=== retargetTask({ target: "release/1.x" }) ===
ok: true, returned: {"ok":true,"branch":"bridza/engineering/feature-1","flow":"main","type":"","stages":["spec"],"removed":0,"committed":false}
                     (no target field — option silently ignored)

=== finalizeTask(...) with no into (the UI's only call path) ===
ok: true, target: main  (always main — feature lands on the WRONG branch)
main log head        : bridza: finalize engineering/feature-1 · #1 "ship to release/1.x" → main
release/1.x has it?  : NO — feature not on release/1.x
```

**Expected:** the task carries `target: "release/1.x"` set at creation; the task
branch forks from / diffs against / finalizes into `release/1.x`; the user can change
that target anytime before finalize; and each flow's review step runs against the
target branch and hands off a merge-ready change.

## Failing path (exact steps)

1. Repo has a non-default integration branch (`release/1.x`) with real commits.
2. Capture an idea / create a task titled to land on that branch. Creation accepts no
   target — metadata has no field for it (`bridza-store.js:600`).
3. Task branch is forked from `main` (`ensureTaskBranch` → `baseBranchName`), so it
   never contains the `release/1.x` context it's meant to extend.
4. Run stages. The Review run asks the agent to review `branchDiff`, whose `base` is
   computed as `main` (`bridza-run.js:1143`) — the review cannot be against the
   intended target.
5. Try to "change the target branch": no control in the UI; `retargetTask` accepts
   only `flow`/`type`/`stages` (`bridza-run.js:933`) and silently ignores `target`.
6. Click **Finalize → main**. `finalizeTask` resolves `into || baseBranchName(root)`
   = `main` (`bridza-run.js:1010`); the squash commit lands on `main`
   (`"bridza: finalize … → main"`) and `release/1.x` does not contain the feature.

## Code locations

- `server/bridza-run.js:47-51` — `baseBranchName` = main/master hard-coded default
- `server/bridza-run.js:75-87` — `ensureTaskBranch` forks from that default
- `server/bridza-run.js:933` — `retargetTask` (flow/type only)
- `server/bridza-run.js:1006-1085` — `finalizeTask`: `into` defaults to main, not persisted
- `server/bridza-run.js:1139-1150` — `branchDiff` base always `baseBranchName(root)`
- `server/bridza-store.js:600-604` — `createTask` writes no target field
- `server/bridge.js:316` — `/finalize` accepts `into` but nothing feeds it
- `src/app/features/task.jsx:147-152,277` — UI finalize never passes `into`; button "Finalize → main"
- `core/domain.js:35-41` — `taskBranchName` (one branch per task, no target)