# Review — Remove automatic focus on search field in Kanban View

Task #107 · `engineering/remove-automatic-focus-on-search-field` · stage `fix-review`

Branch `bridza/engineering/remove-automatic-focus-on-search-field` → lands on `main`.

**Verdict: approve.** The fix hits the root cause `repro.md` identified, at the
right layer, and nothing else. I re-ran the regression spec against `main`'s
unfixed `board.jsx` and watched it go red, swept every sibling focus path in the
tree for collateral damage, and probed three behaviours the committed spec does
not cover (caret survival during the poll, hover shortcuts, Escape). All clean.
`vitest` 284/285, `eslint` 0, `vite build` ok — the one failure is pre-existing
and unrelated.

**Merge into `main`: clean.** `git merge-tree --write-tree main HEAD` produced
tree `b8152ad` and exited 0 with no conflict output. Merge-base is `2789ae9`,
and `git diff --name-only 2789ae9 main` is **empty** — `main` has not moved since
this branch left it, so the merge is a fast-forward. No conflicts to resolve, and
no doc in this branch's diff names a landing branch other than `main`.

## 1. Does the fix address the root cause?

`repro.md` pins the cause precisely: `src/app/features/board.jsx:191` carried an
**inline** ref callback,

```jsx
ref={(el) => el && setTimeout(() => el.focus(), 0)}
```

React compares ref identity across commits; an arrow literal is never
identity-equal to the previous render's, so React ran detach(`null`)/attach(`el`)
on **every commit** and the callback called `focus()` per *render*, not per mount.
With `<Board>` re-rendering on the 4s poll (`App.jsx:78`) and on every card hover
(`setHover`), the caret was dragged back into the search box every few seconds.

The fix removes exactly that coupling, and nothing adjacent:

| Change | Line | Addresses |
|---|---|---|
| `const searchRef = useRef(null)` + `ref={searchRef}` | `board.jsx:99`, `:202` | A **ref object** is not re-invoked per commit. Rendering the board no longer touches focus **at all** — this is the actual root-cause kill. |
| `useEffect(() => { if (searchOpen && searchRef.current) searchRef.current.focus(); }, [searchOpen])` | `board.jsx:140-142` | Re-expresses focus as *intent to open* — it runs on the `false → true` transition, never on an unrelated re-render. |
| `if (searchRef.current) searchRef.current.focus()` in the ⌘K / `/` handler | `board.jsx:126` | Covers the case the fix newly makes reachable: box already open, caret elsewhere, `setSearchOpen(true)` is a no-op that fires no effect. |

