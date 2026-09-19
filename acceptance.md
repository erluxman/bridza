# Acceptance — Highlight selected task in running now sidebar

- [ ] When a task present in `proj.running` (and therefore in the sidebar "Running now" list) is selected, its `.run-task` item receives the active/selected highlight class.
- [ ] The highlighted item matches the selected task exactly (pipeline id + task id from `activePipe`/`activeTask`).
- [ ] Non-selected running tasks in the "Running now" list keep the standard running style — no highlight.
- [ ] The highlight tracks selection: switching to a different task, the board, Plan, or Inbox clears it; selecting the running task again re-applies it.
- [ ] Highlighted items remain clickable and open the task as before.
- [ ] The highlight class follows the existing `.on` selected convention with styling in `bridza.css`.
- [ ] `pnpm test`, `pnpm lint`, and `pnpm build` all pass.