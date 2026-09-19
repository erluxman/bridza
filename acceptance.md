# Settings page in left navigation — Acceptance

## Sidebar footer

- [ ] Settings button appears at the bottom of the left sidebar
- [ ] Button is visible even when pipeline list is scrolled
- [ ] Button has a visual separator (border or spacing) from the scrollable content above

## Button interaction

- [ ] Clicking "⚙ Settings" opens the Settings modal
- [ ] Modal displays terminal settings (font family, font size, ligatures)
- [ ] Settings modal is the same as before (existing functionality preserved)
- [ ] Clicking "Save" closes modal and persists settings
- [ ] Clicking "Cancel" or "X" closes modal without saving

## Visual

- [ ] Button uses the same styling as other sidebar items (`pipe` class)
- [ ] Button shows "⚙ Settings" label
- [ ] Footer area does not scroll with pipeline list

## Verification commands

- [ ] `pnpm test` passes
- [ ] `pnpm lint` passes
- [ ] `pnpm build` passes
