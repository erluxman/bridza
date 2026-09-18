# Prompt history — Build

One entry per "Run stage" press (oldest first). The same text is in each
run record in metadata.json and in the stage's commit message.

## 2026-09-18T20:50:44.339Z · run 1 · opencode

Task: Manual archive for Kanban issue cards

## WHAT & WHY

In the Kanban view (`src/app/features/board.jsx`) every issue card should have
an explicit Archive action. Archiving moves a card out of its current column —
including the terminal "Delivered" column — into a distinct "Archived"
column/section, so a finished-but-not-yet-relevant task stops cluttering
"Delivered". Archiving is STRICTLY manual: the card's archived state changes
only when the user clicks the button, never automatically.

## ACCEPTANCE CRITERIA

- Every card on the board shows an archive affordance (e.g. an 🗄 button),
  including cards in the terminal "Delivered" column.
- Clicking Archive moves the card OUT of its current column and INTO a distinct
  "Archived" column/area at the end of the board; it no longer appears under its
  stage column or under "Delivered".
- The archived state PERSISTS on the task (e.g. an `archived` flag in
  `.bridza/pipelines/<pipeline>/<task>/metadata.json`, committed the same way
  `setTaskReuse` writes task flags in `server/bridza-run.js`), exposed through a
  new bridge endpoint in `server/bridge.js`, and survives reload.
- Archived cards are excluded from the normal columns and their counts; they
  render (with their own count) only in the Archived area.
- An un-archive action restores the card to its previous column ("Delivered"
  when it was archived from there) — archiving is reversible and still manual.
- Nothing archives automatically: only a user click changes a card's archived
  state.
- Unit/component tests cover the archive → archived → restore round-trip and
  persistence; `pnpm test` passes, and `pnpm lint` + `pnpm build` are clean.

NOTE: sibling sub-task `kanban-columns-drag-reorder` also edits
`src/app/features/board.jsx` on a separate branch — keep changes localised to
the per-card action path so the two merge cleanly.

Fit check — this task was filed under the "Feature" flow. The earlier stages' outputs (research, requirements, design…) are in the worktree — read them, then judge whether this really is a single "Feature" task. The pipeline's other flows: "Full product SDLC" (Vision → Requirements → Design & Architecture → Sprint Planning → Implementation → Testing → Review & Release); "Bugfix" (Reproduce → Fix → Review); "UI design" (Spec → Design); "Feature dissection" (Dissect). If it belongs in a different flow (e.g. it's a multi-task feature that must be broken down, not implemented in one go), STOP: write flow-fit.md naming the right flow and why — the earlier stages' work stays on this branch — and do NO implementation. If it fits, proceed normally.

## 2026-09-18T22:03:22.122Z · run 1 · opencode · omniroute/auto

Task: kanban-archive-issue-cards

## WHAT & WHY

In the Kanban view (`src/app/features/board.jsx`) every issue card should have
an explicit Archive action. Archiving moves a card out of its current column —
including the terminal "Delivered" column — into a distinct "Archived"
column/section, so a finished-but-not-yet-relevant task stops cluttering
"Delivered". Archiving is STRICTLY manual: the card's archived state changes
only when the user clicks the button, never automatically.

## ACCEPTANCE CRITERIA

- Every card on the board shows an archive affordance (e.g. an 🗄 button),
  including cards in the terminal "Delivered" column.
- Clicking Archive moves the card OUT of its current column and INTO a distinct
  "Archived" column/area at the end of the board; it no longer appears under its
  stage column or under "Delivered".
- The archived state PERSISTS on the task (e.g. an `archived` flag in
  `.bridza/pipelines/<pipeline>/<task>/metadata.json`, committed the same way
  `setTaskReuse` writes task flags in `server/bridza-run.js`), exposed through a
  new bridge endpoint in `server/bridge.js`, and survives reload.
- Archived cards are excluded from the normal columns and their counts; they
  render (with their own count) only in the Archived area.
- An un-archive action restores the card to its previous column ("Delivered"
  when it was archived from there) — archiving is reversible and still manual.
- Nothing archives automatically: only a user click changes a card's archived
  state.
- Unit/component tests cover the archive → archived → restore round-trip and
  persistence; `pnpm test` passes, and `pnpm lint` + `pnpm build` are clean.

NOTE: sibling sub-task `kanban-columns-drag-reorder` also edits
`src/app/features/board.jsx` on a separate branch — keep changes localised to
the per-card action path so the two merge cleanly.

Fit check — this task was filed under the "Feature" flow. The earlier stages' outputs (research, requirements, design…) are in the worktree — read them, then judge whether this really is a single "Feature" task. The pipeline's other flows: "Full product SDLC" (Vision → Requirements → Design & Architecture → Sprint Planning → Implementation → Testing → Review & Release); "Bugfix" (Reproduce → Fix → Review); "UI design" (Spec → Design); "Feature dissection" (Dissect). If it belongs in a different flow (e.g. it's a multi-task feature that must be broken down, not implemented in one go), STOP: write flow-fit.md naming the right flow and why — the earlier stages' work stays on this branch — and do NO implementation. If it fits, proceed normally.

