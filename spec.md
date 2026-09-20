# Tags on a task, picked from a card with L

## What

A task carries **tags** — a set of named, coloured labels, independent of its pipeline, flow, stage and #ref. Hovering a card on the board and pressing **L** opens a tag picker for that task; the picker both selects from tags that already exist and creates new ones (name + colour) on the spot. A tag created once is offered on every task from then on. Tags render as chips on the board card and in the task header.

## Why

There is no per-task label today. The only classifiers a task has are structural — `type` (idea/bug/feature), `flow`, stage, archive state — all of them chosen from fixed sets the pipeline owns, and all of them meaning "where this task is in the machine". Nothing says what the work is *about* (`billing`, `regression`, `blocked-on-design`), so cross-cutting groupings live in the title or nowhere.

**L** is the hover key the user wants for this, and it is taken: today it opens the *flow* menu (`src/app/features/board.jsx:88-94`), which is a rare, destructive action — retargeting discards stage commits — and is only bound at all when the pipeline has two or more flows. Tagging is the frequent one; it gets **L**, and the flow menu moves to **F**.

## How

**Where it lives.** Both the registry and the per-task assignment go in `.bridza/refs.json`, at the repo root on the base branch — the same place and for the same reason as `archived` (`server/bridza-store.js:370-382`): a task's `metadata.json` is read from its `bridza/*` branch tip, which is never pushed, so anything stored there cannot cross to another machine. Tags are board-wide display state, so they follow `archived`, not `routing`.

```json
"tags":     { "billing": { "name": "billing", "color": "violet" } },
"taskTags": { "engineering/separate-tags-filled-for-each-org-item": ["billing", "regression"] }
```

The registry key is the slug (`safeRef` of the typed name); `name` keeps the typed casing for display. `color` is a name from a fixed palette (`TAG_PALETTE` in `core/domain.js`, shared by the server's validation and the picker's swatches), not a hex value, so tags theme with the rest of the app in light and dark. `readRefs` defaults both to `{}` — an old `refs.json` with neither key reads as "no tags" and never crashes. Deleting a task drops its `taskTags` entry in the same place the existing cleanup drops `refs.archived[key]` (`server/bridza-store.js:937`); registry entries are never auto-pruned.

**Server.** Two functions in `server/bridza-store.js`, both modelled on `setTaskArchived` — read `refs.json`, mutate, `writeJSON`, `commitPaths` once:

- `createTag(root, { name, color })` — slugifies, rejects an empty name or a colour outside the palette, returns the existing entry unchanged if the slug is already taken (create is idempotent, never a silent recolour).
- `setTaskTags(root, pipeline, task, tagIds)` — validates the refs, keeps only slugs present in the registry, de-duplicates, writes the whole set for that task. An empty array clears the task's tags and removes the key.

Exposed as `POST /api/bridza/tag/create` and `POST /api/bridza/task/tags` in `server/bridge.js`, and `api.createTag` / `api.setTaskTags` in `src/app/api/client.js`.

**Reads.** `readRefs`' `tags` registry rides out on every pipeline projection in `readTasks` as `pipeline.tags` (like `flows`), and each task gets `tags: [{ id, name, color }]` resolved next to `archived` (`server/bridza-store.js:536`) — the UI never has to resolve slugs itself, and a slug whose registry entry is gone simply drops out of the projection.

**UI.** In `src/app/features/board.jsx` the existing hover effect keeps its shape, with the bindings swapped: **L** opens `tagMenu` for the hovered card (bound whenever a card is hovered, unlike the flow menu's `flows.length >= 2` guard), **F** opens `flowMenu` on the same condition as today, `Escape` closes either, and the card's hint line reads `press L to tag` (plus `· F for flow` when the pipeline has several flows). The menu reuses `.proj-menu`, positioned like `flowMenu`: every registry tag as a toggleable row showing its colour dot and a check when assigned, a text input at the bottom with a row of palette swatches above it that creates a tag (name + the chosen colour, the swatches starting on the palette's next colour) and assigns it immediately. Toggling posts the new set and refreshes via the existing `onChange`; a failed post flashes the error and leaves the board untouched.

Chips render from `task.tags` on the card (under the title, next to the running/done chip) and in the task header in `src/app/features/task.jsx:350`, as `.tag.tag-<color>` classes added to `src/app/bridza.css` alongside the existing `.tag.kind-*` rules.

Out of scope: filtering or searching the board by tag, tag rename/delete/recolour after creation, tags on pipelines or on inbox items, per-pipeline tag namespaces, and any use of tags by agents or stage prompts.
