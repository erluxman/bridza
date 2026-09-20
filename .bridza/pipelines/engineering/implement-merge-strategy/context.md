# Implement merging strategy in backend runner

## Intent
Update `server/bridza-run.js` to execute the newly defined merge strategy during task finalization.

## Acceptance Criteria
- [ ] Backend code updated to support the new merge strategy.
- [ ] Preserves necessary commit history/comments without hitting conflict problems repeatedly.

## SCOPE NOTE by #88 — verification folded in (was #26)

`verify-merge-strategy` was archived; a strategy that isn't verified isn't
implemented. Its checks are acceptance criteria here:

- [ ] Finalizing a task lands it on its target with the method
      [[define-merge-strategy]] picked, and a conflicting finalize fails
      cleanly — no half-merged worktree left behind.
- [ ] Every run recorded in the task's ledger is still reachable afterwards
      (or the spec says explicitly that it is not, and why).
- [ ] **#37's check**: promoting one inbox idea to a task produces a small,
      bounded number of commits on the base branch — assert the count in a test
      rather than eyeballing `git log`.
- [ ] `pnpm test`, `pnpm lint`, `pnpm build` pass.
