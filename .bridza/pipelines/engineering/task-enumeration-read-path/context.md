# Implement numbered-prefix read & enumeration path

## WHAT & WHY

When the system enumerates tasks from disk (via `bridza-fs.js` and `bridza-store.js`), it must correctly parse both the new padded-prefix format AND legacy un-prefixed folders. The enumeration must extract the ref and task id from folder names using `parseTaskDir()` from the contract, maintaining backward compatibility.

Update the read/enumerate path to:
- List folders in `pipelines/<pipeline>/`
- Parse each folder name via `parseTaskDir(dirName)` to recover `{ ref, id }`
- Handle the dual mode: new prefixed format OR legacy unprefixed format
- Populate the store with correct refs and ids

## ACCEPTANCE CRITERIA

- `bridza-fs.js` read/enumerate functions call `parseTaskDir()` for every folder name.
- New padded folders are parsed correctly, extracting ref and id.
- Legacy un-prefixed folders are recognized and treated as `{ ref: null, id: <dir-name> }`.
- Leading-digit slugs (e.g., `2fa-rollout`) are never mis-parsed as padded refs.
- Tests verify enumeration of mixed old and new folders; all refs and ids are correct.
- `pnpm test` passes, `pnpm lint` passes.

## DEPENDENCIES

- Depends on: `engineering/number-prefix-contract` (the parsing helpers must exist first)
