# Review — Zero-padded numbered-folder naming contract

Branch: `bridza/engineering/number-prefix-contract`
Reviewed against: `main`

## Verdict: ❌ NOT approved — the build stage delivered zero code

The build run (commit `39f58fd`, stage "build") produced **no file changes**.
The commit message says literally "No file changes", the run record in
`metadata.json` lists `"files": []`, and the agent log only ran its fit check
("Fit check passes … Proceeding") before stopping without writing anything.

A whole-repo search for `REF_WIDTH | padRef | taskDirName | parseTaskDir |
displayRef` matches **only** spec/acceptance/context docs and the pipeline's
prompt history — no source file defines or imports any of them.

## Acceptance Check (acceptance.md)

- [ ] **FAIL** `core/domain.js` exports `REF_WIDTH` (8) + `padRef`, `taskDirName`, `parseTaskDir`, `displayRef` as pure helpers — `core/domain.js` is unchanged; none of these names exist in it (or anywhere).
- [ ] **FAIL** `padRef(17)` → `"00000017"`, `padRef(10000000)` → `"10000000"` — function missing.
- [ ] **FAIL** `taskDirName("engineering", "every-task-when-they-are-converted-into", 17)` → `"00000017-every-task-when-they-are-converted-into"` — function missing.
- [ ] **FAIL** `parseTaskDir` round-trips and falls back to `{ ref: null, id: dirName }` for unpadded/leading-digit dirs (incl. `2fa-rollout`) — function missing.
- [ ] **FAIL** `displayRef` returns the plain integer — function missing.
- [ ] **FAIL** Unit tests added to `src/app/__tests__/bridza-model.test.js` — the file is unchanged; no padding/round-trip/width/legacy tests exist.
- [ ] **FAIL** `pnpm test` / `pnpm lint` for the new code — nothing to run; the pre-existing suite is untouched (node_modules is also not installed in this environment, so even a baseline run wasn't possible here).
- [ ] **OK** Out of scope respected — no folders written, nothing renamed. This is the ONLY criterion that passes, and only because nothing was done.
- [ ] **PARTIAL** Key-shape decision: the spec correctly chose plain-id keys (`<pipeline>/<slug>`) with no key rewrite — sound. But the contract was also supposed to expose ONE helper that every reader/writer of the `.bridza/refs.json` / `plan.json` maps calls; no such helper was defined. When the build is redone, add it (e.g. `taskKey(pipeline, id)`) so the naming contract is actually the single source for both folder names and board-state keys.

## Over-Engineering Analysis

Nothing to flag — there is no implementation to audit. The real problem is the
opposite: zero code was written. On redelivery, keep it to exactly the spec
(four pure helpers + `REF_WIDTH` + one test block); no flexibility, stdlib
reinvention, or extra abstractions are warranted.

## Merge Readiness

- `git diff main...HEAD` touches only `acceptance.md`, `spec.md`, and Bridza stage plumbing under `.bridza/pipelines/engineering/number-prefix-contract/` — no product code at all.
- `git merge-tree` on `main`/`HEAD` reports **no conflicts** (0 conflict markers). A merge into `main` right now would be *technically* clean — but only because the branch carries nothing.
- Docs/outputs reference no landing branch; nothing names a wrong target.
- **Merge into `main` will be clean — but must NOT happen until the build stage actually implements the helpers + tests.** This task is not merge-ready as delivered.

## What to do next

Re-run the `build` stage with the same prompt. Deliver exactly:

1. `core/domain.js`: `REF_WIDTH = 8`, `padRef`, `taskDirName`, `parseTaskDir` (legacy fallback: not exactly 8 digits + `-` ⇒ `{ ref: null, id }`), `displayRef` — all pure, reusing `safeRef`/`taskSlug`.
2. `src/app/__tests__/bridza-model.test.js`: the four required test groups.
3. Confirm `pnpm test` and `pnpm lint` pass (and `pnpm build`).