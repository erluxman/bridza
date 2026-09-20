# Archived cards live in their own box on the plan board

## What

On the plan board (`src/app/features/plan.jsx`), archived tasks stop being drawn inline among the live ones. Every archived task is drawn inside a single **Archive box** — same chrome as a milestone module box, labelled as the archive — that the user can drag around the canvas and park anywhere. The box is not a milestone: it has no deps, no `needs`, no gating, it never appears in a milestone dropdown, and it is never on the critical path. Milestone boxes never contain an archived card.

## Why

The kanban already hides archived tasks; the plan board still draws them inline, so dead work sits loose among live work, gets swept into milestone boxes, and pads the dependency picture. Parking them in one movable box keeps them reachable (they are still real tasks) without letting them clutter the graph the board exists to show.

## How

**Split the task list.** `tasks` (built from `proj.pipelines`) keeps only `!t.archived`; archived ones go into a separate `archivedTasks` list carrying the same fields. Everything downstream of `tasks` — `byKey`, `planLayout`, `gateOf`'s `byKey.has` filter, `msMembers`'s `byKey.has` filter, `criticalPath`, `stateOf`, the dep pickers, the milestone task dropdown, the right-drag selection box — then excludes archived tasks with no further change. Archived tasks get no `plan.pos`/`plan.sizes` treatment and no side panel; they are not selectable.

**Milestone membership is filtered, not erased.** Archiving a card does not rewrite `plan.milestones[].tasks`. `msMembers` already drops keys missing from `byKey`, so an archived card disappears from its milestone box, its `done/n` count, and its gating — and restoring the card from the kanban puts it straight back.

**The box.** One anchor position `plan.archive = { x, y }` holds the box; archived cards are laid out relative to that anchor in a fixed grid (default card width, `PN.H` height, wrapping to a new column after 8 rows) rather than from `plan.pos`. When `plan.archive` is unset, the box defaults to below the live graph (`x = 50`, `y = maxY of live content + gap`). It renders with the milestone box markup (`rect.ms-box`, pins, label) under a `plan-ms archive` class and an archive label (`🗄 Archived · N`), styled in `src/app/bridza.css` so it reads as an archive, not a milestone. With zero archived tasks the box is not rendered.

**Dragging.** A mousedown anywhere inside the box (chrome or card) starts a drag of type `"archive"` in the existing drag system; move updates a live anchor, mouseup persists the rounded `{x, y}` via `save({ ...plan, archive })`. A click without movement selects nothing (it must not set `selMs`). Double-clicking an archived card still opens that task. The box contributes to `maxX`/`maxY` so `fit()` frames it, and the canvas renders when there are live **or** archived tasks (the "No tasks yet" empty state only when both are empty).

**Persistence.** `readPlan` in `server/bridza-store.js` gains `archive` (an `{x, y}` object or `null` when unset); `savePlan` accepts, validates (finite numbers, rounded) and writes it through like `pos`, keeping it on partial saves. The existing `readPlan` empty-shape assertion in `src/app/__tests__/plan.test.js` is updated for the new key.

**Topbar.** The task count stays live-only, with `· N archived` appended when `N > 0`, so cards that vanish from the graph are still accounted for.

Out of scope: archiving or restoring from the plan board (the kanban's 🗄 toggle stays the only control), resizing/collapsing/sorting the archive box, per-card positions inside it, and any change to archived *pipelines*.
