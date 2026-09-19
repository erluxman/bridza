# Prompt history — Build

One entry per "Run stage" press (oldest first). The same text is in each
run record in metadata.json and in the stage's commit message.

## 2026-09-19T16:15:37.709Z · run 2 · opencode

Task: Highlight selected task in running now sidebar list

## What
When a user selects a task or work item that is currently running in the background, highlight that specific item in the "Running now" section of the left sidebar.

## Why
Users need immediate visual feedback in the sidebar to know which running task they are currently viewing or inspecting, improving spatial awareness and navigation state.

## Acceptance Criteria
- When an active task is selected and is present in the `running` list, its DOM element in the sidebar "Running now" list receives an active/selected CSS highlight class.
- Non-selected running tasks remain in the standard running state without the selection highlight.

Fit check — this task was filed under the "Feature" flow. The earlier stages' outputs (research, requirements, design…) are in the worktree — read them, then judge whether this really is a single "Feature" task. The pipeline's other flows: "Full product SDLC" (Vision → Requirements → Design & Architecture → Sprint Planning → Implementation → Testing → Review & Release); "Bugfix" (Reproduce → Fix → Review); "UI design" (Spec → Design); "Feature dissection" (Dissect). If it belongs in a different flow (e.g. it's a multi-task feature that must be broken down, not implemented in one go), STOP: write flow-fit.md naming the right flow and why — the earlier stages' work stays on this branch — and do NO implementation. If it fits, proceed normally.

