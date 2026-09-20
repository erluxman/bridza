# Investigation — does one task's state interfere with another's, across tabs?

Task #106 · `engineering/investigate-state-interference-between` · stage `fix`

## Fixed (second pass)

`npx vitest run` → **12 files, 262 passed** (244 before + 18 regression tests). Lint + build clean.

| Channel | Change |
|---|---|
| React tree | `<TaskDetail key={pipeline/task}>` (`App.jsx`) — a task switch is a remount; `StageRunner` reseeds on `pipeline.id` too |
| localStorage | `bridza.taskView`, `railHidden`, `canvasLayout` keyed `:<pipeline>/<task>`; `plannerLayout` keyed `:<pipeline>`; a `storage` listener follows another window's auto-advance flip |
| `plan.json` | client sends only the changed keys with `merge: true`; server patches the per-task maps key-wise (`null` clears) — lists (milestones, pipeDeps) still replace whole |
| `time.json` | server keeps the **max** per stage — a second window can never wind a clock back |
| runs | ▸ Run honours `live`; `ACTIVE_RUNS` / `stopRuns` / `/run/stop` carry the repo root |
| two repos | every browser-side key is prefixed with the repo path (`<dir>\|<pipeline>/<task>`) — same task id in two repos = two keys; the open project rides in the tab's own URL (`?dir=`), localStorage only seeds a fresh tab |
| paused merge | `_finalize.owner` records the task that parked it; another task's finalize / finish / abort is refused by name instead of being handed the conflict |

Tests: `src/app/__tests__/task-isolation.test.jsx` (one tab, 7), `tab-isolation.test.jsx` (two tabs, 8), plus `bridza-store` / `bridza-run` cases for the server halves.

Left as is: rail/sidebar **widths** (window prefs, not task state); two tabs editing the same **milestone list** (last write wins); the Electron ephemeral-port origin; `GET /state` committing; `fold: "plan"`. All listed below.

---

*(original investigation follows — findings still accurate; the ones above are now closed)*

## Answer

**Yes, and through three independent channels, not one.** The `repro` stage found
the first. This pass confirms it and adds the two the report actually asked
about — the ones that cross a tab/window boundary.

| # | Channel | Scope | What it is |
|---|---|---|---|
| 1 | **The React tree** | one tab | `TaskDetail` never unmounts on a task change, so task A's state runs task B's screen |
| 2 | **`localStorage`** | tab ↔ tab | 6 semantically per-task keys are global, read once into `useState`, never re-read, no `storage` listener anywhere |
| 3 | **The server** | tab ↔ tab, and window ↔ window | one process, one repo; `plan.json`, `time.json`, the run registry and the paused-merge worktree are shared and written whole from each tab's stale snapshot |

Channel 3 is the one that loses committed data. Channel 1 is the one that sends
requests naming the wrong task. Channel 2 is mostly preference noise — with one
exception (auto-advance) that starts agent runs the user turned off.

The requirement "every tab is its own piece of work" is **not met today**, and a
`key` on `TaskDetail` — the fix the repro stage proposed — closes channel 1
only. Channels 2 and 3 need their own changes.

---

## Part 0 — verifying what was already done

`repro.md` (stage `repro`) is accurate. Re-run on this branch:

```
cp .bridza/pipelines/engineering/00000106-.../repro/outputs/repro-106-state-interference.test.jsx src/app/__tests__/
npx vitest run src/app/__tests__/repro-106-state-interference.test.jsx
→ 7 failed (7)        ← every failure is a real leak
npx vitest run        → 10 files, 244 passed   (baseline still green)
```

Its root cause is confirmed at `src/app/App.jsx:128` — `<TaskDetail>` has no
`key`, so a sidebar click swaps the `task` prop on a reused instance and ~12 of
~16 state slots survive into the next task.

Its scope is **one tab**. The report was about several tabs. That gap is what
follows.

---

## Part 1 — new evidence: a two-tab repro

