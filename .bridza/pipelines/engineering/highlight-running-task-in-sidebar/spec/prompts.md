# Prompt history — Spec

One entry per "Run stage" press (oldest first). The same text is in each
run record in metadata.json and in the stage's commit message.

## 2026-09-19T15:58:00.768Z · run 1 · opencode

Task: Highlight selected task in running now sidebar list

## What
When a user selects a task or work item that is currently running in the background, highlight that specific item in the "Running now" section of the left sidebar.

## Why
Users need immediate visual feedback in the sidebar to know which running task they are currently viewing or inspecting, improving spatial awareness and navigation state.

## Acceptance Criteria
- When an active task is selected and is present in the `running` list, its DOM element in the sidebar "Running now" list receives an active/selected CSS highlight class.
- Non-selected running tasks remain in the standard running state without the selection highlight.

