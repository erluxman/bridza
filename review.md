# Review — Tags on a task, picked from a card with L

Branch `bridza/engineering/separate-tags-filled-for-each-org-item` → lands on `main`.

**Verdict: approve with fixes.** The feature works end-to-end and the shape matches the spec: registry + assignments in root `refs.json`, **L** = tags on every pipeline, **F** = flow behind the old two-flow gate, chips on card and task header, docs updated. `pnpm test` (254 tests, 11 files), `pnpm lint`, `pnpm build` all pass. Two things block a clean tick: the picker never lets you choose a colour, and the tag menu gets stuck open (Escape dead) once the pointer leaves the card. Both are small.

**Merge into `main`: clean.** `git merge-tree --write-tree main HEAD` produced tree `70f3df0` with zero conflict messages (merge-base `a008119`). No file in the diff is touched on `main` since the base. Docs and outputs name `main` as the landing branch.

## 1. Acceptance criteria

| # | Criterion | Result |
|---|---|---|
| 1 | **L** on a hovered card opens the tag picker, incl. single-flow pipelines | ✅ `board.jsx:124` — listener now gated on `hover` alone, `flows.length` gate moved to **F**; covered by `board-tags.test.jsx` |
| 2 | Typing a name **and choosing a colour** creates + assigns + chip appears without reload | ⚠️ **partial** — name + create + assign + refresh all work (`createAndAssign`, `board.jsx:152`), but there is **no colour choice in the UI**; the colour is auto-picked as the next unused palette entry. See finding A |
| 3 | A different card's **L** lists the earlier tag, one-click selectable, registry board-wide | ✅ registry rides `pipeline.tags` for every pipeline (`bridza-store.js:578`) |
| 4 | Clicking an assigned tag unassigns; last one leaves no chips and no `taskTags` entry | ✅ `setTaskTags` deletes the key on empty (`bridza-store.js:428`); store + UI tests cover both |
| 5 | Several tags at once, each in its own colour, on card and task header | ✅ `board.jsx:204`, `task.jsx:351` |
| 6 | Name slugging to an existing tag reuses it, no duplicate, no recolour | ✅ `createTag` returns the existing entry with `created: false`; test asserts the colour is untouched |
| 7 | Stored in `refs.json` as `tags`/`taskTags`, committed on the base branch, survives restart | ✅ — but the **path in acceptance.md/spec.md is wrong**. See finding D |
| 8 | **F** opens the flow menu with the old two-or-more-flows condition + confirm; **L** never opens it | ✅ confirm dialog untouched in `changeFlow`; test asserts F is inert with <2 flows |
| 9 | Hint line names the live keys; `Escape` closes whichever menu is open | ⚠️ **partial** — hint is right (`press L to tag · F for flow`); Escape works only while the card is still hovered. See finding B |
| 10 | Legacy `refs.json` loads with no tags; unknown slug ignored, no crash | ✅ `readRefs` defaults both to `{}`; projection filters unresolved slugs; both tested |
| 11 | Deleting a task drops `taskTags`, registry entries survive | ✅ `deleteTaskIn` (`bridza-store.js:973`), tested |
| 12 | Failed save flashes the error and leaves tags unchanged | ✅ no optimistic update; `flash(r.error)` on `!ok` |
| 13 | Tests: `createTag` idempotence/colour, `setTaskTags` drop+dedupe, projection resolution, L/F menus | ✅ all four present. Gap: the create-from-picker path is never asserted — `api.createTag` is mocked but no test calls it |
| 14 | `tags`/`taskTags` documented in `docs/09-file-format.md` | ✅ new "Board state" section, and it usefully documents the whole file, which had no section before |
| 15 | `pnpm test`, `pnpm lint`, `pnpm build` pass | ✅ 254/254, eslint silent, build ✓ |

## 2. Findings

### A. No colour picker — criterion 2 is half-met (medium)
`src/app/features/board.jsx:150-160`. `createAndAssign` computes the colour itself (`TAG_PALETTE.find(c => !used.includes(c))`) and `TagMenu` renders only a text input. Acceptance asks the user to choose a colour; the spec asks for "name + a colour picked from the palette, **defaulting** to the next unused one". As shipped there is a default and no choice — after 8 tags every new one gets a colour by modulo, with no way to change it (tag recolour is explicitly out of scope, so the create moment is the only chance).

