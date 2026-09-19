# Auto-advance switch and run-log card reflect server truth

## What
In the task detail (`src/app/features/task.jsx`) the topbar "Auto-advance"
switch and the run-log card are driven by a transient local `automating` state
that is reset whenever the task changes and whenever TaskDetail remounts.
Derive both from the server's chain truth (the chain registry delivered by
`auto-advance-chain-registry`): when this task's chain is live — this window,
another window, or after navigating away and back — the switch renders ON with a
per-stage progress label ("⚡ Auto-advancing · 2/5 · Design"), the run-log card
header shows the same instead of the generic "LIVE RUN", and no path can start a
second chain while one is already active (the manual toggle, the open-time
auto-start effect, or a second window).

## Why
The report: "auto-advance only works at the beginning of task creation — when I
go back to that same task it looks turned off, and sometimes it feels stuck."
Root cause: the ON state is client-local and transient, not server truth. This
sub-task makes "is it running / which stage / is it in auto-advance mode"
honest and revisit-proof, and removes the double-chain hazard that can visibly
stall work.

## Acceptance criteria
- Play a task, navigate back to the board, reopen the task mid-chain: the switch
  is checked, the label shows "⚡ Auto-advancing · i/n · <stage>", and the run-log
  card header reads "⚡ Auto-advancing" with the stage + remaining count. It does
  NOT start a second chain.
- While a chain is active, the toggle cannot start another chain (disabled or
  no-op), in the same window AND when a live run of this task is reported but the
  payload's chain info is absent/partial (graceful fallback: a live stage run
  still counts as a live chain for double-start protection).
- When the chain ends with all stages done, the switch returns to OFF on its own
  and the card shows the completed run summary.
- No double-run: a test that simulates a live chain in the state payload asserts
  `api.automate` is NOT called by the open-time auto-start effect.
- Existing tests in `src/app/__tests__/task-auto.test.jsx` continue to pass
  (exactly-once auto-start preserved when no chain is active).