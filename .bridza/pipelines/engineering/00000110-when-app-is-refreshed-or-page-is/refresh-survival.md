# Refresh survival — the run lives on the server, the page is a window onto it

Task #110. Before this change a page refresh (or a dev-server HMR reload) mid-run
left the agent running but the UI blind: empty output box, ▸ Run re-armed while
the stage was still live, no reason shown for a run that failed while the page
was away, and — worst — the auto-advance chain stalled, because "run the next
stage when this one ends" lived in the browser tab.

## What changed

- **Run transcript + listeners live in the server's run registry.** Every run
  keeps its printed text (capped) and a set of attached streams. A new endpoint
  `POST /api/bridza/run/attach` replays the text so far and streams the rest;
  for a finished run it replays the text and its end (status, exit, reason).
- **The page re-attaches on load** (and whenever a stage's live flag flips):
  the stage's output box fills back in, ▸ Run stays disabled, ⏹ Stop works,
  the task-level log pane is refilled. A run that failed while nobody watched
  shows its text, the reason, and the header says *failed*, not *idle*.
- **Auto-advance is the server's job.** A manual ▸ Run hands the server the run
  bodies of the stages after it (`advance`); when the stage ends done the server
  runs the chain itself. Refresh, close the tab, open another window — the task
  carries on. The page follows the live stage as the chain moves.
- **One live stage per task.** The server refuses a second run of the same task
  while one is live (`status: "busy"`), so a stale page or a second window can't
  write the same branch from two sides.
- **Clock never runs behind.** Re-attaching lifts the stage clock to the run's
  start clock plus its elapsed time; a committed run's seconds lift it too; the
  last time flush uses `keepalive` so a reload doesn't drop it.

## What still does not survive a refresh (by design, or follow-ups)

- The in-app terminal (PTY) and one-shot terminal commands are killed with the
  socket. Re-attachable shells are a separate piece of work.
- Half-typed prompt/brief text, which panel/diff was open, which stage you had
  expanded by hand (the page opens the live stage, else the first unfinished).
- Killing the server process itself (Ctrl+C on `pnpm dev`, quitting the app)
  still orphans the agent process: it keeps running, nobody collects the result.

## Evidence

`screenshots/before/*` vs `screenshots/after/*`, same scripted scenario
(slow stub agent, 25 s per stage; Review made to fail after 6 s):

1. running, 7 s in — baseline
2. right after refresh — before: "…" + Run re-armed · after: text back, Running…, Stop
3. 12 s after refresh — before: still blank · after: still streaming
4. after Spec finished — before: Build Idle (chain stalled) · after: Build running on its own, page followed it
5. Review failed while the page was away — before: Idle, no reason · after: text + "✖ provider error", header *failed*

Unit tests: `bridza-run.test.js` › "refresh survival" (attach replay + live
tail, finished-run replay, advance chain, no chain after failure, busy guard);
`task-auto.test.jsx` › "a refresh mid-run" (re-attach UI) + updated chain tests.
