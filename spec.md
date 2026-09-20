# Create PR button — direct GitHub CLI (`gh`) path

## What

The **Create PR** button in task detail (`src/app/features/task.jsx:374`) stops
being a browser-only affordance. When the GitHub CLI is installed *and*
authenticated, one click creates the pull request on GitHub directly —
non-interactive, no compose page — and the resulting PR URL is flashed and
opened. When `gh` is missing or not logged in, the same click falls back to the
browser compose link from the sibling subtask, with a message saying why.

## Why

Creating a PR through the compose page costs a browser round trip and a second
click on "Create pull request", with the title and body re-typed or re-pasted.
Most users who have `gh` already have it authenticated, so for them the button
can do the whole thing. The fallback is what makes that safe to default to: the
button is never a dead click, whatever the machine has installed.

## How

### Server — `createPR()` in `server/bridza-run.js`

The function already resolves the GitHub remote, `taskTarget`, `taskBranchName`,
the task title and a body from the task context, and already has a `gh` branch
guarded by `toolAvailable("gh")`. Three changes:

1. **Auth gate.** After `toolAvailable("gh")`, run `gh auth status`
   (`execFileSync`, stdio piped). A non-zero exit means unauthenticated → take
   the fallback path with the message `not logged in to GitHub CLI — run
   \`gh auth login\``.
2. **Fallback contract.** Today the no-`gh` path returns `{ ok: true, url:
   composeUrl }`, which the UI cannot tell apart from a created PR. It returns
   `{ ok: false, fallback: true, error, url: compareUrl, title, body }` instead
   — the compose URL still travels on the response so the UI can open it. Both
   fallback causes (no `gh`, failed `gh auth status`) use this shape, differing
   only in `error`.
3. **Push before create.** With `gh` available and authenticated, check whether
   the task branch has an upstream (`git rev-parse --abbrev-ref
   <branch>@{upstream}`); if it does not, run `git push -u origin <branch>`
   before `gh pr create`. A failed push is a real error, not a fallback:
   `{ ok: false, error: "push failed: " + firstLine(...) }` — the compose link
   would not work either with the branch absent from origin.

Order inside the authenticated path stays: existing-PR lookup (`gh pr view
<branch> --json url`, returns `{ ok: true, url, existing: true }` — unchanged) →
push if needed → `gh pr create --base <target> --head <branch> --title <title>
--body <body>` → `{ ok: true, url }` parsed from stdout.

The bridge route `POST /api/bridza/pr` (`server/bridge.js:332`) already forwards
the whole result object; no route change.

### UI — `createPR()` handler in `src/app/features/task.jsx:186`

- A `creatingPr` state disables the button and labels it `Creating PR…` for the
  duration, so a slow `gh` call cannot be double-clicked.
- `ok` → flash the PR URL (`PR created · <url>`, or `PR already exists · <url>`
  for `existing`) and open it, as today.
- `fallback` → flash the server's message and open `r.url` (the compose link) in
  a new tab.
- neither → flash `r.error`, open nothing.

### Tests — `src/app/__tests__/`

Vitest against a real temp git repo (the `makeRepo` pattern in
`bridza-run.test.js`), with a stub `gh` shell script written into a temp bin dir
prepended to `process.env.PATH`, so `toolAvailable("gh")` and the `execFileSync`
calls both resolve to the stub. The stub appends its argv to a log file the test
reads back. Three cases: happy path (asserts the `pr create` argv — base, head,
title — and the returned URL), no `gh` on PATH (fallback shape + compose URL),
and a stub whose `auth status` exits non-zero (fallback shape + the
"not logged in" message).

## Out of scope

Draft PRs, reviewers, labels, assignees and milestones; PR templates; editing
the title or body from the UI before creating; PR status or checks in task
detail; non-GitHub remotes; installing or authenticating `gh` on the user's
behalf.
