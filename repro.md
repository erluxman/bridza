# Repro — Have a different task URL so that I can refresh

Task #105 · `engineering/have-a-different-tax-url-so-that-i-can` · stage `repro`

> "tax URL" in the title is a typo for **task URL**.

## Summary

The Bridza app (`/app`, `app.localhost:5173`) keeps **all** navigation state in
React component state only. The address bar is `http://localhost:5199/app`
whether you are on the board, inside a task, in the inbox, in the plan view, or
in the stage-flow editor. Because the URL never names the open task, a browser
refresh (or a copy-pasted link, or a Vite HMR full reload) drops the user back
to the pipeline board — "home".

**Reproduced end-to-end.** Failing spec: `e2e/repro-task-url.spec.js` (added by
this stage; it is a repro, not a fix).

## Reproduction steps

Prereq: dependencies installed (`pnpm install`). This worktree has none; the run
below borrowed the main checkout's:
`ln -sfn /Users/risky/projects/erluxman.com/bridza/node_modules node_modules`
(removed again afterwards so the tree stays clean).

```bash
PLAYWRIGHT_BROWSERS_PATH=~/Library/Caches/ms-playwright \
  ./node_modules/.bin/playwright test e2e/repro-task-url.spec.js
```

The spec drives the real app against a throwaway git fixture repo:

1. `goto /app`, clear `localStorage` (and pre-set `bridza-welcome` to today so
   the once-a-day welcome dialog does not swallow clicks), reload.
2. Type the fixture repo path into the Welcome panel → Enter.
3. Category picker → **Engineering** → **Create 1 pipeline**.
4. Click the **Engineering** pipeline → **New task** → title `Repro Task 105`,
   flow `feature` → **Create**. The task detail screen opens.
5. Record `page.url()` on the board and with the task open.
6. `page.reload()`, wait, record what is on screen.

Manual equivalent: `pnpm dev`, open `http://app.localhost:5173`, open any task,
look at the address bar, press ⌘R.

## Observed

Verbatim console output from the failing run:

```
URL on board          : http://localhost:5199/app
URL with task OPEN    : http://localhost:5199/app
URL after reload      : http://localhost:5199/app
task heading visible  : false
board visible         : true
main region text      : "Engineering\n⌨ Terminal\n🔍\n⚙ Stage flow\n＋ New task"
```

```
Error: URL should change when a task is opened
expect(received).not.toBe(expected) // Object.is equality
Expected: not "http://localhost:5199/app"
```

## Observed vs expected

| Action | Observed | Expected |
|---|---|---|
| Open a task | URL stays `/app` | URL names the pipeline + task, e.g. `/app/engineering/repro-task-105` |
| Refresh with a task open | Task closes; pipeline board ("home") renders | Same task detail reopens |
| Copy/share the address bar | Always points at home | Points at the exact task |
| Refresh in Inbox / Plan / Stage-flow | Falls back to the board | Stays on that view |
| Back / Forward buttons | Leave the app entirely (no in-app history entries) | Step through in-app navigation |

## Root cause

There is no router and no `history` integration anywhere in the app. A repo-wide
grep for `pushState` / `replaceState` / `popstate` / `hashchange` /
`location.hash` returns **zero** hits in `src/`; `react-router` is not a
dependency. The only `location` reads are in `src/main.tsx:17-21`, and they run
once at module load to pick which bundle to mount:

```ts
const isApp =
  location.hostname.startsWith("app.") ||
  location.pathname === "/app" ||
  location.pathname.startsWith("/app/");
```

Everything after `/app/` is matched but then discarded — nothing parses it.

All navigation lives in `useState` inside `src/app/App.jsx`, initialised to
"home" on every mount:

- `src/app/App.jsx:22` — `const [activeTask, setActiveTask] = useState("")`
- `src/app/App.jsx:21` — `const [activePipe, setActivePipe] = useState("")`
- `src/app/App.jsx:29-31` — `flowOpen` / `inboxOpen` / `planOpen`, all `useState(false)`

`src/app/App.jsx:36` then computes `atHome = !planOpen && !inboxOpen &&
!flowOpen && !activeTask`, which is **true on every fresh mount**, and
`src/app/App.jsx:125` renders `<Board>` because `task` is undefined.

Every "open a task" entry point is a pure `setState` with no URL write —
`src/app/App.jsx:111` (sidebar), `:119` (plan), `:122` (inbox), `:126` (board
card), `:129` (task→task), `:139` (task just created).

The single piece of navigation state that *does* survive a reload is the opened
project folder, persisted to `localStorage` under `bridza-project`
(`src/app/App.jsx:17`, key from `src/app/lib/format.js:10`). That is exactly why
the refresh lands on the board rather than on the Welcome screen — the project
reopens, the task does not.

Secondary consequence, from the same cause (code-level, not exercised by the
spec above, which creates only one pipeline): `src/app/App.jsx:63` resets
`activePipe` to `s.pipelines[0].id` whenever the current value is empty, so a
refresh while viewing the *second* pipeline also silently switches back to the
first.

## Notes for the fix stage (nothing fixed here)

- Deep links will resolve in both environments already: `public/_redirects`
  serves `/* /index.html 200` in production, and Vite dev falls back to
  `index.html` for unknown paths — so a path-based scheme under `/app/...` needs
  no extra server work. `src/main.tsx:19` already admits `/app/*` into the app
  bundle. Note the app also answers on `app.<host>` where the path has no `/app`
  prefix, so the URL scheme has to work under both prefixes.
- The URL should carry pipeline id + task id (both are stable slugs, e.g.
  `engineering` / `have-a-different-tax-url-so-that-i-can`), and ideally the
  non-board views (`inbox`, `plan`, `flow`) too.
- Restoring state on load must wait for `refresh()` to populate `proj` before
  the task lookup at `src/app/App.jsx:98` can succeed; an id in the URL that no
  longer exists should degrade to the board, not to a blank screen.
- Guard against the polling `refresh()` at `src/app/App.jsx:77` and the
  `activePipe` reset at `:63` fighting whatever the URL says.
- `e2e/repro-task-url.spec.js` should be kept and turned into the regression
  test once the fix lands (drop the `REPRO:` prefix from its title).
