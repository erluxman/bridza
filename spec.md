# Change a tag's colour

## What

A tag's colour is editable after creation, from **every place a task is drawn**,
and it is a free colour rather than one of eight.

Three surfaces, all carrying the same picker:

- **Kanban card** — hover, press **L**, as today.
- **Plan board** — the task panel gains its chips and a 🏷 button.
- **Task detail rail** — a `Tags` row in the Task card, beside `Status`,
  `Branch` and `Target`.

In the picker, each existing tag's dot expands a row holding the eight presets
**and a full colour input**; the picker's **⚙** opens a manage-tags dialog
listing every tag in the registry with the same control on each. A change is
registry-wide and immediate: every chip and dot for that tag repaints. Tag name,
id, and which tasks carry the tag are untouched.

Tags also become visible on the plan board — colour dots on the task node, full
chips in the panel — the one place a task was drawn without them.

Out of scope: renaming a tag, deleting a tag, and a tags screen under Settings
(the ⚙ dialog is reachable from any picker instead).

## Why

Colour was assigned once and then permanent, and it was one of eight names.
`createTag` (`server/bridza-store.js`) early-returns the existing entry when the
slugged name already exists, ignoring the colour it was handed — so retyping a
name with a different swatch did nothing, and the only escape was a second,
differently-named tag. That is how a registry accumulates `billing` and
`billing-2`.

Editing from one surface only is the other half. `TagMenu` was private to
`board.jsx` and mounted on the kanban card alone, so a task looked at on the plan
board or on its own detail page could not be tagged or recoloured without
navigating back to the board.

## How

**Colour becomes a value.** `TAG_PALETTE` (`core/domain.js`) turns from eight
names into eight `#rrggbb` presets — the same values the old `.tag-<name>` CSS
rules resolved to — and `normalizeTagColor` accepts any hex (expanding `#abc`,
folding case) plus the legacy names through `LEGACY_TAG_COLORS`. `readRefs`
normalizes on the way out, so a `refs.json` written before this change needs no
migration pass: it reads as hex, and the next write persists hex.

**Rendering.** The eight `.tag-<name>` rules are gone. `tagStyle(color)` in
`features/tags.jsx` returns `{ color, borderColor: color + "55" }` — the same
~33% border alpha the palette rules used — and chips, dots, swatches and the
plan-board circles carry it inline.

**Store.** `updateTag(root, { id, color })` beside `createTag`: unknown id →
`{ ok: false, error }`, unparseable colour → `{ ok: false, error: "invalid
color" }`, otherwise set `refs.tags[id].color`, write and commit
(`bridza: recolor tag "<name>" (<id>) → <hex>`). Existence is checked with
`hasOwnProperty`, not truthiness — `refs.tags["constructor"]` is a function off
`Object.prototype`, and a bare truthiness check wrote a nameless tag to disk.
`createTag`, `setTaskTags` and the project projection share the same guard.

**Shared module.** `TagMenu` moves out of `board.jsx` into
`src/app/features/tags.jsx`, together with `TagChips`, the `TagManager` dialog,
and `useTagActions(dir, onChange, flash)` — the four writes the three surfaces
would otherwise each copy. Pipeline id is a per-call argument, not a hook
argument, because the plan board spans every pipeline at once and the registry
is per-pipeline.

`TagManager` is portalled to `document.body`: the picker that opens it is an
absolutely positioned, z-indexed menu, which is a stacking context that would
otherwise pin the modal underneath the app.

The colour input listens for the **native `change`** event, not React's
`onChange` — a colour input fires `input` continuously while the OS picker is
dragged, which would be one API round-trip and one git commit per pixel.

**Plan board** (`src/app/features/plan.jsx`) — `tags` carries into the task
model. On a node, a right-aligned row of `<circle>`s on the sub-text line
(`y ≈ 33`), capped at 4; the `<title>` naming all of them lives on the node's own
`<g>`, so the whole card is the hit area rather than a 7px dot. The pipeline
label truncates harder when tags are present, so the dots do not sit on it.
