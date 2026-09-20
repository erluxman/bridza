# Review — Setting to hide columns in Kanban that do not have any item

## Acceptance Check
- [x] Kanban board hides columns that do not have any cards by default.
- [x] A toggle ("Show all columns") sits in the pipeline view topbar.
- [x] When ticked, all columns are shown.
- [x] The preference persists across reloads, per pipeline (`bridza.showAllColumns.<pipelineId>`).
- [x] Column-header drag reorder still works: the drop slot is read off the
      visible columns and mapped back into the full column order.
- [x] Root cause from `repro.md` addressed (derived column union filtered by occupancy when the toggle is off).
- [x] Regression test fails without the fix and passes with it
      (`src/app/__tests__/kanban-empty-columns.test.jsx`).
- [x] `pnpm test` (202), `pnpm lint`, `pnpm build` pass.

## Defects found in the fix stage, and fixed here
1. **The preference never persisted.** `toggleShowAll` wrote `"1"`/`"0"` while
   the mount-time reader compared against `"true"`, so "Show all columns"
   silently reset to off on every reload — the acceptance item it was written
   for. Now both sides use `"1"`/`"0"` through `lsGet`/`lsSet`, matching
   `settings.js`.
2. **`localStorage` written directly** in a try/catch instead of the existing
   `lsSet` helper.
3. **`moveColumn` import left dangling** after `onColDrop` stopped using it.
   (`eslint.config.js` ignores `src/app`, so lint stayed green — do not read a
   passing `pnpm lint` as coverage of this file.)
4. **Stray one-space re-indent** across the JSX in `Board`'s `return`, which
   inflated the diff and would have widened the conflict with `main`.
5. **No regression test in the suite.** The repro stage's test lived only in
   `.bridza/.../repro/outputs/`, so nothing in `pnpm test` covered the new
   behaviour. Added `src/app/__tests__/kanban-empty-columns.test.jsx` (jsdom,
   real clicks): default hides empty columns, ticking shows all, the choice
   survives a remount both ways, and the key is per pipeline. It fails on the
   pre-fix `board.jsx` (persistence case) and passes after.

## Regression & Sibling Caller Analysis
- `byCol` is still built from the **full** column list, so header counts and
  task placement are unchanged; only rendering is filtered.
- `kanban-order.js` is untouched; `applyKanbanOrder` still receives the full
  derived order, so stored orders keep their hidden entries.
- Drop onto the last slot appends to the full order — hidden columns keep their
  relative positions.

## Over-Engineering Analysis
- No unused flexibility, no reinvented stdlib, no single-caller abstractions.
- Verdict: minimal implementation, roughly 6 lines of real logic.

## Merge Readiness
**Not a clean merge — `main` has moved.** `git merge-tree main HEAD` conflicts in:
- `src/app/features/board.jsx` — `main` has since gained the card tag picker
  (`TagMenu`, `tags`) and topbar task search (`/` hotkey, `filteredByCol`), and
  both touch the same topbar row and `columns.map` lines this branch edits.
  Resolution must keep `main`'s search/tags and re-apply the toggle on top,
  including filtering `filteredByCol` rather than `byCol` for occupancy.
- `repro.md`, `review.md` — add/add between task worktrees; standard for Bridza,
  resolved at finalization.

The earlier revision of this file claimed the code merged cleanly aside from
`repro.md`. That was checked against the merge base, not against current `main`.