Parked next to the first one, same convention (outside `src/`, so `pnpm test`
stays green):

```
.bridza/pipelines/engineering/00000106-investigate-state-interference-between/repro/outputs/repro-106-cross-tab.test.jsx
```

Two tabs are modelled as two independent React roots in one document — which is
exactly what two tabs of one origin are: separate component trees, **one**
`localStorage`, **one** server.

```
cp .bridza/.../repro/outputs/repro-106-cross-tab.test.jsx src/app/__tests__/
npx vitest run src/app/__tests__/repro-106-cross-tab.test.jsx
→ 6 failed | 1 passed (7)
```

| | Assertion | Observed |
|---|---|---|
| **G** | Task A set to Canvas in tab 1 → task B opens in tab 2 | opens in **Canvas**; `bridza.taskView` is one key for every task in every tab |
| **H** | Rail hidden on task A in tab 1 → task B in tab 2 | opens with the **rail gone** (`bridza.railHidden`) |
| **I** | Two live tabs + a view change in tab 1 | store says `canvas`, tab 1 shows Canvas, tab 2 still shows Stages — **three-way divergence**; tab 2's next write then decides task A too |
| **J** | Same task in two tabs, Planning open in one and Build in the other, 30 s each | `time.json` ends at `{"build":29}` — **`planning` is 0**. Each tab posts absolute totals; the server replaces per stage (`bridza-store.js:355`) |
| **L** | Task A in tab 1 gains a dependency; task B in tab 2 gains one | `plan.json` ends with **only task B's**. Tab 2 posted its whole pre-edit snapshot — and `plan.json` is committed and gates what may run |
| **M** | Tab 1 is running stage *Planning*; tab 2 has the same task open | tab 2's **▸ Run is enabled** — a second agent process, same worktree, same branch |
| **K** *(control, passes)* | `bridza.autoAdvance.<pipeline>/<task>` | correctly per-task — the pattern the global keys should copy |

J and L are data loss. M is two agents writing one branch.

---

## Part 2 — channel 2: `localStorage`

Complete inventory. No `storage` listener, no `BroadcastChannel`, no Electron
IPC exists anywhere in the app (verified by grep over `src/`, `electron/`,
`index.html`) — so every key below is read **once** into a `useState`
initializer and reconciles only on remount.

### Global, but semantically per-task — these are bugs

| Key | Site | Symptom across tabs |
|---|---|---|
| `bridza.taskView` | `task.jsx:70,72` | tab 2's view choice decides what tab 1's *next* task opens in (test G) |
| `bridza.canvasLayout` | `views.jsx:208,209` | a 3-stage task laid out `radial` re-lays-out a 12-stage task; the per-task *positions* (`bridza.canvasPos:<p>/<t>`) and the global *layout* they sit on top of disagree |
| `bridza.plannerLayout` | `flow.jsx:29,30` | same, for the pipeline planner |
| `bridza.railHidden` | `task.jsx:74,75` | test H |
| `bridza.railW` | `task.jsx:73` → `ui.jsx:13,16` | two tabs ping-pong the width; neither reconciles until reload |
| `bridza.sideW` | `App.jsx:28` → `ui.jsx:13,16` | same, App-level, so it never reconciles while both tabs live |

### Namespaced per task — but still divergent, and this one is dangerous

`bridza.autoAdvance.<pipeline>/<task>` (`task.jsx:17,85,89`) is keyed correctly,
yet it is read only inside the `[key]` effect. **Tab 2 turns auto-advance off
for task A; tab 1 already has task A open and never re-reads.** When a stage
finishes in tab 1 it chains to the next stage (`task.jsx:280`) — the app starts
agent runs the user explicitly disabled. Namespacing alone doesn't fix this;
the value has to be re-read or pushed.

### Global and correct by intent

