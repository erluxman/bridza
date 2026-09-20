# Review — Hide Archived Tasks from Kanban

## Acceptance
- [x] Moved `Archived` into a button on the top bar.
- [x] Floating dialog from the right.
- [x] Not visible on the pipeline's Kanban view.

## Over-engineering / Simplification
- The `archive-panel` is manually managed via `showArchived` state in `board.jsx`. It's fine for now, but could be extracted to a separate component if it grows.
- The `archive` icon in `kcard` is kept, which is a good shortcut.

## Merge Readiness
The change is ready to be merged into `main`. Clean diff.
