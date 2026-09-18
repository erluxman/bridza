# Review — Welcome dialog shows at most once per calendar day

Verdict: **approved**. Every acceptance criterion is met, the diff is minimal, and `pnpm test` (71/71), `pnpm lint`, and `pnpm build` are all green. I independently verified the one piece of "extra" test infrastructure is genuinely required by the environment, not speculative.

## Fit check

Single small feature in the "Feature" flow, implemented in one build stage ("Feature" == one task, done). No mis-flag. Proceeded.

## Acceptance checklist

| Criterion | Status | Evidence |
|---|---|---|
| Dismiss (close button, backdrop, Escape) → reload same day → hidden | ✅ | All three dismiss paths call the same `onClose` (`App.jsx:149`): backdrop `.modal-bg onClick` (`App.jsx:2033`), `✕` button (`App.jsx:2037`), Escape keydown (`App.jsx:2027-2029`). That handler does `setWelcomeOpen(false)` **and** `localStorage.setItem(LS.welcome, today())`, and on mount the initializer is `useState(() => localStorage.getItem(LS.welcome) !== today())` (`App.jsx:45`) — so a fresh mount the same day reads today's date back and stays quiet. |
| Persisted per calendar day via `localStorage`, following `LS` conventions | ✅ | `LS.welcome = "bridza-welcome"` added to the existing `LS` constant (`App.jsx:9`), same pattern as `side`/`dir`/`recents`. Value is the local calendar date string `YYYY-MM-DD` from `today()` (`App.jsx:11`, local-time — correct calendar-day semantics). Matches the acceptance's own clarification ("`LS.welcome`, value = today's date"). |
| New day resets, dialog reappears | ✅ | Any stored date ≠ today → `welcomeOpen` starts true. A stored value from a previous day (or none) shows the dialog. |
| Reuses existing localStorage helpers/pattern; no new dependency | ✅ | Direct `getItem`/`setItem` via the `LS` constant, identical to how `side`/`recents`/`dir` are handled. `package.json` untouched — no new storage library. |
| Tests cover both cases deterministically; `pnpm test` passes | ✅ | `welcome-dialog.test.jsx:81-98`: (1) stale date `2000-01-01` → shown → click dismiss → asserts stored value `=== today()` → remount in same root → hidden (deterministic: today is never `2000-01-01`); (2) stale date → shown. `pnpm test` → 71/71 pass, `pnpm lint` clean, `pnpm build` clean. |

## Notes (non-blocking)

- **Tests exercise a mirror, not the app.** The `Harness` re-states the App's two lines (init + persist on dismiss) rather than mounting `App` — same trade-off the previous review accepted (full `App` drags in `@xterm` + the api client). The cost is that a future divergence between `App.jsx` and the `Harness` copy wouldn't be caught. Given the logic is 2 lines and the diff is visible in review, acceptable.
- **Persistence asserted only via the button path.** The same-day-reload test dismisses through `.modal .btn`; the backdrop/Escape tests dismiss but don't assert the storage write. Since all three funnels into the identical `onClose`, that's equivalent coverage — but asserting storage after one of the other paths (e.g. Escape) would pin the wiring against refactors.
- **Midnight rollover is load-time only.** An app left open across midnight won't re-greet live; it appears on the next reload. That matches the acceptance's phrasing ("on a new calendar day the greeting returns"), so this is intended behavior, not a bug.
- **Pre-existing churn, unchanged:** `WelcomeDialog` re-subscribes its Escape listener on every App render (4s-poll). Carried over from the prior review; not introduced here.

## Over-engineering — nothing to delete

- **`makeStorage` / `stubLocalStorage` (~16 lines) — KEEP.** I verified this is load-bearing, not speculative: under this vitest + Node 25 (flagless `--localstorage-file`) + jsdom combo, `globalThis.localStorage` and `window.localStorage` are bare objects whose `getItem`/`setItem` are `undefined` (I probed: `g.setItem FAIL: globalThis.localStorage.setItem is not a function`). Deleting the stub and relying on the native globals makes the App code (and the `Harness` initializer) throw immediately. The stub is the minimal thing that makes the existing `LS` pattern executable in tests; `localStorage.clear()` alone can't fix a missing method. Keep.
- **Exported `today` / `LS` — KEEP.** Both are used in app code; the `export` exists only so the test imports the same values instead of duplicating string literals / re-implementing the date. That's the idiomatic "export for testability" trade, not one-caller abstraction.
- **`Harness` — KEEP.** The prior review already justified mirror-over-full-App; it's still the lowest-cost way to get deterministic, dependency-free coverage.
- No dead code, no speculative flexibility, no new deps. The net diff is ~42 lines of app code + tests.

## Process note

None — single build run, clean tree, no double-launch this time.