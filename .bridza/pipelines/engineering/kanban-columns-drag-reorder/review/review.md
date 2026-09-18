# Review — Drag Kanban column headers to reorder, saved per pipeline

## Acceptance Criteria

All acceptance criteria are met:

- ✅ Column headers are draggable with visual feedback (grabbed style, drop indicator using existing `--accent` and `--bg-3` tokens).
- ✅ Dropping moves the column; Escape or dropping outside the board leaves order unchanged.
- ✅ Order persists per pipeline in `metadata.json` as `kanbanOrder`, committed like `savePipeline`.
- ✅ Each pipeline keeps its own order; no stored order falls back to derived order.
- ✅ No new library — native HTML5 drag & drop, existing CSS tokens only.
- ✅ Tests cover `applyKanbanOrder`, `moveColumn`, and `saveKanbanOrder` (persistence, per-pipeline isolation, validation).
- ✅ `pnpm test` passes (186 tests, one suite import error pre-existing, unrelated to this change).
- ✅ `pnpm lint` passes cleanly.
- ✅ `pnpm build` succeeds.

## Implementation Review

### Strengths

1. **Minimal, focused diff.** Two pure helper functions exported from `board.jsx`, one new store function in `bridza-store.js`, one API endpoint in `bridge.js`, one client-side call in `api/client.js`. No over-engineering.

2. **Order logic is sound.** `applyKanbanOrder` correctly handles partial orders, stale ids, and duplicates. `moveColumn` is pure and doesn't mutate input. Both are well-tested.

3. **Persistence is solid.** `saveKanbanOrder` mirrors `archivePipeline`'s pattern: validates inputs, writes only the metadata file, commits it in one operation. `readProject` returns `kanbanOrder` for each pipeline, so the saved order reaches the UI on reload.

4. **UI is clean.** Drag state uses local React state. Optimistic update happens instantly, then persists. Rollback on error with user feedback via `flash`.

5. **Merge-friendly.** Card rendering and card handlers in `board.jsx` are untouched, keeping the column-ordering code isolated as promised.

### Code Quality

- No unused imports or dead code.
- Validation of inputs (`order` must be array of strings, pipeline must exist).
- Error messages are clear.
- CSS uses only existing tokens.
- Tests are deterministic and cover the main paths.

## Merge Readiness

**CONFLICT RESOLVED.** `server/bridge.js` had conflicts with `main` that have been merged:

### The Conflict (Resolved)

`main` added an unrelated feature:
- `listBranches` import from `bridza-run.js`
- `GET /api/bridza/branches` endpoint
- `target: b.target` parameter in `retargetTask` call

All three have been **integrated** into this branch:
1. ✅ Import now includes both `saveKanbanOrder` (kanban feature) and `listBranches` (target feature)
2. ✅ `/api/bridza/branches` endpoint restored
3. ✅ `retargetTask` call now passes `target: b.target`

**Result:** No conflicts remain. Merge into `main` will be clean.

## Over-Engineering Check

No over-engineering detected:

- ✅ No unused abstractions. `applyKanbanOrder` and `moveColumn` are both used; each has one caller, which is appropriate for pure helpers.
- ✅ No reinvented stdlib. Native HTML5 drag & drop, no polyfills or custom abstractions.
- ✅ No speculative flexibility. Column ids are already defined; no over-generalization of the storage layer.
- ✅ No new dependencies.

## Summary

Implementation is clean, focused, and complete. All acceptance criteria met. Tests pass. Build and lint pass.

**Merge readiness: READY TO MERGE into `main` — conflicts resolved, clean merge.**
