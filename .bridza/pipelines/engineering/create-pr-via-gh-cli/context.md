# Create PR button — direct GitHub CLI (gh) path

## Intent

Second half of the "Create PR button in task detail alongside merge with main."
feature. Reuses the **Create PR** button and remote-resolution helper from
`create-pr-browser-compose-link` and upgrades it: when the GitHub CLI (`gh`)
is installed AND authenticated, clicking the button CREATES the PR directly
(non-interactive, no browser round trip) and flashes the resulting PR URL.

Server (reuse `toolAvailable("gh")` in `server/bridza-run.js`, and the resolution
helper / `taskTarget` / `taskBranchName` from the sibling subtask):

- `gh` present + authenticated → push the task branch to origin if it has no
  upstream, then run non-interactively
  `gh pr create --base <target> --head <task-branch> --title "<task title>" --body "<brief>"`,
  return `{ ok: true, url }`.
- `gh` missing OR `gh auth status` failing → `{ ok: false, fallback: true }`
  and a clear message; the UI then falls back to the browser compose link, so
  the user is never left without a path.

UI (`src/app/features/task.jsx`): while creating, the button shows a busy state;
on success flash the PR URL; on fallback open the compose link.

## Acceptance Criteria

- [ ] Bridge route detects `gh`; missing gh returns `{ ok:false, fallback:true }`
      and the button falls back to the compose link (never a dead click).
- [ ] `gh auth status` failure is caught and also falls back with a readable
      message ("not logged in to GitHub CLI").
- [ ] With gh available, calling creates the PR for `<task-branch>` →
      `<target>` with the task title, and returns the real PR URL.
- [ ] Branch is pushed to origin before `gh pr create` when it has no upstream;
      push failure is surfaced as a clear error.
- [ ] vitest coverage in `src/app/__tests__/` with a stubbed `gh` on PATH
      (existing `BRIDZA_TOOL_OVERRIDE` / execFileSync pattern): happy path args,
      missing-gh fallback, unauthenticated fallback.
- [ ] `pnpm test`, `pnpm lint`, `pnpm build` pass.