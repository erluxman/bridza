# Create PR button — GitHub compose link in browser

## Intent

First half of the "Create PR button in task detail alongside merge with main."
feature. Add a **Create PR** button to the task detail toolbar next to the
existing `Finalize → main` button (`src/app/features/task.jsx` ~line 367,
next to `targetName`).

When the GitHub CLI (`gh`) is NOT available, clicking the button opens the
GitHub "compare & pull request" page in the real browser, pre-filled for THIS
task:

    https://github.com/<owner>/<repo>/compare/<target>...<task-branch>?expand=1

Take the repo web URL from `git remote get-url origin`, supporting BOTH forms:
`https://github.com/o/r.git` and `git@github.com:o/r.git`. Reuse the existing
`taskTarget` / `taskBranchName` helpers in `server/bridza-run.js` for the
branch pair. If the repo has no origin or origin is not GitHub (GitLab,
Bitbucket, bare path…), the button must be disabled with an explanatory tooltip
rather than build a bogus URL.

Open the URL with `window.open(url)` — Electron's `setWindowOpenHandler`
(`electron/main.js`) already routes external https to the real browser.

## Acceptance Criteria

- [ ] Server resolves `https://github.com/<owner>/<repo>` from BOTH ssh and
      https remotes (unit-tested pure helper in `server/bridza-run.js`).
- [ ] New bridge route returns `{ ok: true, url }` for a task whose branch and
      target exist; `{ ok: false, error }` when origin missing or not GitHub.
- [ ] `src/app/api/client.js` exposes the call; `task.jsx` renders **Create PR**
      next to `Finalize → <target>`.
- [ ] Button disabled (with title) when the task is `finalized`, or when the
      repo has no GitHub origin.
- [ ] Clicking opens the correct compare URL `…/compare/<target>...<branch>?expand=1`
      and the branch/target come from the task's real metadata.
- [ ] vitest coverage using the existing temp-repo helpers in
      `src/app/__tests__/` (`makeRepo`, `BRIDZA_WORKTREE_DIR`): http+ssh remotes,
      non-github origin → null, finalized task → disabled.
- [ ] `pnpm test`, `pnpm lint`, `pnpm build` pass.