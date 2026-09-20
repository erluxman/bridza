# Resolve a conflicted merge in VS Code, launched from the app

## Intent

First half of ticket #15 (`more-conflicts-user-experience-should`): when a
merge into the target branch conflicts, the user should be able to fix it from
this app's flow rather than being silently dropped into a terminal they may not
know how to use.

Scope is deliberately the CHEAP, high-certainty path: don't build a
three-way-merge editor. When [[merge-preflight-check]] reports `conflict`, start
the real merge in the task's worktree so git writes conflict markers and
`MERGE_HEAD`, then launch VS Code at that worktree with the conflicted files
open — VS Code's built-in merge-conflict UI (Accept Current / Incoming / Both)
does the rest.

The app owns the lifecycle around that hand-off: it must be able to abort
cleanly (`git merge --abort`) and must detect when the user has finished
resolving outside the app.

## Acceptance Criteria

- [ ] "Resolve in VS Code" appears on the readiness panel only when preflight
      `state === "conflict"`.
- [ ] Clicking starts the merge in the task's worktree and opens VS Code via the
      `code` CLI at that folder with the conflicted files as arguments; the
      worktree is left in a conflicted-but-valid git state.
- [ ] `code` not on PATH → the action is disabled with a tooltip explaining how
      to install the shell command; it never fails silently or half-starts a
      merge.
- [ ] An "Abort merge" action runs `git merge --abort` and restores the worktree
      to its pre-attempt state; asserted byte-identical in tests.
- [ ] After the user resolves and commits in VS Code, re-running the preflight
      reports `clean` and finalize becomes available again — no app restart.
- [ ] vitest coverage with the temp-repo helpers in `src/app/__tests__/`:
      conflict → merge started + correct `code` argv (stubbed binary via the
      existing `BRIDZA_TOOL_OVERRIDE` pattern), missing `code` → disabled,
      abort → clean worktree.
- [ ] `pnpm test`, `pnpm lint`, `pnpm build` pass.

## SCOPE NOTE by #88 — this is the whole conflict UX for now (#15 + #49)

Two tickets were archived into this one:

- **#15 `more-conflicts-user-experience-should`** — the raw idea. Its other half
  (most conflicts are `.bridza` JSON state, not code) is
  [[conflict-auto-union-bridza-state]], which runs *before* this path and should
  remove most of the conflicts this ticket would otherwise have to show.
- **#49 `when-merging-to-main-does-not-happen`** — asked for an AI-resolved
  merge. That spec is written up in `ai-assisted-conflict-merge` (#89, archived
  as deferred, not deleted). Deliberately deferred: auto-union plus a VS Code
  hand-off is cheap and certain, an agent resolving merges is neither. Unarchive
  #89 only if conflicts still reach the user after both of those ship.
