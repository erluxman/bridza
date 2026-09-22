# Acceptance — task #123

Checks run against a task that has at least one `done` stage with committed
output, on a machine with at least one CLI agent installed.

## The chat box exists where a non-technical person will find it

- [ ] Task detail shows a floating 💬 bubble in the bottom-right, in every view
      including `⌨ Terminal`, without scrolling.
- [ ] The toolbar `.seg` group reads `Stages | Inspector | Canvas | ⌨ Terminal`
      — no `Chat` button in it.
- [ ] Clicking the bubble docks the chat panel on the right; the stage timeline
      stays visible and keeps updating, and the details rail collapses.
- [ ] Closing the panel with `✕` restores the details rail to the state it had
      before the panel opened.
- [ ] The panel is resizable by its grip; the width survives a reload, and so
      does open/closed state for that task.
- [ ] The panel shows the stage threads as collapsed history, then the
      task-level thread, then a composer docked at its bottom.
- [ ] With no chat turns yet, the empty state invites a plain-language message.
- [ ] `Enter` sends, `Shift+Enter` makes a newline, the composer clears on send.
- [ ] The agent/model control is collapsed by default and defaults to the tool
      and model the task last ran with; a full turn can be sent without ever
      opening it.

## Sending shows what's happening

- [ ] The user's message appears as a bubble immediately, before the server
      answers.
- [ ] An assistant bubble opens in a `working` state within one render — never
      a blank pane.
- [ ] While the agent works, a one-line activity indicator names the current
      step in plain words ("reading …", "editing …", "running …", "saving the
      change") and updates as the agent moves on.
- [ ] `▸ show details` expands the raw agent log; it auto-scrolls and matches
      what the stage runner would show for the same run.
- [ ] The assistant's text streams in as it arrives.
- [ ] On completion the bubble settles into the answer with a file chip row;
      clicking a chip opens that file's diff for the turn's commit.

## The turn is real work

- [ ] A turn that changes files produces exactly one commit on the task branch,
      subject `bridza(<pipeline>/<task>/chat): turn <n> · <tool> · exit 0 · <k> files`.
- [ ] `git log` for the task shows the stage commits unchanged — no stage commit
      is rewritten, amended or soft-reset by a chat turn.
- [ ] No stage's `tracking[*].status`, `outputs/` or `prompts.md` changes as a
      result of a chat turn.
- [ ] `.bridza/pipelines/<p>/<task>/chat/thread.md` gains one readable block per
      turn (timestamp, turn number, tool, the message, the answer), in order.
- [ ] `metadata.json` gains the matching `chat.turns[]` record with
      `seq/at/tool/model/message/answer/status/exit/files/commit`.
- [ ] A failed turn: the bubble shows the reason, the turn is recorded
      `failed`, nothing is committed, and no partial untracked output is left
      in the worktree.

## Session continuity

- [ ] With **Reuse LLM session** on, a second message referring to the first
      ("make that one bigger too") lands correctly — the run resumes the stored
      session id rather than starting fresh.
- [ ] With reuse off, a turn still runs and still gets the task brief; reuse is
      not silently turned on.
- [ ] A session id minted by a chat turn is reused by the next stage run of the
      same task and tool.

## One live run per task

- [ ] Start a stage, then open the chat panel: the composer is disabled and
      says which stage is running; typed text is preserved.
- [ ] Start a chat turn, then press a stage's `▸ Run`: it is refused with the
      busy message naming chat, and no second process spawns.
- [ ] The toolbar `⏹ Stop` stops a live chat turn; it is recorded `stopped`,
      nothing is committed, and the composer re-enables.

## Survives navigation

- [ ] Send a message, close the panel, reopen it: the turn is still shown live
      with its activity line, not restarted.
- [ ] Send a message, switch to `Stages`, come back: same.
- [ ] Send a message, reload the page mid-turn, reopen the task: the turn
      re-attaches, the log replays and the answer lands in the thread when it
      ends.
- [ ] Send a message, close the task entirely, come back after it finished: the
      completed turn is in the thread with its answer, files and commit.
- [ ] While a chat turn runs with the panel closed, the bubble carries a live
      dot from the `Stages`, `Inspector`, `Canvas` and `⌨ Terminal` views.

## Guards

- [ ] A finalized task shows the thread read-only with the "finalized" line;
      no send is possible.
- [ ] A plan-gate-blocked task refuses the send and shows the gate's own
      explanation as a note in the thread.

## Regression

- [ ] Stage runs, auto-advance, Automate and the timeline behave exactly as
      before, including the one-commit-per-stage collapse on re-run.
- [ ] The existing per-stage "continue / re-run" runner, now inside the panel's
      collapsed history, still works and still re-runs the stage (not a chat
      turn).
- [ ] Inspector, Canvas and the classic Stages view are unchanged.
- [ ] `pnpm test` and the Playwright suites are green, plus the new
      `chat-turn` and `chat-view` tests.
