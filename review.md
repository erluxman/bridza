# Review — Kanban archive issue cards

## Acceptance Check
- [x] Every card (including "Delivered") shows archive button (🗄).
- [x] Clicking Archive moves card to distinct "Archived" column at the end of board.
- [x] `archived` flag persisted in metadata.json via new bridge endpoint, committed like task reuse.
- [x] Archived cards excluded from normal columns and "Delivered"; render only in "Archived".
- [x] "Archived" column header displays count of archived cards.
- [x] Clicking Archive on archived card restores it to previous column.
- [x] Archiving persists across reload.
- [x] Strictly manual archiving (only user clicks).
- [x] Unit tests cover archive → restore round-trip and persistence.
- [x] `pnpm test`, `pnpm lint`, and `pnpm build` all pass successfully.

## Over-Engineering Analysis
- **Unused flexibility:** None.
- **Reinvented stdlib:** None.
- **Single-caller abstractions:** None. The bridge handler and `setTaskArchived` directly mirror existing patterns (`setTaskReuse`).
- **Verdict:** Clean, minimal implementation with nothing to delete.

## Merge Readiness
- Branch `bridza/engineering/kanban-archive-issue-cards` was tested against `main`.
- Merge into `main` will be clean with no conflict issues.
