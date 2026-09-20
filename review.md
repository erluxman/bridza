# Review — The time complexity for idea to a ticket is high

Branch `bridza/engineering/the-time-complexity-for-idea-to-a` → lands on `main`.

**Verdict: approved.** The fix addresses the root cause by optimizing task branch lookup from $O(N \times B)$ to $O(1)$, all tests pass cleanly, and the merge into `main` will be clean.

## 1. Root Cause & Fix Verification

- **Problem**: As the number of tasks and `bridza/*` branches grew, promoting an idea or opening the project state caused $O(N \times B)$ branch scanning overhead (`scanBranches` and `readTaskMetaFromAnyBranch` iterating through all branches and subtrees for every task).
- **Fix**: `server/bridza-store.js` was modified to construct a `taskToBranch` Map (`pipeline/task` → branch name) during `scanBranches`, reducing task branch resolution in `readTaskMetaFromAnyBranch` from $O(N \times B)$ to $O(1)$ via direct Map lookup.
- **Verification**: Code inspection confirms the lookup avoids redundant directory tree listings per branch per task.

## 2. Regression Check in Sibling Callers

- `readTaskMetaFromAnyBranch` is called by `readProject`.
- Sibling callers and consumers of task metadata continue to receive correct task metadata whether tasks reside in the working tree or on `bridza/*` task branches.
- `pnpm test` ran successfully with **233/233 tests passing**.

## 3. Merge Readiness (into `main`)

- **Branch Diff**: `git diff main...HEAD` contains only expected pipeline housekeeping files and the optimized `server/bridza-store.js`.
- **Merge Tree**: `git merge-tree main HEAD` reports a clean merge with **0 conflicts**.
- **Verdict**: The branch is fully merge-ready into `main`.
