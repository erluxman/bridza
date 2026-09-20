# Review — Persist agent pickup choice

Branch `bridza/engineering/persist-agent-pickup-choice` → lands on `main`.

**Verdict: approved.** All acceptance criteria pass, code is concise and idiomatic, test suite (244 tests), lint, and build all pass cleanly, and the merge into `main` will be clean with zero conflicts.

## 1. Acceptance Criteria Verification

- [x] **Persistence on Reopen/New Window**: Picking an agent for a stage and running nothing, then closing and reopening the task (or opening in a second window), retains the agent selection.
- [x] **Metadata Storage**: Stored in the task's `metadata.json` as `routing["<stageId>"] = { tool, model }` on the task branch and committed (verified in unit tests and branch tip).
- [x] **Stage & Task Independence**: Two stages of the same task hold independent agent picks, and different tasks keep separate routing dicts without interference.
- [x] **Execution on Picked Agent**: `▸ Run` on a stage with a saved pick executes on that agent; run records and commit messages name it correctly.
- [x] **Auto-Advance Integration**: Auto-advance into a never-run stage utilizes that stage's saved agent and model.
- [x] **Server-Side Fallback & Override**: Requests reaching the server without explicit `tool` fallback to saved `routing[stage].tool`; explicit `tool` in body wins.
- [x] **Background Execution**: Choosing an agent for a later stage and closing the window allows background tasks/auto-advance continuation on the chosen agent.
- [x] **Model Persistence & Clearing**: Saved models are reapplied; clearing with `×` stores tool default and passes no model.
- [x] **Agent Change Overwrite**: Changing the agent for a stage overwrites previous pick and clears stored model.
- [x] **Legacy / Missing Routing Fallback**: Tasks with no `routing` (`{}`) or unknown stages/uninstalled agents fall back gracefully without crashing.
- [x] **Documentation**: `docs/09-file-format.md` properly documents the populated `routing` shape.
- [x] **Test Coverage**: Unit tests cover routing round-trips through task metadata read/write, `runStage` resolution from routing, and picker seeding ahead of run history.
- [x] **Verification**: `pnpm test` (244/244 passed), `pnpm lint`, and `pnpm build` pass successfully.

## 2. Over-Engineering & Simplicity Audit

- **Unused flexibility / Speculative abstractions**: None. The implementation mirrors existing established patterns (`setTaskReuse` in server, `StageRunner` state in UI).
- **Reinvented stdlib**: None. Uses standard JavaScript objects, array methods, and existing git/file helper utilities.
- **Code to delete**: None. The changes are minimal (~40 lines in server, ~25 lines in frontend, tests, and documentation).

## 3. Merge Readiness (into `main`)

- **Branch Diff**: `git diff main...HEAD` is clean, focused, and limited to `server/bridza-run.js`, `server/bridge.js`, `server/bridza-store.js`, `src/app/features/views.jsx`, `src/app/features/task.jsx`, `src/app/api/client.js`, `src/app/__tests__/bridza-run.test.js`, `src/app/__tests__/ux-views.test.jsx`, documentation, and pipeline logs.
- **Merge Tree**: `git merge-tree main HEAD` reports a clean merge with **0 conflicts**.
- **Verdict**: Fully ready to be merged into `main`.
