# Review — Highlight selected task in running now sidebar

Branch: `bridza/engineering/highlight-running-task-in-sidebar`
Reviewed against: `main`

## Acceptance Check

- [x] When a task present in `proj.running` is selected, its `.run-task` item receives the active/selected highlight class — `features/nav.jsx:76` appends `" on"` to the matching row; `liveTasks` is built from `proj.running` (nav.jsx:31-40).
- [x] Highlight matches exactly on pipeline id + task id (`r.pid === active && r.tid === activeTask`); `active`/`activeTask` are the `activePipe`/`activeTask` state passed from `App.jsx:99`.
- [x] Non-selected running tasks keep standard `.run-task` style — the `" on"` suffix only applies to the exact match.
- [x] Highlight tracks selection: switching tasks re-targets the highlight; Board (TaskDetail `onBack` → `setActiveTask("")`), Plan (`onPlan`), and Inbox (`onInbox`) all clear `activeTask` (App.jsx:99-103), so the highlight clears; selecting a running task again re-applies it.
- [x] Highlighted items stay clickable — the button still calls `onOpenTask(r.pid, r.tid)`.
- [x] `.run-task.on` follows the existing `.on` convention — identical rule to `.pipe.on` (bridza.css:71 vs 88).
- [x] `pnpm test` — 208 passed · `pnpm lint` — clean · `pnpm build` — succeeds (only pre-existing chunk-size warning).

## Over-Engineering Analysis

- **Unused flexibility:** None. Only the exact selected pair is highlighted, no config surface.
- **Reinvented stdlib:** None.
- **Single-caller abstractions:** None — the diff is one new prop (`activeTask`), one className ternary, one CSS rule.
- **Verdict:** Minimal, surgical implementation. Nothing to delete.

## Merge Readiness

- `git diff main...HEAD` touches only `src/app/App.jsx`, `src/app/bridza.css`, `src/app/features/nav.jsx`, the task's `acceptance.md`/`spec.md`, and Bridza stage plumbing under `.bridza/`. No overlapping files with concurrent `main` work.
- `git merge-tree --write-tree main HEAD` exits 0 with a clean merged tree — **no conflicts**.
- Outputs and docs name `main` as the landing branch (no stale branch references in generated docs).
- **Merge into `main` will be clean.**