# Prompt history — Fix

One entry per "Run stage" press (oldest first). The same text is in each
run record in metadata.json and in the stage's commit message.

## 2026-09-18T19:48:16.828Z · run 1 · opencode

Task: Every stage floor should be in auto advance by default.

One thing I am noticing is that whenever I use flow, it is not auto advance mode. Every flow should be by default in auto advance mode. Whatever communication is happening between the terminal should be displayed on that pane where we are displaying it. So that I can see what is actually happening in the background.

Fit check — this task was filed under the "Bugfix" flow. The earlier stages' outputs (research, requirements, design…) are in the worktree — read them, then judge whether this really is a single "Bugfix" task. The pipeline's other flows: "Full product SDLC" (Vision → Requirements → Design & Architecture → Sprint Planning → Implementation → Testing → Review & Release); "Feature" (Spec → Build → Review); "UI design" (Spec → Design); "Feature dissection" (Dissect). If it belongs in a different flow (e.g. it's a multi-task feature that must be broken down, not implemented in one go), STOP: write flow-fit.md naming the right flow and why — the earlier stages' work stays on this branch — and do NO implementation. If it fits, proceed normally.

