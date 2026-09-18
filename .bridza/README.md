# .bridza — this folder IS the database

Bridza stores everything as files, versioned in git. Where each thing lives:

| You see in the app | On disk |
|---|---|
| Pipelines & their stage flow (stages, **system prompts**, outputs, gates) | `pipelines/<pipeline>/.metadata/metadata.json` |
| A task's config + **all tracking** (per-stage status, **time**, every run's **prompt**, tool, exit, changed files, commit sha) | `pipelines/<pipeline>/<task>/metadata.json` |
| Human-readable summary of a task (status, time, prompts, files) | `pipelines/<pipeline>/<task>/README.md` (auto-generated) |
| Task / stage intent (natural language) | `<task>/context.md`, `<task>/<stage>/context.md` |
| **Every prompt ever typed into "Run stage"** (append-only history) | `<task>/<stage>/prompts.md` |
| Files a stage produced | `<task>/<stage>/outputs/` — for code tasks, product-code edits land in the working dir and show in the commit diff |
| Live wall-clock time per stage (the ticking clock) | `.cache/time.json` (gitignored — local only) |
| Global context injected into every prompt | `.metadata/company-principles.md`, `.metadata/universal-rules.md` |
| The project inbox (captured ideas/bugs/requests before they become tasks) | `inbox.json` |

**A task's work lives on its git branch `bridza/<pipeline>/<task>`, not on main**, until you Finalize (merge). Open a task's branch in your editor with **"Open in VS Code"** in the app — that checks out the branch in a worktree so you see all of the above.
