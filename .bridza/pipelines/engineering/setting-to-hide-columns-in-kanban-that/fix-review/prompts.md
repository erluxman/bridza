# Prompt history — Review

One entry per "Run stage" press (oldest first). The same text is in each
run record in metadata.json and in the stage's commit message.

## 2026-09-20T15:16:08.291Z · run 1 · opencode

Task: Setting to hide columns in Kanban that do not have any item.

I don't think it's a nice idea to show all the columns in the Kanban. Please put a toggle somewhere on the pipeline view that will by default be disabled to show all the columns but when enabled it will show all columns. By default it will only show columns which has card in them.

Merge readiness — this task's change will be merged into the branch "main" (on finalize Bridza merges this task's branch into it). Make the change READY TO BE MERGED into "main": review the task's branch against that branch (`git diff main...HEAD`, `git merge-tree`), resolve or flag conflicts with it, make sure outputs and docs name "main" (not "main") where a landing branch matters, and state plainly in your review output whether the merge into "main" will be clean. A delivered task must be merge-ready into "main", not just done.

