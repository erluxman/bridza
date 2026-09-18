# Prompt history — Spec

One entry per "Run stage" press (oldest first). The same text is in each
run record in metadata.json and in the stage's commit message.

## 2026-09-18T18:45:24.123Z · run 1 · opencode

Task: Welcome dialog shows at most once per day

## WHAT & WHY

A welcome dialog that pops up on every reload would be noise. Once the user dismisses it, the app remembers for the rest of the calendar day that it was already seen, so reloading or revisiting the app the same day stays quiet. On a new calendar day the greeting returns until dismissed again. This follows from the intent "wishes me a good luck for the work I am doing for the day" — one greeting per day.

## ACCEPTANCE CRITERIA

- After dismissing the dialog, reloading/reopening the app the same day does not show it again.
- The dismissal is persisted per calendar day via `localStorage` (keyed by date), following the existing `LS` conventions in `src/app/App.jsx`; a new day resets it and the dialog reappears.
- Reuses the app's existing localStorage helpers/pattern; no new storage dependency or library.
- Tests cover both cases deterministically (dismiss + same-day reload = hidden; new date = shown); `pnpm test` passes.

