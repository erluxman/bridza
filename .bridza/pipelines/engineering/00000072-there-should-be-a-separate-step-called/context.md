# There should be a separate step called squashing commits that will merge all commits into single one commit which will…

this was all the comments of our branch into one comment before merging to main so basically the last step of any changes should be squashing comments and that should be changed in every single flow if they change any part of the file system

## PLAN BOARD NOTE (added by #88, board triage)

**Status: largely already true — keep as a decision check, not a build ticket.**

Squash IS already the last step: `finalizeTask` in `server/bridza-run.js`
defaults to `style = "squash"`, so every flow already collapses a task branch
into one commit when it lands. Adding a separate "squashing commits" stage to
every flow would duplicate that.

The open question this ticket really raises — *should* squash stay the default —
is owned by [[define-merge-strategy]], which weighs it against keeping per-run
commits reachable for the run ledger. This ticket is therefore gated on
`define-merge-strategy` and closes as either "already satisfied" or "changed by
the new strategy". Do not build a stage for it before that decision lands.

Grouped into milestone **ms-git-merge**.

## ARCHIVED by #88 — already satisfied — `finalizeTask` in `server/bridza-run.js` defaults to `style = "squash"`. Whether squash stays the default is [[define-merge-strategy]]'s call, not a build ticket.
