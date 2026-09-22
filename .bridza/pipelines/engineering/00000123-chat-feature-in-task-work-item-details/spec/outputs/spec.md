# Spec — Talk to the task's agent in a chat box, and watch it work

Task #123 · pipeline `engineering` · flow `feature`

## What

A task detail gets a **floating 💬 bubble** in its bottom-right corner. Click it
and a chat panel docks on the right, alongside the stage timeline — a real
conversation with the task's agent, not the read-only replay of stage runs the
`Chat` tab shows today. A composer sits at the bottom. You type a plain
sentence — "the button should be blue", "add a test for the empty case", "undo
the last change" — press send, and the agent works in the task's worktree and
answers in the thread. While it works, the thread shows **what it is doing
right now** in plain language ("reading `board.jsx`", "editing `task.jsx`",
"running `pnpm test`"), with the raw agent log one click away.

A chat turn is a first-class unit of work: it runs the same CLI agent, in the
same worktree, on the same branch, and lands its own commit. It is not a stage
and never touches a stage's commit, outputs or tracking.

## Why

Bridza's flows already do the big moves — spec, build, review — and each is
driven from a terminal-shaped surface: pick an agent, pick a model, fill a
prompt box, press ▸ Run. That is fine for the person who built the pipeline.
It is not how most people ask for a change.

For everyone else the natural gesture is to say what they want in a sentence,
to a thing that answers back. Today the only way to nudge a finished task is to
re-run a stage with a re-written prompt (which collapses the stage's commit and
re-opens a "done" stage) or to open a terminal in the worktree — which is
exactly the surface a non-technical person came here to avoid. So work that is
95% done stalls on the last 5%.

The chat box is that last 5%: after the stages are done — or between them — you
keep talking, and the flow bends to what you say. The second half matters as
much as the first: when a non-technical person sends a message, silence reads
as broken. The thread must show the agent working, step by step, so sending a
message feels like handing work to someone who visibly picks it up.

## Behaviour

### Surface

The entry point is a **floating chat bubble**, not a view tab. `Chat` leaves the
`.seg` group in the task toolbar (`task.jsx:416`): that group is an audit-view
chooser — its own tooltip says *"read & audit what each stage did"* — and the
one plain-language affordance in the product does not belong as its fourth
button. The group becomes `Stages | Inspector | Canvas | ⌨ Terminal`.

**The bubble**

- A round 💬 button fixed to the bottom-right of the task detail, above the rail
  grip in z-order, present in every view including Terminal and in the
  finalized and blocked states. It never scrolls away and it is the only chat
  affordance.
- Idle: 💬 alone. While a turn is live: a pulsing dot on the bubble, so someone
  who navigated to another view still sees the agent working.
- Title: *"Ask for a change — in plain words"*.

**The panel**

- Clicking the bubble slides a chat panel in from the right. It takes its own
  grid column in `.content.detail`; while it is open the details rail collapses
  (its prior state is remembered and restored on close). The stage timeline on
  the left stays visible and live — that is the whole reason for a panel rather
  than a full-pane view: you watch the timeline while you talk.
- Header: `💬 Chat` left, `✕` right. Nothing else — no agent, no model, no
  stage picker.
- Width: the existing `ColGrip` / `useColWidth` machinery, default 380px,
  min 300 / max 560, persisted as `bridza.chatW`. Open/closed persists per task
  (`bridza.chatOpen:<key>`), so someone who works in chat keeps it open across
  navigation.
- Under ~900px of available content width the panel goes full-width over the
  timeline instead of squeezing it.
- Inside, top to bottom: the per-stage threads as **collapsed** history
  (`▸ Spec · 4 files`, expandable — they are the conversation's past, not its
  subject), then the task-level turns, then the composer docked to the bottom.
- The panel is narrow, so: file chips wrap, and `▸ show details` expands the
  raw log in a panel-width `.term` block that scrolls horizontally rather than
  widening the panel.

**Composer**

- A textarea (`Enter` sends, `Shift+Enter` newline), a send button, and one
  muted hint line. Empty state under the last stage thread: *"Ask for anything
  else — in plain words. e.g. 'make the header smaller'."*
