# Prompt history — Review

One entry per "Run stage" press (oldest first). The same text is in each
run record in metadata.json and in the stage's commit message.

## 2026-09-19T06:13:19.849Z · run 1 · opencode

Task: When opening a task or card, it should not auto-advance for the first step.

When I open a task, it should not auto-advance just by opening it. Once I start it, it should auto-advance the stages in it. If auto-advance is enabled, I mean by default it is enabled, but if it is turned off, it should not auto-advance. But auto-advance only works when going from any task which is not the first task. You cannot auto-advance to the first task.
 Thank you.

By auto advance, I don't mean the configuration, I mean it should not auto start. It should have the configuration auto advance by default, but when I open the card, it should not auto start at any steps.

Merge readiness — this task's change will be merged into the branch "main" (on finalize Bridza merges this task's branch into it). Make the change READY TO BE MERGED into "main": review the task's branch against that branch (`git diff main...HEAD`, `git merge-tree`), resolve or flag conflicts with it, make sure outputs and docs name "main" (not "main") where a landing branch matters, and state plainly in your review output whether the merge into "main" will be clean. A delivered task must be merge-ready into "main", not just done.

## 2026-09-19T11:50:51.505Z · run 2 · claude · opus

Task: When opening a task or card, it should not auto-advance for the first step.

Merge readiness — this task's change will be merged into the branch "main" (on finalize Bridza merges this task's branch into it). Make the change READY TO BE MERGED into "main": review the task's branch against that branch (`git diff main...HEAD`, `git merge-tree`), resolve or flag conflicts with it, make sure outputs and docs name "main" (not "main") where a landing branch matters, and state plainly in your review output whether the merge into "main" will be clean. A delivered task must be merge-ready into "main", not just done.

