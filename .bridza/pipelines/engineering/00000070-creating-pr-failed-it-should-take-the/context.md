# creating PR failed it should take the titles and description from the…

creating PR failed it should take the titles and description from the task itself

## PLAN BOARD NOTE (added by #88, board triage)

**Status: mostly covered before it is reached — keep only the residue.**

The title half is already specified: [[create-pr-via-gh-cli]] runs
`gh pr create --base <target> --head <task-branch> --title "<task title>"`, so
the PR title comes from the task by construction.

Two things are genuinely left for this ticket, once that subtask lands:
- **Description.** The body should come from the task's `context.md` (intent +
  acceptance criteria), not a placeholder string.
- **The reported failure.** "creating PR failed" has no captured error. Confirm
  whether it still reproduces after `create-pr-via-gh-cli` ships, and if it
  does, attach the actual `gh` stderr before treating it as a separate bug.

Gated on `create-pr-via-gh-cli` and estimated at 2h on that basis.

Grouped into milestone **ms-create-pr-button**.