**Verified at the right layer.** The fix sits on the one shared path every render
went through (the input's ref), not on the things that *trigger* renders. The poll
(`App.jsx:78`) and the hover state (`setHover`) are correct and untouched — fixing
either of those would have been a workaround. `grep -rn "ref={(" src/` now returns
nothing but the explanatory comment in the test header, so no other render-coupled
focus survives in the tree.

The `setTimeout(…, 0)` going away is a real improvement, not cosmetic: focus now
lands in the commit's effect instead of a macrotask later, so it can no longer beat
React's own focus handling or steal focus that moved during the same tick.

### Against the report, line by line

| The report asked for | Result |
|---|---|
| "when I do not focus search … with shortcut or click, the focus should stay on whichever element it is at" | ✅ Verified — poll re-render and card hover both leave focus put (tests 2 & 3, both red on `main`). |
| "it should not automatically focus on it" | ✅ Verified — first render mounts no input and leaves `document.activeElement` on `document.body`. |
| "to focus on that search either we click on it" | ✅ Verified — 🔍 click focuses. |
| "or press a shortcut like command + K" | ✅ Verified — ⌘K focuses from **both** the closed state (via the effect) and the already-open state (via `:126`). The latter did not work before this change. |

## 2. The regression test — confirmed red without the fix

This is the check that matters most, so I ran it rather than trusted it. I
restored `main`'s `board.jsx` in place, ran the spec, and put the fix back:

```bash
git show main:src/app/features/board.jsx > src/app/features/board.jsx
./node_modules/.bin/vitest run src/app/__tests__/board-search-focus.test.jsx
#  Tests  3 failed | 3 passed (6)
```

| Test | On `main` | With fix |
|---|---|---|
| focuses the search box when the user opens it on purpose (click) | pass | pass |
| **does NOT re-steal focus on an unrelated re-render (the 4s poll)** | **FAIL** | pass |
| **does NOT re-steal focus when the pointer merely crosses a card** | **FAIL** | pass |
| focuses the search box when the user presses the shortcut | pass | pass |
| **re-focuses an already-open search box when the shortcut is pressed again** | **FAIL** | pass |
| does not grab focus when the board first renders | pass | pass |

The failure messages are the bug in plain sight — `expected <button class="btn
primary">＋ New task</button> to be …` — focus had been yanked off the button and
into `<input class="search-input" value="alpha">`. The three passing-on-`main`
cases are the behaviour the fix had to preserve, and it does.

Worth calling out: the third red test is **not** a restatement of the bug. On
`main`, ⌘K with the box already open does nothing at all — `setSearchOpen(true)`
bails out, no commit happens, so the inline ref never re-fires. The fix closes a
gap the original code only ever hid behind the steal.

The test file itself is honest work: it drives the real `<Board>` through
`createRoot`/`act`, stubs only `term.jsx` (xterm does not load under jsdom), goes
through the native value setter so React's DOM value tracking does not swallow the
input, and keeps the `settle()` macrotask drain so a re-introduced
`setTimeout(…, 0)` would still be caught. It asserts on `document.activeElement`,
the actual thing the user complained about — not on a spy or a render count.

## 3. Regressions in sibling callers — none found

**Other focus entry points in the tree** (`grep -rn "autoFocus\|\.focus()" src/`):
`nav.jsx:206`, `onboarding.jsx:192`, `onboarding.jsx:269`, `task.jsx:587`,
`board.jsx:62` are React's declarative `autoFocus`, which fires on mount only and
is correct — every one sits in a modal or inline form the user just opened.
`term.jsx:57` focuses the terminal on open. None were touched, and none shared the
per-commit defect. The diff to `src/` is exactly two files: `board.jsx` and the new
spec.

**Consumers of the state the fix changed.** I checked each path that can now reach
a state that was previously unreachable (search open, caret elsewhere), because
that combination is genuinely new:

- **Hover `L` / `F`** (`board.jsx:143-153`) — guarded by
  `if (typing) return` on `input|textarea|select`. Previously, search-open implied
  caret-in-search, so that guard swallowed `L`/`F` while searching. Now they work.
  Verified by probe. This is a **behaviour improvement** in the report's direction,
  not a regression.
- **`Escape`** (`board.jsx:127-130`) — closes search and clears the query with no
  `typing` guard, so it fires wherever the caret is. Verified: it closes the box
  and **leaves focus on the element the user had focused** rather than jumping.
- **`onBlur` closes when empty** (`board.jsx:207`) — unchanged, and the ordering
  still holds: closing sets `searchOpen` false, the effect re-runs, the condition
  is false, nothing is focused.
- **`/` and ⌘K while typing in any input** — still inert via the same tagName
  guard. Unchanged.
- **`searchQuery` filtering** — untouched; the fix moved focus only.

**Three probes beyond the committed spec.** I wrote a scratch spec for the cases a
focus fix most plausibly breaks, ran it (3/3 pass), and deleted it:

1. **Caret survives the poll while legitimately typing.** This is the one thing the
   *buggy* code accidentally provided, so it was the likeliest regression. With the
   search focused and the caret parked mid-word at offset 2, a poll re-render leaves
   `activeElement` on the input, the **same DOM node** (not remounted), value
   `"alph"`, `selectionStart` still `2`. No regression.
2. **Hover + `L` with search open but unfocused** — reaches the tag picker; focus
   does not snap back to search.
3. **Escape from elsewhere** — closes the box, focus stays on the user's element.

## 4. Suite, lint, build

```
vitest run   → 15 files, 285 tests, 284 passed, 1 failed
eslint .     → exit 0, no warnings (incl. react-hooks/exhaustive-deps on the new effect)
vite build   → ✓ built in 1.07s
```

The single failure is **pre-existing and unrelated**, as `repro.md` flagged:

```
× src/app/__tests__/create-pr.test.js > falls back with the compose URL when gh is not on PATH
  expected 'gh pr create failed: GraphQL: Could not resolve to a Repository…' to match /not installed/
```

Confirmed unrelated by construction, not by assumption: this branch's only `src/`
changes are `board.jsx` and `board-search-focus.test.jsx`, and `create-pr.test.js`
references neither. The test asserts behaviour for a machine **without** the GitHub
CLI; `gh` is installed here, so it reaches a real API call instead of the
not-installed branch. Environment-dependent, out of scope, correctly left alone.

## 5. Notes — none blocking

**A. `repro.md:143` and `fix.md` call the `node_modules` symlink "gitignored". It
is not.** `.gitignore` has `node_modules/` with a trailing slash, which git treats
as a directory-only pattern; the symlink is a *file*, so it does not match and
shows up as `?? node_modules`. Anyone following those instructions and then running
`git add -A` would commit a symlink pointing at an absolute path on this machine. I
removed the symlink after my runs, so the worktree is clean as I found it. Fixing
the doc line (or the pattern) would spare the next stage the trap.

**B. `acceptance.md`, `spec.md` and the previous `review.md` in this worktree are
leftovers from a different task** — "Tags on a task, picked from a card with L"
(`separate-tags-filled-for-each-org-item`). They are committed on `main` and are
not in this branch's diff, so no acceptance criteria were ever generated for #107.
I reviewed against the report text in the task prompt instead, item by item
(section 1). This file replaces the stale `review.md`. Flagging it as pipeline
hygiene, not as a defect in the change.

**C. Optional, not worth changing.** The focus effect is a passive `useEffect`
rather than `useLayoutEffect`, so focus lands a tick after paint. Standard React
practice for focus-on-open, verified correct by the click and shortcut tests, and
`useLayoutEffect` would only matter if something else raced for focus in the same
frame. Leaving it alone is right.

## 6. Merge readiness

- `git merge-tree --write-tree main HEAD` → tree `b8152ad`, exit 0, **no conflicts**.
- Merge-base `2789ae9`; `git diff --name-only 2789ae9 main` is empty — `main` has
  not advanced, so the merge is a **fast-forward**.
- Working tree is clean apart from this stage's own outputs (`fix-review/`,
  `metadata.json`); build output lands in gitignored `dist/`.
- Docs in this branch's diff name `main` as the landing branch where it matters.

**The merge into `main` will be clean.** Ready to finalize.
