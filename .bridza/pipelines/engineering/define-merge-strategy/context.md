# Define merging strategy specification

## Intent
Specify the new merging strategy for reference branches to avoid losing commit context/comments while ensuring a clean merge.

## Acceptance Criteria
- [ ] Strategy documented in a design doc or spec.
- [ ] Clear decision on merge method (e.g. non-fast-forward merge vs squash vs custom).
- [ ] Per-run commits on a task branch REMAIN REACHABLE after finalize — via
      `--no-ff`, or by tagging the pre-merge tip (e.g.
      `bridza/archive/<pipeline>/<task>`) before a squash.
      Rationale: a task's run ledger (`metadata.json` → `tracking[stage].runs`)
      records the tool, prompt, exit code, changed files and **sha** of every
      run. Today `finalizeTask` in `server/bridza-run.js` defaults to
      `style = "squash"`, which collapses those commits, and
      `deleteTask({ deleteBranch: true })` removes the ref outright. After
      either, the ledger describes work that can no longer be checked out —
      the record survives, the objects do not.
- [ ] The spec states EXPLICITLY whether task branches are ever auto-deleted.
      If they are, say plainly that post-finalize reproducibility is out of
      scope; do not claim both.
- [ ] The spec says which of the two problems it is optimising for — history
      noise on the base branch (#23's complaint, and the branch-only task
      `reduce-the-amount-of-commits-for-the`) versus reproducibility of what an
      agent acted on — and how it trades them off. They pull in opposite
      directions; picking one silently is how we got the squash default.

## PLAN BOARD NOTE (added by #88, board triage)

This ticket was previously dissected (commit `af16342`, on its own branch) into
seven spec sub-tasks: `merge-strategy-goal-ranking`, `merge-method-decision-adr`,
`run-ledger-reachability-contract`, `task-branch-deletion-policy`,
`finalize-merge-style-surface`, `merge-strategy-acceptance-matrix`,
`archive-tag-backfill-policy`. That split never landed on `main`, and it is not
being revived: seven tickets to write one spec is the over-dissection the user
already pushed back on for #23. Their stale plan-board nodes have been removed.

Every question those seven raised is already an acceptance criterion above —
goal ranking, merge method, ledger reachability, branch-deletion policy and the
finalize surface. Answer them here, in one 2h spec, and hand the result to
[[implement-merge-strategy]] and the new preflight slice
[[merge-preflight-check]].

Grouped into milestone **ms-git-merge**.

## SCOPE NOTE by #88 — this spec now answers every merge-shape question

Archived into this ticket (answer them here, do not reopen them as tickets):

- **#23 `better-merging-strategy-to-reference`** — the parent idea: few commits,
  still easy merges.
- **#37 `reduce-the-amount-of-commits-for-the`** — the same problem from the
  creation side: promoting one inbox idea produced three or four commits.
- **#72 `there-should-be-a-separate-step-called`** — a squash step. Already true:
  `finalizeTask` in `server/bridza-run.js` defaults to `style = "squash"`. The
  live question is only whether squash *stays* the default, which is this spec's
  call.

So the spec must state, in one page: the goal ranking (few commits vs. a
reachable run ledger), the merge method on finalize, whether task branches are
deleted, and what the finalize surface exposes. Output goes straight to
[[implement-merge-strategy]].
