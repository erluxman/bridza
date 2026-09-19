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
