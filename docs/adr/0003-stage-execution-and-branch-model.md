# ADR-0003 — Real stage execution: CLI tools + the luxpms branch model

**Status:** accepted · 2026-06-11 · **branch model SUPERSEDED by
[ADR-0004](0004-bridza-task-timeline-model.md)** (one branch + one worktree per
*task* with a prompt→result commit timeline, replacing the per-stage branches +
in-repo worktrees below; product renamed Bridza, data dir `.bridza/`). The
CLI-tool registry and `cmd.shell` decisions here still hold.
**Advances:** P0-3 (real generation, CLI-first) and P0-4 (git integration).

## Decision

### Tools — CLI first

A stage runs for real via a **command-line agent tool** chosen per stage in
the belt UI. v1 supports **Claude Code** (`claude -p … --permission-mode
acceptEdits --append-system-prompt …`) and **opencode** (`opencode run …`,
system prompt folded into the message). Availability is detected with `which`.
API tools (codex, openrouter, …) come later behind the same registry
(`src/store/run.js` → `CLI_TOOLS`).

The prompt is assembled from the stage contract itself: task ref + title,
stage name/goal, inputs from the previous stage, expected output artifacts,
user-attached file paths, and the user's prompt. The (editable) stage system
prompt rides separately. `LUXPMS_TOOL_OVERRIDE` substitutes a stub command so
the whole pipeline is testable without LLM cost.

### Branch model

```
luxpms/tasks/<REF>/base      created when the issue/card is created
luxpms/tasks/<REF>/<stage>   created on first run of that stage, branched
                             from the PREVIOUS stage's branch (or /base)
```

One git constraint shapes this: a ref path can't be both a file and a
directory, so the task branch is `<REF>/base` — never bare `<REF>` — leaving
`<REF>/` free for stage branches.

- **Diffs are stage-vs-previous-stage**: `git diff prevBranch...stageBranch`,
  shown in the belt after each run (file list + full patch).
- **Runs happen in worktrees** under `.luxpms/worktrees/<ref>/<stage>` (the
  directory is gitignored via `.luxpms/.gitignore`), so the user's working
  tree and checked-out branch are never touched.
- After a run, the bridge commits the worktree
  (`luxpms(<ref>/<stage>): <tool> run`, author `luxpms <luxpms@local>`); a
  run with no file changes commits nothing.

## Consequences

- A repo needs at least one commit before task branches can exist; the UI
  surfaces the error otherwise.
- Stage chaining is literal git ancestry — approving/merging flows
  (stage → base → main PR) are the natural next step, not built yet.
- Re-running a stage appends commits to its existing branch (no reset
  semantics yet — to be designed with the conveyor's regenerate/stale model).
- Worktrees accumulate; `git worktree prune` runs opportunistically, a
  cleanup command is future work.

## Amendment — 2026-06-11

The runner core moved to `stagepipe-run.js` (importable; `stagepipe-fs.js` is
only the HTTP layer) and the last two consequences above are resolved:

- **Re-run reset:** `fresh: true` on a run deletes the stage branch + worktree
  first, so the run branches cleanly from the previous stage again. Default
  re-runs still append.
- **Worktree cleanup:** `POST /api/pm/git/cleanup-worktrees` (belt: "Clean
  worktrees") removes run worktrees; branches/commits are kept and a later
  run recreates the worktree from the branch.
- **Commit only on success:** a failed run (nonzero tool exit, failed
  `cmd.shell`) commits nothing — its changes stay uncommitted in the worktree
  for inspection. Typed failures: `unknown-tool/bad-ref/git/spawn/exit/shell`.
- **`cmd.shell`:** the stage's shell commands run sequentially in the worktree
  after the tool; any failure fails the run.
- **Reply = output:** the tool's streamed reply becomes the belt's reviewable
  stage output; committed files feed the stage diff.
- Covered by `src/__tests__/bridge-run.test.js` (temp repos + stub tool).
- **`$PWD` must match the worktree:** opencode trusts `$PWD` over `getcwd()`,
  so the spawn env sets `PWD: worktree` — otherwise the agent writes into the
  SERVER's folder (found via a real opencode run; regression-tested).
- **Per-tool model override:** `body.model` or `LUXPMS_<TOOL>_MODEL` env maps
  to `claude --model` / `opencode run -m`, so a broken default in the tool's
  own config (e.g. a dead provider key returning 402) can't dead-end runs.
