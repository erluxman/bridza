# Bridza — On-disk format (`.bridza/`)

The contract for the repo bridge and the store. Decisions:
[ADR-0001](adr/0001-file-based-storage.md) (file-based),
[ADR-0002](adr/0002-github-client-no-auth.md) (local client, no auth),
[ADR-0004](adr/0004-bridza-task-timeline-model.md) (the task-timeline model).

A **project** is any repo that has (or gets) a `.bridza/`. The product code
lives next to it; `.bridza/` holds the pipelines, tasks, and their outputs.

```
<repo>/                                # the project (a monorepo)
  lib/ ios/ android/ …                 # product code
  .bridza/
    .metadata/
      metadata.json                    # business-level config
      company-principles.md            # NL global context, injected into prompts
      universal-rules.md
    pipelines/
      .metadata/
        metadata.json                  # config shared by all pipelines
      <pipeline>/                      # e.g. marketing — replaces the old "type"
        .metadata/
          metadata.json                # stage-flow, constraints, workingDir
        <task>/                        # e.g. task-506 — a leaf, NO .metadata
          metadata.json                # hard config + ALL tracking
          context.md                   # NL intent for the whole task
          <stage>/                     # e.g. stage-1-research
            context.md                 # NL intent for this stage
            outputs/                    # the ONLY content files
```

Rules that apply everywhere:
- **Every directory's config file is `metadata.json`** (program-read, strict).
- **Natural language is `.md`** (`context.md`, principles, rules) — readable,
  diffable, agents read it directly.
- **Content is `outputs/`** — nothing else writes content files.
- Unknown JSON keys are preserved on rewrite (hand-edits and agent-added
  metadata survive). Missing keys get engine defaults.
- On-disk pipeline/task/stage dir names are slugged `[A-Za-z0-9_-]`; the id in
  `metadata.json` is authoritative.

## Git model (summary; full detail in ADR-0004)

One branch + one worktree per task: `bridza/<pipeline>/<task>`. Each stage run
appends a **prompt** commit then a **result** commit (a timeline; re-runs
append). Worktrees live outside the repo, optionally sparse to `workingDir`, so
tasks run/build in parallel and the user's checkout is never touched. Finalize
merges the task branch into main (`squash | rebase | merge`).

## Business config — `.bridza/.metadata/metadata.json`

```jsonc
{
  "v": 1,
  "name": "YellowQ",
  "merge": "squash",                 // finalize style: squash | rebase | merge
  "defaults": { "tool": "claude" }   // fallbacks for pipelines/tasks
}
```

`company-principles.md` / `universal-rules.md` are free prose, prepended to the
system prompt for every stage in the project.

## Pipeline config — `.bridza/pipelines/<p>/.metadata/metadata.json`

The stage-flow definition. **System prompts live here, once**, read by every
task's stage by id (no per-task duplication).

```jsonc
{
  "v": 1,
  "id": "marketing",
  "label": "Marketing",
  "workingDir": "Marketing",          // a subdir, or "." for the whole repo
                                       //   → drives the task worktree's sparse checkout
  "stages": [
    {
      "id": "research",
      "name": "Research",
      "tool": "claude",               // default CLI tool for this stage
      "systemPrompt": "You are a research agent. …",
      "outputs": [{ "name": "brief.md", "note": "crisp problem framing" }],
      "shell": [],                    // build/check gates run after the tool
      "gate": "reviewed"
    }
    // … planning, spec, …
  ],
  "constraints": {}                   // optional per-pipeline rules
}
```

`pipelines/.metadata/metadata.json` holds defaults shared by all pipelines
(same shape, partial).

## Task — `.bridza/pipelines/<p>/<task>/metadata.json`

Hard config **and** all tracking. This file is itself versioned in the task
branch timeline, so every run updates it.

```jsonc
{
  "v": 1,
  "id": "task-506",
  "pipeline": "marketing",
  "title": "Q3 launch microsite",
  "type": "campaign",
  "outputMode": "docs",
  "branch": "bridza/marketing/task-506",
  "stages": ["research", "planning", "spec"],   // the chosen stage set
  "routing": {},
  "status": "in-progress",                       // in-progress | done
  "finalized": false,
  "tracking": {
    "research": {
      "status": "done",                          // idle | running | done | failed
      "seconds": 512,
      "runs": [
        {
          "tool": "claude", "model": null,
          "prompt": "do research on …",
          "startedAt": "2026-06-20T…", "finishedAt": "2026-06-20T…",
          "status": "done", "exit": 0,
          "promptCommit": "a1b2c3…"              // result commit = the branch tip
        }
      ]
    }
  }
}
```

`context.md` (task) and `<stage>/context.md` are free prose — the human-authored
intent. Nothing program-read lives in them.

## `<stage>/outputs/`

The stage's content files (what the tool produced). On a fresh stage an empty
`outputs/` is materialised with a `.gitkeep`. Diffs/reviews are against the task
branch timeline, not a per-stage branch.

## Project enumeration & state

- **Projects** are a recents list (folders the user has opened), the same model
  as the old open-folder recents — persisted client-side, not in any one repo.
- A task's heavy `outputs/` live only on its branch until finalize. A
  lightweight stub (`metadata.json` + `context.md`) is committed on the shared
  branch at create-time so the sidebar lists the task; live in-progress state is
  read from the task branch tip (`git show <branch>:…/metadata.json`).

## Versioning & compatibility

- `metadata.json.v` versions each level; migrations run on open.
- The app starts empty — no project open → welcome screen (open a directory /
  recents). A folder with no `.bridza/` gets the pipeline picker; only chosen
  pipelines are written, nothing else in the folder is touched.
- Corrupt file → that file is skipped with a console warning + UI toast, never a
  crash; the raw file is left untouched on disk.
