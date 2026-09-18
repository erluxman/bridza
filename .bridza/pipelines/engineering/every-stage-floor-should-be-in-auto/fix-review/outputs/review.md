# Review — Every stage floor should be in auto advance by default.

Verdict: **approved with notes**. The two user-facing asks — (1) every flow is in auto-advance mode by default, (2) the background runner/terminal communication is visible on the pane — are genuinely fixed and verified. Regression test confirmed **red without the fix**, 3/5 assertions fail on the pre-fix tree. `pnpm test` (183/183), `pnpm lint`, and `pnpm build` are all green. One repro root-cause point (the inert per-stage `auto`/"review" flag) is left untouched and should be cleaned up as a follow-up.

## Fit check — Bugfix flow

Single reported defect ("flows are not auto by default, and I can't see what's happening in the background"), one code path (`TaskDetail` + flow/store defaults), no missing feature surface. Filed under Bugfix is correct; no re-flow needed.

## Root-cause mapping (repro.md → fix)

| repro.md root cause | Addressed? | Evidence |
|---|---|---|
| 1a. `task.jsx:48` `automating = useState(false)` — opt-in default OFF | ✅ (behaviorally) | `automating` still defaults to `false`, but a new guarded effect (`task.jsx:210-219`) calls `automate()` on open whenever: brief is loaded, task not finalized, ≥1 stage not done, nothing live for this task (`runningStages` prefix), and this task hasn't been auto-started in this mount (`autoStartedRef`). The switch is never clicked; flows run back-to-back by default. |
| 1b. `flow.jsx:13-14` `mkStage`/`normStage` default `auto: false` | ✅ | `mkStage` → `auto: true`; `normStage` → `auto: s.auto !== false` (`flow.jsx:13-14`). |
| 1c. `server/bridza-store.js:451` `normStageDef` defaults `auto: !!s.auto` → review | ✅ | `auto: s.auto !== false` (`bridza-store.js:451`) — an unset `auto` now normalizes to auto. |
| 2a. Log pane gated on `automating` only, in the mounted view | ✅ | `runLogCard` (was the inline `automating &&` block) renders when `automating \|\| taskLive \|\| taskLog` (`task.jsx:270-278`), in both the stages view and the inspector/canvas/chat view (`task.jsx:332,346`). A live run in **another window** (`taskLive` from `App.jsx:94` `proj.running`) keeps the pane up. |
| 2b. `taskLog` wiped on task change + ephemeral component state → log lost when `TaskDetail` unmounts while the run continues | ✅ | New module store `src/app/lib/autolog.js` (`logKey`/`readLog`/`appendLog`, cap 64000, keyed `pipeline/task`). `appendLog` mirrors to it (`task.jsx:57`); the task-change effect restores `setTaskLog(readLog(key))` instead of `setTaskLog("")` (`task.jsx:73`). Survives navigate-away-and-back; (correctly) not a reload — it's in-memory, which matches repro scope ("navigate away and come back"). |
| 3. Per-stage `auto` flag never read by `automateTask` (`bridza-run.js:830-863`) — dead config | ⚠️ NOT addressed | Server still ignores `stage.auto`. With the new all-defaults-on, this is *consistent* with runtime (everything advances), but the flow editor still renders a live-looking toggle: `flow.jsx:269` toggles a stage between `⚡ auto` and `review`, and choosing **review has zero runtime effect** — the run barrels through it. repro.md explicitly listed this as root cause and suggested "wire it into the runner **or remove it**". Neither was done. Follow-up recommended: remove/hide the review toggle or wire real supervised-pause semantics. Note wiring real review semantics would partly contradict "every flow auto by default", so deleting the dead toggle is the better of the two. |

## Regression test without the fix

Ran `src/app/__tests__/task-auto.test.jsx` (5 tests) against a worktree at the fix's parent (`bdee1f5`, pre-fix `task.jsx` + the new test file + `autolog.js`):

- **3 failed** — exactly the on-point assertions:
  - *"opens a task … starts advancing on its own, log pane showing the run"* → `api.automate` never called (`expected "vi.fn()" to be called at least once`).
  - *"keeps showing the background run after leaving the task and coming back"* → `automate` 0× instead of 1×.
  - *"restarts advancing on re-open only when nothing is live anymore"* → `automate` 0×.
- **2 passed vacuously** — the *"does NOT auto-start a finalized / all-done task"* guards: they assert absence of a behavior that never existed pre-fix, so they're weak but harmless (post-fix they pin the guards).
- Same file on the fixed tree: **5/5 pass**.

Conclusion: the regression suite does fail without the fix and does pin the fixed behavior.

## Sibling callers — no regressions found

