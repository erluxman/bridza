# Acceptance — Archived cards live in their own box on the plan board

- [ ] With at least one archived task, the plan board draws exactly one Archive box, labelled as the archive with its card count, containing every archived card — and no archived card is drawn anywhere else on the canvas.
- [ ] No archived card appears inside any milestone box, in a milestone's `done/n` count, in the milestone panel's task list, or in the "add task (unassigned only)" dropdown.
- [ ] The Archive box is not a milestone: it has no requires/needs UI, never appears in "add required milestone…", is never highlighted by the critical path, and adds nothing to the milestone count in the topbar.
- [ ] No dependency wire, gate, or critical-path segment references an archived task — archiving a task that other tasks depend on removes its wires and leaves the dependents' gates evaluating over the remaining live deps.
- [ ] Dragging the Archive box (from its chrome or from a card inside it) moves the whole box; releasing parks it there, and the position survives a reload of the plan view.
- [ ] Dragging a milestone box or a live card never moves the Archive box, and dragging the Archive box never moves live cards.
- [ ] Right-drag selection over the Archive box selects no archived cards; clicking an archived card opens no side panel; double-clicking one opens that task.
- [ ] Archiving a task that belongs to a milestone removes it from that milestone's box; restoring it from the kanban puts it back in the same milestone with its previous position.
- [ ] With zero archived tasks, no Archive box is drawn. With every task archived, the board still renders the canvas and the Archive box (not the "No tasks yet" empty state).
- [ ] `⌖ Fit` frames the Archive box along with the rest of the board wherever it has been parked.
- [ ] The topbar counts only live tasks and shows the archived count alongside when it is non-zero.
- [ ] `savePlan` round-trips the archive box position through `.bridza/plan.json`, rejects non-finite values, and a partial save (deps only) keeps it — covered by a store test.
- [ ] `pnpm test`, `pnpm lint`, `pnpm build` pass.
