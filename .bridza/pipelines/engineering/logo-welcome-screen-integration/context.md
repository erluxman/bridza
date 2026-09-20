# Integrate animated logo into Welcome screen on first launch

## Intent
Wire the animated logo and first-launch detection together: show the logo animation on the Welcome screen only on first app launch, then hide it permanently.

## What
- Modify `<Welcome />` component in src/app/features/onboarding.jsx
- Import the animated logo component and first-launch detection helper
- If first launch (detection function returns `true`), render the logo in a centered overlay above the welcome panel
- Logo animation plays to completion, then fades out
- After animation completes, mark the flag as seen (set localStorage)
- On subsequent launches, skip the logo animation entirely
- Ensure the animation doesn't block interaction with the welcome screen (dismiss via click or Esc)

## Acceptance criteria
- First app launch: animated logo displays center-screen above the welcome panel
- Animation plays once, then fades out (no loop)
- After animation completes, localStorage flag is set so it never plays again
- Clicking logo or pressing Esc dismisses it early
- Subsequent launches: no logo animation (Welcome screen loads normally)
- All existing Welcome screen functionality preserved