- Agent + model for chat default to the ones the task last ran with
  (`task.routing` of the most recent stage, else the last run's tool/model).
  They are changeable from a small, collapsed `⚙ agent` control in the composer
  row — collapsed by default, because the person this feature is for should
  never have to open it.
- The task-level `⏹ Stop` in the toolbar stops a live chat turn, exactly as it
  stops a stage.

### Sending a message

1. The message appears immediately as a user bubble, and the composer clears.
2. An assistant bubble opens straight away in a `working` state, showing the
   activity trace (below) — never an empty pane, never a spinner alone.
3. The server runs the task's agent in the task's worktree with:
   - the typed message as the prompt,
   - a chat system prompt (new, in `core/domain.js` beside the stage prompts):
     the agent is continuing an existing task on its branch, should make the
     change directly in the worktree, keep it small, and answer in one short
     paragraph of plain language — no markdown report, no re-statement of the
     plan,
   - the task brief (`context.md`) and the list of the stages' output files as
     context, so "the spec you wrote" resolves,
   - the task's LLM session resumed when there is one (see **Session**).
4. On success the turn is committed (see **Commits**), the assistant bubble
   settles into its answer, and a file chip row appears under it — same
   `FileList` component the stage views use, so each file opens its diff.
5. On failure the bubble shows the error in one line plus a `show details`
   toggle over the raw log. The turn is still recorded in the thread, marked
   `failed`, and nothing is committed (same rule as a failed stage run).

### Showing what's happening

The run stream already carries everything needed — `{t:"out"}` lines that
include the agent's `· <Tool> <arg>` tool-use markers, `{t:"cmd"}`, `{t:"commit"}`
(`bridza-run.js`, `CLI_TOOLS.onEvent`). The chat renders them twice:

- **Activity line** (always visible, one line, replaced as it advances):
  the most recent tool-use mapped to plain words —
  `Read`→"reading *file*", `Edit`/`Write`→"editing *file*", `Bash`→"running
  `<cmd>`", `Grep`/`Glob`→"searching", `Task`→"thinking it through",
  a shell `{t:"cmd"}`→"running `<cmd>`", `{t:"commit"}`→"saving the change".
  Unmapped tools fall back to the tool's own name. Nothing recognised yet →
  "working…".
- **Details** (collapsed): `▸ show details` expands the raw log in the existing
  `.term` block, auto-scrolled, exactly as `StageRunner` renders a run.

The assistant's own text streams into the bubble as it arrives, above the
activity line.

### Commits

- One commit per completed chat turn, on the task branch:
  `bridza(<pipeline>/<task>/chat): turn <n> · <tool> · exit 0 · <k> files`,
  body carrying the message text (first 2000 chars) and the changed files.
- A chat turn **never** soft-resets or replaces a stage commit, never writes
  into a stage's `outputs/`, never appends to a stage's `prompts.md`, and never
  changes any `tracking[stage].status`. The stage timeline keeps reading as the
  clean sequence of stages it is today; chat turns are extra commits after it.
- A failed or stopped turn: `git clean -fd` of untracked partial output, no
  commit — the existing `resultCommit` rule, unchanged.

### Where the conversation lives

- `.bridza/pipelines/<p>/<task>/chat/thread.md` — human-readable, appended one
  block per turn, exactly the spirit of a stage's `prompts.md`:
  `## <ISO ts> · turn <n> · <tool>[· model]`, the message, then the answer.
  This is what survives in git and what a person greps.
- `metadata.json` gains a sibling of `tracking`:
  `chat: { turns: [ { seq, at, tool, model, message, answer, status, exit,
  files, commit, sessionId, error } ] }` — the UI reads this to render the
  thread without parsing markdown, same split as run records vs `prompts.md`.
- The chat panel builds its thread from the stage records (collapsed history,
  as today's Chat view renders them) followed by `chat.turns` in order.

### Session

- When the task has **Reuse LLM session** on and a session exists for the
  picked tool, the chat turn resumes it (`--resume <id>`), so "the button you
  just changed" resolves without re-explaining. The id keeps living in the
  non-committed sidecar (`.git/bridza-sessions.json`) — unchanged.
- When reuse is off or there is no session, the turn runs fresh; the brief +
  output-file context in the prompt is what carries it. A turn never silently
  turns reuse on.
- A chat turn that mints a session id stores it under the same
  `(task, tool)` key, so a later stage run continues from the chat.

### One live run per task

The existing invariant holds: a chat turn registers in `ACTIVE_RUNS` under the
reserved stage id `__chat__`.

- Composer while a stage (or another chat turn) is running: disabled, with the
  line *"<Stage> is running — you can send as soon as it finishes."* The typed
  text is kept.
- Stage `▸ Run` while a chat turn is running: the same `busy` refusal that two
  concurrent stages get today, worded with "chat" as the reason.
- `⏹ Stop` (toolbar) stops whichever is live, chat included; a stopped turn is
  recorded `stopped`.

### Refresh, navigation, other windows

- A turn runs on the **server**. Closing the panel, closing the task, switching
  view, reloading the page or opening the task in another window and coming
  back re-attaches via
  `/run/attach` with `stage: "__chat__"`: the log replays, the activity line
  resumes, the answer lands in the thread when it ends — the same contract
  `StageRunner` already relies on.
- A turn that finished while nobody was looking is shown from `chat.turns` on
  the next load.

### Finalized tasks

A finalized task's composer is disabled with one line: *"This task is finalized.
Reopen a stage or create a follow-up task to keep working."* The thread stays
readable. (Consistent with the finalized-disabled controls in the rail.)

### Blocked tasks

Plan-gate blocking applies to chat exactly as to stages: the send is refused
with the gate's own message shown in the thread as a note, not an error bubble.

## Out of scope

- Chat anywhere but task detail — no kanban-card chat, no inbox chat, no
  plan-board chat. The bubble is mounted by the task detail screen only.
- Editing, retrying or deleting a past message; branching the conversation.
- Voice input, attachments, @-mentions, slash commands.
- Multi-user/presence. One person, one machine, as everywhere else in Bridza.
- Changing how stages run, how they commit, or the stage system prompts.
- Auto-advance interaction: chat never starts a stage and is never started by
  the advance chain.

## Touch points (expected)

- `core/domain.js` — chat system prompt beside the stage prompts; `rel.chat()`
  / `rel.chatThread()` path helpers.
- `server/bridza-run.js` — `runChatTurn(root, body, emit)`: worktree + branch
  as `runStage`, **without** stage scaffolding/soft-reset/prompts.md/tracking;
  own commit; `ACTIVE_RUNS` entry under `__chat__`; appends `thread.md` and the
  `chat.turns` record; reuses `focusedContext`, the tool registry, the JSON
  event mapping and `resultCommit`'s clean-on-failure rule.
- `server/bridge.js` — `POST /api/bridza/chat/send` (ndjson stream, same shape
  as `/run/stage`); `res.on("close")` must not kill the turn (it continues
  server-side, like a stage run).
- `server/bridza-store.js` — expose `chat.turns` on the task the app reads
  (beside `reuseSession`, ~`:604`).
- `src/app/api/client.js` — `sendChat(dir, body, onEvent)` over the existing
  `stream()` helper.
- `src/app/features/views.jsx` — `ChatPanel`: collapsed stage-thread history +
  task-level thread + `ChatComposer` + `ActivityLine`; reuse `FileList`. The
  full-pane `ChatView` route retires; a persisted `view === "chat"` opens the
  panel and falls back to `stages`.
- `src/app/features/task.jsx` — `Chat` removed from the `.seg` group;
  `ChatBubble` + `ChatPanel` mounted in `.content.detail`; the panel's column in
  `gridTemplateColumns` with the rail auto-collapsed while open; live-dot on the
  bubble; `⏹ Stop` covering `__chat__`; pass the chat turns down.
- `src/app/bridza.css` — `.chat-bubble`, `.chat-panel`, composer, message
  bubbles, activity line (beside `.uxv-chat`).
- Tests: `src/app/__tests__/chat-turn.test.js` (server: commit shape, no stage
  mutation, busy refusal, thread.md append, stop) and
  `src/app/__tests__/chat-view.test.jsx` (UI: bubble opens the panel with the
  stage timeline still mounted; send → working bubble → activity line → answer
  + files; composer disabled while a stage runs).
