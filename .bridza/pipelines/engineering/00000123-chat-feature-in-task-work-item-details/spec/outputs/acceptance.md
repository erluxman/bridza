# Acceptance — Chat with the agent in task details

Unchecked until the build stage verifies each one.

## The tab

- [ ] The task detail screen has tabs `Stages · Inspector · Canvas · Threads ·
      Chat`; `Threads` is the former per-stage thread view, unchanged.
- [ ] `Chat` shows one transcript for the whole task and a composer, with no
      stage picked and none required.
- [ ] The composer works when **every stage is `done`**, and when the task is
      **finalized** — the case the feature exists for.
- [ ] The tab choice persists per task, as the other views' does.

## A turn

- [ ] Sending a message runs the picked agent in the task's worktree and streams
      its output live into the turn.
- [ ] A turn that changes files produces **one commit** on the task branch, and
      the previous turn's commit is still there (`git log` shows both).
- [ ] The commit names the task and the turn; the turn's files are listed on the
      turn and each opens its diff.
- [ ] A turn that fails commits nothing, leaves no untracked partial output, and
      still appears in the transcript with its error.
- [ ] `Stop` mid-turn ends it as `stopped`, not `failed`.
- [ ] Reloading mid-turn re-attaches: the text printed so far replays and the
      turn streams on. A second window on the same task sees the same turn.
- [ ] A turn started while a stage of the same task is running is refused with
      the existing `busy` error — no second process on the worktree.
- [ ] A task blocked by a plan gate refuses a turn with the same gate error a
      stage run gives.

## It persists

- [ ] Turns survive a reload and an app restart: `tracking.chat.runs[]` in the
      task's `metadata.json`, carried by the turn's own commit.
- [ ] `.bridza/pipelines/<p>/<task>/chat/prompts.md` holds every message sent,
      oldest first, one entry per turn with its timestamp, tool and model.
- [ ] `chat` is **not** in `meta.stages`: the Stages, Threads, Inspector and
      Canvas views, the task's progress percentage and the flow's gates are all
      identical to before the chat existed.
- [ ] A turn does not change the task's `status` and does not clear
      `finalized`.

## Continuity

- [ ] Turn 2 can refer to turn 1 ("rename the function you just added") and the
      agent knows what is meant — the session is resumed.
- [ ] Continuity does not depend on the task's `reuseSession` checkbox; with it
      off, the chat still remembers.
- [ ] Changing the model starts a fresh session rather than resuming one on the
      wrong model.
- [ ] On a tool with no headless resume (`gemini`), each turn carries the task
      brief instead, and the composer says the conversation is not resumed.
- [ ] The first turn carries the brief — task title, `context.md`, the done
      stages and their outputs — so a cold chat on a delivered task knows the
      task.

## Commands

- [ ] `/help` lists exactly the five commands with their arguments.
- [ ] `/run <stage> [text]` runs that stage with the given instructions and the
      result lands in the stage's own record (not in `tracking.chat`), exactly
      as a Run from the rail would.
- [ ] `/agent <stage> <tool> [model]` changes the stage's saved pick; the rail
      and the Threads view show the new one.
- [ ] `/stage add <id>` appends a stage the pipeline defines; `/stage add <id>
      after <other>` inserts it after `<other>`. `git log` is unchanged, every
      existing stage keeps its tracking, and the new stage is `idle` and
      runnable.
- [ ] `/stage add` refuses an id the pipeline does not define, an id the task
      already carries, and a finalized task — each with the reason, nothing
      written.
- [ ] `/reopen <stage>` alone only reports what it would drop; `/reopen <stage>
      !` performs the rollback.
- [ ] Every command's outcome — success or the server's error — is echoed as a
      turn in the transcript.
- [ ] An unknown `/command` is an error turn listing the five, and no agent
      process is started.
- [ ] A message that does not start with `/` is never interpreted as a command,
      including one that reads like an instruction ("run the build stage
      again").

## Regression

- [ ] Running, re-running and reopening a stage behave exactly as before,
      including one-commit-per-stage and auto-advance.
- [ ] `pnpm lint`, `pnpm build` and `pnpm test` clean, with new tests covering:
      append-only turn commits, `chat` staying out of `task.stages`, the `busy`
      guard, session resume across turns, command parsing (all five, plus
      unknown and non-command), and `addTaskStage`'s three refusals.
