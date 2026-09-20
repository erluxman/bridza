# The agent picked for a stage sticks to that stage

## What

Picking an agent (and model) for a stage of a task **saves that choice on the task**, keyed by stage. Every later execution of that stage — reopening the task in any window, ▸ Run, auto-advance, a run the server continues after the window is gone — uses the saved agent, until the user picks a different one for that stage.

## Why

The choice currently lives only in `StageRunner`'s React state, seeded from `lastRunTool(runs)` (`src/app/features/views.jsx:28`). So it exists only *after* a run, only for that stage's own run history, and only in the window that is open: a stage picked as `claude` but not yet run, or re-entered from another window, or chained into by auto-advance building bodies from a stale snapshot (`src/app/features/task.jsx:235`), silently falls back to `def.tool` → `opencode`. The user has to re-check the picker every time, and a background run can execute on an agent they did not choose.

## How

**Where it lives.** The task's `metadata.json` already reserves an empty `routing: {}` (written at `server/bridza-store.js:801`, documented in `docs/09-file-format.md`). It becomes the store for this:

```json
"routing": { "<stageId>": { "tool": "claude", "model": "opus" } }
```

`model: ""` (or absent) keeps meaning *the tool's own default* — the same meaning the model box already has. Unknown stage ids are ignored on read, never pruned on write. It is written on the task branch alongside `tracking`, via `readTaskMeta`/`writeTaskMeta`, so it travels with the task like every other per-task fact.

**Writing it.** A new `setStageRouting(root, pipeline, task, stage, { tool, model })` in `server/bridza-run.js`, modelled on `setTaskReuse` (validate refs → `ensureTaskWorktree` → read/merge/write meta → `commitWorktree`), exposed as `POST /api/bridza/task/routing` in `server/bridge.js` and `api.setStageRouting` in the client. The `StageRunner` picker calls it when the agent or the model changes — at pick time, not at run time — so a choice made and never run still persists. `runStage` also records `{ tool: toolId, model }` into `routing[stage]` as part of the prompt-commit metadata write it already does (`server/bridza-run.js:787`), keeping the saved choice in step with what actually ran, including a fallback to another agent.

**Reading it.** `readTask`'s projection in `server/bridza-store.js` surfaces `routing: meta.routing || {}` on the task, next to `tracking`. Then:

- `StageRunner.remembered()` resolves `routing[def.id].tool` → `lastRunTool(runs)` → `def.tool` → first available tool → `"opencode"`; the model seed resolves `routing[def.id].model` → `lastRunModel(runs)` → `""`.
- `automate()` in `src/app/features/task.jsx` builds each stage body from `routing[def.id]` first (same precedence), and passes its `model` — instead of today's "no model is ever passed".
- `runStage` on the server resolves the agent as `body.tool || routing[stage].tool || <stage default>` (and the model likewise) before `resolveRunnableTool`, so any path that reaches the server without an explicit tool — a chain continued after the window closed, a stale client snapshot, another window — still runs the agent the user chose. The client's explicit pick always wins over the stored one.

**Changing it.** Picking a different agent for that stage overwrites the entry; picking a tool clears the stored model (mirroring the picker's existing `setModel("")` on tool change), and the `×` next to the model box stores `""` = tool default. Nothing clears routing on its own — not finalize, not reopening a stage.

Out of scope: per-pipeline or global agent defaults, a routing editor outside the existing per-stage pickers, changing which agents exist or how they are detected, and back-filling `routing` for tasks that already have run history (their `lastRunTool` fallback already covers them).
