# Prompt history — Review

One entry per "Run stage" press (oldest first). The same text is in each
run record in metadata.json and in the stage's commit message.

## 2026-09-20T15:26:09.287Z · run 1 · opencode

Task: persist agent pickup choice

When I select an agent for a step in a task, it should persist and use that model only to execute that step in that stage for that task or card. It should be stored somewhere and it should be read from there so that I don't have to go back and check every single time.

if i chose opencode and exited that window, the background running task shall still use opencode to execute that task and same case for claude or any other model

Merge readiness — this task's change will be merged into the branch "main" (on finalize Bridza merges this task's branch into it). Make the change READY TO BE MERGED into "main": review the task's branch against that branch (`git diff main...HEAD`, `git merge-tree`), resolve or flag conflicts with it, make sure outputs and docs name "main" (not "main") where a landing branch matters, and state plainly in your review output whether the merge into "main" will be clean. A delivered task must be merge-ready into "main", not just done.

