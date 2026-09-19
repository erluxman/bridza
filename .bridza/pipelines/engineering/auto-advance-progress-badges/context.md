# Auto-advance progress badges on board & plan cards

## What
From the outside — the kanban board and the plan board — a task currently under
auto-advance shows only a generic "running" indicator. Render a live chain badge
("⚡ 3/5 · Build") on that task's board card and plan node so the user can see at
a glance which task is advancing and where it is, without opening the task.
Distinguish a chain run from a one-off manual stage run (manual runs keep the
existing running indicator, no badge).

## Why
The user's ask includes "whether it is running, which stage it is running and is
it in auto-advance mode" being transparent. The board is where a user scans for
"is anything progressing / is it stuck"; today a single manual run and an
auto-advancing task are indistinguishable from outside the task detail.

## Acceptance criteria
- A board card whose task has an active chain in the state payload renders a
  badge with index/count and stage name (fallback: index/count only when the
  stage name is missing), refreshed by the existing poll.
- A manual single-stage run shows the existing running indicator and NO chain
  badge.
- The plan board node for the same task shows the same chain chip.
- Rendering is null-safe when the payload reports a chain with missing fields,
  and existing board/plan/ux-views tests still pass.