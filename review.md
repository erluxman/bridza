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
Rebased onto `main` (5e59a0f). Three conflicts, all resolved here:

- **`src/app/features/board.jsx`** — `main` had since gained the card tag picker
  (`TagMenu`) and the topbar task search (`/` hotkey, `filteredByCol`), both
  touching the lines this branch edits. Kept both, and the occupancy filter now
  reads `filteredByCol`, not `byCol`: a column hides when it holds no *visible*
  card, so hiding follows an active search instead of fighting it. Covered by a
  test ("follows the search: a column whose cards all filter out hides too").
  The toggle's inline style also moved to a `.col-toggle` rule in `bridza.css`,
  matching how the rest of the topbar is styled.
- **`repro.md` / `review.md`** — add/add against the previously merged task's
  docs; took this task's, which is what every finalize commit does.

## One unrelated fix carried along
`src/app/__tests__/pty-session.test.js` (from the terminal-restoration task)
hangs its `afterAll` on `server.close()`, which resolves only once every socket
is gone — a WebSocket upgraded off that server is not always one it hangs up.
It is invisible at 17 test files and deterministic at 18, so *any* task adding a
test file trips it; adding this task's test file is what exposed it. Teardown
now force-closes, unrefs, and bounds the wait at 2s. Verified: 17 files green,
18 files red 2 runs in 3 before, 4 runs in 4 green after.

`pnpm test` 298 passing, `pnpm lint`, `pnpm build` all green on the rebased
branch (a `pnpm install` is needed in stale worktrees — `main` added
`canvas-confetti`).
