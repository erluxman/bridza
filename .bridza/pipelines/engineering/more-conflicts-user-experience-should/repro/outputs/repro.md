# Repro — "More conflicts, user experience should be easier." (task #15)

**Status:** reproduced (both merge-conflict paths)  
**Scope:** `Finalize → main` flow in the Bridza app + editor handoff  
**Do not fix yet** — this is the reproduction report only.

---

## 1. What the reporter is asking for

When a task branch conflicts with the target branch on merge (Finalize), the app
should make resolving the conflict easy for people who are not terminal-literate:

- either resolve the conflict **inside the app's UI** (GitHub-style Accept
  current / incoming / both), or
- **hand off to VS Code with the necessary parameters already set** so the user
  only has to pick what to keep (`accept` / `delete` / `add`).

The merge must stay "driven by the app" — the user never wants to figure out the
merge commands themselves. Today **none of that exists**.

---

## 2. Reproduction environment

- OS: Linux, node ≥ 25, git available, VS Code `code` CLI not required for the repro
  (the failing path never reaches VS Code).
- App: Bridza Electron/Vite app, bridge `server/bridge.js` → `server/bridza-run.js`.
- Verified against current HEAD `4022293` (task metadata on branch
  `bridza/engineering/more-conflicts-user-experience-should`).

Repro scripts used (kept under `/tmp/opencode`):
`repro-bridza-conflict.mjs` (Scenario A + B), `repro-bridza-conflict-b.mjs` (clean B),
inline runs for the mid-merge landmine checks.

---

## 3. The failing path — exact steps and inputs

### Scenario A — finalize while the target (`main`/`master`) is the checked-out branch (the common case)

This is the path `finalizeTask` calls "in-place" (`server/bridza-run.js:1030`).

Setup (existing app model — a task branch forked from `main` + worktree):

1. Repo seeded with `git init -b main`, one commit containing `app.txt`:
   ```
   line1
   line2
   line3
   ```
2. Task `engineering/conflict-demo` created (fork from `main`) with a
   worktree on branch `bridza/engineering/conflict-demo`.
