# Acceptance — Zero-padded numbered-folder naming contract

- [ ] `core/domain.js` exports `REF_WIDTH` with value `8`, and `padRef`, `taskDirName`, `parseTaskDir`, `displayRef` as pure functions (no fs/git side effects).
- [ ] `padRef(17)` → `"00000017"`; `padRef(1)` → `"00000001"`; `padRef(10000000)` → `"10000000"` (width covers up to 10 million).
- [ ] `taskDirName("engineering", "every-task-when-they-are-converted-into", 17)` → `"00000017-every-task-when-they-are-converted-into"`.
- [ ] `parseTaskDir("00000017-every-task-when-they-are-converted-into")` → `{ ref: 17, id: "every-task-when-they-are-converted-into" }` (round-trips through `taskDirName`).
- [ ] `parseTaskDir("2fa-rollout")` → `{ ref: null, id: "2fa-rollout" }` — a legacy dir or a slug merely starting with digits is returned unpadded, never mis-parsed.
- [ ] `displayRef(17)` → `17` (and `displayRef` applied to a padded ref yields the plain integer) — UI sees `#17`, never `#00000017`.
- [ ] The canonical board-state key remains `<pipeline>/<plain-id>` across `.bridza/refs.json` and `.bridza/plan.json`; no key rewrite accompanies a folder rename.
- [ ] This contract writes no folders and renames nothing — existing repos are untouched until the migration sub-task runs.
- [ ] Unit tests in `src/app/__tests__/bridza-model.test.js` cover padding, the round-trip, the 10-million width bound, and the legacy fallback; `pnpm test`, `pnpm lint`, and `pnpm build` all pass.