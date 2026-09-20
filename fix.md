# Fix — Have a different task URL so that I can refresh

Task #105 · `engineering/have-a-different-tax-url-so-that-i-can` · stage `fix`

## Flow fit

Fits the **Bugfix** flow. `repro.md` pins one root cause (navigation state never
reaches the address bar) with one shared fix point (the state that `App.jsx`
owns). No decomposition needed — this is one change, not a multi-task feature.

## The fix

Root cause per `repro.md`: the app has no `history` integration at all, so
`activePipe` / `activeTask` / `flowOpen` / `inboxOpen` / `planOpen` are
`useState` that reset to "home" on every mount.

Fixed at the shared path — the state `App.jsx` owns — **not** at the six
open-a-task call sites (`Sidebar`, `PlanView`, `Inbox`, `Board`, `TaskDetail`,
`NewTaskModal`), which are untouched and keep calling the same setters.

### `src/app/lib/route.js` (new, 36 lines, pure)

The address bar ⇄ navigation state mapping. Takes the Location as an argument,
so it unit-tests without a browser.

```
/app                       nothing resolved yet
/app/engineering           that pipeline's board
/app/engineering/fix-auth  task `fix-auth` open
…?view=inbox|plan|flow     the non-board screens
```

- The prefix is computed per load with the same test `src/main.tsx` uses: on an
  `app.<host>` there is none, everywhere else (`/app`, electron's loopback
  server, the prod fallback path) it is `/app`.
- The non-board views are a **query param**, not a path segment, so no pipeline
  or task id can ever collide with a view name.
- Ids are percent-encoded/decoded; an unknown `?view=` value is ignored.

### `src/app/App.jsx` (+38 lines)

1. The five nav states now **boot from the URL** (`useState(() => parseRoute()…)`),
   so the first render already shows the addressed screen.
2. A `popstate` listener maps the URL back onto that state — back/forward now
   step through in-app history instead of leaving the app.
3. The derivation of the shown `pipeline` / `task` moved above the early
   returns (hooks must precede them). The address bar mirrors the **derived**
   pipeline, not raw `activePipe`, so the URL can never name a pipeline that
   isn't on screen — that also covers the secondary bug in `repro.md` where a
   refresh on the second pipeline snapped back to the first.
4. A task id the project doesn't have (stale link, deleted task) clears itself
   → that pipeline's board, never a blank screen, and the stale id leaves the URL.
5. The writer effect `pushState`s only real navigation; the boot normalisation
   (resolving the default pipeline, dropping a vanished id) `replaceState`s, so
   it never becomes a back-button trap. `refresh()`'s existing `activePipe`
   reset already drops an unknown pipeline, so URL and poll don't fight.

No new dependency (no router), no server change — `public/_redirects`, Vite's
dev fallback and `electron/main.js`'s static handler already serve deep paths,
and every asset/API URL in the app is absolute, so a deeper path is safe.

## Verification

- `src/app/__tests__/route.test.js` (new) — 10 cases over the mapping: both
  prefixes, bare root, `?view=`, a task with no pipeline, unknown views,
  encoding, and a round-trip of every state `parseRoute` can produce.
- `e2e/task-url.spec.js` — the repro spec (`e2e/repro-task-url.spec.js`),
  rewritten as a regression test and made fixture-agnostic so it runs
  standalone or after `app.spec.js`. Covers: board URL, task URL, back/forward,
  **refresh reopens the task**, and a cold-loaded (pasted) task link; second
  test covers the inbox surviving a refresh.

```
vitest run                → 11 files, 254 tests passed
playwright test e2e/task-url.spec.js → 2 passed
```

**Pre-existing, unrelated:** `e2e/app.spec.js:40` and `e2e/ux-views.spec.js:67`
fail because their `openApp` helper doesn't suppress the once-a-day welcome
dialog, whose overlay swallows the next click. Verified by re-running the suite
with this fix reverted — same two failures. Left alone (out of scope); the new
spec suppresses the dialog itself, as `repro-task-url.spec.js` already did.
