# Acceptance — Tags on a task, picked from a card with L

- [ ] Hovering a board card and pressing **L** opens a tag picker for that task — on every pipeline, including one with a single flow (where **L** does nothing today).
- [ ] Typing a name in the picker and choosing a colour creates the tag, assigns it to the hovered task immediately, and the chip appears on the card without a reload.
- [ ] Hovering a *different* card and pressing **L** lists the tag created earlier, selectable in one click — the registry is board-wide, not per task.
- [ ] Clicking an assigned tag in the picker unassigns it; unassigning the last one leaves the card with no chips and no leftover `taskTags` entry.
- [ ] A task can hold several tags at once, each rendering in its own colour, on the card and in the task header.
- [ ] Creating a tag whose name slugs to an existing one reuses that tag instead of duplicating it or changing its colour.
- [ ] Tags and assignments are stored in `.bridza/refs.json` as `tags` / `taskTags` and committed on the base branch — visible in `git show` of that branch tip, and surviving an app restart.
- [ ] **F** on a hovered card opens the stage-flow menu with the same behaviour and the same two-or-more-flows condition **L** had before, confirm dialog included; **L** never opens the flow menu.
- [ ] The card hint line names the live keys, and `Escape` closes whichever menu is open.
- [ ] A repo whose `refs.json` predates this (no `tags`, no `taskTags`) loads with no tags and no error; a `taskTags` entry naming a tag that is not in the registry is ignored, not rendered, and does not crash the board.
- [ ] Deleting a task removes its `taskTags` entry; the tags it used stay in the registry and are still offered on other tasks.
- [ ] A failed save flashes the error and leaves the board showing the unchanged tags.
- [ ] Tests cover: `createTag` idempotence and colour validation; `setTaskTags` dropping unknown slugs and de-duplicating; the task projection resolving slugs to `{ id, name, color }`; **L** opening the tag menu and **F** the flow menu from a hovered card.
- [ ] The `tags` / `taskTags` shape is documented alongside the other `.bridza/` on-disk state in `docs/09-file-format.md`.
- [ ] `pnpm test`, `pnpm lint`, `pnpm build` pass.
