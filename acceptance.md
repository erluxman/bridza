# Acceptance — Create PR button, direct `gh` path

- [ ] With `gh` installed and authenticated, clicking **Create PR** creates the
      PR for `<task-branch>` → `<target>` with the task title and a body from
      the task context, and returns the real PR URL — no compose page involved.
- [ ] The task branch is pushed to origin before `gh pr create` when it has no
      upstream; a branch that already has one is not re-pushed.
- [ ] A failed push returns `ok: false` with a readable error (not a fallback),
      and no `gh pr create` is attempted.
- [ ] `gh` not on PATH returns `{ ok: false, fallback: true }` carrying the
      compose URL, and the button opens the compose link — never a dead click.
- [ ] `gh auth status` exiting non-zero is caught and falls back the same way,
      with a message naming the cause ("not logged in to GitHub CLI").
- [ ] An already-open PR for the branch is reported as existing with its URL
      instead of erroring on a duplicate create.
- [ ] While the request is in flight the button is disabled and shows a busy
      label; it returns to **Create PR** on success, fallback, and error alike.
- [ ] Vitest coverage in `src/app/__tests__/` with a stubbed `gh` on PATH:
      happy-path `pr create` argv and URL, missing-`gh` fallback, unauthenticated
      fallback.
- [ ] `pnpm test`, `pnpm lint`, `pnpm build` pass.
