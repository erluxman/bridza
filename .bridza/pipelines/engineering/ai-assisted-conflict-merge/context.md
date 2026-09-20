# Hand an unresolved merge conflict to the configured AI agent

## Intent

Delivers ticket #49 (`when-merging-to-main-does-not-happen`): when a merge into
the target branch cannot be completed with plain git, the app should be able to
ask the already-configured agent (claude / opencode — the same tool selection
each stage uses) to resolve the conflict against the task's own context, rather
than forcing a hand merge.

This is the LAST resort in the chain, and it must be positioned that way:
[[conflict-auto-union-bridza-state]] removes the boring conflicts first,
[[conflict-open-in-vscode]] covers the ones a human wants to see, and only what
is left reaches the agent.

Non-negotiable: an AI resolution is a PROPOSAL, not a commit. The agent runs in
the task's worktree on an already-conflicted merge, and the user reviews the
resulting diff and explicitly accepts it. Nothing is pushed, and nothing lands
on the target branch, without that click.

## Acceptance Criteria

- [ ] "Resolve with <tool>" appears on the readiness panel only when preflight
      `state === "conflict"`, and names the tool actually configured for the
      task.
- [ ] The run happens in the task's worktree with the merge already started, and
      the agent is given: the conflicted paths, the task's `context.md`, and the
      target branch name.
- [ ] The result is surfaced as a reviewable diff with explicit Accept / Discard
      actions. Discard runs `git merge --abort` and restores the pre-attempt
      worktree byte-for-byte.
- [ ] Accept commits the resolution on the TASK branch only. The target branch
      is never written by this task — landing still goes through the normal
      finalize path.
- [ ] After Accept, re-running [[merge-preflight-check]] reports `clean`.
- [ ] A failed, timed-out, or empty agent run leaves the worktree recoverable
      and shows the tool's stderr; it never leaves a silently half-resolved
      merge.
- [ ] The run is recorded in the task's `tracking` run ledger like any other
      run (tool, prompt, exit code, changed files, sha).
- [ ] vitest coverage with a stubbed agent binary (existing
      `BRIDZA_TOOL_OVERRIDE` / execFileSync pattern): successful resolution →
      accept → clean preflight; non-zero exit → recoverable worktree; discard →
      pre-attempt state.
- [ ] `pnpm test`, `pnpm lint`, `pnpm build` pass.

## ARCHIVED by #88 — deferred, not dropped. Ship [[conflict-auto-union-bridza-state]] and [[conflict-open-in-vscode]] first — they are cheap and certain. Unarchive this if conflicts still reach the user afterwards. The spec below stays valid.
