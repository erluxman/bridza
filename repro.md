# Repro — Remove automatic focus on search field in Kanban View

Task #107 · `engineering/remove-automatic-focus-on-search-field` · stage `repro`

## Summary

The kanban board's search box does not focus **once, when you open it**. It
re-focuses itself on **every single render of `<Board>`**, for the whole time it
stays open. Since the app polls the bridge every 4 seconds and re-renders the
board with fresh data, the caret is yanked out of whatever you were doing and
back into the search field roughly every 4 seconds — and instantly whenever the
mouse pointer crosses a task card.

The offending line is `src/app/features/board.jsx:191`:

```jsx
ref={(el) => el && setTimeout(() => el.focus(), 0)}
```

An **inline** ref callback is a new function identity on every render, so React
detaches it (`ref(null)`) and re-attaches it (`ref(el)`) on every commit. This
is not mount-time focus; it is `focus()` per render.

**Reproduced end-to-end.** Failing spec: `src/app/__tests__/board-search-focus.test.jsx`
(added by this stage — it is a repro, not a fix).

The ⌘K / `/` shortcut the report asks for **already exists**
(`board.jsx:120-123`) and works. Nothing needs adding there; the defect is
purely the unconditional re-focus.

## Reproduction steps

### Automated

This worktree ships without `node_modules`; the run below borrowed the main
checkout's (symlink, gitignored, so the tree stays clean):

```bash
ln -sfn /home/risky/projects/erluxman.com/bridza/node_modules node_modules
./node_modules/.bin/vitest run src/app/__tests__/board-search-focus.test.jsx
```

```
 ❯ src/app/__tests__/board-search-focus.test.jsx (4 tests | 2 failed)
   × does NOT re-steal focus on an unrelated re-render (the 4s poll)
   × does NOT re-steal focus when the pointer merely crosses a card
   ✓ focuses the search box when the user opens it on purpose (click)
   ✓ does not grab focus when the board first renders
```

The two passing cases are the behaviour a fix must **preserve**; the two failing
ones are the bug.

### By hand, in the real app

1. `pnpm dev`, open `http://app.localhost:5173/app`, open any pipeline with at
   least one task (the kanban view).
2. Click 🔍 (or press `/` / ⌘K) and type something, e.g. `alpha`. The query must
   be non-empty — `onBlur` closes the box again when it is empty
   (`board.jsx:196`), which masks the bug.
3. Click somewhere else — another button, a card, the terminal drawer.
4. **Wait ~4 seconds, or just move the pointer over a task card.**

Observed: focus jumps back into the search input, caret and all. Keystrokes
meant for the page get typed into the search box.

## Observed vs expected

| | |
|---|---|
| **Observed** | While search is open, focus returns to the search `<input>` on every board render — every 4s from the poll, and immediately on any card hover. The user never asked for it. |
| **Expected** | Focus moves into the search box **only** on an explicit user action: clicking 🔍 / the input, or pressing `/` or ⌘K. Otherwise focus stays wherever the user put it. |

## Root cause

`src/app/features/board.jsx:189-197`

```jsx
{searchOpen ? (
  <input
    ref={(el) => el && setTimeout(() => el.focus(), 0)}   // ← line 191
    className="search-input"
    ...
```

Three facts combine:

1. **The ref is inline.** React compares ref identity across commits. An arrow
   function literal is never identity-equal to the previous render's, so React
   runs the detach/attach cycle every commit — the callback fires, and calls
   `focus()`, on **every render**, not just on mount.

   Measured directly (instrumented `input.focus`, then three unrelated
   re-renders): **3 renders → 3 `focus()` calls.** One per render. Confirmed,
   not inferred.

2. **`<Board>` re-renders constantly.** `App.jsx:76-79` polls every 4s:

   ```js
   const t = setInterval(() => refresh(dir, { poll: true }), 4000);
   ```

   `refresh` does `setProj(s)` (`App.jsx:63`) with a **fresh object** from
   `api.getState(d)`, so the board's props change identity every 4s. `Board` is
   not memoised. On top of that, board-local state re-renders it too — most
   notably `setHover(t.id)` from each card's `onMouseEnter` (`board.jsx:219`),
   which is why a bare mouse movement triggers it with no poll involved.

3. **The `setTimeout(…, 0)` hides the cause and widens the blast radius.** The
   focus lands a macrotask *after* the commit, so it beats React's own focus
   restoration and steals focus that was legitimately moved during that same
   tick. It also means the steal cannot be traced to the render that caused it.

Why the intent was reasonable and still wrong: the author wanted "focus the box
when it appears". A ref callback looks like a mount hook, but it isn't one — it
is a per-commit hook. The condition that actually matters (*did the user just
open the search?*) is nowhere in the code, so every render re-asserts focus.

### Why the empty-query case masks it

`onBlur={(e) => { if (!e.target.value) setSearchOpen(false); }}` (`board.jsx:196`)
closes the box on blur when it is empty. With an empty query the input unmounts
the moment you click away, so there is nothing left to steal focus. The bug only
shows once a query is typed — which is exactly the state a user searching is in.

## Scope

Only `src/app/features/board.jsx:191`. The other `autoFocus` uses in the
codebase (`nav.jsx:206`, `task.jsx:587`, `onboarding.jsx:192`/`269`,
`board.jsx:62`) are React's declarative `autoFocus` prop, which fires on mount
only and is correct — all of them sit in modals/forms the user just opened.

## Notes for the fix stage

- Removing the ref outright is **not** enough: ⌘K and `/` set `searchOpen` but
  rely on this ref to actually put the caret in the box. The fix has to focus on
  the *intent to open*, not on the render.
- The two passing tests in the spec pin the behaviour to keep.

## Environment

- Branch `bridza/engineering/remove-automatic-focus-on-search-field`, worktree clean apart from this stage's files.
- `node_modules` symlinked from the main checkout for the run; gitignored.
- vitest 4.1.9, jsdom, React 19.

### Pre-existing unrelated failure

The full suite (`vitest run`) reports **283 tests, 3 failed**. The third failure
is not ours and predates this task:

```
× src/app/__tests__/create-pr.test.js > createPR — fallbacks
  > falls back with the compose URL when gh is not on PATH
```

It asserts behaviour for a machine **without** the GitHub CLI; `gh` is installed
here (`/usr/bin/gh`), so the test's premise does not hold in this environment.
Unrelated to the search field — flagged, not touched.
