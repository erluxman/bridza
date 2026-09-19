# Repro — one user action produces 4–5 bridza commits

Task #37 · `engineering/reduce-the-amount-of-commits-for-the` · stage `repro`

## Summary

Every write helper in `server/bridza-store.js` commits **by itself**, and the
high-level actions are built by *composing* those helpers. Nothing coalesces
them, so one UI action produces one commit per helper it happens to call.
Promoting one inbox item into a task = **4 commits**; capture + promote = **5**.

`commitPaths()` (`server/bridza-store.js:39`) is the only commit primitive; all
15 call sites go through it, and it can only create a *new* commit — there is no
amend mode and no "this write belongs to the action already in flight" scope.

## Reproduction

### Steps (UI)

1. Open a project, type an idea into the inbox → **Capture**.
2. Promote that item into the `engineering` pipeline (pick a flow), confirm
   title + description in the promote dialog.
3. `git log` → **5 new commits**, 4 of them from step 2 alone.

### Observed — the user's reported case, still in this repo's history

Captured 10:32:40, promoted 10:32:57. Four commits share the identical second,
i.e. one click:

```
$ git log --format='%h %ad %an %s' --date=format:'%H:%M:%S' --name-only d1281a6~1..eecac95

d1281a6 10:32:40 bridza  bridza: inbox capture (idea) · "Alright, for some reason, the archive cards are …"
                   .bridza/inbox.json
8d0e747 10:32:57 bridza  bridza: assign task #ref #36 → engineering/card-archiving-is-not-working-when
                   .bridza/refs.json
0fa461a 10:32:57 bridza  bridza: add task #36 "Card archiving is not working when syncing between" (…)
                   .bridza/pipelines/engineering/card-archiving-is-not-working-when/context.md
                   .bridza/pipelines/engineering/card-archiving-is-not-working-when/metadata.json
4d9fa58 10:32:57 bridza  bridza: edit task context of engineering/card-archiving-is-not-working-when · "…"
                   .bridza/pipelines/engineering/card-archiving-is-not-working-when/context.md
eecac95 10:32:57 bridza  bridza: inbox promote (idea) "Card archiving is not working when synci" → task #36 …
                   .bridza/inbox.json
```

All five are authored `bridza <bridza@local>` (the `BIDENT` identity,
`server/bridza-store.js:12`) — machine bookkeeping, not human commits.

This very task shows the same shape: `8eafdd8` + `f49fb1c`, both 10:36:21 —
`createTask` alone is always ≥2 commits.

### Steps (headless driver)

`.bridza/pipelines/engineering/reduce-the-amount-of-commits-for-the/repro/repro.mjs`
builds a scratch repo, calls the store functions directly and prints the commit
count per action (no npm deps needed):

```
node repro.mjs <path-to-this-checkout> /tmp/bridza-repro-scratch
```

**Not executed**: running `node` requires approval and this session is
non-interactive (`npx vitest` also fails here — `node_modules` is not installed
in this worktree). The numbers below therefore come from real git history above
plus a read of the call graph, both of which agree. The script is left for the
`fix` stage as a before/after check.

## Observed vs expected

| Action | Observed commits | Expected |
|---|---|---|
| `addInbox` (capture) | 1 | 1 |
| `promoteInbox` | **4** (5 when plan wiring fires) | 1 |
| `createTask` | **2** (3 with deps/milestone/est) | 1 |
| Add 8 context links to a task, one by one | **8** | 1 (or few) |
| Reorder kanban columns | **1 per drag** (4 in 19s observed) | 1 (or few) |
| `deleteTask` | **2** (removal + `retire #ref`) | 1 |

Scale on this repo — commits since 2026-09-01:

```
$ git log --format='%s' --since=2026-09-01 | wc -l              → 283
$ git log --format='%s' --since=2026-09-01 | grep -c '^bridza:'  → 267   (94%)

 117  bridza: edit plan
  26  bridza: assign task
  22  bridza: inbox capture
  20  bridza: add task
  17  bridza: reorder kanban
  17  bridza: edit task
  16  bridza: inbox promote
```

## Root cause

### Cause 1 — commit-per-helper, and the helpers compose (the reported bug)

`promoteInbox` (`server/bridza-store.js:890`) is four committing calls in a row:

| # | Code | Commit produced |
|---|---|---|
| 1 | `createTask` → `assignRefs` (`:901` → `:621` → `:265`) | `assign task #ref …` |
| 2 | `createTask` → `commitPaths` (`:663`) | `add task #N …` |
| 2b | `createTask` → `savePlan` when `planTouched` (`:700` → `:852`) | `edit plan …` (only with deps/milestone/est/pipeDeps) |
| 3 | `saveContext` (`:903` → `:931`) | `edit task context of …` |
| 4 | `commitPaths` for the inbox removal (`:905`) | `inbox promote …` |

Each helper is separately reachable from the UI (`server/bridge.js` exposes one
endpoint per helper), so each commits defensively. There is no transaction scope
saying "these writes are one action", and `commitPaths` cannot fold into the
commit it is following.

**Dead blob inside that:** step 2 commits a placeholder `context.md`
(`"Describe the intent of this task."`, `:652`), then step 3 overwrites the same
file 0 seconds later with the real brief. Verified:

```
$ git show 0fa461a:….../context.md
# Card archiving is not working when syncing between devices with git.

Describe the intent of this task.          ← superseded by 4d9fa58, same second
```

### Cause 2 — no debounce on plan / kanban saves

`savePlan` (`:793`) commits on **every** call, and the UI calls it once per
interaction with no debounce: `src/app/features/plan.jsx:199`
(`const save = (next) => { setPlan(next); api.savePlan(dir, next)… }`),
`src/app/features/task.jsx:568` and `:575`. Adding 8 context links one at a time
produced 8 commits in under 3 minutes, all touching only `.bridza/plan.json`,
messages differing only in the counter:

```
b31642c 04:58:36  bridza: edit plan · 10 dep gates, 5 milestones, 1 context link
d448c3e 04:58:50  bridza: edit plan · 10 dep gates, 5 milestones, 2 context links
…
e482628 05:01:21  bridza: edit plan · 10 dep gates, 5 milestones, 8 context links
```

`saveKanbanOrder` (`:518`, UI `src/app/features/board.jsx:51`) is the same —
`cf374a7 … ecc3916`, 4 commits in 19 seconds with byte-identical messages.
Consecutive edits, one file, one identity, no intervening work: the textbook
case for amending instead of appending.

## Notes for the fix stage (nothing fixed here)

- `commitPaths` (`:39`) is the single choke point — fix belongs there plus an
  action-scope API, not sprinkled over the 15 call sites.
- Amend precedent already in-tree: `server/bridza-run.js:417`
  (`saveTaskFile` with `amend` → `commit --amend --no-edit`), with an
  empty-change guard at `:413`. `commitPaths:43` already has the same
  nothing-staged guard.
- Amending is only safe while commits are unpushed and bridza-authored; `BIDENT`
  (`:12`) makes "is the tip mine?" cheap. Plan/kanban coalescing additionally
  wants "same action kind + same paths + recent".
- `promoteInbox` should write the real `context.md` **before** the task commit
  instead of rewriting it after — removes one commit and the dead blob with no
  amend logic at all.
- Tests touching current commit behaviour: `src/app/__tests__/bridza-store.test.js`
  (asserts `committed: true` in several places), `src/app/__tests__/plan.test.js`.
  `node_modules` is absent in this worktree — install before running them.

**Nothing was fixed in this stage.**
