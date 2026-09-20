# Repro — State interference between two different tasks in task details

Task #106 · `engineering/investigate-state-interference-between` · stage `repro`

## Short answer to the report

> "if I open multiple sessions of Bridza in different tabs, does the state of one
> task detail affect the state of another task detail that I'm opening in a
> different tab? I think it does."

Yes — and the sharper version of the bug doesn't even need two tabs. **Inside a
single tab, clicking another task in the sidebar while a task detail is open
does not unmount `TaskDetail`.** React reuses the component instance, and every
piece of its state that isn't explicitly reset carries task A's values into
task B — including a paused merge conflict, an open diff, an open file editor,
and the stage the wall-clock is billing time to.

Across tabs the leak is narrower but real: the task-detail **view mode** and the
rail/canvas/layout preferences live under single global `localStorage` keys, so
they are shared by every task in every tab.

## Reproduction

Runnable repro — 7 failing assertions, one per leak:

```
.bridza/pipelines/engineering/00000106-investigate-state-interference-between/repro/outputs/repro-106-state-interference.test.jsx
```

It is parked outside `src/` so `pnpm test` stays green (244 passed, 0 failed on
this branch). To run it:

```bash
pnpm install                                   # or: ln -s <main checkout>/node_modules node_modules
cp .bridza/pipelines/engineering/00000106-investigate-state-interference-between/repro/outputs/repro-106-state-interference.test.jsx \
   src/app/__tests__/
npx vitest run src/app/__tests__/repro-106-state-interference.test.jsx
```

Observed: **7 failed (7)**. Every failure is the bug; the assertion in each test
is the expected behaviour.

### By hand, in the app

1. Open a project, open task **A** (e.g. an `engineering` task with stages
   *Planning / Build*).
2. Click its **Build** stage header so that card is open.
3. In the **sidebar**, click a different task **B** whose flow has different
   stages (e.g. *Repro / Fix*). Do not go back to the board first — clicking
   straight from the sidebar is what keeps `TaskDetail` mounted.
4. Task B's screen renders with **no stage open at all**, and the stage clock in
   the *Time by stage* card keeps ticking against a stage B does not have.

The same path, for the worst variant:

1. On task A press **Finalize → main** and let the merge hit a conflict — the
   CONFLICT dialog appears.
2. Without closing it, click task **B** in the sidebar.
3. The conflict dialog is still on screen, over task B. Press **✓ Finish
   merge**.
4. The request sent is task A's paused worktree attributed to task B.

## Observed vs expected

