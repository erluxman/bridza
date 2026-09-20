# Review — Have a different task URL so that I can refresh

Task #105 · `engineering/have-a-different-tax-url-so-that-i-can` · stage `fix-review`
Branch `bridza/engineering/have-a-different-tax-url-so-that-i-can` → lands on **`main`**.

**Verdict: approved.** The fix hits the root cause named in `repro.md`, the
regression test is proven to fail without it, every sibling nav caller still
behaves, and the merge into `main` is clean. Four minor notes below — none
blocking.

## 1. Does it address the root cause?

`repro.md` pinned one cause: no `history` integration anywhere, so the five nav
states (`activePipe`, `activeTask`, `flowOpen`, `inboxOpen`, `planOpen`) are
plain `useState` that boot to "home" on every mount.

The fix closes exactly that loop, at the one place that owns the state:

| `repro.md` symptom | Addressed | Where |
|---|---|---|
| URL never names the open task | yes | `src/app/App.jsx:119-131` writer effect |
| Refresh drops to the board | yes | `src/app/App.jsx:22-23,30-32` boot from `parseRoute()` |
| Shared/pasted link goes home | yes | same + `public/_redirects`, electron `serveStatic` already fall back to `index.html` |
| Inbox / Plan / Flow reset on refresh | yes | `?view=` param, `src/app/lib/route.js:18,33` |
| Back/Forward leave the app | yes | `popstate` listener, `src/app/App.jsx:105-113` |
| Secondary: refresh on the 2nd pipeline snaps to the 1st | yes | URL mirrors the *derived* `pipeline`, so `activePipe` boots to the pipeline you were on and `refresh()`'s reset leaves it alone (it only resets an empty/unknown id) |
| Stale id → blank screen | yes | `src/app/App.jsx:116-118` clears a task the pipeline doesn't have, degrading to that board |

Fixed at the shared state, not at the six open-a-task call sites — the right
altitude. No new dependency, no router, no server change.

Verified deep-path serving myself rather than trusting the claim:
`electron/main.js:44` falls back to `index.html` for any extension-less *or*
missing path (so a task id containing a dot is covered too), and
`public/_redirects` is `/* /index.html 200`. `src/main.tsx:19` already admits
`/app/*` into the app bundle.

## 2. Regression test fails without the fix — confirmed

Reverted `src/app/App.jsx` to `main` and deleted `src/app/lib/route.js`, then
re-ran:

```
playwright test e2e/task-url.spec.js      → 1 failed, 1 did not run
  Expected pattern: /\/app\/engineering$/
  Received string:  "http://localhost:5199/app"
vitest run src/app/__tests__/route.test.js → 1 failed (module gone)
```

With the fix restored, both pass (`2 passed` / `254 passed`). Source tree was
restored byte-identical to HEAD afterwards (`git diff HEAD -- src/ e2e/` empty).

One caveat worth stating: without the fix the spec dies on its *first*
assertion (the board URL) and never reaches the `page.reload()` assertion that
is the literal user complaint. Same root cause, so the proof holds, but the
refresh assertion is not independently exercised in the red state.

## 3. Sibling callers — no regressions

Walked all six nav entry points; all keep calling the same setters, all still
land on the right screen, and each now writes a URL:

| Caller | Behaviour |
|---|---|
| `Sidebar onPipe` / `onOpenTask` / `onInbox` / `onPlan` (`App.jsx:148-152`) | batched setters → exactly one history entry each ✓ |
| `PlanView onOpenTask` (`:158`) | batched → one entry ✓ |
| `Board onOpen={setActiveTask}` (`:165`) | one entry ✓ |
| `TaskDetail onOpenTask` / `onBack` (`:167-168`) | batched → one entry ✓ |
| `NewTaskModal onDone` (`:178`) | intermediate commit is still the board URL, so one entry ✓ |
| `Inbox onOpenTask` (`:161`) | two entries — see note (b) |

Other checks, all clean:

- Hook order: the derivation and the three effects sit **above** the early
  returns; `pipes` guards `proj === null`, so the Welcome / picker branches are
  unchanged.
- `refresh()`'s `activePipe` reset (`App.jsx:64`) and the URL no longer fight:
  the reset only fires for an empty or unknown id, which is exactly the case
  where the URL has nothing to defend.