- **`automate()`** is called only from the switch (`task.jsx:307`) and the new effect (`task.jsx:218`), both inside `TaskDetail`. No other callers. Reentrancy: `automate()` early-returns if `automating` (`task.jsx:171`); the effect is additionally ref-guarded per `key`.
- **`appendLog`/`onLog` path**: `Stage`→`StageRunner` (`task.jsx:684`) and views-runner (`task.jsx:335`) both forward `onLog` into `appendLog` → store mirror. The module-store swap preserves the pre-existing single-log-per-task behavior; cap stays 64000.
- **`key`** (`logKey(pipeline.id, task.id)`) produces the identical string as the old `pipeline.id + "/" + task.id`; `TaskRelations taskKey` (`task.jsx:410`) and the `runningStages` prefix match (`task.jsx:95,217`) are unchanged in meaning.
- **Flow editor/store defaults**: `mkStage`/`normStage`/`normStageDef` are the only normalizers of `auto` (`core/domain.js` never reads it). `bridza-store.test.js:115` still passes.
- **e2e** updated consistently: `app.spec.js:232-235` (handoff test — switch click removed, `.term` asserted) and `ux-views.spec.js:419-439` (auto-advance test renamed "on by default"; throwaway-task test now waits for 3 done before delete).

## Verification run on the fixed tree

| Check | Result |
|---|---|
| `pnpm test` (vitest) | ✅ 8 files / **183 tests pass** (incl. 5 new `task-auto` tests) |
| `pnpm lint` | ✅ clean |
| `pnpm build` (tsc + vite) | ✅ built (only the pre-existing >500 kB chunk warning) |
| `pnpm test:e2e` | ⚠️ 2 of 43 fail — **pre-existing, not this fix's doing** |

The two e2e failures (`app.spec.js:40` "new task must pick a flow", `ux-views.spec.js:67` setup) both die on `.pipe` clicks intercepted by the **Welcome dialog** (`<div class="modal-bg">` + `dialog "Welcome" … "Good luck with today's work"`), rendered over the dashboard on a fresh run (no `bridza-welcome` in storage). I re-ran those exact two tests on the pre-fix tree — **identical failures on the same line**. The fix's files don't touch `App.jsx`/`WelcomeDialog`, and the failing step never reaches `TaskDetail`. So no **new** e2e regression; but the modified/added e2e assertions (`.term` visible, no-switch-click auto-advance) could not be executed end-to-end because the serial suites halt at these blockers. File follows upstream as the pending "WelcomeDialog flake" noted in the fix run's log; worth its own ticket once #12/landing-page QA lands.

## Notes (non-blocking)

- **Stopped/failed tasks re-fire on reopen.** "Restarts advancing on re-open only when nothing is live anymore" is codified as intended (test 5). Consequence to be aware of: a task the user deliberately stopped, or one whose stage failed, restarts on the *next* open (nothing live → work remains → `automate()`). A persistent failure thus retries on every visit; the only hard stopper is **Finalize → main**. Within a single open session the `autoStartedRef` guard keeps a stopped run stopped, but navigation unmounts it. Worth a persisted "auto off" memory if this ever bites.
- **Manual single-stage runs now race the auto-run.** Auto-start fires moments after open, so the per-stage "Run stage" button has a small window before auto-advance grabs the run; manual operators must Stop first. This is the direct, intended price of "every flow auto by default" — flagging for awareness, not a defect.
- **`runLogCard` persists after finalize.** A retained `taskLog` keeps the "⚡ Auto-advance" card rendering even on a finalized task — showing retained history is desirable; the label reads slightly odd but is cosmetic.
- **The two negative tests pass vacuously pre-fix** (see above) — acceptable since the positive tests carry the regression weight.

## Over-engineering — nothing to delete

- `autolog.js` is ~19 lines and replaces what would otherwise be a `liftedState`/context rewrite across the whole app; the module store is the minimal correct scope (session-level, matches repro's "navigate away" wording). `logKey`/`readLog`/`appendLog`/`__resetLogs` are each used.
- The auto-start effect is one effect with a `useRef` guard + the `runningStages`/`briefLoaded` gates — the minimal correct way to avoid double-kick and avoid running before the brief loads (stage prompts depend on it).
- No new dependencies, no speculative abstraction, no dead code introduced.

## Process note

Single fix run (commit `f0d932d`, 7 files + pipeline metadata). The fix-stage log flagged the WelcomeDialog e2e flake as suspected-pre-existing; I've now proven it reproduces on the pre-fix tree's identical lines, so it is confirmed pre-existing and unrelated. Recommendation: file the WelcomeDialog e2e blocker as its own task so auto-advance e2e coverage can actually run in CI.