| # | Action | Observed | Expected |
|---|---|---|---|
| A | Open *Build* on task A → click task B in the sidebar | Every stage card in B is collapsed (`openStage` is still `"build"`, which B has no stage for) | B opens on its own first unfinished stage (*Repro*) |
| B | Leave it there ~11s | `POST /api/bridza/time` for **t-bravo** with `{"repro":0,"fix":0,"build":9,"__idle":{}}` — `build` is task A's stage | Only task B's own stage ids are written |
| C | Conflict dialog open on A → switch to B | `ConflictDialog` stays mounted over task B | Conflict is task A's; it is not part of B's screen |
| C2 | …then press **✓ Finish merge** | `finishConflict("/repo", {dir:"/repo/.bridza/wt/alpha", pipeline:"eng", **task:"t-bravo"**, target:"main"})` | Nothing sent; the dialog was not on screen |
| D | Click a timeline commit on A → switch to B | `DiffView` re-renders with `commit:"aaaaaaaaaaaa"` (A's) **and** `task:"t-bravo"`, `commits:` A's timeline | No diff modal for B |
| E | Switch A to the *Canvas* view → open task B (other tab, or after a reload) | B opens in *Canvas* — `bridza.taskView` is one global key | View mode is per task (or at least never surprises on a different task) |
| F | Two tasks with the same id in different pipelines (`eng/login-form`, `design/login-form`) | The prompt typed against the Engineering task is still in the Design task's Build box | Each task's stage seeds from its own brief / last run |

Not covered by a test but the same class, all leaking A → B on a sidebar swap:
`fileOpen` (the file editor modal — opens/saves A's path against B's worktree,
and `onSaved` commits to **B's** branch), `diffBranch`, `resolveOpen`,
`activeStage`, `tlOpen`, plus a frame of A's `timeline` / `stageTime` /
`stageIdle` before the refetch lands. `Stage`'s own `running` / `histOpen`
(`src/app/features/task.jsx:766-767`) leak too — `<Stage key={def.id}>` keys on
the stage id only, so the same stage id in two tasks is one instance.

## Root cause

### 1. `TaskDetail` has no `key`, so it is never remounted on a task change

`src/app/App.jsx:128`

```jsx
<TaskDetail dir={dir} proj={proj} pipeline={pipeline} task={task} … />
```

`activeTask` changes (sidebar click, `TaskRelations` row, follow-on task) while
the same ternary branch stays selected, so React reconciles the element by
position and type and **reuses the instance**. Only the state covered by the one
reset effect gets cleared:

`src/app/features/task.jsx:83-87`

```jsx
useEffect(() => {
  setTaskLog(readLog(key)); setShowTerm(false); setAutomating(false);
  setAutoAdvance(localStorage.getItem(autoKey(key)) !== "0");
}, [key]);
```

That is 4 of the ~16 state slots on this component. Everything else survives:

| Slot | Line | Reset on task change? |
|---|---|---|
| `openStage` | `task.jsx:42` | ❌ lazy initializer — computed once, for the first task only |
| `diffCommit` | `task.jsx:49` | ❌ |
| `diffBranch` | `task.jsx:50` | ❌ |
| `resolveOpen` | `task.jsx:51` | ❌ |
| `conflict` | `task.jsx:52` | ❌ |
| `fileOpen` | `task.jsx:53` | ❌ |
| `activeStage` | `task.jsx:71` | ❌ |
| `tlOpen` | `task.jsx:41` | ❌ |
| `timeline`, `stageTime`, `stageIdle` | `task.jsx:40,43,44` | ⚠ refetched async — stale for a frame, not cleared |
| `brief` | `task.jsx:108` | ✅ cleared then reloaded |
| `taskLog`, `showTerm`, `automating`, `autoAdvance` | `task.jsx:54,58,64,67` | ✅ the effect above |

Because the leaked values are then combined with the **new** `task`/`pipeline`
props in every handler, the leak is not cosmetic — it produces requests that
name task B while carrying task A's payload (`finishConflict`, `abortConflict`,
`openConflict`, `saveFile`, `getFile`, `getDiff`, `saveTime`).

### 2. The stage clock bills the leaked `openStage` into the new task's file

`src/app/features/task.jsx:146-163` — the 1s clock keys on `openStage` and the
10s flush posts `timeRef.current` wholesale for the *current* `task.id`. The
server merges rather than replaces:

`server/bridza-store.js:355`

```js
cur.tasks[key] = { ...prev, ...clean };
```

so the foreign stage id is written into task B's entry in
`.bridza/.cache/time.json` and stays there. (Gitignored cache, so it's a wrong
number in the *Time by stage* card, not a bad commit.)

### 3. `StageRunner` re-seeds on `task.id` without the pipeline

`src/app/features/views.jsx:44`

```jsx
useEffect(() => { setPrompt(seed()); setTool(remembered()); setModel(rememberedModel()); setOut(""); }, [task.id, def.id]);
```

Task ids are per-pipeline slugs, so two pipelines can hold the same id. When
only `pipeline.id` changes, this effect does not fire and the prompt, agent and
model of the other pipeline's task stay in the box — and get sent on the next
▸ Run.

### 4. Global `localStorage` keys for per-task view state (the cross-tab half)

`src/app/features/task.jsx:70` — `bridza.taskView` is a single key for every
task and every tab. Same for `bridza.railHidden` (`:74`), `bridza.railW` (`:73`),
`bridza.canvasLayout` (`views.jsx:208`), `bridza.plannerLayout`
(`flow.jsx:29`).

These are correctly scoped and are *not* part of the bug — worth keeping as the
model for a fix:

- `bridza.autoAdvance.<pipeline>/<task>` (`task.jsx:18`)
- `bridza.canvasPos:<pipeline>/<task>` (`views.jsx:212`)
- the run log store `LOGS`, keyed `pipeline/task` (`lib/autolog.js`)

## Notes for the fix stage (nothing fixed here)

- The single highest-leverage change is a `key` on `TaskDetail` in
  `App.jsx:128` — `key={pipeline.id + "/" + task.id}` — which remounts the
  screen per task and clears A–D and the `Stage`-level leaks at once. Check
  first that it does not regress the two behaviours the current code leans on
  the *lack* of a remount for: the run-log pane surviving navigation (it
  already lives in the `autolog` module store, so it should be fine) and the
  `beforeunload`/cleanup time flush (`task.jsx:158-163`), which runs on unmount
  and would now fire on every task switch — that is arguably more correct, but
  it changes the flush cadence.
- `StageRunner`'s effect (`views.jsx:44`) needs `pipeline.id` in its dependency
  list regardless — a `key` on `TaskDetail` covers the sidebar path but not a
  same-id/other-pipeline prop swap reaching `StageRunner` by another route.
- Decide deliberately whether `bridza.taskView` / `railHidden` / `railW` /
  `canvasLayout` are meant to be app-wide preferences (then leave them, and
  document it) or per-task (then key them like `bridza.autoAdvance.*` does).
  Test E encodes the per-task reading; flip it if the app-wide reading wins.
- Regression tests: the parked repro file is ready to move into
  `src/app/__tests__/` as-is — all 7 assertions are written as the expected
  behaviour, so they turn green on a correct fix.

## Environment

- branch `bridza/engineering/investigate-state-interference-between`, tip `9a4d169`
- node v24.13.0 · vitest 4.1.9 · react 19.1
- baseline `npx vitest run`: **10 files, 244 passed** (repro file excluded)