3. Worktree commits a change to `app.txt` line 2 → `task line`.
4. `main` advances independently: `app.txt` line 2 → `main line`, committed.
5. In the app, user clicks **Finalize → main**.
   HTTP input: `POST /api/bridza/finalize` → `finalizeTask(root, "engineering", "conflict-demo", { style: "squash", … })`
   (style defaults to `squash`; `currentBranch(root) === "main"` and the tree is
   clean → `inPlace = true`, so the merge runs in the repo's checked-out `main`).

Server execution:

- `server/bridza-run.js:1069` runs `git merge --squash bridza/engineering/conflict-demo`.
- Git aborts with `CONFLICT (content): Merge conflict in app.txt`, exit code ≠ 0.
- `execFileSync` (`git()` helper, `server/bridza-run.js:30-35`) **throws**.
- The `try/catch` at `server/bridza-run.js:1081-1084` catches it and returns:
  ```json
  {
    "ok": false,
    "error": "Command failed: git merge --squash bridza/engineering/conflict-demo",
    "autocommit": null
  }
  ```
  (`firstLine(e)` at bridza-run.js:1083 discards git's stderr — the repo **is not
  told which file conflicted**. No flag like `conflict: true`, no conflicted-file
  list.)

Client-visible behavior:

- `src/app/features/task.jsx:147-154` — `finalize()` flash-toast shows exactly:
  `Command failed: git merge --squash bridza/engineering/conflict-demo`.
  That is the **entire** guidance the user gets.
- Clicking **Open in VS Code** (`task.jsx:155-159`) calls `openWorktree`
  (`server/bridza-run.js:159-186`) → `code -n <task-worktree>`. The task worktree
  is on the *task branch* and is **clean** — it contains none of the conflict.
  The conflict markers live in the repo's checked-out `main`,
  **which the app never opens**. So the "hand off to VS Code" path points the
  user at the wrong directory and shows them nothing to resolve.

Post-conditions of Scenario A (observed):

- `git status --porcelain` → `UU app.txt`; `git ls-files -u` shows 3 staged
  blobs (base/stage1, ours/stage2, theirs/stage3).
- `app.txt` in the repo contains the raw markers:
  ```
  line1
  <<<<<<< HEAD
  main line
  =======
  task line
  >>>>>>> bridza/engineering/conflict-demo
  line3
  ```
- No `MERGE_HEAD` (squash merges don't write one); repo is left **mid-merge**.

### What the app does if the user keeps clicking (the landmine)

- The **next** click on **Finalize** does not retry the merge.
  `finalizeTask` sees `!isClean(root)` (`bridza-run.js:1032`) and returns
  `{ ok: false, needsResolve: true, target: "main" }`
  → the app opens the "Uncommitted changes on main" dialog
  (`DiffView working`, `task.jsx:383`, `diff.jsx:168-175`).
- That dialog is built for ordinary uncommitted work, not an in-progress merge:
  - `workingDiff` (`bridza-run.js:1154-1162`) renders the conflicted state as a
    **broken file entry with an empty path** whose hunks are the raw conflict
    markers (`{ path: "", hunks: [ +<<<<<<< HEAD,  MAIN, +=======,  task line, +>>>>>>> …] }`).
  - **Stash & merge** → `git stash push -u …` fails on the unmerged index:
    `error: could not write index` (observed; so the user can't "get out").
  - **Commit & merge** → `git add -A && git commit` would commit the literal
    conflict-marker text onto `main` (worst case) unless the user happens to
    first edit the file in the broken diff viewer (which can't be opened
    correctly for a conflicted file).

> Net observed behavior: the app is a one-way door. Once a conflict happens in
> place, the app gives a useless one-line error, cannot surface the conflicted
> files, cannot hand off to VS Code at the right place, and any attempt to
> "resolve" via its own dialogs fails or commits garbage. Only reverting the repo
> by hand in a terminal escapes it — exactly what the reporter says users can't
> do.

### Scenario B — finalize while a *different* branch is checked out (`into` = main, out-of-place)

Same conflict, but the merge runs in the throwaway worktree `<repo>.bridza-tasks/_finalize`
(branch forked off the target), created at `bridza-run.js:1052-1056`.

1. Same setup as A (task branch + worktree conflict with `main`), except the repo
   checkout is now `feature-x`.
2. User clicks **Finalize → main**.
3. `_finalize` worktree is created, `git merge --squash bridza/engineering/conflict-demo`
   inside it → conflict.
4. Catch at `bridza-run.js:1081-1084` calls `cleanup()` (bridza-run.js:1056)
   → `git worktree remove --force <repo>.bridza-tasks/_finalize`.
5. The only copy of the conflict markers in existence is **deleted**.

Observed result:

```json
{ "ok": false, "error": "Command failed: git merge --squash bridza/engineering/conflict-demo", "autocommit": null }
```

- `_finalize` worktree no longer exists; the task worktree is clean
  (`app.txt` = `task line`, no markers anywhere).
- **There is nothing left on disk to inspect or resolve, anywhere.**
  The user cannot open VS Code on the conflict because no conflicted folder
  exists anymore. Only recourse: go to a terminal and redo the merge manually.

---

## 4. Observed vs expected behavior

| | Observed (both scenarios) | Expected (from the request + industry UX) |
|---|---|---|
| Conflict detected | Treated as a generic git failure; stderr discarded by `firstLine` (bridza-run.js:1083) | App knows it's a **merge conflict**, reports which files (`git ls-files -u` / `git diff --name-only --diff-filter=U`) and how many |
| Error shown to user | `Command failed: git merge --squash bridza/<branch>` — names no file, no branch | Clear message: "N file(s) conflict on merge", list each conflicted path |
| Resolution options in the app | None. Only escape hatch is the "dirty main" dialog meant for uncommitted work (currently broken on unmerged entries) | In-app resolve: accept current / accept incoming / accept both per conflict (GitHub added exactly these one-click buttons — 2025-10 changelog; VS Code CodeLens)
 / git resolve markers |
| VS Code handoff | `Open in VS Code` opens the *task worktree* (task branch) where there is **no** conflict; out-of-place it doesn't exist at all | Open VS Code **at the checked-out folder where the merge is paused** so its Source Control auto-detects `UU` entries and shows Accept Current/Incoming + the 3-way merge editor; optionally `code --merge <input> <input> <base> <result>` (VS Code CLI, `--merge`) |
| Where the conflict lives | Scenario A: stranded in the repo's `main` checkout, half-merged, invisible to the app. Scenario B: destroyed | A stable, discoverable conflicted state the app can drive a resolution from |
| "Merging is driven by the app" | False — after failure the user is forced to terminal | True — the app drives the whole merge → resolve → finish loop |
| Repo safety | App mutates the user's checked-out `main` (starts a merge there) with no `MERGE_HEAD`, no conflict banner, and broken exit paths | Either keep the user's checkout untouched (merge in a stable, kept conflict worktree) or clearly manage the in-progress state |

---

## 5. Root cause

`finalizeTask` (`server/bridza-run.js:1006-1085`) is written with only two
outcomes in mind — success, and "dirty target checkout" (`needsResolve`) — and
**no branch for the third outcome: conflicting merge**. Concretely:

1. **Conflicts are not distinguished from any other merge failure.**
   The merge command is one of three one-liners (`squash`:1069 / `rebase`:1073 /
   `merge`:1076) inside one blind `try`; on failure the catch (`1081-1084`)
   collapses everything to `{ ok:false, error: firstLine(e) }`. Git's stderr —
   which contains `CONFLICT (content): Merge conflict in <file>` and the
   "fix conflicts and then commit" instructions — is thrown away. The server
   never exposes `conflict: true` or the conflicted file list, so no UI anywhere
   can branch on it.

2. **Out-of-place conflicts destroy the evidence.** The merge happens in a
   disposable `_finalize` worktree; the catch unconditionally runs `cleanup()`
   (`1056`, `1081`) before returning, deleting the only location that holds the
   markers.

3. **The one editor affordance points at the wrong place.** `openWorktree`
   (`159-186`) always opens the *task branch* worktree. For a conflict the user
   needs a VS Code window on the directory where an unmerged index exists (VS
   Code's integration surfaces `UU` entries as "Merge Changes" with Accept
   Current/Incoming and the 3-way merge editor). The app never offers that
   directory, and never passes conflict parameters.

4. **The "resolve dirty main" dialog is reused for a job it can't do.**
   `needsResolve` (`1030-1046`) conflates "ordinary uncommitted edits" with
   "left-over conflicted merge". After an in-place conflict, the next Finalize
   hits `!isClean` → `needsResolve:true`, and the diff-based dialog then:
   - renders the conflicted state as a file with `path: ""` full of raw markers
     (`workingDiff` `1154-1162`);
   - **Stash & merge** fails (`git stash` refuses the unmerged index —
     `error: could not write index`);
   - **Commit & merge** stages and commits marker text onto `main` if the user
     doesn't hand-edit first.

5. **No conflict primitives exist anywhere.** `conflict`/`unmerged`/`Unmerged`
   have **zero** matches in `src/`. Neither the bridge (`server/bridge.js`)
   nor the UI has any concept of a conflicted file, a paused merge, conflict
   resolution, or finishing a resolved merge (`git add` + commit) from the app.

---

## 6. What a fix should preserve / can lean on (reference only — not implemented)

Researched references for the expected UX (see §4):

- **GitHub conflict resolution** (docs.github.com — "Resolving a merge conflict on
  GitHub"; GitHub Changelog 2025-10-02 "One-click merge conflict resolution now
  in the web interface"): per-file conflict editor under a **Resolve conflicts**
  button, list of conflicting files on the side, **Accept current changes /
  Accept incoming changes / Accept both changes** buttons, **Mark as resolved**,
  then **Commit merge**. Complex conflicts → hand off to a local editor. This is
  precisely the shape the reporter asked to copy.
- **VS Code** (code.visualstudio.com/docs/sourcecontrol/merge-conflicts): when a
  repo has unmerged entries, VS Code shows a **Merge Changes** section; opening a
  conflicted file gives CodeLens **Accept Current / Accept Incoming / Accept
  Both**, plus a **3-way merge editor** (Incoming | Current | Result). Also
  `code --merge <input1> <input2> <base> <result>` launches the merge editor
  directly, and `git config merge.tool vscode` /
  `mergetool.vscode.cmd 'code --wait $MERGED'` wires terminal merges to it.
- The app already has the building blocks to keep the merge app-driven:
  `parseDiff`/`branchDiff` (diff support), `workingDiff`,
  `openWorktree` (editor launch), and the bridge's `POST /api/bridza/finalize`
  surface — but it lacks (a) a conflict-detection/completion step in
  `finalizeTask`, (b) a stable conflicted state in a worktree the user is
  pointed at, and (c) any UI for accept/skip/finish.

Any fix should also decide the "into a dirty checkout" policy: starting a merge
in the user's live `main` checkout with no `MERGE_HEAD` and no banner is what
makes the state hard to recover from (Scenario A landmine).

---

## 7. Repro artifacts

- `/tmp/opencode/repro-bridza-conflict.mjs` — Scenario A (in-place) end-to-end:
  prints the `{ok:false}` result, the `UU`/unmerged index, the marker contents,
  and the `needsResolve` follow-up trap.
- `/tmp/opencode/repro-bridza-conflict-b.mjs` — Scenario B (out-of-place)
  end-to-end: shows the `_finalize` worktree deleted after the conflict so no
  conflict state survives.
- Inline node runs (captured above) verifying:
  - next Finalize after an in-place conflict → `needsResolve:true`;
  - `workingDiff` broken entry `{ path: "", hunks: […markers…] }`;
  - `git stash push -u` → `error: could not write index`;
  - `git ls-files -u` → 3 unmerged entries, no `MERGE_HEAD`.

Outputs dir note: `repro/` was untracked on the task branch before this report;
`repro.md` is the first artifact written.