Fix: a row of 8 colour swatches above the input, preselected to the next unused one, passed as `color` to `api.createTag`. ~10 lines in `TagMenu`.

### B. Tag menu sticks open with Escape dead after the pointer leaves the card (medium — confirmed)
`src/app/features/board.jsx:122-134`. The key listener early-returns on `if (!hover) return`, so leaving the card unmounts the handler — but nothing closes `tagMenu`. The flow menu is safe because it carries `onMouseLeave={() => setFlowMenu(null)}`; `TagMenu` has no equivalent. Reproduced with a scratch render test: hover → `l` → mouseout → the `.tag-menu` node is still in the DOM and `Escape` no longer removes it. Only the ✕ closes it. This breaks criterion 9 literally.

Fix (either): bind `Escape` in an effect that depends on `tagMenu || flowMenu` rather than `hover`; or give `TagMenu` the same `onMouseLeave`. The first is better — the menu holds a focused text input, so closing on mouseout would be hostile while typing.

### C. **F** can open the flow menu on top of an open tag menu (low)
Once a tag row is clicked, focus sits on a `<button>`, so the `typing` guard is false and **F** opens `flowMenu` while `tagMenu` is still open; both are absolutely positioned at `top: 6; right: 6` and overlap. One line: have each setter clear the other.

### D. `acceptance.md` and `spec.md` name a path that does not exist (low, docs)
Both say `.bridza/.metadata/refs.json`. The real file — used by the code, the tests and the new `docs/09-file-format.md` section — is `.bridza/refs.json` (`DATA_DIR = ".bridza"`, `refsFile()` at `bridza-store.js:365`). The implementation is right; correct the two spec docs so criterion 7 does not read as failed.

### E. `createTag` hand-rolls name validation the repo already has (low)
`server/bridza-store.js:389`. `if (!name || typeof name !== "string" || !name.trim())` duplicates `validRef(name, "tag name")` from `bridza-run.js:89`, and misses what `validRef` catches: `safeRef` falls back to the literal `"x"` for a punctuation-only string, so `createTag({name: "!!!"})` and `createTag({name: "???"})` both land on slug `x` and silently become the same tag. Replace the three-part check with `const bad = validRef(name, "tag name"); if (bad) return { ok: false, error: bad };` — shorter and closes the collapse.

## 3. Over-engineering — what to delete

1. **`TAG_PALETTE` duplicated in `src/app/features/board.jsx:12`.** It exists only to compute the next unused colour client-side, and the comment concedes it mirrors the server. If you fix finding A, the client needs the list for swatches and the duplication is earned — but then it should be imported from `core/domain.js`, not retyped, since `core/` is already the shared layer both sides import. If you *don't* fix A, delete the client constant entirely and let `createTag` default the colour server-side when `color` is omitted.
2. **`board.jsx:154` — the `||` fallback.** `TAG_PALETTE.find(c => !used.includes(c)) || TAG_PALETTE[Object.keys(registry).length % TAG_PALETTE.length]` is two strategies where one does the whole job. The modulo expression alone covers every case. Delete the `find` half (or the whole line, per item 1).
3. **Redundant guards in the projection, `bridza-store.js:569-571` and `:578`.** `refsAll.taskTags && …`, `refsAll.tags && …` and `refsAll.tags || {}` all re-check what `readRefs` has just guaranteed — it normalises both keys to `{}` two functions up. Three dead conditionals; drop them and the `.map` reads in one line.
4. **`createTag`'s `tag` return field.** Callers use `ok`, `id`, `error`; `tag` has no consumer anywhere and `created` only has the unit test. Return `{ ok, id, created }` and drop `tag`.
5. **Not over-engineering, worth saying:** `setTaskTags`/`createTag` correctly reuse `readRefs` → `writeJSON` → `commitPaths`, matching `setTaskArchived` line for line, and `commitPaths` already no-ops when nothing staged, so a no-change toggle makes no empty commit. `TagMenu` as a component is justified — it holds its own input state and the card body is already dense.

## 4. Suggested order

1. B (stuck menu, Escape) — smallest and the only one that strands the user.
2. A (colour swatches) — the one real acceptance gap.
3. D (fix the two docs paths), E (`validRef`), then the deletions in §3.
4. C last.
