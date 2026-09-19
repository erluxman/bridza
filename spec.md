# Settings page in left navigation

## What

Add a Settings button at the bottom of the left sidebar navigation that opens the existing Settings modal when clicked. The button is always visible at the sidebar footer, separated from the scrollable pipeline list above.

## Why

Users need quick access to app settings without navigating away from their current context. Placing it at the bottom of the sidebar follows standard navigation patterns where account/settings controls live in the footer area.

## How

Extend `src/app/features/nav.jsx` Sidebar component:

- **Footer section**: Add a fixed footer area at the bottom of `.side` container that remains visible when the pipeline list scrolls
- **Settings button**: A button styled like other sidebar items (`pipe` class), labeled "⚙ Settings", opens the Settings modal on click
- **Modal integration**: Import `SettingsModal` from `./settings.jsx` and manage modal state (`settingsOpen` boolean) in the Sidebar component
- **Layout**: The scrollable area (`.side-scroll`) stops above the footer so the settings button never scrolls out of view

The Sidebar currently ends with the context menu markup (line 113-121). After that, add:

```jsx
<div className="side-footer">
  <button className="pipe" onClick={() => setSettingsOpen(true)}>⚙ Settings</button>
</div>
{settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
```

Add minimal CSS to `.bridza.css` for `.side-footer` styling (padding, border-top) to visually separate it from the scrollable area.

## Verification

- Settings button visible at bottom of left sidebar
- Clicking opens Settings modal (terminal font/size/ligatures)
- Button stays visible when scrolling the pipeline list
- Closing modal returns to previous state
- `pnpm test`, `pnpm lint`, `pnpm build` pass
