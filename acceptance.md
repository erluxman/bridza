# VS Code-like categorised Settings — Acceptance

## Layout

- [ ] Settings modal renders two panes: a category rail on the left, the selected
      category's settings on the right
- [ ] The rail shows one entry per `CATEGORIES` registry entry — today, exactly
      one: "Terminal"
- [ ] The first category is selected on open; selection resets to it each time
      the modal is reopened
- [ ] The active category is visually distinct and carries `aria-current="page"`
- [ ] Modal is wide enough for both panes (`.modal.wide`, `min(720px, 92vw)`) and
      the narrow `.modal` width is unchanged for every other modal
- [ ] The settings pane scrolls within a bounded height; the modal never grows
      past the viewport

## Terminal settings still work

- [ ] Font family select lists the same presets plus "Custom…"
- [ ] Choosing "Custom…" reveals the free-text font CSS input; a stored font that
      is not a preset opens with that input already shown
- [ ] Font size input accepts 8–32 and clamps out-of-range values on save
- [ ] Ligatures checkbox reflects and updates the stored value
- [ ] "Save" persists via `setTermSettings` and closes the modal
- [ ] "Cancel" / backdrop click closes without saving
- [ ] Saved changes still reach a live terminal (existing subscriber path
      unbroken)
- [ ] The redundant inline "Terminal" heading is gone — the rail names it

## Extensibility

- [ ] Adding a category requires appending one `{ id, label, Panel }` entry and
      writing that panel — no change to `SettingsModal`
- [ ] With a stubbed two-entry registry, clicking the second category swaps the
      right pane to its panel and the left pane's active state follows

## Not in this change

- [ ] No settings search box
- [ ] No per-setting reset, "modified" badge, or scope switcher
- [ ] No new settings or storage keys — `src/app/lib/settings.js` is untouched
- [ ] `src/app/features/nav.jsx` still opens the modal the same way

## Verification commands

- [ ] `src/app/__tests__/settings-categories.test.jsx` exists and covers rail
      rendering, Terminal save-through, and pane switching
- [ ] `pnpm test` passes
- [ ] `pnpm lint` passes
- [ ] `pnpm build` passes
