# ADR-0004 — Bridza: project/pipeline/task/stage model, the task-timeline git model

**Status:** accepted · 2026-06-20
**Supersedes:** the branch model of [ADR-0003](0003-stage-execution-and-branch-model.md)
(per-stage branches + per-stage worktrees inside `.luxpms/`).
**Rename:** the product is now **Bridza**; the data dir is `.bridza/`
(was `.luxpms/`), the branch prefix is `bridza/` (was `luxpms/`), env vars are
`BRIDZA_*` (was `LUXPMS_*`).

## Context

ADR-0003 gave each *stage* its own branch (`luxpms/tasks/<ref>/<stage>`) and its
own worktree under `.luxpms/worktrees/`. That fanned out branches and worktrees
per task, cluttered the repo, and made stage diffs the unit of review. We want a
simpler mental model: a task is a unit of work with a **timeline**, tasks run
and build **in parallel**, and the user's checkout is **never** disturbed.

## Decision

### Hierarchy

```
project (a repo + .bridza/)        ← top-left switcher (recents)
  └─ pipeline (.bridza/pipelines/<p>/)   ← sidebar; replaces the old "type"
       └─ task (one git branch)           ← leaf
            └─ stage                        ← context.md + outputs/
```

Workspaces are removed — isolation is a new project (a separate repo + `.bridza/`).

### Git model — one branch + one worktree per task

```
bridza/<pipeline>/<task>     ← created when the task is created; every stage run
                               appends a prompt-commit then a result-commit.
```

- **One worktree per task**, located **outside the repo** in a per-repo cache
  (`~/.cache/bridza/worktrees/<repo>/<pipeline>/<task>`, overridable via
  `BRIDZA_WORKTREE_DIR`). Optionally **sparse-checked-out** to the pipeline's
  `workingDir` (plus the global rules, the pipeline def, and this task's own
  `.bridza` subtree) so a big monorepo isn't fully materialised. → tasks run and
  build in parallel with full isolation; the user's HEAD and working tree are
  never touched.
- **The timeline = two commits per stage run** (`runStage`):
  1. **prompt** — the run record (prompt text, tool, model, `startedAt`) is
     written into the task `metadata.json` and committed *before* the tool runs:
     `bridza(<p>/<task>/<stage>): prompt · <tool>`.
  2. the tool runs in the worktree, then any `cmd.shell` gates.
  3. **result** — `outputs/` + the completed run record (`exit`, `status`,
     `finishedAt`, `seconds`) are committed:
     `bridza(<p>/<task>/<stage>): result · <status> · exit <n>`.
- **Re-run appends** a new prompt/result pair — the timeline only grows, history
  is never lost (no `fresh`/reset).
- **Failures still commit a result** (`status: failed`) so the timeline records
  what actually happened; a later run appends a corrected pair. Typed failures:
  `unknown-tool | bad-ref | git | spawn | exit | shell`.
- Author is `bridza <bridza@local>`; `$PWD` is set to the worktree (opencode
  trusts `$PWD` over `getcwd()` — regression from ADR-0003 carried forward).

### Finalize — merge the task branch into main

`finalizeTask(root, pipeline, task, { style, into })`, `style ∈ squash | rebase |
merge` (default from the business `metadata.json`). When `into` (default
main/master) is the branch the user has checked out, the merge happens there —
finalize is an explicit user action and landing the work is the point; it
refuses a dirty checkout. Otherwise it runs in a throwaway worktree so the
user's checkout is untouched.

### Storage split

Config / program-read data → `metadata.json` (every directory's config file is
`metadata.json`). Natural language → `.md` (`context.md`, `company-principles.md`,
`universal-rules.md`). Content → `outputs/`. Per-stage tracking (status, seconds,
run records, commit shas) lives in the task `metadata.json` — no separate
`time.json`. System prompts live once in the pipeline's stage definition and are
read by stage id (no per-task duplication). See [09-file-format](../09-file-format.md).

## Consequences

- A repo needs at least one commit before task branches exist; surfaced as an
  error otherwise.
- Task **enumeration**: a task's heavy `outputs/` live only on its branch until
  finalize merges them to main. A lightweight stub (`metadata.json` +
  `context.md`) is committed on the shared branch at create-time so the sidebar
  can list tasks; live in-progress state is read from the task branch tip.
- Worktrees accumulate in the cache; `removeTaskWorktree` and `git worktree
  prune` reclaim them. Branches/commits are kept; a later run recreates the
  worktree from the branch.
- Core is `bridza-run.js` (+ pure helpers in `src/store/bridza.js`), covered by
  `src/__tests__/bridza-run.test.js` (temp repos + `BRIDZA_TOOL_OVERRIDE` stub).
- Migration is **greenfield**: the `.luxpms` markdown store, fixtures, and the
  ADR-0003 per-stage runner are replaced, not migrated.

## Status of the migration — complete (clean cut, no old files)

- [x] git core + tests (`bridza-run.js`, `src/store/bridza.js`)
- [x] JSON+md store read/write (`bridza-store.js`) — reads are pure, creates commit only their `.bridza` paths
- [x] HTTP bridge `bridza-fs.js` (`/api/bridza/*`)
- [x] UI: welcome → pipeline picker → project switcher + pipeline sidebar → board → task timeline + stage runner (`src/App.jsx`, `src/store/client.js`, `src/bridza.css`)
- [x] deleted all `stagepipe-*` / `pms-*` / old store + tests; product renamed Bridza (package, env, scripts, route)

Tests: `src/__tests__/bridza-run.test.js` + `bridza-store.test.js` (21, green). Verified
end-to-end in the browser: open project → create pipeline (commits `.bridza` to main) →
create task (stub on main + branch) → run stage (live `prompt → result` timeline on the
task branch, main untouched) → finalize merges to main.
