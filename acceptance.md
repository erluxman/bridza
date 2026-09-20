# Acceptance — The task terminal survives leaving it

- [ ] Start a long-running command (`sleep 300`, `pnpm dev`) in a task's ⌨ Terminal, switch to Stages, switch back: the same shell is there, the command is still running, and its output produced while away is visible.
- [ ] Leave the task entirely (open another task, then return): same shell, same process — a variable `export`ed before leaving is still set, and `pwd` is still the task's worktree.
- [ ] Two tasks opened in turn each get their own shell; a variable set in one is not visible in the other, and neither is killed by opening the other.
- [ ] The board's repo-root terminal is a separate session from any task terminal and survives the same navigation.
- [ ] ✕ actually ends the shell: after pressing it, reopening the terminal for that task gives a fresh shell (no prior history, no prior running command).
- [ ] A shell that exits on its own (`exit`) shows the existing "shell exited (N)" message, and reopening starts a new shell rather than reattaching to the dead one.
- [ ] Reattaching to a terminal resized since detach renders at the pane's current size, with the prompt usable and no stuck rows.
- [ ] Output exceeding the replay cap keeps the most recent output — the pane is never blank on reattach for a session that has printed anything.
- [ ] A detached session is reaped after its idle window: its PTY process is gone, and reopening starts a fresh shell.
- [ ] Navigating away from a terminal leaves no "disconnected" or "couldn't reach the PTY bridge" message behind on return.
- [ ] Terminal font, size, and ligature settings still apply, and the cwd header still shows the worktree path after a reattach.
- [ ] A server-side test covers the session map: same cwd reuses the PTY across attach/detach/attach, an explicit kill drops the entry, and PTY exit drops the entry.
- [ ] `pnpm test`, `pnpm lint`, `pnpm build` pass.