`bridza-recents`, `bridza-side`, `bridza-welcome`, `bridza-plan-wide`,
`bridza.term.*`, `theme` (marketing pages only). Cosmetic divergence at worst,
except: the terminal-settings bus (`settings.js:17,23`) is per tab, so tab 1's
open xterm keeps the old font after tab 2 saves.

### `bridza-project` — the highest-blast global

`App.jsx:17,84,89`. Opening a **different repo** in tab 2 overwrites it. Tab 1
keeps working against the old `dir` held in React state, with no warning, and on
reload **both tabs land on the last-written project**. `closeProject` removes
the key, so closing the project in tab 2 sends tab 1 to the Welcome screen on
its next reload.

### Structural: no per-tab identity at all

There is no router (no `react-router`, no `pushState`/`popstate` anywhere). The
open task is plain component state (`App.jsx:21-22`); `main.tsx:16-21` only
picks app vs. marketing page. So:

- a reload loses the open task entirely — `activeTask` resets to `""` and the
  board renders;
- both tabs are `http://127.0.0.1:<port>/app`, indistinguishable, un-bookmarkable;
- and there is no natural per-tab key to scope any of the above by.

This is the same ground as task #105 ("a different task URL"), and it is the
cleanest place the per-tab/per-task split could come from.

---

## Part 3 — channel 3: the server

One process, one repo, every tab talking to it. Every store function is
synchronous, so a single read-modify-write cannot interleave *within* one
process — the damage comes from state that persists *between* requests, and from
each tab posting whole documents built from its own stale snapshot.

### Critical

**A paused merge is repo-global and blocks unrelated tasks.**
`bridza-run.js:1230` — `const inPlace = currentBranch(root) === target`. The
common case (checkout on `main`, task targets `main`) merges **in the user's
real checkout**. A conflict leaves `main` mid-merge. Every store write then
commits with a pathspec (`bridza-store.js:168`), which git refuses during a
merge, so it throws → 500. Tab A saving context / creating a task / editing the
plan on a *different* task fails until someone resolves tab B's conflict. And
`GET /state` writes too (below), so both tabs can flip to "Can't open <dir>".

**One shared `_finalize` worktree, and `finishConflict` ignores the task.**
`bridza-run.js:168,1263` — the conflict worktree path is keyed by repo root
only. On conflict it is deliberately kept (it is the only copy). Then:

```js
// server/bridza-run.js:1313
export function finishConflict(root, { dir, pipeline, task, target, message } = {}) {
```

`pipeline` and `task` are destructured and **never referenced in the body** —
verified by reading the whole function. It acts purely on `dir`, and
`bridge.js:342-358` passes `b.dir` through with no containment check. So tab B
finalizing task-2 is handed task-1's parked conflict (files, dir and all),
renders it as its own, and "✓ Finish merge" commits **task-1's half-resolved
merge onto `main` under task-2's message**. Abort deletes it outright.

This is the server-side twin of `repro.md`'s case C2: the client sends the wrong
task, and the server has no guard that would have caught it.

### High

**`plan.json` — whole-document replace, no version check.** `savePlan`
(`bridza-store.js:990-999`) takes each section wholesale from the body; both
writers (`task.jsx:598-609`, `plan.jsx:217`) post their entire in-memory
snapshot, loaded once at mount. Proven by test **L**. `plan.json` is committed
and enforced at run time (`blockedByPlan`), so a lost edge silently changes what
is allowed to run. `savePipeline` and `saveKanbanOrder` have the same shape.

**`time.json` — absolute values, replace-merge.** `task.jsx:160` posts
`{...timeRef.current}`; `bridza-store.js:355` does `{ ...prev, ...clean }`.
Proven by test **J**.

**The run registry has no repo dimension.** `ACTIVE_RUNS` entries are
`{pipeline, task, stage, tool, startedAt}` (`bridza-run.js:743`) — no root — and
`stopRuns` filters on those alone (`:488`). `/api/bridza/run/stop`
(`bridge.js:247-250`) is the only handler in the file that never resolves a repo
at all. Two tabs on **two different projects** with a colliding
`pipeline/task` (likely — starter pipelines hand out the same ids, task slugs
come from titles): tab A's Stop kills tab B's agent in the other repo,
`deleteTask` does the same, and `listActiveRuns()` is spliced into `/state` for
every repo, so the other project's run paints a live badge and suppresses
auto-advance on an unrelated task.

