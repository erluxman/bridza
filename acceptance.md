# Acceptance — Change a tag's colour

## Reach — the picker is on all three surfaces

- [x] **Kanban card**: hover, press **L**, the picker opens as before.
- [x] **Plan board**: selecting a task shows its chips in the panel and a 🏷
      button that opens the same picker.
- [x] **Task detail rail**: the Task card carries a `Tags` row beside `Status`,
      `Branch` and `Target`, showing the task's chips and an add/edit button.
- [x] A task can carry any number of tags, and the row grows to fit them.
- [x] The detail page shows its tags in that rail row **only** — no chips beside
      the title, which stays a single ellipsised line.
- [x] The plan board's picker is scoped to the **selected task's own pipeline** —
      the registry is per-pipeline and the board spans all of them — and writes
      its assignment against that pipeline id.

## Colour is a free value

- [x] Each tag row's dot expands the eight presets **and a full colour input**;
      the preset matching the current colour reads as selected.
- [x] An off-palette colour (`#123456`) is accepted, stored and rendered exactly
      as picked — no class, no rounding to a preset.
- [x] Shorthand expands (`#0FA` → `#00ffaa`) and case folds down, so one colour
      has one spelling on disk.
- [x] A colour that is neither hex nor a legacy name (`chartreuse`, `#gg0000`,
      `#12345`, `rgb(1,2,3)`, `""`, `null`, `7`) → `{ ok: false, error:
      "invalid color" }`, nothing written.
- [x] The colour input commits on the OS picker's **`change`**, not on the
      `input` events fired throughout a drag — one write per colour chosen.

## The ⚙ dialog

- [x] The picker's ⚙ opens a dialog listing every tag in the registry with its
      colour control.
- [x] Recolouring from the dialog goes through the same `updateTag` path.
- [x] The dialog is portalled to `<body>` — rendered inside the z-indexed picker
      it would be trapped in that stacking context.
- [x] `Esc` closes the dialog.

## Recolouring

- [x] A recolour repaints the row's dot, the chips on every card carrying the
      tag, the task detail chips and the plan board's dots and chips, with no
      manual reload.
- [x] Recolouring never tags or untags the task the picker is open on; the tag's
      **name** still toggles assignment.
- [x] Only one tag's swatch row is expanded at a time; `Esc` closes the picker.
- [x] The colour survives a reload: `.bridza/refs.json` holds it for that tag id,
      with `name` and `taskTags` intact, committed at the repo root.
- [x] Creating a tag still works, and the "new tag…" row still preselects the
      next preset.

## Server

- [x] `updateTag` with a known id and any valid colour → `{ ok: true }`, written
      and committed.
- [x] `updateTag` with an unknown id → `{ ok: false, error }`, nothing on disk.
- [x] `updateTag` with an `Object.prototype` key (`constructor`, `__proto__`,
      `toString`, `hasOwnProperty`) is an **unknown tag**, not a silent write.
      `createTag`, `setTaskTags` and the project projection share the guard.
- [x] `POST /api/bridza/tag/update` reaches `updateTag` and returns its JSON.

## Legacy data

- [x] A `refs.json` holding a palette **name** (`"emerald"`) reads back as that
      name's hex, through both `tagsOf` and the project projection — no migration
      pass, nothing renders colourless.

## Plan board

- [x] A tagged task shows one dot per tag on its node; an untagged task is
      unchanged.
- [x] More than four tags → four dots, with every name still in the tooltip.
- [x] The tooltip is on the node's own `<g>`, so the whole card is the hit area
      rather than a 7px dot.
- [x] The pipeline label truncates harder when tags are present, so the dots do
      not land on the sub-text at the minimum node width.

## Regression

- [x] `pnpm lint` and `pnpm build` clean.
- [x] `pnpm test` — 306 passed. The one failure, `create-pr.test.js > falls back
      with the compose URL when gh is not on PATH`, is pre-existing and
      environment-dependent (a real `gh` is on this machine's PATH, so the "not
      installed" branch never runs). That file is untouched by this branch.

## Known gaps

- [ ] **No contrast floor.** A freely picked near-black renders as an
      unreadable chip on the dark `--bg-2` background. Deliberate: the result is
      visible the moment it is picked, and clamping would silently change the
      colour the user chose. A lightness floor is a ~15-line follow-up if wanted.
- [ ] Renaming and deleting a tag are still not possible anywhere.
