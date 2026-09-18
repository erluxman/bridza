# Kanban archive issue cards

## What

Every card in the Kanban board (`src/app/features/board.jsx`) gets an explicit Archive button. Clicking it moves the card out of its current column into a distinct "Archived" column at the end of the board. Clicking Archive again restores the card to its previous column. Archiving is always manual — nothing archives automatically.

## Why

Finished tasks in "Delivered" accumulate and clutter the terminal column. Archiving lets users clear visual noise from completed work without losing the record. The card remains queryable and restorable, just out of the active view.

## How

- Add an archive affordance (🗄 button) to every card in `board.jsx`, including cards in "Delivered".
- Clicking Archive sets an `archived` boolean flag on the task's metadata (`.bridza/pipelines/<pipeline>/<task>/metadata.json`), following the same commit path as `setTaskReuse` in `server/bridza-run.js`.
- Add a bridge endpoint in `server/bridge.js` that writes the `archived` flag and commits it.
- When `archived: true`, exclude the card from all stage columns and from "Delivered". Instead, render it in a distinct "Archived" column appended after "Delivered" in the kanban layout.
- Archived cards count separately; their count appears in the "Archived" column header.
- Clicking Archive on an already-archived card toggles it back to `archived: false` and restores it to its previous column (determined by `currentStage(t)` logic).
- Persist across reload: read `archived` from metadata on mount.

Out of scope: automatic archiving on any condition, bulk archive operations, filtering archived cards by date.
