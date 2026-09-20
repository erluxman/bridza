# Acceptance — The agent picked for a stage sticks to that stage

- [ ] Picking an agent for a stage and running nothing, then closing and reopening the task (or opening it in a second window), shows that agent still selected for that stage.
- [ ] The pick is stored in the task's `metadata.json` as `routing["<stageId>"] = { tool, model }` on the task branch, and is committed — visible in `git show` of the task branch tip.
- [ ] Two stages of the same task can hold different agents at once, and picking for one never changes the other; two tasks using the same stage id keep independent picks.
- [ ] ▸ Run on a stage with a saved pick runs on that agent — the run record in `tracking[stage].runs` and the run's commit message name it.
- [ ] Auto-advance into a stage that was never run uses that stage's saved agent and model, not `def.tool`/`opencode`.
- [ ] A run whose request reaches the server with no `tool` uses the saved `routing[stage].tool`; with an explicit `tool`, the explicit one wins.
- [ ] Choosing an agent for a later stage, starting the task, then closing the window: the run that continues in the background executes that stage on the chosen agent.
- [ ] A saved model is reapplied on the next run; clearing it with `×` stores "tool default" and the next run passes no model.
- [ ] Changing the agent for a stage overwrites the previous pick and clears the stored model for that stage.
- [ ] A task with no `routing` (existing tasks, `routing: {}`) behaves exactly as before: last-run agent, then stage default, then `opencode` — no crash on a `routing` entry naming a stage that no longer exists or an agent that is not installed (falls back as today).
- [ ] `docs/09-file-format.md` documents the populated `routing` shape.
- [ ] Tests cover: routing round-trips through read/write of task metadata; `runStage` resolving the agent from routing when the body omits it; the picker seeding from routing ahead of run history.
- [ ] `pnpm test`, `pnpm lint`, `pnpm build` pass.
