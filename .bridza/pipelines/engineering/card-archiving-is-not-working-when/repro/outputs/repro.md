# Repro — archived cards don't appear in the Archived column after a git sync

Task #36 · `engineering/card-archiving-is-not-working-when` · stage: **repro**

## Summary

Archiving a card writes the `archived` flag **only onto that task's
`bridza/<pipeline>/<task>` branch**, never onto the base branch. Those task
branches are never pushed (and would be ignored even if they were), so the
flag physically cannot cross to a second computer. Device B falls back to
`main`'s copy of `metadata.json`, which has no `archived` key, reads it as
`false`, and puts the card back in its old column.

Nothing "ignored" the archive on device B — the archive commit never arrived.

## Observed vs expected

| | Device A (where 🗄 was clicked) | Device B (after `git pull`) |
|---|---|---|
| `task.archived` | `true` | `false` |
| Column | Archived | **Delivered / its stage column** ← wrong |

- **Expected:** a card archived on one computer shows in the Archived column on
  every computer that syncs the repo.
- **Actual:** it shows in Archived only on the computer where the button was
  clicked. Everywhere else it reverts.

## Steps to reproduce

1. On **computer A**, open a pipeline and pick a card (e.g. a Delivered one).
2. Click the 🗄 Archive button. The card moves to the **Archived** column. ✅
3. Sync as usual: `git add -A && git commit && git push` (this pushes `main`).
4. On **computer B**: `git pull`.
5. Open the same pipeline. **The card is back in its previous column**, not in
   Archived.

Reload/restart on B does not help — the state is absent, not cached.

An executable two-device version of the above is in
[`repro.mjs`](./repro.mjs) (bare origin + two clones, driving the real
`bridza-store`/`bridza-run` APIs):

```
node .bridza/pipelines/engineering/card-archiving-is-not-working-when/repro/outputs/repro.mjs
```

> Note: command execution required interactive approval in the session that
> wrote this document, so the script itself was **not executed here**. The root
> cause below is established from the source and from this repository's own git
> state, each check shown with its command and output.

## Root cause

### 1. The write goes to the task branch, not the base branch

`server/bridza-run.js:1071` — `setTaskArchived`:

```js
export function setTaskArchived(root, pipeline, task, archived) {
  const wt = ensureTaskWorktree(root, pipeline, task);   // the task's worktree
  const W  = wt.worktree;
  const m  = readTaskMeta(W, pipeline, task);
  m.archived = !!archived;
  writeTaskMeta(W, pipeline, task, m);                   // ← writes inside W
  const c = commitWorktree(W, `bridza: ${archived ? "archive" : "unarchive"} …`);
  return { ok: true, archived: !!archived, committed: c.committed };
}
```

`commitWorktree` (`server/bridza-run.js:368`) runs `git add -A` + `git commit`
**inside that worktree**, so the commit lands on `bridza/<pipeline>/<task>` and
on nothing else.

This is the odd one out. Every other piece of board-level state is committed at
the repo root, i.e. on the checked-out base branch:

| State | Write target | Syncs? |
|---|---|---|
| **Pipeline** archived (`archivePipeline`, `bridza-store.js:504`) | `commitPaths(root, …)` | ✅ |
| Kanban column order (`saveKanbanOrder`) | `commitPaths(root, …)` | ✅ |
| `#ref` numbers / delete tombstones (`assignRefs`, `.bridza/refs.json`) | root | ✅ |
| **Card** archived (`setTaskArchived`) | `commitWorktree(W, …)` | ❌ |

The original spec asked for exactly this, which is how it got in — from
`.bridza/pipelines/engineering/kanban-archive-issue-cards/build/prompts.md`:

> The archived state PERSISTS on the task (…) **committed the same way
> `setTaskReuse` writes task flags in `server/bridza-run.js`**

`setTaskReuse` is a per-worktree runtime preference, so branch-local is fine
for it. `archived` is a board-wide, cross-device display property — branch-local
is the wrong home for it.

### 2. There is no later merge to carry the flag to `main`

The only branch → base path is `finalizeTask` (squash/rebase/merge). But the
archive button exists precisely to declutter the **Delivered** column, i.e. it
is used *after* finalize. After finalize there is no further merge, so the
archive commit sits on a branch that will never be merged again.

(Archiving *before* finalize does land the flag on `main` — which is why this
looks intermittent rather than totally broken.)

### 3. Task branches are never published

Bridza has no push/pull/fetch of its own — syncing is whatever the user does by
hand. In this repository, `origin` carries no `bridza/*` branch at all:

```console
$ git ls-remote --heads origin
45c47c9f…  refs/heads/feat/theme-toggle
e63df618…  refs/heads/main
53c7a320…  refs/heads/new-bridza
37de8561…  refs/heads/ux-revamp
```

