# Acceptance — Drag Kanban column headers to reorder, saved per pipeline

- [ ] Every Kanban column header (`kcol-h`) can be dragged. During a drag, the header shows a grabbed style and a drop indicator marks the landing slot. Both use existing `bridza.css` tokens.
- [ ] Dropping on a valid slot moves the column, with its cards, to that position.
- [ ] Pressing Escape during a drag, or dropping outside a valid slot, leaves the order unchanged and saves nothing.
- [ ] After a reorder, reloading the app or reopening the pipeline shows the same order. The order is stored as `kanbanOrder` in that pipeline's metadata.json and committed. Nothing is written to localStorage.
- [ ] A different pipeline keeps its own order, and reordering one pipeline does not change the other.
- [ ] A pipeline with no `kanbanOrder` shows today's derived order: pipeline stages, then task-only stages, then Delivered.
- [ ] A stored order that is missing columns or holds stale ids still shows every current column: known ids in stored order, new columns after them in derived order, stale ids ignored.
- [ ] `POST /api/bridza/pipeline/kanban-order` persists the order. It rejects an unknown pipeline and an `order` that isn't an array of strings.
- [ ] Unit tests cover:
  - `applyKanbanOrder` (no stored order, full order, partial order, stale ids)
  - `moveColumn` (moves forward and backward, same-slot move is a no-op, input is not mutated)
  - `saveKanbanOrder` (writes and commits `kanbanOrder`, `readProject` returns it, each pipeline keeps its own order)
- [ ] No new dependency. Card rendering and card handlers in `board.jsx` are unchanged.
- [ ] `pnpm test`, `pnpm lint`, and `pnpm build` all pass cleanly.
