# Detect first app launch via localStorage flag

## Intent
Create a localStorage-backed mechanism to detect whether this is the user's first time launching the app. This flag will gate the logo animation to only play once.

## What
- Add a new localStorage key `bridza.logoAnimated` (or reuse existing pattern)
- Set it to `true` after the animation plays once
- Provide a helper function that returns `true` if animation should run (flag not set)
- Does NOT handle the animation itself — just the detection logic

## Acceptance criteria
- First visit: detection function returns `true`
- After animation has played once: detection function returns `false`
- Clearing localStorage resets the flag
- Works across page reloads and browser restarts
- Key naming follows existing `LS.*` pattern in lib/format.js
