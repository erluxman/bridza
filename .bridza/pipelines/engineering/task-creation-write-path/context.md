# Implement numbered-prefix write path for new tasks

## WHAT & WHY

When a new task is created (via `bridza-store.js` / `bridza-fs.js`), the on-disk folder must use the zero-padded numbered prefix contract from `number-prefix-contract`. The task's ref number is already assigned by the system; this subtask ensures that folder is created with the new naming scheme.

Update the write path in the store/fs layer to call `taskDirName(pipeline, taskId, ref)` from `core/domain.js` when creating the folder.

## ACCEPTANCE CRITERIA

- When `createTask()` or equivalent is called in the store layer, the folder is created as `<padded-ref>-<slug>` using `taskDirName()`.
- The task's ref and id are both correctly captured and passed to the naming function.
- Existing task creation tests pass; new tests verify the folder name format is correct (8-digit padding, hyphen separator, slug).
- `pnpm test` passes, `pnpm lint` passes.

## DEPENDENCIES

- Depends on: `engineering/number-prefix-contract` (the domain helpers must exist first)
