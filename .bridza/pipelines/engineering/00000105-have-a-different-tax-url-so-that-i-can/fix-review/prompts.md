# Prompt history — Review

One entry per "Run stage" press (oldest first). The same text is in each
run record in metadata.json and in the stage's commit message.

## 2026-09-20T15:58:43.106Z · run 1 · claude

Task: Have a different tax URL so that I can refresh.

In the URL, it should show which task is being opened so that when I refresh that page, it should load that task rather than going to home.

Merge readiness — this task's change will be merged into the branch "main" (on finalize Bridza merges this task's branch into it). Make the change READY TO BE MERGED into "main": review the task's branch against that branch (`git diff main...HEAD`, `git merge-tree`), resolve or flag conflicts with it, make sure outputs and docs name "main" (not "main") where a landing branch matters, and state plainly in your review output whether the merge into "main" will be clean. A delivered task must be merge-ready into "main", not just done.

