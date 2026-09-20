# Prompt history — Review

One entry per "Run stage" press (oldest first). The same text is in each
run record in metadata.json and in the stage's commit message.

## 2026-09-20T14:59:09.704Z · run 1 · opencode

Task: On the plan board, archived cards should not sit loose among the…

On the plan board, archived cards should not sit loose among the live ones and should not be grouped into milestones either. Put every archived card in its own box on the canvas — drawn like a milestone box, labelled as the archive — and let me drag that whole box around the canvas to park it wherever I want. Milestone boxes must never contain an archived card, and the archive box must never be treated as a milestone (no deps, no needs, no critical path, not in the milestone dropdown). The kanban already hides archived cards; the plan board currently draws them inline, which is what makes the canvas confusing.

Merge readiness — this task's change will be merged into the branch "main" (on finalize Bridza merges this task's branch into it). Make the change READY TO BE MERGED into "main": review the task's branch against that branch (`git diff main...HEAD`, `git merge-tree`), resolve or flag conflicts with it, make sure outputs and docs name "main" (not "main") where a landing branch matters, and state plainly in your review output whether the merge into "main" will be clean. A delivered task must be merge-ready into "main", not just done.

