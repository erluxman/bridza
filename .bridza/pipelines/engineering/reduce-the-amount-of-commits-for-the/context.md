# Reduce the amount of commits for the work group related commit into one commit or amend it with log of changes in a…

even for a very small task there are multiple commits being created I just created one issue from inbox but it has three or four different commits we need to minimize the amount of commit as much as possible maybe if like
 there could the commit could be amended yeah right it could be amended amended with some metadata addition that this is the path it took but we are trying to reduce the commits or something like that but the amount of commits are too freaking high we should
 and find a way to reduce it.

## PLAN BOARD NOTE (added by #88, board triage)

**Status: same root problem as #23 — not an independent build ticket.**

"Too many commits per task" and #23's "not having lots of commits but still
merging easily" are one problem stated twice. Both are resolved by whatever
[[define-merge-strategy]] decides and [[implement-merge-strategy]] builds.

What this ticket keeps that #23 does not: it names the *creation* side — a
single promoted idea produced three or four commits before any work happened.
Carry that as an explicit acceptance check against the implemented strategy:
promoting one inbox idea to a task must produce a bounded, small number of
commits on the base branch. Hence the dep on `implement-merge-strategy` and the
2h estimate (verification, not implementation).

Grouped into milestone **ms-git-merge**.
