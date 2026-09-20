# The task terminal survives leaving it

## What

Opening **⌨ Terminal** on a task (or at the repo root from the board) starts a shell that keeps running when you navigate away. Switching to Stages/Inspector/Canvas/Chat, opening another task, or leaving the task view detaches the browser from the shell instead of killing it; coming back to that same terminal reattaches to the *same* shell — same process, same cwd, same shell history, same running command — and repaints what it printed while you were gone. The ✕ button remains the way to actually end a shell.

The terminal stays an in-app xterm.js pane. No native window is popped out.

## Why

`TermDrawer` (`src/app/features/term.jsx`) owns the PTY's lifetime through its WebSocket: its effect cleanup closes the socket on unmount, and `server/bridge.js`'s `ws.on("close")` handler calls `p.kill()`. Every tab switch therefore destroys the shell, so a `pnpm dev` or a long build started in the task terminal dies the moment you look at anything else, and returning shows a dead pane reading "disconnected — close and reopen to restart".

The intent allowed a native-terminal fallback (kitty) if restoration was not possible. It is possible: the PTY already lives in the long-lived bridge process, and only the `close → kill` wiring ties it to a browser tab. Keeping it in-app preserves the existing font/ligature settings, the cwd header, and the worktree resolution — a native window would rebuild all of that and lose the button's meaning.

## How

**Server owns session lifetime** (`server/bridge.js`). A module-level `SESSIONS` map, keyed by the resolved `cwd` (which already encodes repo root vs. task worktree, so the board terminal and each task terminal get their own session). Each entry holds the `node-pty` process, a replay buffer, the last known `{cols, rows}`, and the currently attached `ws` (or `null`).

`handleUpgrade` resolves `cwd` exactly as it does today, then **reuses** a live session for that key rather than spawning. Spawning only happens when there is no entry. On attach the server sends the existing `{t:"cwd"}` frame, then replays the buffer as `{t:"out"}` so the pane repaints, then applies the client's first `resize`.

**Detach ≠ kill.** `ws.on("close")` clears the entry's `ws` and leaves the PTY running. `p.onData` still runs while detached, appending to the buffer instead of writing to a socket. A new client attaching while another is attached takes over: the old socket is closed, newest wins.

**Buffer.** A byte-capped (256 KB) rolling buffer of raw PTY output, trimmed from the front. Replay is best-effort scrollback, not a terminal-state emulation — a long-running full-screen TUI (vim, htop) repaints on its next frame or on the reattach resize, and a very chatty run may lose its oldest output to the cap.

**Killing is explicit.** The ✕ button gains a `{t:"kill"}` frame before `onClose`; the server kills the PTY and drops the session. The button's existing "Close (kills the shell)" title stays accurate; the pane's other exits (tab switch, unmount) no longer kill.

**Cleanup.** `p.onExit` notifies any attached socket with the existing `{t:"exit"}` frame and drops the entry, so a shell that exits on its own is not reattached to. Detached sessions are reaped after 30 minutes idle — without this, not killing on detach would leak one shell per terminal the user ever opened, for the life of the bridge process.

**Client** (`src/app/features/term.jsx`). The effect cleanup keeps closing the socket (that is now a detach). The dead-pane message only applies to a real `err`/`exit`, not to a normal detach. No change to the settings/font path, the cwd header, or `task.jsx`/`board.jsx` beyond what the ✕ frame needs.

Out of scope: surviving a bridge/dev-server restart (sessions are in-process and die with it), any session list or "running terminals" UI, sharing one session across two panes at once, and the native-terminal popout.
