# Migrate existing task folders to numbered-prefix format

## WHAT & WHY

Existing tasks on disk still use the old folder naming (no prefix). A one-time migration script must:
1. Enumerate all existing task folders
2. Extract each folder's ref (from metadata.json)
3. Rename the folder to use the new `<padded-ref>-<slug>` format via `taskDirName()`
4. Update any internal references (e.g., in plan.json) to use the new folder names
5. Be safe to run (idempotent, backed by git)

This is a data migration, not a code change. It touches the file system but the read/write paths are already updated by earlier subtasks.

## ACCEPTANCE CRITERIA

- A `migrate.js` script in `scripts/` or `server/` enumerates all pipelines and tasks.
- Each legacy folder is renamed to the new format using the domain helpers.
- The script is idempotent (safe to re-run).
- Git history is preserved; folders are renamed via git (not deleted/recreated).
- All internal references (plan.json deps, refs.json) are updated to use new folder names.
- `.bridza/refs.json` has THREE key namespaces, all keyed `"<pipeline>/<task>"`,
  and the migration MUST rewrite all three together:
  - `refs` — the `#numbers`;
  - `deleted` — tombstones (a missed key resurrects deleted tasks, because
    branch scanning re-discovers their folders at task-branch tips);
  - `archived` — board archive state, added by **#36** (a missed key silently
    unarchives every archived card, which is the bug #36 just fixed).
  Prefer one rename helper applied to every namespace over three call sites.
- Migration tests assert, after rename: an archived task is still archived, a
  tombstoned task is still tombstoned, and a task's `#ref` is unchanged.
- After migration, `pnpm test` still passes.
- Documentation in `docs/migration.md` explains the process and how to recover if needed.

## DEPENDENCIES

- Depends on: `engineering/number-prefix-contract`, `engineering/task-creation-write-path`, `engineering/task-enumeration-read-path` (the system must handle both old and new formats during migration)
