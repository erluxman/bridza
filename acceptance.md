# Acceptance — First-launch logo heartbeat

- [ ] With no Bridza keys in `localStorage`, opening the app animates the top-left `⎇ Bridza` logo with a heartbeat pulse (double beat, then rest) that plays a finite number of cycles and stops.
- [ ] The first-launch marker is written to `localStorage` on that first mount; reloading the page does not replay the animation.
- [ ] Every subsequent launch renders the logo static.
- [ ] Clearing the marker key and reloading replays the animation (proves the trigger is the marker, not a one-off).
- [ ] Under `prefers-reduced-motion: reduce`, the logo does not animate on first launch, and the marker is still written.
- [ ] The animation uses CSS `transform` only — the sidebar header, project switcher, and pipeline list do not shift or reflow while it plays, and the logo ends at its original size.
- [ ] With `localStorage` unavailable (private mode / throwing), the app renders normally with no animation and no error.
- [ ] A test covers the state logic: marker absent → animate flag true and marker written; marker present → animate flag false.
- [ ] The landing page logo (`src/pages/App.tsx`) is unchanged.
- [ ] `pnpm test`, `pnpm lint`, and `pnpm build` all pass.
