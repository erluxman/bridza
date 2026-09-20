# Review — Change a tag's colour

Task #112 · `engineering/i-should-be-able-to-change-the-color-of` · stage `review`

Branch `bridza/engineering/i-should-be-able-to-change-the-color-of` → lands on `main`.

**Verdict: approve with fixes.** The feature is built the way the spec described,
it is small, and it reuses what was already there — no new dependency, no new CSS,
no new abstraction. `pnpm lint` and `pnpm build` are clean; the two touched test
files pass (69 tests). One acceptance criterion is genuinely broken (F1, with a
repro below) and three layout criteria are partly unmet (F2–F4). All four fixes
are a few lines each.

**Merge into `main`: clean.** `git merge-tree --write-tree main HEAD` produces a
tree and exits 0 — no conflicts. `git diff main...HEAD` touches 15 files, all of
them this task's own (`server/bridge.js`, `server/bridza-store.js`,
`src/app/api/client.js`, `src/app/features/board.jsx`, `src/app/features/plan.jsx`,
two test files, plus the task's own `.bridza/` artifacts, `spec.md`,
`acceptance.md`). Nothing in the outputs names a branch, so there is no stale
landing-branch reference to correct.

---

## Acceptance

### Recolouring

| | Criterion | Notes |
|---|---|---|
| ✅ | dot click reveals the palette, current colour reads as selected | `board.jsx:60-68`; `.tag-swatch.on` already exists (`bridza.css:199`). Covered by test. |
| ✅ | swatch click recolours dot / card chips / task-detail chips, no manual reload | `recolorTag` → `onChange` → `App.jsx:165 onChange={refresh}`; the task topbar chips read `task.tags` from the refreshed `proj` (`task.jsx:364`). |
| ✅ | recolouring does not tag/untag, name still toggles | The dot and the name are separate buttons, both `stopPropagation`. Asserted: `expect(api.setTaskTags).not.toHaveBeenCalled()`. |
| ✅ | one swatch row at a time; `Esc` closes the picker | Single `open` state; `board.jsx:180` already clears `tagMenu` on Escape, which unmounts `TagMenu` and so resets `open`. Both asserted. |
| ✅ | colour survives reload/restart, `name` + `taskTags` intact, committed at repo root | Store test round-trips `refs.json` and asserts `git status --porcelain` is empty. |
| ✅ | creating a tag unchanged, "new tag…" still preselects the next colour | That block is untouched. |

### Server

| | Criterion | Notes |
|---|---|---|
| ✅ | valid id + palette colour → `{ ok: true }`, written and committed | |
| ✅ | colour off `TAG_PALETTE` → `{ ok: false, error: "invalid color" }`, nothing on disk | |
| ❌ | unknown id → `{ ok: false, error }`, nothing on disk | **F1** — holds for a plain unknown id, fails for `constructor`/`__proto__`. |
| ✅ | `POST /api/bridza/tag/update` reaches `updateTag`, returns JSON | `bridge.js:300-304`, mirrors `/tag/create`. No route has a test in this repo, so the missing one is the house style, not a gap. |

### Plan board

| | Criterion | Notes |
|---|---|---|
| ✅ | one dot per tag on the node, names in the tooltip, untagged task unchanged | Dots ✅ and the untagged path is guarded by `t.tags.length > 0`. Tooltip: see **F3**. |
| ✅ | >4 tags → four dots, tooltip still names all | `slice(0, 4)` for dots, full list in `<title>`. |
| ⚠️ | dots clear the `~Nh` estimate, the progress bar, the resize handle, at default size and after resize | Estimate ✅ (different line). Handle ✅ (rightmost dot ends at `nw-12.5`, handle starts at `nw-12`). Progress bar: **F4**. Sub-text: **F2**. |
| ✅ | selecting a task shows full chips in the side panel, kanban style | `plan.jsx:667`; `selTask` comes from `byKey`, built only from `tasks`, which all carry `tags: t.tags \|\| []` — no undefined-`.tags` path. |
| ✅ | recolouring from the kanban repaints plan-board dots and chips | Both read `proj`, which `refresh` reloads. |

### Regression

| | Criterion | Notes |
|---|---|---|
| ✅ | tests cover `updateTag`'s three outcomes + the picker recolour flow | `bridza-store.test.js:689`, `board-tags.test.jsx:139`. The picker test also pins "a second dot replaces the open row", which the acceptance only implies. |
| ⚠️ | `pnpm test`, `pnpm lint`, `pnpm build` pass | lint ✅, build ✅. `pnpm test` = 294 passed, **1 failed**: `create-pr.test.js > falls back with the compose URL when gh is not on PATH`. **Not this branch** — that file is untouched by the diff, and the same test fails on `main` (verified by running it in the `main` worktree). It fails because a real `gh` is on this machine's PATH, so the "not installed" branch is never taken. Pre-existing, environment-dependent. |

---

## Findings

### F1 — CONFIRMED · `updateTag` writes a bogus tag for inherited Object keys
`server/bridza-store.js:408` — `refs.tags[id]` is a truthiness check, so any
`Object.prototype` key passes as a "known" tag. Repro against a temp repo:

```
updateTag(root, { id: "constructor", color: "cyan" })
  → { ok: true, id: 'constructor', color: 'cyan' }
refs.json tags → {"billing":{...},"constructor":{"color":"cyan"}}
commit         → bridza: recolor tag "Object" (constructor) → cyan
updateTag(root, { id: "__proto__", color: "cyan" })
  → { ok: true, ... }        (silent success for a tag that does not exist)
```

That directly contradicts "unknown tag id returns `{ ok: false, error }` and
changes nothing on disk", and the `constructor` entry then renders as a nameless
row in the picker. `createTag` is immune because it slugs through `safeRef`;
`setTaskTags` shares the same truthiness pattern but only *reads* through it, so
this branch is where it first becomes a write. One line:

```js
if (!Object.prototype.hasOwnProperty.call(refs.tags, id)) return { ok: false, error: `unknown tag "${id}"` };
```

### F2 — PLAUSIBLE · the dots overlap the sub-text at the default node width
`src/app/features/plan.jsx:578` — non-wide nodes are at least 170px
(`W = 170`, `plan.jsx:160`), and `.pn-sub` is 10px mono (`bridza.css:422`), so
`trunc(t.pipe, 12) + " · " + "○ ready"` ≈ 22 chars ≈ 132px from `x=14`, ending
near **x≈146**. The second-from-right dot sits at `cx = nw-26 = 144`, spanning
140.5–147.5. Two or more tags on a minimum-width node with a 12-char pipeline
label therefore collide with the text the dots were placed beside. The acceptance
list only names the estimate, the bar and the handle, so this is not a stated
failure — but it undercuts the spec's reason for choosing that line. Cheapest fix:
shorten the sub-text when tags are present, e.g.
`trunc(t.pipe, wide ? 40 : t.tags.length ? 7 : 12)`. (Marked plausible rather than
confirmed: the arithmetic uses a 0.6em monospace advance, not a measured render.)

### F3 — CONFIRMED · the tooltip is on the dots, not the node
`plan.jsx:576-584` — the `<title>` lives inside the inner `<g>`, whose only
children are up to four r=3.5 circles. The plan node's own `<g>` has no `<title>`
of its own, so the names appear only when the pointer lands on a 7px dot; the
acceptance says "with the tag names in the node's tooltip", and for the >4-tags
case that hidden list is the *only* way to see the rest. Move the `<title>` up to
the node `<g>` (it is free — nothing there claims it today), or leave it where it
is and accept the smaller hit area as a deliberate call.

### F4 — CONFIRMED · dots cross the progress bar at the minimum node height
`plan.jsx:582` vs `plan.jsx:313` — resize clamps height at 38px. The bar is drawn
at `y = nh-4 = 34` with `height 3` (34–37); the dots span `cy 33 ± 3.5` = 29.5–36.5.
They overlap by ~2.5px. The acceptance names the progress bar explicitly, "after
resizing a card". Low impact — the sub-text baseline at `y=36` already clashes with
the bar at that height today, so a shrunk card is visually crowded regardless —
but if you want the criterion clean, either raise the clamp (`Math.max(46, …)`) or
hide the dots when `nh < 46`.

### F5 — cosmetic · the dot shifted 9px left and lost its hover
Moving `.tag-dot` out of `.item` cost it that button's `padding: 7px 9px`
(`bridza.css:69`), so the dot now sits 6px from the menu border instead of 15px,
while the tag *name* stays exactly where it was (6+7+6+9 = 28px either way).
`.item:hover` also no longer paints under the dot, leaving a 13px unhighlighted
strip at the left of each hovered row. `paddingLeft: 9` on the row `div` fixes
both.

---

## Over-engineering

Little to cut — the change adds no dependency, no config, no new component, and
reuses all eight existing palette classes. Three small deletions:

1. **`plan.jsx:581-582` — delete the `Math.min`.** `t.tags.slice(0, 4)` already
   knows the count; `Math.min(t.tags.length, 4)` recomputes it, and `t.tags` is
   read four times in three lines. Hoist once:
   ```js
   const dots = t.tags.slice(0, 4);
   …dots.map((g, i) => <circle … cx={nw - 16 - (dots.length - 1 - i) * 10} …/>)
   ```
2. **`bridza-store.js:414` — `{ ok: true, id, color }` can be `{ ok: true }`.**
   The only caller checks `r.ok` and nothing else (`board.jsx:203`); the echoed
   `id`/`color` exist solely because the store test asserts them. `createTag`
   returns `id` because its caller genuinely needs it — this one does not. Minor;
   skip it if you prefer the two store functions to look alike.
3. **`board.jsx:56 — the three inline style props on the dot button**
   (`border: 0, padding: 0, cursor: pointer`) repeat per row and re-declare what
   a stylesheet does better. One rule, `.tag-menu .tag-dot { border: 0; padding: 0;
   cursor: pointer; }`, replaces them — and gives F5's `padding-left` somewhere
   natural to live. The spec's "no new CSS" was a scoping note, not a goal worth
   paying inline styles for.

Explicitly **not** findings: `onRecolor` having a single caller (that is a
component boundary, not an abstraction); `title` + `aria-label` + `aria-pressed`
tripling up on each swatch (the pre-existing create-row swatches do exactly this,
and matching them beats being right in isolation); the `<div key={id}>` wrapper
(the swatch row needs a parent).