**Two tabs can run the same stage at once.** Proven by test **M**. The Run
button guards on local state only (`views.jsx:93`); `live` is passed in
(`views.jsx:21,108`) and never used to disable it. Server-side the registry key
is uniquified with `Date.now()` (`bridza-run.js:742`), so the second run is
admitted, gets the **same worktree** (`:750`), and two agent processes race
commits on one branch. Notably, auto-advance *does* already defend against this
(`task.jsx:276-280`, "another window") — manual Run does not.

**Finalize mutates the shared root checkout on one task's behalf.**
`git stash push -u` of the whole working tree (`:1245`), `git add -A` + commit
(`:1249`), and `git reset --hard HEAD` as the abort path (`:1356`). The stash
stack is repo-global and records nothing about which task pushed it.

### Medium

- **`GET /state` writes and commits.** `bridge.js:169-173` self-heals missing
  `#refs` via `assignRefs`, which writes `refs.json` and commits. Both tabs poll
  this every 4 s — a read-only-looking poll creates commits, and during a paused
  merge it throws.
- **Commit folding merges two tasks' edits.** `bridza-store.js:1053` folds plan
  commits under the constant key `"plan"`, so within the 5-minute window tab B's
  estimate edit on task-2 `--amend`s away tab A's dependency commit for task-1.
  (`"context:" + path` and `"kanban:" + pid` are keyed correctly.)
- **Head-of-line blocking.** Every child process is `execFileSync`:
  `aiCommitMessage` up to 90 s (`:1197`), `recommendPipelines` 60 s,
  `pickFolder` 120 s. Tab B finalizing task-2 freezes tab A's polls, its stage
  run, and the NDJSON output of an in-flight run for the duration.
- **`BRANCH_SCAN` is a single global slot** (`bridza-store.js:443`) guarded by
  root, so no wrong-repo data — but two tabs on two projects alternate roots
  every 4 s and the cache misses every time, rebuilding the whole branch scan
  twice per window.
- **`mergeTime` accepts foreign stage ids** (`:355`) — the server half of
  `repro.md` case B; a leaked `openStage` is written into the other task's entry
  and stays.
- **No Electron single-instance lock** (`electron/main.js:90-93`). A second
  launch is a second process with its own server, and every "safe because it's
  single-threaded" guarantee above evaporates: `refs.json`, `inbox.json`,
  `time.json` and `.git/bridza-sessions.json` are unguarded read-modify-write
  with plain `writeFileSync` — no atomic rename, no lock.

### Electron: every launch is a different origin

`electron/main.js:69-75` — `server.listen(0)` takes an **ephemeral port**, and
`createWindow()` calls `startServer()` every time. `localStorage` partitions by
origin *including port*, so in the packaged app **none of the keys in Part 2
persist across launches**: the app always opens on Welcome, recents are empty,
terminal font resets. And on macOS, closing the window then clicking the dock
icon (`:93`) starts a *second* server on a *new* port, leaving the first
listening — two windows with completely separate storage sharing one
`ACTIVE_RUNS` and one repo. Worst of both.

This also means the Part 2 localStorage leaks bite hardest in **dev/browser
mode** (`http://app.localhost:5173`, stable origin, real tabs), which is how the
report was filed.

---

## What is already correctly isolated

Worth stating, because it narrows the fix surface:

- **Task worktrees and branches** — `taskWorktree(root, pipeline, task)`
  (`bridza-run.js:153`), `bridza/<pipeline>/<task>`. Two tasks genuinely run in
  separate checkouts; `reset`/`clean`/`add -A` act only inside the task's own.
