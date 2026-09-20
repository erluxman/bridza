# Review — Setting to hide columns in Kanban that do not have any item

## Acceptance Check
- [x] Kanban board hides columns that do not have any cards by default.
- [x] A toggle ("Show all columns") is present in the pipeline view topbar.
- [x] When toggle is enabled, all columns are shown.
- [x] Toggle preference persists across reloads via localStorage (`bridza.showAllColumns.<pipelineId>`).
- [x] Drag-and-drop column reordering works correctly with visible columns mapped back to full column order.
- [x] Root cause from `repro.md` fully addressed (derived column union filtered by occupancy when toggle is off).
- [x] Regression test fails without the fix and passes with the fix.

## Regression & Sibling Caller Analysis
- `Board` component (`src/app/features/board.jsx`) uses `visibleColumns` for rendering and drag target mapping while preserving full `columns` order and task tallying (`byCol`).
- Sibling callers of `kanbanColumns()` or board helpers (`kanban-order.js`, etc.) remain unaffected.
- No regressions in task moving, stage flows, or delivered/archived columns.

## Over-Engineering Analysis
- **Unused flexibility:** None.
- **Reinvented stdlib:** None (uses standard React state, `localStorage`, and array methods).
- **Single-caller abstractions:** None.
- **Verdict:** Clean, minimal implementation.

## Merge Readiness
- Branch `bridza/engineering/setting-to-hide-columns-in-kanban-that` reviewed against `main`.
- `git merge-tree main HEAD` indicates an add/add conflict on root `repro.md` (since different tasks write task-specific `repro.md` files at the root of their worktrees). This is standard for Bridza worktrees and will be resolved on finalization/merge.
- Aside from task-specific `repro.md`, code changes merge cleanly into `main`.
