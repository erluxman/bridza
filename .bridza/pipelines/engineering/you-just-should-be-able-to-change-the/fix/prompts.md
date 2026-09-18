# Prompt history — Fix

One entry per "Run stage" press (oldest first). The same text is in each
run record in metadata.json and in the stage's commit message.

## 2026-09-18T19:32:12.447Z · run 1 · opencode

Task: You just should be able to change the target branch of the task or the issue

And the thing that I am seeing is we should have a target branch rather than always merging domain because main-minute we always have the target so we should have a target branch where this particular feature will merge to and of this make sure in every single flow in engineering or product whatever it is after writing any code in the review process there must be a step where it makes the change ready to be merged to the reference branch where it is going to be merged

Fit check — this task was filed under the "Bugfix" flow. The earlier stages' outputs (research, requirements, design…) are in the worktree — read them, then judge whether this really is a single "Bugfix" task. The pipeline's other flows: "Full product SDLC" (Vision → Requirements → Design & Architecture → Sprint Planning → Implementation → Testing → Review & Release); "Feature" (Spec → Build → Review); "UI design" (Spec → Design); "Feature dissection" (Dissect). If it belongs in a different flow (e.g. it's a multi-task feature that must be broken down, not implemented in one go), STOP: write flow-fit.md naming the right flow and why — the earlier stages' work stays on this branch — and do NO implementation. If it fits, proceed normally.