Meanwhile 8 `bridza/*` branches exist locally. So every archive commit ever
made on the other computer is still sitting on that computer's disk.

### 4. `main` therefore has no `archived` flag anywhere — confirmed

30 task `metadata.json` files are tracked on `origin/main`. Not one carries an
`archived` key (the only hits are prose in spec/prompt files and the
`"__archived__"` *column id* in the kanban order):

```console
$ git grep -n 'archived' origin/main -- '.bridza' | grep 'metadata.json'
origin/main:.bridza/pipelines/engineering/.metadata/metadata.json:830:    "__archived__"
```

That single hit is the Archived **column**, which lives in `kanbanOrder` and is
written at the root — which is why the column itself syncs correctly and shows
up on device B, just permanently empty. That is the exact symptom reported.

### 5. The read path on device B falls back to `main`

`readProject` → `readTaskMetaFromAnyBranch` → `readTaskMeta`
(`server/bridza-store.js:274`):

```js
export function readTaskMeta(root, pipeline, task) {
  const branch = taskBranchName(pipeline, task);
  if (branchExists(root, branch)) { … return j; }   // branch tip wins
  const disk = readJSON(path.join(root, relPath));  // ← device B lands here
  return disk || { v: 1, id: …, tracking: {} };
}
```

On device B no `bridza/*` branch exists, so it reads `main`'s file, and
`bridza-store.js:383` coerces the missing key:

```js
archived: !!meta.archived,     // !!undefined === false
```

`src/app/features/board.jsx:22` then never routes the card to Archived:

```js
function currentStage(t) {
  if (t.archived) return ARCHIVED_COL;   // never taken on device B
  if (t.finalized) return DONE_COL;
  return (t.stages || []).find((s) => (t.tracking[s] || {}).status !== "done") || DONE_COL;
}
```

The UI is correct. It is faithfully rendering `archived: false`.

### 6. Pushing the task branches would *not* fix it

Both readers look exclusively at local heads, so remote-tracking refs are
invisible:

- `branchExists` (`bridza-run.js:38`) → `git rev-parse --verify refs/heads/<name>`
- `scanBranches` (`bridza-store.js:300`) → `git for-each-ref refs/heads/bridza/`

A fresh clone creates `refs/remotes/origin/*`, not `refs/heads/bridza/*`. So
even if the user pushed every task branch, device B would still read `false`.
The fix has to put `archived` on the base branch — publishing branches is not
an alternative.

## Failing chain, end to end

```
A: click 🗄
   → setTaskArchived writes archived:true into the task WORKTREE
   → commitWorktree commits it onto bridza/<pipe>/<task>   [branch-local]
   → base branch metadata.json: unchanged, no `archived` key
   → card was already finalized ⇒ no future merge will carry it over
A: git push origin main              → bridza/* branches not pushed
B: git pull                          → receives main only
B: readProject
   → branchExists("bridza/<pipe>/<task>") === false   (no local head)
   → readTaskMeta falls back to main's metadata.json
   → archived: !!undefined === false
   → currentStage() skips ARCHIVED_COL
B: card renders in Delivered / its stage column, Archived column empty
```

## Why the tests didn't catch it

`src/app/__tests__/bridza-run.test.js:677` (`"toggles the archived flag and
commits it"`) asserts only on the **task worktree and the task branch**:

```js
const m = JSON.parse(fs.readFileSync(path.join(wt.worktree, rel.taskMeta(…))));
expect(m.archived).toBe(true);
expect(git(root, ["log", "-1", "--format=%s", "bridza/marketing/task-506"]).trim())
  .toBe("bridza: archive task marketing/task-506");
```

It never asserts that `readProject(root)` reports `archived: true`, and never
crosses a clone boundary — so it passes while the feature is broken for its
actual purpose.

## Scope of the damage

The archive intent from the other computer is **not lost** — it is preserved in
commits on that machine's `bridza/*` branches. Any fix should account for
recovering those, not just for new archives.

Each affected card can be recovered on the originating machine with:

```console
$ git log --all --grep='bridza: archive task' --format='%H %s'
```

## Suggested direction (for the fix stage — not applied)

Store `archived` the same way pipeline-archived and kanban order are stored: on
the base branch at the repo root, via `commitPaths(root, …)` — either as a flag
in the root copy of the task's `metadata.json`, or as a set in the already
root-level, already-syncing `.bridza/refs.json` (which is how delete tombstones
solve the identical "must be true on every branch" problem).

Regression tests should assert (a) `readProject(root).…archived === true`
without consulting any task branch, and (b) that it survives a clone of the
base branch only.
