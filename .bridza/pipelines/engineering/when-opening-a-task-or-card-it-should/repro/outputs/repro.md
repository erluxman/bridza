# Repro — When opening a task or card, it should not auto-advance for the first step

- Pipeline: `engineering` · Task #39 · Flow: bugfix · Branch: `bridza/engineering/when-opening-a-task-or-card-it-should`
- Scope: **reproduce only**. No code was changed in `src/` or `server/`; this document records the bug and its root cause. Fix is a separate stage.

## User report (verbatim)

> "When opening a task or card, it should not auto-advance for the first step. When I open a task, it should not auto-advance just by opening it. Once I start it, it should auto-advance the stages in it. If auto-advance is enabled, I mean by default it is enabled, but if it is turned off, it should not auto-advance. But auto-advance only works when going from any task which is not the first task. You cannot auto-advance to the first task."
>
> Clarification: "By auto advance, I don't mean the configuration, I mean it should not auto start. It should have the configuration auto advance by default, but when I open the card, it should not auto start at any steps."

Three distinct asks:

1. **Opening a task must never itself trigger a run.** Merely viewing/opening a task or card is not "starting" it.
2. **Once the user explicitly starts the task, subsequent stages should auto-advance** (auto-advance stays the default *setting*, per the earlier #13 fix — this report does not ask to remove that default).
3. **Auto-advance never fires "into" the first stage.** It only carries a task forward from stage *N* (already started/running) to stage *N+1*; it must not be the thing that kicks off the very first stage of a task that has never been run.

## Expected behavior

- Opening/navigating to a task is a pure read — no stage run is started as a side effect of mounting the task view.
- The first stage of a task only ever begins because a human explicitly starts it (e.g. runs the stage, or flips the Auto-advance switch themselves).
- After that explicit start, if auto-advance is on, the runner is allowed to chain forward through the remaining stages without further clicks.
- If the run is stopped/not live and work remains, reopening the task must NOT silently re-kick a fresh run on its own — only a live-in-background run should resume being displayed.

## Observed behavior

1. Opening *any* task that has incomplete stages — including a **brand-new task where no stage has ever been run** — immediately starts `automate()`, which runs stage 1 (the first stage) with zero user interaction.
2. This happens purely from mounting `TaskDetail`: there is a `useEffect` keyed only on `briefLoaded`/`task.finalized`/`task.tracking` that calls `automate()` once per task key, with no check for "has this task ever been started by a human."
3. The regression is even encoded as *intended* behavior in the current test suite: `src/app/__tests__/task-auto.test.jsx` ("auto-advance on by default" describe block) asserts that simply mounting a fresh task with stages left "starts advancing on its own, log pane showing the run" and expects `api.automate` to have been called with **both** stages (including the never-started first one) — i.e. the test locks in exactly the behavior this report says is wrong.
4. There is no persisted "auto-advance enabled/disabled" preference distinct from "a run is currently in progress." The topbar switch (`task.jsx:337`) is bound to `automating` (purely ephemeral, run-in-flight state) and is `disabled` while a run is live — so a user has no way to declare "auto-advance off" ahead of time; the only lever is whether a run happens to be running right now.

## How to reproduce

1. Start Bridza (`pnpm dev`, open `http://app.localhost:5173`).
2. Create a fresh task in an engineering pipeline with 2+ stages, none of which have ever been run (`task.tracking` is empty).
3. Click into the task (just open it — do not touch the ⚡ Auto-advance switch or run any stage manually).
4. **Observe**: within moments the ⚡ Auto-advance panel appears already labeled "⚡ Auto-advancing…", the switch is checked and disabled, and the run log starts streaming output — the first stage started executing purely because the task was opened.
5. Equivalently, run the existing regression test, which currently passes and documents this as intended:
   ```
   pnpm vitest run src/app/__tests__/task-auto.test.jsx -t "opens a task with stages left and starts advancing on its own"
   ```
   It asserts `api.automate` was called (with all stages, including the first) merely from `mount()` — no simulated click, no prior "start."

**Result:** the exact complaint reproduces — opening a task with an unstarted first stage auto-starts that first stage without the user doing anything.

---

## Root cause (code evidence)

### 1. A mount-time effect auto-starts the whole chain, with no "has this been started" gate
`src/app/features/task.jsx:234-249`:
```js
// ⚡ AUTO-ADVANCE ON BY DEFAULT: a task with stages still to run starts
// advancing the moment it opens — exactly once per task, and only after the
// brief is loaded so every stage prompt carries the captured intent. …
const autoStartedRef = useRef(null);
useEffect(() => {
  if (autoStartedRef.current === key) return;
  if (task.finalized || !briefLoaded) return;
  autoStartedRef.current = key;
  if (automating) return;   // already advancing (user kicked it manually first)
  const work = task.stages.some((s) => (task.tracking[s] || {}).status !== "done");
  const liveHere = runningStages && [...runningStages].some((k) => k.startsWith(key + "/"));
  if (work && !liveHere) automate();
}, [key, briefLoaded, automating, task.finalized, task.stages, task.tracking, runningStages]);
```
`work` is true for *any* task with at least one non-`done` stage — including a task where `task.tracking` is `{}` (nothing has ever run). `liveHere` is only true if a run is *currently* live; it says nothing about whether the task was ever started. So the very first time a fresh task is opened, `work && !liveHere` is `true` and `automate()` fires immediately, unconditionally, from the mount effect itself — no click, no prior run, nothing.

This block was introduced whole-cloth by the #13 fix (commit `52a77b8`, "finalize engineering/every-stage-floor-should-be-in-auto"), which correctly made auto-advance *the default setting* but went further and made *opening the task* the trigger for starting work — conflating "auto-advance is on by default" with "runs should auto-*start* on open."

### 2. `automate()` sends the whole stage chain, including the never-started first stage, with no way to exclude it
`src/app/features/task.jsx:200-218` (`automate`) builds `bodies` from *every* stage in `stageObjs` and posts them all to `api.automate` in one call. There is no notion in this function (or in the server) of "only chain forward from an already-in-progress stage" — stage 0 is treated exactly like stage 1..N.

`server/bridza-run.js:910-941` (`automateTask`) confirms this server-side: it iterates `stages` from index `0`, skipping only stages already marked `done` in `tracking`. A stage that has never been run (no tracking entry at all) is run immediately, with no special-casing for "index 0 / first stage requires a manual kick-off." So there is no server-side backstop either — whatever the client sends starting at the first incomplete stage, the server will run without asking whether that stage was ever explicitly started.

### 3. No persisted "auto-advance enabled" preference — only ephemeral "is running now" state
`src/app/features/task.jsx:337-338`:
```jsx
<input type="checkbox" checked={automating} disabled={automating || task.finalized} onChange={(e) => e.target.checked && automate()} />
<span className="slider" /><span className="switch-lbl">{automating ? "⚡ Auto-advancing…" : "⚡ Auto-advance"}</span>
```
`automating` is local `useState(false)` (`task.jsx:50`), true only while a run is actively streaming. There is no field on the task/pipeline (nothing in `core/domain.js`, `server/bridza-store.js`, or `plan.json`) that records "the user turned auto-advance off for this task." So "if auto-advance is enabled... but if it's turned off, it should not auto-advance" has no representation to check — the mount effect can't respect an off switch that doesn't exist, and the on-switch is indistinguishable from "a run happens to be live right now."

### 4. The regression is locked in by the test suite
`src/app/__tests__/task-auto.test.jsx:95-106` — the `describe("auto-advance on by default")` block's first test explicitly mounts a task with two never-run stages and asserts `api.automate` gets called with both stages, purely from `mount()`. This test currently passes and will need to change as part of the fix (it should instead assert opening a never-started task does *not* call `automate()`, while its sibling tests for `finalized`/all-done tasks — which already correctly assert no auto-start — stay as-is, and a live-in-background run should still resume being *displayed*, not restarted).

---

## Suggested fix direction (for the fix stage — NOT applied here)

- Add a real "has this task been started" signal — e.g. treat a task with an empty `tracking` (no stage ever attempted) as *not started*, and only let the mount effect resume/display an *already-live* run or a task that is mid-way through its stages (some stage done/attempted, more to go). Never call `automate()` from the mount effect for a task whose first stage has no tracking at all.
- Keep the explicit "start" actions (running the first stage manually, or flipping the switch by hand) as the only things that can kick off stage 1. Auto-advance then takes over from stage 2 onward for that same run.
- Consider promoting `automating`/auto-advance into task-level persisted state (e.g. an explicit `task.autoAdvance` flag defaulting to `true`) so "enabled by default, but user can turn it off" is representable and checkable independently of "is a run live right now."
- Update `src/app/__tests__/task-auto.test.jsx` to assert the corrected contract: opening a never-started task does not call `automate()`; opening a task with an already-live background run still shows/resumes the log without restarting anything (this part of the existing suite already passes and should be preserved).

*This document is reproduction/diagnosis only; the fix is tracked by the following `fix` stage.*
