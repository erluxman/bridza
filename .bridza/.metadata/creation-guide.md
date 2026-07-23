# How to create Bridza work items (for agents)

Read this before creating any task, ticket or milestone. Bridza discovers items
from files — create the right files and they appear in the app immediately
(task branches are scanned too, so you may create these inside a task worktree).

## Create a task / ticket

Under `.bridza/pipelines/<pipeline>/<task-id>/` (task-id: lowercase, a-z0-9 and
dashes only, max 40 chars):

1. `metadata.json` — required:
   `{ "v": 1, "id": "<task-id>", "pipeline": "<pipeline>", "title": "<human title>",
      "type": "<feature|bug|design|subtask|…>", "status": "in-progress",
      "finalized": false, "stages": [<stage ids from the pipeline's stage flow>],
      "tracking": {} }`
   Stage ids come from `.bridza/pipelines/<pipeline>/.metadata/metadata.json`.
   Do NOT invent stage ids; reuse the pipeline's flow (or a template's subset).
2. `context.md` — required: the intent. First line `# <title>`, then WHAT and
   WHY, acceptance criteria if known. This is the prompt seed for every stage.

Commit both files. Do not create branches or worktrees — Bridza does that when
a stage first runs. Do not write a `ref` number — Bridza assigns it.

## Split a feature into sub-tasks (dissection)

Create one task per sub-feature as above (type: "subtask"), each with its own
context.md. Then record ordering in `.bridza/plan.json` under `deps`.

## The model in one picture (read this first) <!-- plan-guide-v3 -->

The plan board is a NETWORK DIAGRAM. Think of it as:
- Each TASK is a node.
- A DEPENDENCY is a directed edge "B waits on A" (A must finish before B runs).
  Where several edges meet a task, they pass through an AND gate (all required)
  or an OR gate (any one is enough).
- A MILESTONE is a box drawn around a set of tasks; `needs` sequences boxes.
- An ESTIMATE (hours) is the weight on a node; it sizes the critical path.

You only ever describe THREE things per task: what it waits on (deps), how big
it is (est), and which milestone it belongs to. Bridza draws the whole diagram,
computes the critical path, and enforces the gates automatically — you never
lay out or connect anything by hand.

## Wire dependencies (the AND & OR network)

`.bridza/plan.json` `deps` is the gate network the board renders and ENFORCES
(a task's stages refuse to run until its gate opens):
`{ "deps": { "<pipeline>/<task>": { "all": ["<key>", …], "any": ["<key>", …] } } }`
- `all` = AND: every listed task must be done first.
- `any` = OR: at least one listed task must be done (use for alternatives).
- Keys are "<pipeline>/<task>" and may CROSS pipelines freely. Independent work
  gets NO deps; never invent ordering the work doesn't require.
Merge into the existing file — never overwrite entries you didn't create.

## Estimate the cost of each task

`.bridza/plan.json` `est` maps task → estimated HOURS of work (numbers):
`{ "est": { "<pipeline>/<task>": 4, … } }`
Estimate every task you create; the board weights the critical path with it.

## Create a milestone

Append to `milestones` in `.bridza/plan.json`:
`{ "id": "ms-<slug>", "title": "<title>", "due": "YYYY-MM-DD or empty", "tasks": ["<pipeline>/<task>", …], "needs": ["<other-milestone-id>", …] }`
A task belongs to at most ONE milestone, but a milestone's tasks may SPAN
pipelines (a launch touching engineering + content + marketing). `needs` orders
milestones. Bridza keeps the one-milestone-per-task rule for you.

## Worked example — three tasks, one milestone

```json
{
  "deps": {
    "eng/build-api":  { "all": ["eng/design-schema"], "any": [] },
    "eng/build-ui":   { "all": ["eng/design-schema"], "any": [] },
    "eng/ship":       { "all": ["eng/build-api", "eng/build-ui"], "any": [] }
  },
  "est": { "eng/design-schema": 4, "eng/build-api": 8, "eng/build-ui": 8, "eng/ship": 2 },
  "milestones": [
    { "id": "ms-v1", "title": "v1 launch", "due": "", "tasks": ["eng/build-api", "eng/build-ui", "eng/ship"], "needs": [] }
  ]
}
```
This renders as: schema → (api, ui in parallel) → AND gate → ship, all inside the
"v1 launch" box; the critical path is schema→build→ship (14h).

Tip: when the follow-on relationship is simple, you don't need to touch
plan.json at all — creating a task with a `dependsOn` key auto-wires the AND-dep,
the context link, its `est`, and its `milestone`. Use plan.json directly only for
the richer multi-parent / OR / cross-pipeline structure above.

## Pipeline-level sequence (only when truly ordered)

`pipeDeps` orders WHOLE pipelines: `{ "pipeDeps": [{ "from": "<pipeline>", "to": "<pipeline>" }] }`
Every NEW task in `to` is auto-gated on `from`'s open tasks. Pipelines are NOT
all sequential: some block another, some are fully independent (no edge), and
one may feed several others (multiple edges). Add an edge only where the order
is real; prefer task-level `deps` for anything finer-grained.

## The planning contract

A planning/breakdown stage is done ONLY when its output is on the plan board:
tasks created as files, deps + est + milestones merged into `.bridza/plan.json`.
Docs alone don't count. The user will review, rearrange, re-estimate or delete
items on the board afterwards — structure generously, but keep every item real.
