# Review — First-launch logo heartbeat

Branch `bridza/engineering/animate-the-logo-when-app-starts-for` → lands on `main`.

**Verdict: changes requested.** Two correctness defects (one of which defeats the feature on a genuine first launch), and the merge into `main` will **not** be clean.

## Acceptance Check

| | Criterion | Result |
|---|---|---|
| 1 | No Bridza keys → logo heartbeats on open | ⚠️ **Partial** — see A1 |
| 2 | Marker written on first mount; reload does not replay | ✅ |
| 3 | Every subsequent launch static | ✅ |
| 4 | Clearing the marker + reload replays | ✅ |
| 5 | `prefers-reduced-motion: reduce` → no animation, marker still written | ✅ |
| 6 | `transform` only; no shift/reflow; ends at original size | ✅ |
| 7 | `localStorage` unavailable → no animation, no error | ❌ **Fails** — see A2 |
| 8 | Test covers the state logic | ⚠️ **Letter only** — see A3 |
| 9 | `src/pages/App.tsx` unchanged | ✅ verified — `git diff main...HEAD -- src/pages/` is empty |
| 10 | `pnpm test`, `pnpm lint`, `pnpm build` pass | ⛔ **Not verified** — see A4 |

### A1 — On a real first launch the sidebar isn't mounted, but the marker is burned

`src/app/App.jsx:84`

```js
if (!dir || !proj) return <Welcome recents={recents} ... />;
```

A genuine first launch has *no* Bridza keys — including `bridza-project`. So `dir` is `""`, App returns `<Welcome>`, and `Sidebar` (the only thing that renders `.brand`) never mounts. Meanwhile the effect at `src/app/App.jsx:32` fires on that same mount and writes `bridza-logo-pulsed = "1"` unconditionally.

Within the session it partly recovers: `firstLaunch` stays `true` in state, so once the user picks a folder and the sidebar appears, the pulse does play. But the failure case is real and it's the common one —

> First launch → Welcome screen → user closes the app without picking a folder → marker is written → every later launch is static. The heartbeat is never seen, ever.

`proj.initialized === false` → `PipelinePicker` (`src/app/App.jsx:86`) has the same shape.

Fix: write the marker when the thing that animates actually mounts, not when `App` mounts. Move the effect into `Sidebar`, or gate it:

```js
// App.jsx — only burn the marker once the sidebar is actually on screen
const showSidebar = dir && proj && proj.available !== false && proj.initialized && !sideCollapsed;
useEffect(() => { if (firstLaunch && showSidebar) lsSet(LS.logo, "1"); }, [firstLaunch, showSidebar]);
```

### A2 — Storage-unavailable replays the animation on every launch

`src/app/App.jsx:31`, against `src/app/lib/format.js:8`

```js
export const lsGet = (k, def) => { try { ... } catch (e) { return def; } };
const [firstLaunch, setFirstLaunch] = useState(() => !lsGet(LS.logo, ""));
```

`lsGet` returns `def` both when the key is **absent** and when storage **throws**. The two are indistinguishable at the call site. So with `localStorage` unavailable:

- `lsGet(LS.logo, "")` → `""` → `!""` → `firstLaunch === true` → `.brand pulse` → **the animation plays**, violating "no animation".
- `lsSet` swallows the write error, so the marker can never be recorded → **it plays on every single launch**, which is exactly the "tic" the spec's *Why* section rules out.

The "no error" half of the criterion does hold.

Fix — read directly so the throw is distinguishable from the absent key:

```js
const [firstLaunch] = useState(() => { try { return localStorage.getItem(LS.logo) == null; } catch (e) { return false; } });
```

### A3 — The test asserts against a copy of the logic, not the logic

`src/app/__tests__/logo-pulse.test.jsx:29-33`

```js
function Harness() {
  const [firstLaunch] = useState(() => !lsGet(LS.logo, ""));
  useEffect(() => { if (firstLaunch) lsSet(LS.logo, "1"); }, [firstLaunch]);
  return <Sidebar ... firstLaunch={firstLaunch} />;
}
```

`Harness` re-implements `src/app/App.jsx:31-32` rather than importing it. Delete those two lines from `App.jsx` and this test still passes green. It satisfies the criterion's wording ("a test covers the state logic") but not its purpose.

This does mirror `welcome-dialog.test.jsx`, so it is house idiom and I'd accept it — but note that neither A1 nor A2 is catchable by a test shaped this way, which is partly how they got here. A single test that mounts `App` with a stubbed `api.getState` would cover both.

