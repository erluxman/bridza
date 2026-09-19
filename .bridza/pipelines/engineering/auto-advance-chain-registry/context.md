# Auto-advance chain registry (server truth)

## What
The server already tracks live per-stage runs in an in-process registry
(`ACTIVE_RUNS` in `server/bridza-run.js`); it does NOT track the auto-advance
chain that drives them. `automateTask` (`server/bridza-run.js`) loop-runs stages
back-to-back but never registers or reports the chain itself. Add a first-class
chain registry with the same lifecycle discipline as stage runs: a chain
registers before its first stage and is removed only when it ends (all done,
failed, stopped, or aborted). The project-state payload reports active chains
alongside stage runs so any client (task detail, board, another window) can see
"this task is being auto-advanced, on stage i of n."

## Why
Today only the local client that pressed "Auto-advance" knows a chain is
running, and only while that component stays mounted. After navigating away and
back — or from a second window — the UI reports only a "LIVE RUN" for the single
stage, so auto-advance looks turned off while it actually keeps going. The fix
rests on the server being the source of truth for "is this task in auto-advance
mode, and where is it." This sub-task delivers that server truth; the UI
sub-tasks (`auto-advance-state-truth-toggle`, `auto-advance-progress-badges`,
`auto-advance-stop-and-resume`) consume it.

## Acceptance criteria
- Given a task with 3 incomplete stages in order, when `/api/bridza/automate` is
  invoked, the server registers an active chain for pipeline/task and the
  project-state payload reports it with
  `{ pipeline, task, stage, index, count, phase: "running", startedAt }`.
- As each stage finishes (done or skipped), the chain record's `stage`/`index`
  advance; a skipped stage does not run the tool but still advances the index.
- When a stage fails, the chain's `phase` becomes `"stopped"` with `stoppedAt` =
  that stage, and the chain is removed once its final end event is emitted.
- `stopRuns(pipeline, task)` while a chain is active kills the chain AND its
  current stage run: both are removed from the registry and the stage records
  "stopped" (existing stop semantics for single manual runs stay unchanged).
- A chain that runs to completion (all stages done) leaves no trace in the
  registry.
- Unit tests (in the repo's existing test runner) exercise the full lifecycle —
  register → advance → skip → stop → end — without spawning any tool (inject a
  fake stage runner) and assert the registry/payload contents at each step.