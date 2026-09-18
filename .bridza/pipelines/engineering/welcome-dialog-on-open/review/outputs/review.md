# Review — Welcome dialog appears when the app opens

Verdict: **approved**. The diff meets every acceptance criterion; it is minimal, reuses the existing modal pattern, and is green (tests, lint, build).

## Acceptance checklist

| Criterion | Status | Evidence |
|---|---|---|
| Modal renders over the dashboard on app open, with welcome + good-luck message | ✅ | `App.jsx:44` `welcomeOpen = useState(true)`; `App.jsx:148` renders `<WelcomeDialog/>` inside the dashboard return branch (after the `!dir || !proj || !initialized` early outs), so it appears only over the dashboard. `App.jsx:2035,2038` "Welcome 👋" + "Good luck with today's work — make it count." |
| Dismissable via close button | ✅ | `App.jsx:2036` `✕` button → `onClose` |
| Dismissable via backdrop click | ✅ | `App.jsx:2032` `.modal-bg` `onClick={onClose}`; inner `.modal` stopPropagation (`App.jsx:2033`) |
| Dismissable via `Esc` | ✅ | `App.jsx:2026-2030` window keydown listener, cleaned up on unmount |
| Dismissal removes dialog, dashboard usable | ✅ | conditional render `{welcomeOpen && …}`; backdrop is `position: fixed`, nothing under it is touched |
| Existing modal pattern + CSS tokens, no new dialog library | ✅ | reuses `.modal-bg` / `.modal` from `bridza.css:266-267`; no dialog dependency added (jsdom is a test env, not a dialog lib) |
| Test proves render-on-mount + each dismissal; `pnpm test` passes | ✅ | `welcome-dialog.test.jsx` — 4 tests (render + 3 dismissals); `pnpm test` → 69/69 pass |
| Landing page untouched | ✅ | `git diff main -- src/pages/App.tsx` is empty |

## Notes (non-blocking)

- **Esc-listener duplication.** The ~6-line window-keydown Escape effect in `WelcomeDialog` is the third copy of the pattern in `App.jsx` (`DiffView` at `App.jsx:1004-1008` is another; the resolve/branch diffs reuse it). Extraction into a small `useEscape(fn)` hook is reasonable polish, but it would touch `DiffView` (out of scope) — leave it. Not a correctness issue.
- **No focus management.** `role="dialog"` / `aria-modal` are set but there is no focus trap or initial focus. This matches the existing `Modal`/`DiffView` pattern, so it is consistent — fine to leave, but if a11y is ever tightened repo-wide, all dialogs want it at once.
- **Effect re-subscribes on every App render** (`onClose` is a fresh inline arrow; App re-renders on the 4s poll). Harmless churn, matches existing conventions (`DiffView` does the same).

## Over-engineering — nothing to delete

- `welcomeOpen` state is the minimal toggle; the conditional render is the idiomatic way to unmount.
- The test's `Harness` re-states App's one-liner rather than rendering the full `App` — justified: importing `App` drags in `@xterm`, the api client, and the whole dashboard. Extracting a shared mount helper would be a speculative abstraction with a single consumer.
- `jsdom` devDep is necessary (the component test's environment) and is the only new dependency.
- No dead code, no unused flexibility, no one-caller abstractions were introduced. The net diff is ~40 lines of app code + tests.

## Process note

The build stage was double-launched by the harness — two concurrent `opencode run` processes raced on the same worktree and produced two "done" commits (`5300197`, then `7fdb96c`). They converged on the same design and the tree is clean, so nothing to fix in the code, but the harness double-launch is worth flagging upstream (it also briefly caused an indentation artifact, since resolved).