### A4 — The three commands were not run

`node_modules/` is empty in this worktree and the dependency install was declined, so `pnpm test`, `pnpm lint`, and `pnpm build` could not be executed. This row is unverified, not passed. Re-run before finalize.

Two things worth knowing about what those commands would actually prove here:

- `eslint.config.js:8` — `{ ignores: ["dist", "server", "e2e", "src/app", ...] }`. **`src/app` is ignored.** Every source file in this change lives under `src/app`, so `pnpm lint` does not look at any of them. A green lint says nothing about this diff.
- `tsconfig.app.json` sets `allowJs: true` without `checkJs`, so `tsc -b` parses the `.jsx` files but does not type-check them. `noUnusedLocals` therefore won't catch the dead setter below.

`pnpm test` is the only one of the three that exercises this change.

## Over-Engineering Analysis

The implementation is ~10 lines plus a keyframe. Nothing is structurally over-built — no speculative abstraction, no new dependency, no JS animation loop, no reinvented stdlib. Three small deletions:

- **`src/app/App.jsx:31` — delete `setFirstLaunch`.** It is never called. `const [firstLaunch] = useState(...)`. (Lint won't flag it; `src/app` is ignored.)
- **`src/app/App.jsx:32` — dep array `[firstLaunch]` → `[]`.** `firstLaunch` cannot change, so the dependency is decoration that implies a re-fire that can never happen. (Superseded if you apply the A1 fix, which introduces a dep that genuinely varies.)
- **`src/app/App.jsx:31` — the `""` default in `lsGet(LS.logo, "")` is inert.** `!undefined` is already `true`. Moot once A2 is fixed.

Two judgment calls I am explicitly **not** asking you to change:

- `stubLocalStorage` is copy-pasted from `welcome-dialog.test.jsx`. Two callers is not enough to justify a shared test helper, and the duplication is self-contained. Leave it.
- `useState` with a lazy initializer for a value that never changes is the idiomatic React way to compute-once. Not over-engineering.

One naming nit: `@keyframes heartbeat` (`src/app/bridza.css:53`) is a globally-scoped identifier in a single global stylesheet whose own precedent is prefixed — `plan-pulse` at `bridza.css:401`. Rename to `brand-heartbeat`. The `.brand.pulse` selector is fine; it's already scoped by `.brand`.

## Merge Readiness — into `main`

**The merge will NOT be clean.** `git merge-tree --write-tree main HEAD` reports **5 conflicts**:

| File | Conflict |
|---|---|
| `src/app/App.jsx` | Same line. `main` added `activeTask={activeTask}` to the `<Sidebar>` call; this branch added `firstLaunch={firstLaunch}`. |
| `src/app/features/nav.jsx` | Same line. `main` added `activeTask` to the `Sidebar({...})` param list (plus a `SettingsModal` import and a `.side-footer`); this branch added `firstLaunch`. |
| `.bridza/plan.json` | Both sides edited the plan. |
| `acceptance.md` | `main`'s copy is from a different task. |
| `spec.md` | `main`'s copy is from a different task. |

`src/app/bridza.css` auto-merges clean.

The two source conflicts are mechanical — keep both props on each line:

```js
// nav.jsx
export function Sidebar({ proj, running, runningTasks, active, activeTask, onPipe, ..., flash, firstLaunch }) {
```
```jsx
// App.jsx
<Sidebar ... active={activePipe} activeTask={activeTask} dir={dir} ... flash={flash} firstLaunch={firstLaunch} ...>
```

`acceptance.md` / `spec.md` at the repo root are per-task scratch files; `main` carries the previous task's copies. They conflict on every task and are resolved by taking this branch's side. `.bridza/plan.json` should take `main`'s side — `main` has moved well ahead (`a375090`, 16 dep gates vs. this branch's base).

The branch is based on `65f5aaa`, and `main` has ~100 commits since. Rebase or merge `main` in, re-resolve, then re-run `pnpm test` before finalize.

## Required before merge

1. Fix A1 — don't burn the marker while the sidebar is unmounted.
2. Fix A2 — distinguish "storage threw" from "key absent".
3. Bring `main` in and resolve the 5 conflicts.
4. Actually run `pnpm test` / `pnpm lint` / `pnpm build` and record the result.
5. Optional: the three deletions and the keyframe rename above.
