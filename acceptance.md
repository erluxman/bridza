# Acceptance — Kanban archive issue cards

- [ ] Every card (including those in "Delivered") shows an archive button (e.g. 🗄).
- [ ] Clicking Archive on a non-archived card moves it out of its current column into a distinct "Archived" column at the end of the board.
- [ ] The card's `archived` flag is persisted in `.bridza/pipelines/<pipeline>/<task>/metadata.json` via a new bridge endpoint, committed the same way as task reuse flags.
- [ ] Archived cards do not appear in their stage columns or in "Delivered"; they render only in "Archived".
- [ ] The "Archived" column header displays the count of archived cards.
- [ ] Clicking Archive on an archived card toggles `archived: false` and restores the card to its previous column (determined by `currentStage` logic).
- [ ] Archiving persists across reload.
- [ ] No automatic archiving: only explicit user clicks change the archived state.
- [ ] Unit/component tests cover archive → restore round-trip and persistence.
- [ ] `pnpm test`, `pnpm lint`, and `pnpm build` all pass.