- The polling `refresh()` re-runs the writer effect every 4s (new `proj`
  object), but `next === currentPath()` so it never writes. No loop.
- No other `location`/`history` use in `src/` conflicts (`flow.jsx:77` mailto,
  `term.jsx:53` ws host, landing-page `href="/app"` links).
- `parseRoute`/`routePath` round-trip is covered under both prefixes
  (`/app/…` and `app.<host>/…`), which is the case main.tsx's own gate creates.

## 4. Full verification run

```
vitest run                         → 11 files, 254 tests passed
eslint .                           → clean (exit 0)
tsc -b && vite build               → clean (exit 0)
playwright test e2e/task-url.spec.js → 2 passed
playwright test (full suite)       → task-url 2 passed; app.spec.js:40 and
                                     ux-views.spec.js:67 fail (pre-existing)
```

The two e2e failures are **pre-existing and unrelated**, verified by re-running
both specs with the fix reverted — identical failure, `<div class="modal-bg">
intercepts pointer events`: their shared `openApp` helper doesn't suppress the
once-a-day welcome dialog. Both suites are serial, so that one failure skips
~30 downstream tests in each. Out of scope here, but worth its own task — the
new spec suppresses the dialog itself and shows the two-line fix.

## 5. Minor notes (non-blocking)

**(a) Normalising after boot uses `pushState`, so Back can bounce.**
`App.jsx:119-131` only `replaceState`s while `urlSettled.current` is false.
After the project loads, a history entry whose URL the app immediately rewrites
(one with no pipeline segment) gets *pushed* instead: going Back to it
re-normalises forward and grows history rather than navigating. Reachable by
switching projects (`openDir` clears `activePipe` while the old `proj` is still
mounted, so the pre-switch URL lands in history). Pre-fix, Back simply left the
app, so this is not a regression — but a `replace` flag set by `onPop` and by
the "state didn't change, only resolved" case would close it.

**(b) Opening a task from the Inbox costs two history entries.**
`App.jsx:161` is the one entry point that splits across two commits
(`setActivePipe(pid)` now, `setActiveTask(tid)` after `refresh()` resolves), so
the writer effect pushes `/app/<pipe>` and then `/app/<pipe>/<task>`. Back from
that task lands on the board, not the Inbox you came from. Code-derived, not
executed (the e2e fixture has an empty inbox). Folding the id into the same
commit, or reusing the `PlanView` shape, would fix it.

**(c) A malformed percent-escape in the path throws at mount.**
`decodeURIComponent` in `parseRoute` (`route.js:24`) raises `URIError` on input
like `/app/eng/%E0%A4%A`; it runs inside a `useState` initialiser and there is
no error boundary in `src/main.tsx`, so the app would render blank — the one
outcome `repro.md` asked to avoid. Mitigating: Vite's dev server 500s on that
request before the app ever loads (verified), and only an externally malformed
link can produce it, since every id the app emits is `encodeURIComponent`'d.
A `try/catch` returning the raw segment would settle it.

**(d) `closeProject` leaves the old pipeline in the URL.**
`App.jsx:90` clears `activeTask` but not `activePipe`, so the Welcome screen can
sit at `/app/engineering`. Cosmetic — a reload still lands on Welcome, since the
project key is gone from `localStorage`.

## 6. Merge readiness — into `main`

**The merge into `main` will be clean.** Verified, not assumed:

- `git merge-tree --write-tree --messages main HEAD` → wrote tree
  `a2e1fe6…` with **no conflict messages**, exit 0.
- Merge base `5de52f2`. Since the base, `main` has touched only
  `.bridza/plan.json` and `.bridza/refs.json`; this branch touches neither.
  **Zero file overlap** between the two sides.
- No doc or output on this branch names a landing branch other than `main`;
  `package.json`'s `deploy` script already targets `--branch=main` and is
  untouched.
- `git diff HEAD -- src/ e2e/` is empty after my revert experiments — nothing
  from this review leaked into the tree. Build artefacts (`dist/`,
  `node_modules`, `test-results/`) were removed; only the expected pipeline
  files remain uncommitted.
