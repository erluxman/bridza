# Repro — Every stage floor should be in auto-advance by default

- Pipeline: `engineering` · Task #13 · Flow: bugfix · Branch: `bridza/engineering/every-stage-floor-should-be-in-auto`
- Scope: **reproduce only**. No code was changed in `src/` or `server/`; this document records the bug and its root cause. Fix is a separate stage.

## User report (verbatim)

> "One thing I am noticing is that whenever I use flow, it is not in auto advance mode. Every flow should be by default in auto advance mode. Whatever communication is happening between the terminal should be displayed on that pane where we are displaying it. So that I can see what is actually happening in the background."

Two distinct asks in one report:

1. **Default behavior**: every flow is *not* in auto-advance mode — it should be, by default.
2. **Observability**: whatever communication is happening in the background (between the runner and the terminal) should be visible on the pane that is supposed to display it, so the user can see what's actually happening.

---

## Expected behavior

- Any flow (any stage-flow) is auto-advance **by default**: you create/use a flow and its stages run back-to-back automatically without you having to manually flip a switch first.
- The pane meant to show run communication (the task's auto-advance log pane) always shows the live stream of what the background runner is doing: tool calls, tool output, commands executed, session/commit events — visible even when you navigate away from the task and come back.

## Observed behavior

1. Opening a task built from a flow gives you a **supervised / review** run by default — auto-advance is **off** until you manually toggle the **⚡ Auto-advance** switch. Every flow is therefore *not* in auto-advance mode out of the box.
2. The auto-advance **log pane is not visible by default**: it only renders while the `automating` switch is on (in the current, mounted task view).
3. Because the auto-advance state is **ephemeral client-side state**, once you leave the task (or the component remounts / you reopen the app), the pane disappears even though the server-side run continues in the background — so you **cannot see what is actually happening in the background**.
4. The per-stage `auto`/review flag edited in the flow editor is **inert at runtime**: the server-side auto-advance runner ignores it completely.

---

## How to reproduce

1. Start Bridza (`pnpm dev`, open `http://app.localhost:5173`).
2. Create/select a task built from a flow (e.g. an engineering pipeline with multiple stages).
3. **Observe**: the task is *not* auto-advancing. The **⚡ Auto-advance** switch is off by default; opening the task defaults to a supervised/review run, and the run stops at stages awaiting review rather than flowing through automatically.
4. Turn on **⚡ Auto-advance** to start auto-advancing, then **navigate away from the task and back** (or reopen the task).
5. **Observe**: the auto-advance log pane is gone / its content was cleared, even though the run is (or was) continuing in the background. The communication between the runner and the terminal is no longer visible.

**Result:** the exact complaint reproduces — flows are not in auto-advance by default, and the background communication pane is not reliably showing.

---

## Root cause (code evidence)

The defect is a combination of **wrong defaults** plus **client-only, non-persisted auto-advance state**:

### 1. Auto-advance is opt-in, defaulting to OFF — never on by default
- `src/app/features/task.jsx:48` — `const [automating, setAutomating] = useState(false);` → the task-level auto-advance switch defaults to `false`.
- `src/app/features/task.jsx:268-269` — the ⚡ Auto-advance toggle is driven by this local `automating` state; created flows come up supervised/review, not auto.
- `src/app/features/flow.jsx:13-14` (`mkStage`/`normStage`) — each **stage** defaults to `auto: false` (review). Stages created in the flow editor are never auto by default.
- `server/bridza-store.js:451` — `normStageDef` normalizes `auto: !!s.auto`, so a stage without an explicit `auto` field (or a flow copy that stripped it) becomes `review`/supervised.

So every layer of the feature defaults to *not* auto-advancing, directly contradicting "Every flow should be by default in auto advance mode."

### 2. Auto-advance log pane is gated on ephemeral client state
- `src/app/features/task.jsx:306-310` — the auto-advance card/log pane only renders while `automating` is truthy, in the **currently mounted** view.
- `src/app/features/task.jsx:66` — `useEffect(() => { setTaskLog(""); … }, [task.id])` clears `taskLog` when the task changes.
- The log (`taskLog`) and the `automating` flag are **component-local `useState`** (lines 48, 51). They are not restored from the server's actual running state on reopen.

Consequence: navigated-away / reopened tasks stop showing the pane and its log even though the server-side run (`automateTask` in `server/bridza-run.js:830`) keeps going in the background. The user loses visibility of the background communication — the second half of the report.

### 3. The per-stage `auto` / review flag is never consulted at runtime (dead config)
- `server/bridza-run.js:830-863` (`automateTask`) runs all stages back-to-back and **never reads `stage.auto`**. There is no branch that stops at a `review` stage.
- `server/bridza-run.js` — no reference to `s.auto` anywhere in the run path; the `auto`/review flag affects **only** the editor UI (badge/toggle), never runtime behavior.

So even a user who sets a stage to "auto" in the editor gets no different behavior, and the flag provides no way to guarantee auto-advance. The only thing controlling auto-advance is the client-side switch (which defaults off).

### Pipeline docs are stale on this
- `docs/02-prd.md` FR-GEN-7/8 describe "Supervised | Automate" per-stage semantics that do not match the current runtime (dead `auto` flag, opt-in switch). Useful as intent reference for the fix, not as current behavior.

---

## Suggested fix direction (for the fix stage — NOT applied here)

- Default auto-advance **on**: `automating` should start `true` (and stages should default to `auto: true`) so every flow auto-advances by default while still allowing the user to opt *out*.
- Make auto-advance state **visible and persistent on the pane**: derive the "is this task auto-advancing?" state from server run state (or persist it) so the log pane stays rendered and shows live background communication across navigation/reopen/remount.
- Wire the per-stage `auto` flag into the runner (or remove it) so editor intent matches runtime behavior, and always display the runner/terminal communication on the designated pane.

*This document is reproduction/diagnosis only; the fix is tracked by the following `fix` stage.*
