# Merge preflight check: is this branch clean to land on its target?

## Intent

One server-side answer to the question every other merge ticket assumes:
**would merging `<task-branch>` into `<target>` right now succeed, and if not,
which files conflict?**

Today nothing asks before acting. `finalizeTask` (`server/bridza-run.js`) merges
and discovers conflicts by failing, and the UI's `Finalize → <target>` button
(`src/app/features/task.jsx` ~line 367) is always enabled, so the user learns
about a conflict only after the repo is in a half-merged state.

Compute the answer WITHOUT touching the working tree, using
`git merge-tree --write-tree <target> <task-branch>` (fall back to the
three-arg `git merge-tree <merge-base> <target> <branch>` form on older git),
so the check is side-effect free and safe to run on every task-detail open.

This is the foundation slice: [[merge-button-gating]],
[[conflict-open-in-vscode]] and [[ai-assisted-conflict-merge]] all consume its
result and add nothing to it.

## Acceptance Criteria

- [ ] Pure helper in `server/bridza-run.js` takes `(pipeline, task)`, resolves
      the branch pair with the existing `taskTarget` / `taskBranchName` helpers,
      and returns
      `{ state: "clean" | "conflict" | "up-to-date" | "unknown", conflicts: [<paths>], ahead, behind }`.
- [ ] The check never mutates the working tree, index, or any ref — verified by
      asserting `git status --porcelain` is byte-identical before and after.
- [ ] `state: "unknown"` (never a crash) when the target or task branch is
      missing, the task is already finalized, or git is too old for both
      `merge-tree` forms; the reason is carried in the payload.
- [ ] New bridge route in `server/bridge.js` exposes it; `src/app/api/client.js`
      wraps the call.
- [ ] Task detail shows the result as a plain readiness line next to
      `Finalize → <target>` (e.g. "Clean to merge into main" /
      "3 files conflict with main"). Display only — gating is
      [[merge-button-gating]].
- [ ] vitest coverage using the existing temp-repo helpers in
      `src/app/__tests__/` (`makeRepo`, `BRIDZA_WORKTREE_DIR`): clean merge,
      a real two-sided conflict listing the right path, missing target branch,
      already-merged branch.
- [ ] `pnpm test`, `pnpm lint`, `pnpm build` pass.

## FOLDED IN by #88 — the gated Finalize button (was #92, delivers #50)

`merge-button-gating` was archived and its scope moved here: the check and the
button that consumes it are one slice, not two tickets. The UI half must ship
with the helper.

- [ ] `Finalize → <target>` is disabled when preflight `state === "conflict"`,
      with a tooltip naming the conflicting files.
- [ ] Enabled when `state` is `clean`; for `up-to-date` the button reads
      "Already merged" and is disabled.
- [ ] `state: "unknown"` does NOT disable the button — it shows a warning and
      lets the user proceed, so a preflight failure can't strand a task.
- [ ] The panel always says what to do next (merge the target in, resolve via
      [[conflict-open-in-vscode]], or re-check) and offers a manual "Re-check";
      the check also re-runs after a stage run finishes on that task.
- [ ] Nothing auto-merges, auto-rebases or auto-pushes as a side effect.
- [ ] Component coverage: conflict → disabled + reason, clean → enabled,
      unknown → enabled with warning, re-check updates the state.
