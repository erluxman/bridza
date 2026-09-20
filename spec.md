# VS Code-like categorised Settings

## What

Restructure the Settings modal from a single flat form into a two-pane,
category-driven panel modelled on VS Code: a category rail on the left, the
selected category's settings on the right.

The categories are defined in one declarative registry. Today that registry
holds exactly one entry — **Terminal**, containing the font family / font size /
ligatures fields that already exist. No new settings are added. The deliverable
is the shell plus the registry that makes adding the next category a one-entry
change.

Out of scope (deliberately): a settings search box, per-setting reset, "modified"
badges, workspace-vs-user scopes, category persistence across opens, nested
sub-categories. These are the VS Code features we are *not* building now.

## Why

Settings currently render as one unbroken form. Every future setting appends to
that list until it is unreadable, and each addition touches the same component.
The captured intent is explicit: *"the settings should have a category like VS
code — we may not have all the features but that's the way we eventually will
go."* Committing to the categorised layout now, while there is one category and
three fields to migrate, costs one refactor. Doing it after five more settings
land costs a rewrite plus a re-learn for anyone already used to the old layout.

A single-category rail is the honest intermediate state and is what the intent
asks for: the structure is the feature, the content fills in later.

## How

**Registry** — in `src/app/features/settings.jsx`, above the component:

```jsx
const CATEGORIES = [
  { id: "terminal", label: "Terminal", Panel: TerminalPanel },
];
```

Each entry is `{ id, label, Panel }`. `Panel` is a component receiving
`{ value, onChange }` for its own slice of draft state. Adding a category means
appending one entry and writing its panel — no edit to `SettingsModal` itself.

**`TerminalPanel`** — extract the existing font family select, the custom-font
free-text fallback, the font size input, and the ligatures checkbox verbatim out
of `SettingsModal` into this component. Behaviour, `FONTS` list, clamping
(`Math.max(8, Math.min(32, …))`) and the `custom` toggle logic are unchanged;
this is a move, not a rewrite. Drop the now-redundant inline `Terminal`
`.side-label` heading — the category rail carries that name.

**`SettingsModal`** — keeps ownership of draft state and of `save`, which still
calls `setTermSettings` and then `onClose`. It adds:

- `const [active, setActive] = useState(CATEGORIES[0].id)` — selection lives in
  component state and resets to the first category on each open.
- A `.settings-body` two-column layout: `.settings-cats` rail of `<button>`s
  (one per registry entry, `aria-current="page"` on the active one) and a
  `.settings-pane` that renders the active entry's `Panel`.

**Modal width** — `.modal` is `min(440px, 92vw)`, too narrow for two panes. Add
an optional `wide` prop to `Modal` in `src/app/ui.jsx` that appends a `wide`
class, and pass it here. In `src/app/bridza.css` add `.modal.wide { width:
min(720px, 92vw); }`.

**CSS** — in `src/app/bridza.css`: `.settings-body` as a two-column grid
(fixed rail ~160px, flexible pane), `.settings-pane` scrollable with a bounded
max-height so long categories scroll rather than growing the modal past the
viewport, `.settings-cats button` styled to match existing sidebar items with a
visible active state, and a divider between the columns. Use existing
`--bg-*` / `--line-*` custom properties; do not introduce new colour values.

Unchanged: `src/app/lib/settings.js` (storage keys, defaults, subscribers),
`src/app/features/nav.jsx` (still renders `<SettingsModal onClose={…} />`), and
the live-update path into the terminal.

## Verification

- New test `src/app/__tests__/settings-categories.test.jsx`, in the existing
  raw `react-dom/client` + `act` + jsdom style used by `welcome-dialog.test.jsx`
  (with the same in-memory `localStorage` stub), covering:
  - the rail renders one button per `CATEGORIES` entry, first active by default;
  - the Terminal panel's fields render and Save writes through
    `getTermSettings()`, i.e. the migrated behaviour still works;
  - rendering `SettingsModal` with a stubbed two-entry registry switches panes on
    click — the extensibility claim, tested rather than asserted.
- `pnpm test`, `pnpm lint`, `pnpm build` pass.
