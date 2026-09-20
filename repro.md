# Repro — Setting to hide columns in Kanban that do not have any item

Task #40 · `engineering/setting-to-hide-columns-in-kanban-that` · stage `repro`

## Summary

The per-pipeline Kanban (`src/app/features/board.jsx`) renders **every** column it
can derive — the pipeline's full stage union plus `Delivered` and `Archived` —
regardless of whether any task currently sits in them. Empty columns are not
skipped; they are rendered with a `—` placeholder (`board.jsx:128`). There is no
setting, toggle, or filter anywhere in the app to hide them.

On this repo's own `engineering` pipeline that means **18 columns of which 13 are
empty**. At the fixed `.kcol { flex: 0 0 270px }` plus `gap: 14px`
(`src/app/bridza.css:170-171`) the board is ~5100px wide, so the 5 columns that
actually hold work are spread across ~3.5 screens of horizontal scrolling.

This is a missing-capability bug (the `bugfix` flow was chosen for the task), not
a crash: nothing throws, the wrong thing is simply always shown.

## Reproduction Steps

### A. In the app (manual)

1. `pnpm install && pnpm dev`, open `http://app.localhost:5173`, open this repo as
   the project.
2. Open the **Engineering** pipeline → the Kanban board.
3. Observe the column strip and scroll right to the end.
4. **Observed**: 18 columns — `repro, fix, fix-review, spec, build, review,
   dissect, vision, requirements, architecture, planning, implementation, testing,
   release, design-spec, design, Delivered, Archived`. Only `repro (6)`,
   `spec (9)`, `dissect (4)`, `vision (1)` and `Delivered (12)` contain cards; the
   other 13 show `—`. No control exists anywhere (topbar, ⚙ Stage flow, ⚙ Settings
   modal) to hide them.

The column/occupancy numbers above are read straight from the committed task
metadata in `.bridza/pipelines/engineering/*/metadata.json` (32 tasks), using the
same rules the board uses (`kanbanColumns()` + `currentStage()`).

### B. Automated (deterministic, no repo/bridge needed)

Artifacts: `.bridza/pipelines/engineering/setting-to-hide-columns-in-kanban-that/repro/outputs/`
 · `repro-kanban-empty-columns.test.jsx` (the test) · `vitest-repro-output.txt` (its output).

```bash
cp .bridza/pipelines/engineering/setting-to-hide-columns-in-kanban-that/repro/outputs/repro-kanban-empty-columns.test.jsx \
   src/app/__tests__/
pnpm exec vitest run --disableConsoleIntercept=false src/app/__tests__/repro-kanban-empty-columns.test.jsx
```

The test SSR-renders `<Board>` for a 6-stage pipeline holding 2 tasks (occupying
`plan` and `repro` only) and scrapes the rendered column headers:

```
columns rendered: Research(0) | Plan(1) | Reproduce(1) | Fix(0) | Fix review(0) | Ship(0) | Delivered(0) | Archived(0)
"—" empty placeholders: 6

 ✓ observed: every stage column is rendered, empty ones included
 × expected: only columns holding at least one card are rendered by default
   AssertionError: expected [ 'Research(0)', 'Plan(1)', …(6) ] to deeply equal [ 'Plan(1)', 'Reproduce(1)' ]
 × expected: a toggle exists on the pipeline view to show all columns
   AssertionError: expected false to be true

 Tests  2 failed | 1 passed (3)
```

## Observed vs Expected

| Action / State | Observed | Expected |
|---|---|---|
| Open a pipeline Kanban (default) | All derived columns render, incl. empty ones (18 columns / 13 empty on `engineering`) | Only columns holding ≥1 card render (5 on `engineering`) |
| Empty column body | `—` placeholder occupying a full 270px slot | Column absent |
| Control to show all columns | None exists anywhere in the UI | A toggle on the pipeline view; off by default = hide empty, on = show all |
| Toggle state across reloads/pipelines | n/a | Persisted (per user, and ideally per pipeline) |

## Root Cause

1. **Column set is derived from the stage union, never from occupancy** —
   `kanbanColumns()` (`src/app/features/board.jsx:13-20`) collects every
   `pipeline.stages[].id`, then every `t.stages[]` id of every task, then appends
   `__done__` and `__archived__` unconditionally. The server hands the UI the
   *full* stage list per pipeline (`server/bridza-store.js:390`, `stages:
   allStages`) and each task keeps its own flow's stage subset
   (`bridza-store.js:373-376`), so a pipeline with several flows (bugfix / spec+build
   / dissect / product / design) accumulates the union of all of them — which is
   exactly why `engineering` reaches 18 columns.
2. **The render loop has no filter** — `columns.map(...)`
   (`board.jsx:102`) renders each derived id; the only occupancy check in the file
   is cosmetic: `{!byCol[c].length && <div className="kcol-empty">—</div>}`
   (`board.jsx:128`), which *adds* a placeholder instead of dropping the column.
3. **No such setting exists to read** — `src/app/lib/settings.js` persists only
   terminal font/size/ligatures, and `SettingsModal`
   (`src/app/features/settings.jsx`) exposes only those; grep for `hide` across
   `src/app` finds only the pipeline-archive and task-rail toggles. Nothing in the
   pipeline record (`bridza-store.js:390`) carries a per-pipeline view preference
   either — `kanbanOrder` is the only board-view field persisted.

## Notes for Fix Stage (nothing fixed here)

- Intent from the originating inbox note (task metadata, run 1): default = show
  only columns that have cards; toggle on = show all columns. This **changes the
  default** for existing users, which is what was asked for.
- **Filter after tallying, not before.** `byCol` is seeded from `columns`
  (`board.jsx:55`) and `currentStage()` results fall back to
  `byCol[DONE_COL]` when a key is missing (`board.jsx:56`). Filtering `columns`
  before that line would silently dump every task whose column was filtered into
  `Delivered` and corrupt the counts.
- **Header drag-reorder interacts.** `onColDrop` computes the new order from the
  *visible* `columns` array (`board.jsx:45-46`) and persists it via
  `api.saveKanbanOrder`. With empty columns hidden, a drag would save an order
  containing only the visible ids; `applyKanbanOrder` then appends all hidden ids
  after them (`kanban-order.js:7-10`), so turning the toggle back on silently
  reshuffles the hidden columns to the end. Needs the drop handler to map the
  visible index back onto the full derived order.
- Persistence options, both already in the codebase: localStorage via
  `lib/settings.js` (+ subscribe pattern) for a user-wide preference, or a
  per-pipeline field alongside `kanbanOrder` in `server/bridza-store.js`
  (`saveKanbanOrder` at `bridza-store.js:520-528` is the template) if the toggle
  should follow the pipeline and be git-tracked.
- Empty-state: with tasks present, hide-empty always leaves ≥1 column, so the
  existing `pipeline.tasks.length === 0` branch (`board.jsx:98`) still covers the
  only truly empty board.

## Environment note

This worktree has no `node_modules`; the repro temporarily symlinked the main checkout's
(`/Users/risky/projects/erluxman.com/bridza/node_modules`, gitignored) so vitest
could run (symlink removed afterwards — recreate it, or `pnpm install`, before rerunning). The repro test also stubs `features/term.jsx` — importing it pulls
`@xterm/addon-ligatures`, which does not resolve through that symlink (pure test
plumbing, unrelated to this bug).
