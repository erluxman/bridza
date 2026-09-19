# Prompt history — Dissect

One entry per "Run stage" press (oldest first). The same text is in each
run record in metadata.json and in the stage's commit message.

## 2026-09-19T15:55:46.324Z · run 3 · opencode

Task: Auto advance seems to only works at the beginning of task creation

Auto advance only works at the beginning of task creation after it is started and I go back to that same task or work item auto advance is turned off or at least it does not show that it is in auto advance mode sometimes it feels like the work has stock just stock not being advanced and I think what is actually happening whether it is running, which stage it is running and is it in auto advance mode those kind of things should be really transparent to user so think about it plan the features or box fixes or whatever they are regarding it and implement them

Merge readiness — this task's change will be merged into the branch "main" (on finalize Bridza merges this task's branch into it). Make the change READY TO BE MERGED into "main": review the task's branch against that branch (`git diff main...HEAD`, `git merge-tree`), resolve or flag conflicts with it, make sure outputs and docs name "main" (not "main") where a landing branch matters, and state plainly in your review output whether the merge into "main" will be clean. A delivered task must be merge-ready into "main", not just done.

