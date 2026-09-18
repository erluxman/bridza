# Review — Good-luck greeting adapts to time of day

Verdict: **approved, after a mergeability fix.** The implementation matches every acceptance criterion in `spec/outputs/acceptance.md`, but the build stage had targeted a stale file location and the branch could not be merged into `main`. Both were fixed in this review.

## Mergeability (as required by the run prompt)

The branch `bridza/engineering/time-aware-greeting` was cut from pre-`ux-revamp` `main` (`3c8c805`). Since then `main` refactored the app shell: `WelcomeDialog` moved out of the old monolith `src/app/App.jsx` into `src/app/features/onboarding.jsx`. As committed by the build stage the branch would NOT merge:

- `git merge-tree --write-tree main bridza/engineering/time-aware-greeting` → content conflicts in `src/app/App.jsx`, `src/app/__tests__/welcome-dialog.test.jsx`, and add/add + content conflicts in `metadata.json` / `review/prompts.md`. The stale `greetingForHour` edit also left the *real* `WelcomeDialog` (in `onboarding.jsx`) untouched, so acceptance behavior would not have existed on the merged result.

Fix applied in this review:

1. Merged current `main` into the feature branch; kept `main`'s refactored versions of the four conflicted files.
2. Relocated the feature to its current home: `greetingForHour` + a `WelcomeDialog` that calls it now live in `src/app/features/onboarding.jsx:9-23`, replacing the `Welcome 👋` heading with `{greeting} 👋` and leaving the good-luck line untouched.
3. Updated `welcome-dialog.test.jsx` to import helper + dialog from `../features/onboarding.jsx` and to keep the parameterized bucket tests.
4. Re-verified: `git merge-tree --write-tree main …` now returns a clean tree (no conflicts).

## Acceptance checklist

| Criterion | Status | Evidence |
|---|---|---|
| Greeting line differs by bucket: morning / afternoon / evening | ✅ | `greetingForHour` (`features/onboarding.jsx:9`): `5–11 → "Good morning"`, `12–16 → "Good afternoon"`, `17–23 & 0–4 → "Good evening"`; `WelcomeDialog` renders it as the `<h2>` (`onboarding.jsx:13,23`). |
| Good-luck wish appears in every bucket | ✅ | `Good luck with today's work — make it count.` (`onboarding.jsx:26`) sits outside the bucket lookup and renders regardless of hour. |
| Hour injectable / deterministic for tests (no wall-clock monkeypatching) | ✅ | `greetingForHour` is a pure exported function taking the hour; `WelcomeDialog` supplies `new Date().getHours()` (`onboarding.jsx:13`). No `vi.setSystemTime` / clock stubbing anywhere. |
| No new dependencies; reuses copy style and tokens | ✅ | `package.json` untouched; heading keeps the same `h2` style (`marginTop: 0, fontSize: 17`) and 👋 emoji of the replaced `Welcome 👋`; `.modal-bg`/`.modal` markup unchanged. |
| Parameterized tests inject each bucket's hour; `pnpm test` | ✅ | `it.each` (`welcome-dialog.test.jsx:61-77`) covers all boundaries named in the contract (5, 11, 12, 16, 17, 4) plus interior hours (8, 14, 20, 23, 0). File: 15/15 pass. Full suite: **175 pass / 1 fail** — the single failure (`ux-views.test.jsx · "Canvas shows the layout switcher and nodes", `localStorage.getItem is not a function`) reproduces identically on clean `main` (164/165) and is unrelated to this feature. `pnpm lint` → clean. |

## Over-engineering — nothing to delete

- `greetingForHour` is a pure exported helper with two real callers (component + test suite) — that is the seam the acceptance contract pins, not an abstraction with one caller.
- No state, config layer, constants table, or copy framework introduced. The ternary chain is tighter than a lookup object for three fixed buckets.
- No reinvented stdlib; plain JS + the existing jsdom test harness.
- The single-use local `const greeting` (`onboarding.jsx:13`) could be inlined into the JSX, but it keeps the heading line readable and matches the flat style of the surrounding file — keep as-is.

Optionally deletable, I'd argue for:
- **Stale review commit `43a0606`** on the branch reviewed the pre-refactor diff that no longer exists; the reviewer history for this task can be read from the current `review.md` + `prompts.md` alone. Harmless history, left in place for audit.

## Process note

- The run harness committed this task's review scaffolding onto `main` (`5cab428`, message `{"type":"step_finish",…}`) while the task's pipeline metadata pins branch `bridza/engineering/time-aware-greeting`. The scaffolding files (`metadata.json` update, `review/prompts.md`, `review/outputs/.gitkeep`) are now on both sides after the merge; worth flagging upstream that stage-run scaffolding should land on the task branch, not `main`.
- Pre-existing repo failure noted under acceptance (`ux-views` localStorage-in-jsdom) is on `main` independent of this branch; if "1 failed" is considered a gate, that is a repo-level bug to fix separately, not this feature's regression.