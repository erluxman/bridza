# Inbox Zero Confetti

## What

Show a confetti celebration animation when the user opens the inbox and it contains zero tasks (inbox is empty).

## Why

Celebrating inbox zero provides positive reinforcement and a sense of accomplishment, encouraging users to clear their tasks.

## How

In `src/app/App.jsx` and `src/app/features/nav.jsx`:

- Add a confetti library (e.g., `canvas-confetti`) as a dependency
- When `onInbox` is triggered and `inboxCount === 0`, fire the confetti animation
- Trigger confetti only once per session (use a ref to track if already shown)
- Confetti should be subtle but visible — a short burst (2-3 seconds)

## Verification

- Open inbox when it has items → no confetti
- Open inbox when empty → confetti animation plays
- Refresh and open empty inbox again → confetti plays (resets per session)
- `pnpm test`, `pnpm lint`, `pnpm build` pass