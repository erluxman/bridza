# kanban-archive-issue-cards

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
- The archived state PERSISTS as BOARD state: an entry in the root
  `.bridza/refs.json` `archived` map, committed on the base branch by
  `setTaskArchived` in `server/bridza-store.js` (the same shelf as `#refs`,
  tombstones and kanban column order), exposed through the `/task/archive`
  endpoint in `server/bridge.js`, and surviving reload.
  It MUST NOT be stored in the task's own `metadata.json`, and it MUST NOT be
  written the way `setTaskReuse` writes task flags in `server/bridza-run.js`:
  those commit to the task's `bridza/*` branch, which is never pushed, so the
  flag cannot reach a second computer. See #36.
- Archived cards are excluded from the normal columns and their counts; they
  render (with their own count) only in the Archived area.
- An un-archive action restores the card to its previous column ("Delivered"
  when it was archived from there) — archiving is reversible and still manual.
- Nothing archives automatically: only a user click changes a card's archived
  state.
- Archiving on one computer and pulling the base branch on another shows the
  card in Archived there too (the regression test in
  `src/app/__tests__/bridza-store.test.js` → "task archive state" clones the
  base branch only and asserts this).
- Unit/component tests cover the archive → archived → restore round-trip and
  cross-device persistence; `pnpm test` passes, and `pnpm lint` + `pnpm build`
  are clean.

NOTE: sibling sub-task `kanban-columns-drag-reorder` also edits
`src/app/features/board.jsx` on a separate branch — keep changes localised to
the per-card action path so the two merge cleanly.

## HISTORY — why this file exists

This task originally ran with no `context.md`; its criteria lived only inline in
the stage prompts recorded in `metadata.json`. Those criteria specified the
`archived` flag in the task's own `metadata.json`, "committed the same way
`setTaskReuse` writes task flags". The implementation did exactly that, and the
result was the cross-device bug filed as **#36** — the flag was committed to a
branch that is never pushed. The corrected criterion is above; #36 carries the
fix and the regression tests.
