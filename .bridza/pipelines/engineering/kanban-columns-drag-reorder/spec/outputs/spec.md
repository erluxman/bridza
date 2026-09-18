# Spec — Drag Kanban column headers to reorder, saved per pipeline

## What

In a pipeline's Kanban (`src/app/features/board.jsx`), the user drags a column by its header (`kcol-h`) and drops it at a new position. The column and its cards move together. The new order is saved on that pipeline's metadata, so it survives a reload and has no effect on other pipelines.

## Why

Right now `kanbanColumns(pipeline)` sets the column order: pipeline stages first, then task-only stages, then "Delivered". The user can't change it. Reordering lets each board match how its pipeline is actually worked.

## How

**Ordering (pure, exported from `board.jsx`, unit-tested)**
- `applyKanbanOrder(derived, stored)`: returns the stored ids that still exist in `derived`, in stored order, followed by any remaining `derived` ids in their derived order. Unknown or stale ids are dropped. If `stored` is missing or empty, it returns `derived` unchanged, which is today's behaviour.
- `moveColumn(order, fromId, toIndex)`: returns a new array with `fromId` moved to `toIndex`. It never mutates the input. Moving a column to its current slot returns the same order.
- Column ids are the ids already in use: stage ids, plus `DONE_COL` for Delivered. Every column, Delivered included, can be dragged.

**UI (`board.jsx`, header/ordering path only)**
- `kcol-h` is `draggable` and uses native HTML5 drag and drop. No new library.
- While a column is dragged, its header gets a "grabbed" style. The slot where it will land shows a drop indicator. Both are styled in `bridza.css` with existing tokens.
- Dropping on a valid slot applies the new order right away and then persists it. Escape or a drop outside the kanban (`dropEffect === "none"`) leaves the order unchanged. Nothing is saved when the order doesn't change.
- If saving fails, the board goes back to the previous order and `flash` shows the error.
- The card markup and card handlers stay as they are. Sibling task `kanban-archive-issue-cards` edits the cards, so keeping them untouched lets both branches merge cleanly.

**Persistence (server)**
- `server/bridza-store.js`: new `saveKanbanOrder(root, { id, order })`. It is modelled on `archivePipeline`: it validates the pipeline and requires `order` to be an array of strings. It writes `kanbanOrder` into the pipeline's metadata.json and commits only that file via `commitPaths`. It returns `{ ok, id, kanbanOrder, committed }`.
- `readProject` adds `kanbanOrder` (default `[]`) to each pipeline object it returns (the explicit object built around line 388).
- `server/bridge.js`: new `POST /api/bridza/pipeline/kanban-order` → `saveKanbanOrder`.
- `src/app/api/client.js`: new `saveKanbanOrder(dir, body)`.
- localStorage is not used, and there is no global order.

## Out of scope

- Reordering stages inside a flow. The stage flow and task stage data don't change.
- Moving cards between columns.
- Keyboard-only reordering.
- A "reset order" control.
