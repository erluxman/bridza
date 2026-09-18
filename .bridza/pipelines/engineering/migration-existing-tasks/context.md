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
- After migration, `pnpm test` still passes.
- Documentation in `docs/migration.md` explains the process and how to recover if needed.

## DEPENDENCIES

- Depends on: `engineering/number-prefix-contract`, `engineering/task-creation-write-path`, `engineering/task-enumeration-read-path` (the system must handle both old and new formats during migration)
