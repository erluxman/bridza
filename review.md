# Review — Reduce the amount of commits for the work group related commit into one commit

## Root cause verified
Every write helper in `server/bridza-store.js` was committing for itself, and high-level actions (like `promoteInbox`) were composed of multiple helpers, resulting in 4-5 commits per UI action.

## Fix addresses root cause
- **Transaction scope:** `withAction(root, fn)` wraps high-level actions. The first write commits; subsequent writes within the scope amend that commit.
- **Folding mechanism:** `commitPaths(..., { fold })` allows consecutive identical edits (e.g., kanban drags, plan links) to amend the last commit if it's fresh (5 min window).
- **Reduced writes:** `promoteInbox` now hands the task brief directly to `createTask`, removing the need for a secondary "edit context" commit and avoiding a redundant placeholder blob.
- **Safe amends:** `foldTarget` guards against amending commits that are not ours (`bridza@local`), are not the branch tip, or are reached by other refs (tags, other task branches, remotes).

## Acceptance Check
- [x] `promoteInbox` leaves **1** commit (was 4).
- [x] `createTask` leaves **1** commit (was 2-3).
- [x] Consecutive plan edits fold into **1** commit.
- [x] Consecutive kanban drags fold into **1** commit.
- [x] Branch forks off the **final** folded commit, not an intermediate one.
- [x] Regression tests fail without the fix and pass with it.

## Merge Readiness
- **Conflict:** A content conflict exists in `src/app/__tests__/bridza-store.test.js` because `main` recently added card-archiving tests (`#36`) at the same EOF location where this fix added its regression tests.
- **Resolution:** The resolution is purely additive (include both test blocks). I have verified the merge in a temporary clone and all 215 tests passed.
- **Clean Merge:** Once the test conflict is resolved additively, the merge into `main` will be clean.
- **Note:** `server/bridza-store.js` auto-merges successfully.
