# Home-navigation logo heartbeat

## What

Whenever the app lands on the home board — the first render, and every return from the task detail, inbox, plan, or pipeline-flow view — the `⎇ Bridza` logo in the top-left sidebar header pulses like a heartbeat: a short, finite animation that plays and settles.

## Why

Coming back to home is the moment the eye has to re-anchor. A brief beat on the wordmark pulls focus to the product identity and the sidebar that anchors the whole UI, then gets out of the way. Tying it to the home view (rather than firing once ever) means the cue is there every time it is needed.

## How

- In `src/app/App.jsx`, derive `atHome` from the view state (`!planOpen && !inboxOpen && !flowOpen && !activeTask`) and keep a `logoPulse` counter that increments in an effect whenever `atHome` turns true. The hook sits above the early returns so hook order stays stable.
- Pass the counter to `Sidebar` (`src/app/features/nav.jsx`) as `pulseKey`. `Sidebar` renders the existing `.brand` element with `key={pulseKey}` and the `pulse` modifier class — the key change remounts the node, which is what restarts the CSS animation on every return home.
- Define the animation in `src/app/bridza.css` as a CSS keyframe on `transform: scale()` only (no layout-affecting properties): two quick beats then a rest, ~1.2s per cycle, 3 cycles, then the element settles at its normal size. No JS animation loop, no new dependency.
- Wrap the keyframe in a `@media (prefers-reduced-motion: no-preference)` guard so users who ask for reduced motion see a static logo.
- No `localStorage` marker: the trigger is view state, so nothing is persisted.

Out of scope: the landing-page logo in `src/pages/App.tsx`, animation triggered on project open / task start / reruns, a user setting to replay or disable the pulse, sound, and any change to the logo artwork itself.
