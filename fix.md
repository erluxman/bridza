# Fix — Remove automatic focus on search field in Kanban View

Task #111 · `engineering/remove-automatic-focus-on-search-field` · stage `fix`

## Flow fit

Fits the **Bugfix** flow. `repro.md` pins one root cause at one line
(`src/app/features/board.jsx:191`) with one shared fix point — the search
input's ref. The ⌘K / `/` shortcut the report asks for already exists and
works, so there is no feature to decompose: one change, one file.

## The fix

Root cause per `repro.md`: the search input carried an **inline** ref callback

```jsx
ref={(el) => el && setTimeout(() => el.focus(), 0)}
```

React re-invokes an inline ref callback on every commit (detach `null`, attach
`el`), so this was a `focus()` **per render**, not per mount. `<Board>` renders
on the 4s poll (`App.jsx:78`) and on every card hover (`setHover`), so the caret
was yanked back into the search box every few seconds.

Fixed at the shared path — the one ref every render went through — rather than
at the things that trigger renders (the poll, the hover state), which are
correct and untouched.

### `src/app/features/board.jsx`

1. **Stable ref.** `const searchRef = useRef(null)`, `ref={searchRef}` on the
   input. A stable ref object is not re-invoked per commit, so rendering the
   board no longer touches focus at all.

2. **Focus on the intent to open.** A `useEffect` keyed on `searchOpen`:

   ```js
   useEffect(() => {
     if (searchOpen && searchRef.current) searchRef.current.focus();
   }, [searchOpen]);
   ```

   It runs on the `false → true` transition only — i.e. when the 🔍 button or
   the `/` / ⌘K shortcut opens the box — and never on an unrelated re-render.
   The `setTimeout(…, 0)` is gone too: the focus now lands inside the commit
   instead of a macrotask later, so it can no longer beat React's own focus
   handling or steal focus moved during the same tick.

3. **⌘K when the box is already open.** Before the fix this case could not
   arise — the box always held focus. Now it can sit open while the caret is
   elsewhere, and `setSearchOpen(true)` is a no-op that fires no effect and
   mounts nothing. So the shortcut handler also focuses directly:

   ```js
   setSearchOpen(true);
   if (searchRef.current) searchRef.current.focus();
   ```

   That is the report's own requirement — "to focus on that search either we
   click on it, or press a shortcut like command + K".

Nothing else changed. The other `autoFocus` uses in the codebase
(`nav.jsx:206`, `task.jsx:587`, `onboarding.jsx:192`/`269`, `board.jsx:62`) are
React's declarative mount-only prop inside modals the user just opened, and are
correct — `board.jsx:191` was the only render-coupled focus in the tree
(`grep -rn "ref={(el)" src/` returns nothing else).

## Regression tests

`src/app/__tests__/board-search-focus.test.jsx` — the repro stage's spec, now
passing, plus two cases this fix makes reachable:

| test | guards |
|---|---|
| focuses the search box when the user opens it on purpose (click) | intended focus still happens |
| does NOT re-steal focus on an unrelated re-render (the 4s poll) | **the bug** |
| does NOT re-steal focus when the pointer merely crosses a card | **the bug**, hover path |
| focuses the search box when the user presses the shortcut | ⌘K opens *and* focuses |
| re-focuses an already-open search box when the shortcut is pressed again | ⌘K with no remount to piggyback on (new) |
| does not grab focus when the board first renders | focus never lands unasked |

```bash
./node_modules/.bin/vitest run src/app/__tests__/board-search-focus.test.jsx
#  Test Files  1 passed (1)
#       Tests  6 passed (6)
```

Full suite: **285 tests, 284 passed, 1 failed** — the failure is
`create-pr.test.js > falls back with the compose URL when gh is not on PATH`,
the pre-existing environment-dependent failure `repro.md` already flagged (`gh`
is installed on this machine, so the test's premise does not hold). Unrelated
and untouched.

## Manual check

The by-hand repro from `repro.md` — open search, type `alpha`, click away, wait
for the poll or hover a card — no longer moves the caret. `/` and ⌘K still put
it in the box, from either the open or the closed state.
