# Acceptance — Home-navigation logo heartbeat

- [ ] Opening the app renders the home board and animates the top-left `⎇ Bridza` logo with a heartbeat pulse (double beat, then rest) that plays a finite number of cycles and stops.
- [ ] Opening a task, the inbox, the plan view, or the pipeline flow leaves the logo static — the animation does not loop while away from home.
- [ ] Returning to home (task detail back, sidebar pipeline click, closing the flow/inbox/plan) replays the pulse every time, not just once.
- [ ] Under `prefers-reduced-motion: reduce`, the logo does not animate.
- [ ] The animation uses CSS `transform` only — the sidebar header, project switcher, and pipeline list do not shift or reflow while it plays, and the logo ends at its original size.
- [ ] Nothing is written to `localStorage` for the pulse; clearing storage changes nothing about the behavior.
- [ ] A test covers the state logic: first render at home pulses; away from home stays static; returning home remounts the node so the animation restarts.
- [ ] `pnpm test`, `pnpm lint`, `pnpm build` pass.
