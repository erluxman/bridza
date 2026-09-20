# Review — On the plan board, archived cards should not sit loose among the...

Branch `bridza/engineering/on-the-plan-board-archived-cards-should` → lands on `main`.

**Verdict: approved.** All 15 acceptance criteria pass, code is concise and idiomatic, test suite (240 tests), lint, and build all pass cleanly, and the merge into `main` will be clean with zero conflicts.

## 1. Acceptance Criteria Verification

- [x] **Archive Box Rendering & Card Separation**: With at least one archived task, exactly one Archive box is drawn with card count and milestone chrome, containing all archived cards. No archived card is drawn elsewhere.
- [x] **Milestone Exclusivity**: Archived cards are excluded from milestone boxes, `done/n` counts, task lists, and assignment dropdowns.
- [x] **Non-Milestone Treatment**: Archive box has no requirements/needs UI, never appears in required milestone selectors, is not highlighted by the critical path, and is omitted from the topbar milestone count.
- [x] **Dependencies & Gating**: Archived tasks do not participate in dependency wires, gates, or critical path calculations.
- [x] **Dragging & Persistence**: Dragging the Archive box (from chrome or cards) moves the whole box; position survives plan reload via `.bridza/plan.json`.
- [x] **Isolation**: Dragging milestones/live cards never moves the archive box, and vice versa.
- [x] **Interactions**: Right-drag selection ignores archived cards; clicking opens no side panel; double-clicking opens the task detail.
- [x] **Milestone Membership Round-trip**: Archiving removes from milestone box; restoring from kanban restores membership and position.
- [x] **Zero/All Archived Edge Cases**: Zero archived tasks renders no archive box; all tasks archived still renders the canvas and archive box.
- [x] **Fit Framing**: `⌖ Fit` correctly bounds the archive box alongside live graph nodes.
- [x] **Topbar Count**: Counts live tasks and displays archived count when non-zero.
- [x] **Store Round-trip**: `savePlan` / `readPlan` round-trips `{x, y}` coordinates, rejects non-finite values, and preserves position on partial saves (tested in `src/app/__tests__/plan.test.js`).
- [x] **Verification**: `pnpm test` (240/240 passed), `pnpm lint`, and `pnpm build` pass successfully.

## 2. Over-Engineering & Simplicity Audit

- **Unused flexibility / Speculative abstractions**: None. The archive box directly reuses the existing milestone box layout renderer and existing drag/drop mechanics (`startDrag`, `dragPos`).
- **Reinvented stdlib**: None. Uses standard JavaScript array filtering (`tasks` vs `archivedTasks`), Math utilities, and existing JSON persistence helpers.
- **Code to delete**: None. The implementation is surgical (~80 lines total across source files and tests) and maximally minimal.

## 3. Merge Readiness (into `main`)

- **Branch Diff**: `git diff main...HEAD` is clean, focused, and limited to `src/app/features/plan.jsx`, `server/bridza-store.js`, `src/app/bridza.css`, `src/app/__tests__/plan.test.js`, specs, and pipeline logs.
- **Merge Tree**: `git merge-tree main HEAD` reports a clean merge with **0 conflicts**.
- **Verdict**: Fully ready to be merged into `main`.
