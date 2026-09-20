# Prompt history — Review

One entry per "Run stage" press (oldest first). The same text is in each
run record in metadata.json and in the stage's commit message.

## 2026-09-20T19:53:48.189Z · run 1 · opencode

Task: archived should not be just another section in the Kanban , It should be hidden and appear when we intentionally want…

archived should not be just another section in the Kanban view it should be a button on the top bar or title bar where it will open these items from like floating
 dialog from the right but they won't be visible on the pipeline's Kanban view

Merge readiness — this task's change will be merged into the branch "main" (on finalize Bridza merges this task's branch into it). Make the change READY TO BE MERGED into "main": review the task's branch against that branch (`git diff main...HEAD`, `git merge-tree`), resolve or flag conflicts with it, make sure outputs and docs name "main" (not "main") where a landing branch matters, and state plainly in your review output whether the merge into "main" will be clean. A delivered task must be merge-ready into "main", not just done.

