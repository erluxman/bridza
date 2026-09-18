# Prompt history — Review

One entry per "Run stage" press (oldest first). The same text is in each
run record in metadata.json and in the stage's commit message.

## 2026-09-18T22:05:06.109Z · run 1 · opencode

Task: kanban-columns-drag-reorder

## WHAT & WHY

In any pipeline's Kanban view (`src/app/features/board.jsx`) the user should be
able to rearrange the columns by grabbing a column's header (the title bar,
`kcol-h`) and dragging it to the position they want. Today the columns are a
fixed derivation — the union of every stage used by the pipeline's tasks plus a
terminal "Delivered" column — with no way to reorder them. Dragging the title
and dropping it in the right place lets the user arrange the board to match how
they actually work, in every pipeline.

## ACCEPTANCE CRITERIA

- Column headers are draggable; a drag gives visual feedback (grabbed style)
  and a drop indicator showing where the column will land.
- Dropping over a valid slot moves that column (with its cards) to that
  position; cancelling (Escape) or dropping outside leaves the order unchanged.
- The reordered order PERSISTS per pipeline and survives reload/reopen — stored
  on the pipeline's own metadata (e.g. a `kanbanOrder` field in
  `.bridza/pipelines/<pipeline>/.metadata/metadata.json`), committed like
  `savePipeline`/`archivePipeline` in `server/bridza-store.js`, and exposed
  through a new bridge endpoint in `server/bridge.js`. NOT global/localStorage —
  each pipeline keeps its own order.
- Other pipelines keep their own stored order; a pipeline with no stored order
  falls back to today's derived ordering.
- Uses existing CSS tokens in `bridza.css`; no new drag-and-drop library unless
  native HTML5 drag & drop proves insufficient (flag it in review.md if added).
- Unit tests cover the reorder and per-pipeline persistence logic; `pnpm test`
  passes, and `pnpm lint` + `pnpm build` are clean.

NOTE: sibling sub-task `kanban-archive-issue-cards` also edits
`src/app/features/board.jsx` on a separate branch — keep changes localised to
the column-header/ordering path so the two merge cleanly.

Merge readiness — this task's change will be merged into the branch "main" (on finalize Bridza merges this task's branch into it). Make the change READY TO BE MERGED into "main": review the task's branch against that branch (`git diff main...HEAD`, `git merge-tree`), resolve or flag conflicts with it, make sure outputs and docs name "main" (not "main") where a landing branch matters, and state plainly in your review output whether the merge into "main" will be clean. A delivered task must be merge-ready into "main", not just done.

## 2026-09-18T22:05:20.387Z · run 2 · opencode · omniroute/auto

Task: kanban-columns-drag-reorder

Merge readiness — this task's change will be merged into the branch "main" (on finalize Bridza merges this task's branch into it). Make the change READY TO BE MERGED into "main": review the task's branch against that branch (`git diff main...HEAD`, `git merge-tree`), resolve or flag conflicts with it, make sure outputs and docs name "main" (not "main") where a landing branch matters, and state plainly in your review output whether the merge into "main" will be clean. A delivered task must be merge-ready into "main", not just done.

## 2026-09-18T22:08:54.774Z · run 3 · opencode · omniroute/auto

Task: kanban-columns-drag-reorder

fix the mege conflicts based on previous review ... so that its ready to be merged again 

Merge readiness — this task's change will be merged into the branch "main" (on finalize Bridza merges this task's branch into it). Make the change READY TO BE MERGED into "main": review the task's branch against that branch (`git diff main...HEAD`, `git merge-tree`), resolve or flag conflicts with it, make sure outputs and docs name "main" (not "main") where a landing branch matters, and state plainly in your review output whether the merge into "main" will be clean. A delivered task must be merge-ready into "main", not just done.