- **Task metadata**, **per-stage routing** (`metadata.routing[stageId]` on the
  task's own branch), and **LLM sessions** (`.git/bridza-sessions.json`, keyed
  `pipeline/task` then tool, merged not replaced).
- **The API client is stateless** — `?dir=` plus explicit `pipeline`/`task` on
  every call (`api/client.js:4`). There is no implicit "current task" on the wire.
- **PTY sessions** — one pty per WebSocket, cwd from the URL's `pipeline`+`task`,
  killed on close (`bridge.js:116-152`, `term.jsx:51-77`). Two tabs get two
  independent shells.
- **No broadcast channel exists** — run output goes to the requesting response
  only. Nothing is fanned out to the wrong tab, and `runStage`'s `meta` event
  already carries `{branch, worktree, pipeline, task, stage}`, so a future
  broadcast could be filtered.
- **The autolog store** is keyed `pipeline/task` (`autolog.js:9`) and restored,
  not wiped, on task change. *(Per tab, though: tab 2 shows "⚡ LIVE RUN" over an
  empty pane for a run owned by tab 1.)*
- **Poll discipline within a tab** — non-stacking polls with a
  supersede-by-sequence guard (`App.jsx:52-65`).
- **`core/domain.js` is pure** — no module-level mutable state.

---

## What "every tab is its own piece of work" actually requires

Four separate changes. Ordered by leverage.

1. **`key={pipeline.id + "/" + task.id}` on `TaskDetail` (`App.jsx:128`).**
   Closes channel 1 whole — A–D of the first repro plus the `Stage`-level leaks
   (`<Stage key={def.id}>` at `task.jsx:416` keys on the stage id alone).
   Check the two behaviours that currently lean on the *absence* of a remount:
   the run-log pane (safe — it lives in the `autolog` module store) and the
   unmount time-flush (`task.jsx:158-163`), which would start firing on every
   task switch. Independently, `views.jsx:44` needs `pipeline.id` in its
   dependency list either way.

2. **Decide per-task vs. app-wide for each global key, then key it.**
   `bridza.autoAdvance.<pipeline>/<task>` is the model. Tests G/H encode the
   per-task reading; flip them if app-wide wins for a given key. Separately, add
   a `storage` listener (or `BroadcastChannel`) so two live tabs converge instead
   of ping-ponging — auto-advance in particular must not be readable-once.

3. **Stop whole-document writes.** `savePlan` should take a patch (or an
   `if-version` / etag), not a snapshot; `saveTime` should send deltas, or the
   server should increment rather than replace. These are the two findings that
   lose committed or recorded data, and no amount of client-side keying fixes
   them.

4. **Give the shared server resources a task identity.**
   `finishConflict`/`abortConflict` must verify that `dir` is the conflict of the
   task named in the request (the parameters are already there, unused);
   `_finalize` should be per task; `ACTIVE_RUNS` and `/run/stop` need the repo
   root; and the Run button should honour `live`.

A per-tab identity — the task in the URL (#105) — would make (2) structural
rather than a list of renamed keys, and would fix reload-loses-the-task at the
same time.

---

## Aside — unrelated bug found while reading

`bridza-run.js:1611` builds `path.join(root, DATA_DIR, rel.taskMeta(pipeline, task))`,
but `rel.taskMeta` already starts with `DATA_DIR` (`core/domain.js:148-159`), so
it resolves to `.bridza/.bridza/pipelines/…` and always throws into the
`catch`. `createPR` therefore always titles the PR with the raw task id and
sends an empty body.

---

## Environment

- branch `bridza/engineering/investigate-state-interference-between`, tip `6ed5262`
- node v24.13.0 · vitest 4.1.9 · react 19.1
- `npx vitest run` → **10 files, 244 passed** (both repro files parked outside `src/`)
- method: full read of `server/`, `core/`, `src/app/`, `electron/`; two parallel
  read-only audits (client / server); every finding quoted above was re-verified
  against the code in this pass.
