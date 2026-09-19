# First-launch logo heartbeat

## What

The very first time the Bridza app is opened on a given browser profile (or Electron install), the `⎇ Bridza` logo in the top-left sidebar header pulses like a heartbeat — a short, finite animation that plays once and never again on subsequent launches.

## Why

First launch is the only moment a new user has no idea where they are. A brief beat on the wordmark draws the eye to the product identity and the sidebar that anchors the whole UI, then gets out of the way. Repeating it on every launch would turn a welcome into a tic, so it fires once.

## How

- Add a first-launch marker key to the `LS` map in `src/app/lib/format.js` (e.g. `logo: "bridza-logo-pulsed"`), alongside the existing `dir` / `recents` / `side` / `welcome` keys.
- In `src/app/App.jsx`, read the marker once at mount: absent → this is the first launch. Pass a boolean down to `Sidebar` (`src/app/features/nav.jsx`) and write the marker immediately so a reload does not replay the animation.
- `Sidebar` applies a modifier class (e.g. `brand pulse`) to the existing `.brand` element when the flag is set.
- Define the animation in `src/app/bridza.css` as a CSS keyframe on `transform: scale()` only (no layout-affecting properties): two quick beats then a rest, ~1.2s per cycle, 3 cycles, then the element settles at its normal size. No JS animation loop, no new dependency.
- Wrap the keyframe in a `@media (prefers-reduced-motion: no-preference)` guard so users who ask for reduced motion see a static logo. The marker is still written for them.
- `localStorage` access follows the existing pattern in this codebase: guarded so private mode / unavailable storage degrades to "no animation" rather than a crash.

Out of scope: the landing-page logo in `src/pages/App.tsx`, any animation triggered on project open / task start / reruns, a user setting to replay or disable the pulse, sound, and any change to the logo artwork itself.
