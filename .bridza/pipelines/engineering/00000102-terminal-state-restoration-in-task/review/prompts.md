# Prompt history — Review

One entry per "Run stage" press (oldest first). The same text is in each
run record in metadata.json and in the stage's commit message.

## 2026-09-20T16:05:16.346Z · run 1 · opencode

Task: terminal state restoration in task details

when we press on terminal on a card/task details it should pop out a terminal in that particular directory/branch  instead of showing it as a react component because it does not persist when i make it away from it, when i come back to  terminal after going to different part of the app, that terminal session is already closed . If it is possible to restore the terminal, then keep it in the UI behind that terminal button, otherwise, pop that terminal out in a native terminal window  (like kitty)

Merge readiness — this task's change will be merged into the branch "main" (on finalize Bridza merges this task's branch into it). Make the change READY TO BE MERGED into "main": review the task's branch against that branch (`git diff main...HEAD`, `git merge-tree`), resolve or flag conflicts with it, make sure outputs and docs name "main" (not "main") where a landing branch matters, and state plainly in your review output whether the merge into "main" will be clean. A delivered task must be merge-ready into "main", not just done.

