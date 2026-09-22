# Chat with the agent in task details

## What

A task gets **one conversation**, on its own `Chat` tab in the task detail
screen, aimed at the task as a whole rather than at one stage — and it keeps
working after every stage is `done`.

- **Transcript + composer.** Each message runs the task's picked agent in the
  task's worktree, streams live (the same ndjson events a stage run emits), and
  commits what it changed as **one commit per turn, appended** — a turn never
  rewrites an earlier one.
- **It persists.** Turns live in `tracking.chat.runs[]` in the task's
  `metadata.json` and, as prose, in
  `.bridza/pipelines/<p>/<task>/chat/prompts.md`. A reload, a second window, or
  a tab closed mid-turn re-attaches to the live turn and can stop it.
- **The agent remembers.** Chat turns resume one LLM session per
  (task, tool, model) — conversation continuity is the feature, so this does
  not wait on the task's opt-in `reuseSession`.
- **Five commands** typed in the same box operate the flow instead of talking
  to the agent: `/help`, `/run <stage> [text]`, `/agent <stage> <tool>
  [model]`, `/stage add <id> [after <id>]`, `/reopen <stage>`. Each one's
  result is echoed into the transcript, so the conversation is also the record
  of what was done to the task.

The existing per-stage thread view is renamed **Threads**; `Chat` is the new
tab. Two surfaces called "Chat" is worse than a one-word rename.

Out of scope: natural-language flow edits (the agent choosing to mutate the
task), removing a stage, editing or deleting a past turn, and chat anywhere
outside a task's detail screen.

## Why

When the flow is delivered — every stage `done`, or finalized — there are
exactly two ways to make an agent touch the work again, and both are wrong for
a follow-up:

- **Re-run a done stage.** `runStage` (`server/bridza-run.js`) soft-resets to
  `lastValidCommitBefore` and *replaces* that stage's commit: one commit per
  stage, deliberately, so a stage's re-runs don't leave a trail of half-done
  attempts. The consequence is that "also handle the empty case" gets recorded
  as if the spec (or build) stage had produced it all along, and that stage's
  earlier commit is gone.
- **The terminal drawer** (`features/term.jsx`) — a shell. No agent, no
  session, no record.

The improvisation *after* the flow is not a stage. It has no stage definition,
no system prompt, no place in the flow order and no gate — and it must not
pretend to be one, or the flow stops describing what the task actually did.
But it is precisely the thing that needs an agent, the worktree and a commit,
which is what a stage run gives and a terminal does not.

The command half is the same argument aimed at the flow itself.
`retargetTask`, `reopenStage` and `setStageRouting` already exist and are
already reachable from the rail — but only by abandoning the conversation
you are in the middle of to go hunt for a control. The commands add no new
capability; they add a second door into the ones already there.

## How

**Server — `runChat(root, body, emit)`** next to `runStage`, sharing its body,
its event stream and its worktree/commit machinery. Four differences, and no
others:

1. **Append-only.** No soft reset. A turn commits on top of `HEAD`, so every
   turn keeps its own commit. `stageOrderOf` includes tracking keys, which puts
   `chat` last in the order, so `lastValidCommitBefore` would otherwise collapse
   the previous *turn* — the reset has to be skipped, not re-pointed.
2. **`chat` is recorded but not a stage.** `tracking.chat` is written;
   `meta.stages` is not touched. `buildStageRecords` (`lib/record.js`) maps over
   `task.stages`, so chat stays out of Stages, Threads, Inspector, Canvas, the
   progress percentage, the flow order and every plan gate.
3. **Session: always resume**, keyed `<tool>|chat` in the existing
   machine-local `.git/bridza-sessions.json` sidecar, and dropped when the
   model changes (as stage reuse already does). A tool with no headless resume
   (`gemini`) gets a fresh process per turn; the composer says so rather than
   pretending otherwise.
4. **Task state is untouched.** A turn must not set `status` back to
   `in-progress`, clear `finalized`, or count toward the task's progress.

Everything else is inherited on purpose: the one-live-run-per-task guard (a
turn while a stage runs ends `busy`, the error that already exists), the plan
gate, `git clean -fd` with no commit on a failed turn, the run record carrying
`error` and the log tail.

**Prompt.** The first turn of a session carries the task brief — `Task:
<title>` + `context.md` + the done stages and their output files — the same
seed `StageRunner` uses, so the agent starts knowing what the task is. Later
turns on a resumed session send the message alone. A tool without resume gets
the brief every turn.

**Bridge.** `POST /api/bridza/run/chat` streams like `/run/stage`.
`/run/attach` and `/run/stop` take `stage: "chat"` unchanged.

**Client.** `api.runChat`; a `TaskChat` component in `features/views.jsx`
reading `task.tracking.chat.runs` for the transcript, with the agent/model
picker the `StageRunner` header already has. The agent defaults to the last
chat turn's tool, then the task's most recent stage pick.

**Commands** are parsed client-side, on a leading `/` only, and each maps to an
endpoint that exists:

| command | goes to |
| --- | --- |
| `/help` | — (prints the table) |
| `/run <stage> [text]` | `/api/bridza/run/stage` |
| `/agent <stage> <tool> [model]` | `/api/bridza/task/routing` |
| `/stage add <id> [after <id>]` | `/api/bridza/task/stage/add` (new) |
| `/reopen <stage>` | `/api/bridza/stage/reopen` |

Deterministic parsing, not intent detection: a mutation of a task's flow and
its git history should not ride on a classifier's guess about a sentence. A
message that starts with `/` and is not one of the five is an **error turn**
listing the five — never forwarded to the agent, so a typo does not silently
spend an agent run.

`addTaskStage(root, pipeline, task, { stage, after })` is the one new store
capability, and it is additive: it appends (or inserts after a named stage) an
id that exists in the pipeline definition, writes `meta.stages`, commits
`bridza: add stage "<id>" to <p>/<t>`, and touches no stage commit and no
tracking. It refuses a finalized task, an id the pipeline does not define, and
an id the task already carries. Removal is deliberately absent: dropping a
stage that has already run means rolling its commit back, which is what
`/reopen` does.

`/reopen` is destructive — `reopenStage` hard-resets the branch and drops that
stage's commit and every later one, now including chat turns. In a text box
with no undo it is **two-step**: `/reopen build` answers with what would be
dropped, and only `/reopen build !` does it.
