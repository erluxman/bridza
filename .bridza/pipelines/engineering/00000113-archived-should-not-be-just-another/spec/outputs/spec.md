# Spec — Archived tasks leave the Kanban, live behind a top-bar button

Task #113 · pipeline `engineering` · flow `feature`

## What

Remove the `Archived` column from the pipeline Kanban. Archived tasks are never rendered on the board. Instead, the Kanban top/title bar gets an **Archive** button that opens a floating panel sliding in from the right, listing that pipeline's archived tasks. From the panel a task can be restored; restoring puts it back on the board and removes it from the panel.

## Why

The Kanban is the live work surface. Today archived tasks sit in a permanent trailing column (`__archived__`, appended after Done in `src/app/features/board.jsx`), so the archive competes for horizontal space and attention with real stages. Archive is something you look at on purpose, rarely. It should be out of sight by default and one deliberate click away.

## Behaviour

**Board**
- The column list is stage columns + Done only. No archived column, no archived cards, no archived count in any column header.
- Board-level filters/search never surface archived tasks.
- Per-card 🗄 "Archive task" action stays. Archiving a card removes it from the board immediately (existing flash "task archived" stays).

**Top-bar button**
- Lives in the Kanban's top/title bar, right side, next to existing board-level controls.
- Label: `Archive` with the current count of archived tasks for the active pipeline, e.g. `🗄 Archive · 4`. Count `0` still shows the button (so the feature is discoverable) but renders muted.
- Click toggles the panel. Keyboard: `Esc` closes.

**Archive panel**
- Floating overlay anchored to the right edge, full board height, fixed width (~360px), above the board, with a scrim or shadow so it reads as a drawer, not a column.
- Header: title `Archived`, count, close ✕.
- Body: archived tasks for the active pipeline, one row per task: `#ref`, title, and a **Restore** action. Same card visual language as the board where cheap, but no drag, no column semantics.
- Sorted most-recently-archived first if that timestamp is available; otherwise by `ref` descending.
- Empty state: one line, e.g. "Nothing archived."
- Restore calls the existing `setTaskArchived(..., archived: false)`; on success the row disappears, the board re-renders with the task in its column, existing flash "task restored" fires.
- Opening a task from the panel (click on title) behaves the same as opening it from a board card.

**Scope of the panel**
- Per pipeline. Switching pipeline closes the panel (or re-scopes it; either is fine, must not show the wrong pipeline's items).
- Open/closed state is session-only. Not persisted.

## Out of scope

- Plan board archive box (task #95) — untouched.
- Pipeline-level archiving (sidebar) — untouched.
- Bulk restore, delete-from-archive, search inside the panel.
- Any change to storage format or the `setTaskArchived` API.

## Touch points (expected)

- `src/app/features/board.jsx` — drop `ARCHIVED_COL` from the column list; add button + panel; filter `t.archived` out of board data.
- `src/app/bridza.css` — panel/drawer styles.
- `src/app/__tests__/kanban-empty-columns.test.jsx` — column expectation currently includes `"Archived"`; update.
- New test(s) for: archived card absent from board, panel lists it, restore returns it.
