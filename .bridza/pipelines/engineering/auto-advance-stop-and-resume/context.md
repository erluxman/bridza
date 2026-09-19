# Honest "stopped" state and exact resume for auto-advance

## What
When an auto-advance chain ends before all stages are done — a stage failed, the
user stopped it, a tool is missing, a plan gate blocked it — the task surface
keeps the run-log tail but never says WHY advancing is over. After a revisit the
worry is "is it running or is it stuck?". Make the ended-not-finished state
explicit: a stopped-at banner with stage name, index/count and the stop reason, a
Resume control that restarts the chain from the first incomplete stage exactly as
`/api/bridza/automate` resumes, and no silent restart while a chain is (or was
just) active.

## Why
"Sometimes it feels like the work has stuck — not being advanced." The feeling is
the absence of an end signal: the chain died (or was stopped) and nothing on
screen explains why or offers the natural next action. This sub-task turns the
stopped case into a visible, actionable state instead of an ambiguous freeze.

## Acceptance criteria
- After a chain stops at a failed stage, revisiting the task shows a stopped-at
  banner: stage name, index/count, and the reason (failed / stopped / no tool /
  plan-gated), with the switch showing OFF.
- "Resume" restarts auto-advance from the first incomplete stage using the same
  prompt assembly and resume semantics as `/automate`; the resuming run appears
  in the existing run-log card.
- While an active chain is present, no other path (banner resume, toggle,
  open-time auto-start) starts a second chain — a test asserts exactly one
  automate call given a live chain.
- The banner disappears when the chain is running again or the task completes.
- Existing tests in `src/app/__tests__/task-auto.test.jsx` still pass.