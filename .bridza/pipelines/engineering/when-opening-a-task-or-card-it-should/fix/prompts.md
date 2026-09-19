# Prompt history — Fix

One entry per "Run stage" press (oldest first). The same text is in each
run record in metadata.json and in the stage's commit message.

## 2026-09-19T05:28:45.647Z · run 1 · claude · opus

Task: When opening a task or card, it should not auto-advance for the first step.

When I open a task, it should not auto-advance just by opening it. Once I start it, it should auto-advance the stages in it. If auto-advance is enabled, I mean by default it is enabled, but if it is turned off, it should not auto-advance. But auto-advance only works when going from any task which is not the first task. You cannot auto-advance to the first task.
 Thank you.

By auto advance, I don't mean the configuration, I mean it should not auto start. It should have the configuration auto advance by default, but when I open the card, it should not auto start at any steps.

Fit check — this task was filed under the "Bugfix" flow. The earlier stages' outputs (research, requirements, design…) are in the worktree — read them, then judge whether this really is a single "Bugfix" task. The pipeline's other flows: "Full product SDLC" (Vision → Requirements → Design & Architecture → Sprint Planning → Implementation → Testing → Review & Release); "Feature" (Spec → Build → Review); "UI design" (Spec → Design); "Feature dissection" (Dissect). If it belongs in a different flow (e.g. it's a multi-task feature that must be broken down, not implemented in one go), STOP: write flow-fit.md naming the right flow and why — the earlier stages' work stays on this branch — and do NO implementation. If it fits, proceed normally.

