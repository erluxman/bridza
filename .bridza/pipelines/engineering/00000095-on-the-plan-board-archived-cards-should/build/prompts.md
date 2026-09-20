# Prompt history — Build

One entry per "Run stage" press (oldest first). The same text is in each
run record in metadata.json and in the stage's commit message.

## 2026-09-20T14:55:20.729Z · run 2 · claude

Task: On the plan board, archived cards should not sit loose among the…

Fit check — this task was filed under the "Feature" flow. The earlier stages' outputs (research, requirements, design…) are in the worktree — read them, then judge whether this really is a single "Feature" task. The pipeline's other flows: "Full product SDLC" (Vision → Requirements → Design & Architecture → Sprint Planning → Implementation → Testing → Review & Release); "Bugfix" (Reproduce → Fix → Review); "UI design" (Spec → Design); "Feature dissection" (Dissect). If it belongs in a different flow (e.g. it's a multi-task feature that must be broken down, not implemented in one go), STOP: write flow-fit.md naming the right flow and why — the earlier stages' work stays on this branch — and do NO implementation. If it fits, proceed normally.

